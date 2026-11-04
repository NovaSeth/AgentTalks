// @ts-check
/**
 * Which stream events reach the agent's session. The SSE stream already carries only
 * conversations the actor is a member of (src/http/sse.ts subscribes per actor, and
 * src/core/messages.ts publishes to recipientsOf = the members), so the SENDER GATE is the
 * server's membership check. This filter narrows further to what deserves an interruption:
 *
 *   - a DM or group DM (kind dm/group),
 *   - a mention of the agent, or @all/@channel/@here in one of its conversations,
 *   - a reply in a thread the agent started or replied in,
 *   - any message in a conversation whose notify setting is "all",
 *
 * and never: the agent's own messages, edits (message_updated), deleted messages, anything
 * in a conversation the agent muted (notify "none" - the server mutes notifications there
 * too), and nothing from a conversation it is not a member of unless the SERVER says it was
 * mentioned (the /api/mentions list, which applies the server's read-access rule).
 *
 * The mention parser mirrors src/core/mentions.ts (MENTION_RE and transliteration). It is a
 * copy, not an import, because the plugin must run from a git checkout without the server's
 * TypeScript sources being loadable; the test pins the behaviour.
 */

// Same pattern as src/core/mentions.ts: a mention is preceded by the start of the text or a
// character that is not part of a word, so an e-mail address is not a mention.
const MENTION_RE = /(^|[^\p{L}\p{N}_@.-])@([\p{L}\p{N}][\p{L}\p{N}._-]{1,31})/gu;
/** Collective mentions, as in src/core/mentions.ts ALL_ALIASES. */
export const ALL_ALIASES = new Set(["all", "channel", "here", "wszyscy", "kanal"]);

/** Polish letters NFD does not decompose (the stroke l), mapped as the server maps them. */
const PL = new Map([
  ["\u0105", "a"], ["\u0107", "c"], ["\u0119", "e"], ["\u0142", "l"], ["\u0144", "n"],
  ["\u00f3", "o"], ["\u015b", "s"], ["\u017a", "z"], ["\u017c", "z"],
]);

/** @param {string} s */
export function transliterate(s) {
  return [...s.toLowerCase()].map((c) => PL.get(c) ?? c).join("")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Handles mentioned in a body, lower-cased and transliterated. @param {string} body */
export function mentionsIn(body) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of String(body ?? "").matchAll(MENTION_RE)) {
    const h = transliterate(m[2]).replace(/[._-]+$/, "");
    if (h.length >= 2) out.add(h);
  }
  return out;
}

/**
 * @typedef {{ notify: "all" | "mentions" | "none", kind: string }} Membership
 * @typedef {{
 *   me: { id: number, handle: string },
 *   memberships: Map<number, Membership>,
 *   threads: Set<number>,
 * }} FilterState
 * @typedef {{ id: number, conversationId?: number, actorId: number, body?: string,
 *   threadId: number | null, deletedAt?: number | null, kind?: string,
 *   actorHandle?: string }} Msg
 * @typedef {"dm" | "mention" | "all" | "thread" | "channel"} PushKind
 */

/** @param {{ id: number, handle: string }} me @returns {FilterState} */
export function newFilterState(me) {
  return { me, memberships: new Map(), threads: new Set() };
}

/** Records the agent's own message: its thread (or itself, as a thread root) now counts as
 *  "a thread I started or replied in". @param {FilterState} state @param {Msg} msg */
export function noteOwn(state, msg) {
  if (msg.actorId !== state.me.id) return;
  state.threads.add(msg.threadId ?? msg.id);
}

/**
 * @param {{ type: string, conversationId?: number, message?: Msg }} event
 * @param {FilterState} state
 * @param {{ serverMention?: boolean }} [opts]
 * @returns {{ kind: PushKind } | null}
 */
export function classify(event, state, opts = {}) {
  // Only a NEW message pushes. message_updated is an edit or a deletion of something already
  // seen: re-pushing it as new would show the agent the same message twice.
  if (!event || event.type !== "message" || !event.message) return null;
  const msg = event.message;
  if (msg.actorId === state.me.id) return null;
  if (msg.deletedAt) return null;
  const convId = Number(msg.conversationId ?? event.conversationId);
  const mem = state.memberships.get(convId);

  if (!mem) {
    // Not a member: only the server's own mention record lets it through (a public channel
    // the agent was called into). A client-side parse is not trusted for this.
    return opts.serverMention ? { kind: "mention" } : null;
  }
  if (mem.notify === "none") return null;
  if (mem.kind === "dm" || mem.kind === "group") return { kind: "dm" };

  const handles = mentionsIn(msg.body ?? "");
  if (handles.has(transliterate(state.me.handle))) return { kind: "mention" };
  for (const h of handles) if (ALL_ALIASES.has(h)) return { kind: "all" };
  // The server's mention list also lists @all calls: only a call it lists that the parse
  // did not explain is a personal mention.
  if (opts.serverMention) return { kind: "mention" };
  if (msg.threadId && state.threads.has(msg.threadId)) return { kind: "thread" };
  if (mem.notify === "all") return { kind: "channel" };
  return null;
}
