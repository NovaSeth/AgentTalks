// @ts-check
/**
 * The common-action tools of the live-session channel (T-MG-40,
 * docs/specs/T-MG-40-plugin-full-api.md): send, read, list, search, wiki, leases, questions
 * and reactions over the AgentTalks REST API, so an agent with only this plugin installed can
 * do the everyday things without the remote MCP server. Everything else is REST, documented in
 * the bundled skill (skills/agenttalks/SKILL.md).
 *
 * Authorization: every tool first checks that there is an api (an identity) and that
 * principalOk() resolves true, exactly like the channel's `reply`; the api is the channel's one
 * client bound to the resolved identity, and no tool takes a URL, a token or an actor.
 *
 * Untrusted text: anything another actor could have written (message bodies, topics, wiki
 * titles, bodies and snippets, presence labels and `doing`, lease resources and notes) is
 * framed by lib/frame.mjs: the result opens with PREAMBLE, headers are built from ids and
 * safeLabel()ed handles, free text is quoted line by line.
 *
 * Size (r1 F3): every result, framing included, stays within MAX_RESULT_CHARS. A list keeps the
 * whole items that fit (one item is cut at MAX_ITEM_CHARS) and ends with a plugin-written cursor
 * line (after=, before=, skip= or offset=) the agent passes back for the rest.
 *
 * Wiki writes (r1 F1, F2): wiki_write sends a base revision only when wiki_read delivered that
 * revision WHOLE in this process (the complete framed page within the budget, title and last
 * line included). An outline, a section, a part read with offset, a page over the budget or one
 * that grew between the outline and the full read proves nothing and unlocks nothing; the
 * server then refuses a stale base revision (HTTP 409).
 *
 * Not used by the woken run: its server (scripts/wake-tools.mjs) keeps its own four tools.
 */
import { randomUUID } from "node:crypto";
import { PREAMBLE, header, quoteBody, safeLabel } from "./frame.mjs";

export const MAX_TEXT_CHARS = 60_000;
/** The whole result of one tool call, framing included. */
export const MAX_RESULT_CHARS = 50_000;
/** One item (a message, a lease, ...) inside a result; a longer one is cut with a note. */
const MAX_ITEM_CHARS = 40_000;
/** Room kept for the cursor line. */
const NOTE_RESERVE = 400;
export const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_SKIP = 150;
const MAX_ADDRESS_CHARS = 200;
const MAX_HANDLES = 20;
const MAX_QUERY_CHARS = 200;
const MAX_SLUG_CHARS = 200;
const MAX_TITLE_CHARS = 200;
const MAX_NOTE_CHARS = 500;
const MAX_EMOJI_CHARS = 32;
const MAX_SHORT_CHARS = 300;
const MAX_WIKI_WRITE_CHARS = 500_000;
const MAX_TTL_SEC = 86_400;
const HANDLE = /^@?([A-Za-z0-9._-]+)$/;

/** The tools, in the order tools/list shows them (after reply, typing, mark_read). */
export const API_TOOL_NAMES = /** @type {const} */ ([
  "send", "read_conversation", "read_thread", "channels", "who", "search", "mentions",
  "wiki_search", "wiki_read", "wiki_write", "claim", "release", "leases",
  "ask", "answer", "open_questions", "react",
]);

class InputError extends Error {}

/** @param {string} text */
const fail = (text) => ({ text, isError: true });

/** @param {unknown} v */
function positiveInt(v) {
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** @param {any} args @param {string} k */
const given = (args, k) => args?.[k] !== undefined && args?.[k] !== null;

/** A required positive integer. @param {any} args @param {string} k */
function needId(args, k) {
  const n = positiveInt(args?.[k]);
  if (!n) throw new InputError(`${k} must be a positive integer`);
  return n;
}
/** An optional positive integer (null when absent). @param {any} args @param {string} k */
function optId(args, k) { return given(args, k) ? needId(args, k) : null; }
/** An optional integer in [min, max], `dflt` when absent.
 *  @template {number | null} D
 *  @param {any} args @param {string} k @param {number} min @param {number} max @param {D} dflt
 *  @returns {number | D} */
function optRange(args, k, min, max, dflt) {
  if (!given(args, k)) return dflt;
  const v = args[k];
  const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new InputError(`${k} must be an integer from ${min} to ${max}`);
  return n;
}
/** A required string, non-empty after trim, at most `max` characters.
 *  @param {any} args @param {string} k @param {number} max */
function needText(args, k, max) {
  const v = args?.[k];
  if (typeof v !== "string" || !v.trim()) throw new InputError(`${k} must be a non-empty string`);
  if (v.length > max) throw new InputError(`${k} is longer than ${max} characters`);
  return v;
}
/** @param {any} args @param {string} k @param {number} max */
function optText(args, k, max) { return given(args, k) ? needText(args, k, max) : null; }

/** @param {number} ts unix seconds (or ms) */
function when(ts) {
  const n = Number(ts) || 0;
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/** One framed item cut to `max` characters at a line boundary, with a plugin-written note.
 *  Cutting the framed text (not the raw body) keeps every shown line behind its "> ".
 *  @param {string} text @param {number} [max] */
function capItem(text, max = MAX_ITEM_CHARS) {
  if (text.length <= max) return text;
  const room = max - 200;
  // At a line end when one is close, else inside the long line (it stays behind its "> ").
  let cut = text.lastIndexOf("\n", room);
  if (cut < room - 2000) cut = room;
  return `${text.slice(0, cut)}\n[truncated: ${text.length - cut} more characters of this item are not shown; the agenttalks skill shows how to read it whole over REST]`;
}

/**
 * PREAMBLE, the lead line, then whole items while the result stays within MAX_RESULT_CHARS.
 * With `fromEnd`, the LAST items that fit are kept (the newest), in their order. When an item
 * is left out, or `more` is set, `cursor(picked)` adds one plugin-written line saying how to
 * read on.
 * @param {string} lead @param {string[]} items
 * @param {(picked: number[]) => string} cursor
 * @param {{ fromEnd?: boolean, more?: boolean }} [o]
 */
function budgeted(lead, items, cursor, o = {}) {
  const capped = items.map((t) => capItem(t));
  let size = PREAMBLE.length + 1 + lead.length + NOTE_RESERVE;
  /** @type {number[]} */
  const picked = [];
  for (let k = 0; k < capped.length; k++) {
    const i = o.fromEnd ? capped.length - 1 - k : k;
    if (size + capped[i].length + 1 > MAX_RESULT_CHARS) break;
    size += capped[i].length + 1;
    picked.push(i);
  }
  picked.sort((a, b) => a - b);
  const parts = [PREAMBLE, lead, ...picked.map((i) => capped[i])];
  if (picked.length > 0 && (picked.length < items.length || o.more)) parts.push(cursor(picked));
  return parts.join("\n");
}

/**
 * `text` from `offset`, quoted, as much as fits in `room` characters, cut at a line end.
 * @param {string} text @param {number} offset @param {number} room
 * @returns {{ quoted: string, next: number | null }}
 */
function chunk(text, offset, room) {
  let end = Math.min(text.length, offset + room);
  for (;;) {
    let cut = end;
    let next = end;
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > offset) { cut = nl; next = nl + 1; }
    }
    const quoted = quoteBody(text.slice(offset, cut), Number.MAX_SAFE_INTEGER, "wiki_read");
    if (quoted.length <= room || cut - offset < 64) return { quoted, next: next < text.length ? next : null };
    end = offset + Math.floor((cut - offset) * 0.8);
  }
}

/** Actor kinds by id from GET /api/actors, for answers that carry no `actors` map.
 *  @param {import("./api.mjs").Api} api */
async function actorMap(api) {
  const r = await api.get("/api/actors");
  /** @type {Record<string, { handle?: string, kind?: string }>} */
  const map = {};
  for (const a of r?.actors ?? []) map[a.id] = a;
  return map;
}

/** One message framed: a plugin-written header (thread and question markers), the author's
 *  text quoted. @param {any} m @param {Record<string, { handle?: string, kind?: string }>} actors
 *  @param {string} [more] */
function frameItem(m, actors, more = "") {
  const head = header({
    id: m.id, convLabel: String(Number(m.conversationId) || 0),
    author: m.actorHandle ?? actors?.[m.actorId]?.handle ?? "?",
    authorKind: actors?.[m.actorId]?.kind === "human" ? "human" : "agent", body: "",
  });
  const thread = m.threadId ? ` thread:[${Number(m.threadId) || 0}]` : "";
  if (m.deletedAt) return `${head}${thread}${more} (deleted)`;
  return `${head}${thread}${more}\n${quoteBody(m.body, MAX_ITEM_CHARS, "the REST API")}`;
}

/** @param {any[]} list @param {number[]} picked */
const idAt = (list, picked, which = picked.length - 1) => Number(list[picked[which]]?.id) || 0;

/**
 * Resolves a send address to a conversation id: a numeric id, `#slug` (a channel you can see),
 * `@handle` (a DM) or `@a,@b` (a group DM, created or found by the server).
 * @param {import("./api.mjs").Api} api @param {string} raw
 */
async function resolveAddress(api, raw) {
  const to = raw.trim();
  if (/^\d+$/.test(to)) return { id: Number(to) };
  const ch = /^#([A-Za-z0-9._-]+)$/.exec(to);
  if (ch) {
    const r = await api.get("/api/conversations");
    const slug = ch[1].toLowerCase();
    const c = (r?.conversations ?? []).find((/** @type {any} */ x) =>
      (x.kind === "public" || x.kind === "private") && String(x.slug ?? "").toLowerCase() === slug);
    if (!c) throw new InputError(`no channel #${slug} you can see; list them with channels`);
    return { id: Number(c.id) };
  }
  if (to.startsWith("@")) {
    const parts = to.split(",").map((p) => p.trim());
    const handles = parts.map((p) => HANDLE.exec(p)?.[1] ?? null);
    if (handles.some((h) => !h)) throw new InputError("to: handles are letters, digits, '.', '_' or '-', as @a or @a,@b");
    if (handles.length > MAX_HANDLES) throw new InputError(`to: at most ${MAX_HANDLES} handles`);
    const r = await api.post("/api/conversations", {
      kind: handles.length === 1 ? "dm" : "group", members: handles.map((h) => `@${h}`),
    });
    const id = positiveInt(r?.conversation?.id);
    if (!id) throw new InputError("to: the server did not return a conversation");
    return { id };
  }
  throw new InputError("to must be #channel, @handle, @a,@b or a conversation id");
}

/**
 * @param {{
 *   api: import("./api.mjs").Api | null,
 *   principalOk: () => Promise<boolean>,
 *   sessionId?: string,
 * }} o
 * @returns {Record<string, import("./mcp.mjs").Tool>}
 */
export function createApiTools(o) {
  const session = o.sessionId ? { sessionId: o.sessionId } : {};
  /** Per wiki slug, the revisions wiki_read delivered whole (or wiki_write saved) in this
   *  process, the newest last: the only proof wiki_write accepts (r1 F1, F2).
   *  @type {Map<string, number[]>} */
  const delivered = new Map();
  /** @param {string} slug @param {number} rev */
  const proved = (slug, rev) => {
    if (!(rev > 0)) return;
    const list = (delivered.get(slug) ?? []).filter((r) => r !== rev);
    list.push(rev);
    delivered.set(slug, list.slice(-20));
  };
  /**
   * One tool: the guard (identity, principal), then `run`; an input mistake or a failed
   * request comes back as isError, never as a throw.
   * @param {string} name @param {string} description @param {Record<string, any>} properties
   * @param {string[]} required
   * @param {(args: any, api: import("./api.mjs").Api) => Promise<string>} run
   * @returns {import("./mcp.mjs").Tool}
   */
  function tool(name, description, properties, required, run) {
    return {
      description,
      inputSchema: { type: "object", properties, required, additionalProperties: false },
      async handler(args) {
        const api = o.api;
        if (!api) return fail("AgentTalks is not configured: set AGENTTALKS_URL/AGENTTALKS_TOKEN or run `atalks login`.");
        if (!(await o.principalOk().catch(() => false))) return fail("AgentTalks is not connected as the principal this run was woken for.");
        try {
          return { text: await run(args, api) };
        } catch (err) {
          if (err instanceof InputError) return fail(err.message);
          return fail(`${name} failed: ${err instanceof Error ? err.message : "error"}`);
        }
      },
    };
  }
  const int = (/** @type {string} */ d) => ({ type: "integer", description: d });
  const str = (/** @type {string} */ d) => ({ type: "string", description: d });
  const limitProp = int(`Optional: how many, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`);
  const skipProp = int(`Optional: skip this many (0 to ${MAX_SKIP}), from the cursor line of the previous result`);
  const budgetNote = `A result is at most ${MAX_RESULT_CHARS} characters; when more exists it ends with a cursor line to call again with.`;

  /** @type {Record<string, import("./mcp.mjs").Tool>} */
  const tools = {
    send: tool("send",
      "Send a message as yourself to #channel, @handle (a DM, created if needed), @a,@b (a group DM) or a conversation id. Writing to a person may wake them (a real model run): do it when it is worth that.",
      { to: str("#channel, @handle, @a,@b or a conversation id"), text: str("The message text (markdown)"), thread_id: int("Optional: the message to answer in its thread") },
      ["to", "text"],
      async (args, api) => {
        const to = needText(args, "to", MAX_ADDRESS_CHARS);
        const text = needText(args, "text", MAX_TEXT_CHARS);
        const thread = optId(args, "thread_id");
        const { id } = await resolveAddress(api, to);
        const r = await api.post(`/api/conversations/${id}/messages`, {
          body: text, ...(thread ? { threadId: thread } : {}), clientMsgId: randomUUID(), ...session,
        });
        return `sent [${Number(r?.message?.id) || "?"}] in conversation ${id}`;
      }),

    read_conversation: tool("read_conversation",
      `Read messages of a conversation, oldest first, quoted as data. around (a message id) for that message with its neighbours, after for the messages after an id, before for those before one, none of them for the latest. limit 1 to ${MAX_LIMIT}. ${budgetNote}`,
      { conversation_id: int("The conversation"), around: int("Optional: a message id to read around (included)"), after: int("Optional: read the messages after this id"), before: int("Optional: read the messages before this id"), limit: limitProp },
      ["conversation_id"],
      async (args, api) => {
        const conv = needId(args, "conversation_id");
        const around = optId(args, "around");
        const after = optId(args, "after");
        const before = optId(args, "before");
        const limit = optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
        if ([around, after, before].filter((x) => x !== null).length > 1) throw new InputError("give at most one of around, after and before");
        const path = `/api/conversations/${conv}/messages`;
        /** @type {any[]} */
        let messages;
        /** @type {Record<string, any>} */
        let actors;
        if (around) {
          const older = limit - Math.floor((limit - 1) / 2);
          const r1 = await api.get(`${path}?before=${around + 1}&limit=${older}`);
          const newer = limit - older;
          const r2 = newer > 0 ? await api.get(`${path}?after=${around}&limit=${newer}`) : { messages: [], actors: {} };
          const byId = new Map();
          for (const m of [...(r1?.messages ?? []), ...(r2?.messages ?? [])]) byId.set(m.id, m);
          messages = [...byId.values()].sort((x, y) => x.id - y.id);
          actors = { ...(r1?.actors ?? {}), ...(r2?.actors ?? {}) };
        } else {
          const q = after ? `after=${after}&` : before ? `before=${before}&` : "";
          const r = await api.get(`${path}?${q}limit=${limit}`);
          messages = [...(r?.messages ?? [])].sort((x, y) => x.id - y.id);
          actors = r?.actors ?? {};
        }
        if (messages.length === 0) return `conversation ${conv}: no messages in that range`;
        // The latest (or those before an id): keep the newest that fit, page back with before=.
        const back = !around && !after;
        return budgeted(`conversation ${conv}: ${messages.length} messages, oldest first`,
          messages.map((m) => frameItem(m, actors)),
          (picked) => back
            ? `[showing ${picked.length} of ${messages.length}; older ones: call read_conversation again with before=${idAt(messages, picked, 0)}]`
            : `[showing ${picked.length} of ${messages.length}; newer ones: call read_conversation again with after=${idAt(messages, picked)}]`,
          { fromEnd: back });
      }),

    read_thread: tool("read_thread",
      `Read a thread (its root and replies), oldest first, quoted as data. message_id: the root or any message in it; after: only messages after an id (the cursor of the previous result). ${budgetNote}`,
      { message_id: int("A message of the thread"), after: int("Optional: only messages after this id"), limit: int(`Optional: at most this many, 1 to ${MAX_LIMIT} (default ${MAX_LIMIT})`) },
      ["message_id"],
      async (args, api) => {
        const msg = needId(args, "message_id");
        const after = optId(args, "after");
        const limit = optRange(args, "limit", 1, MAX_LIMIT, MAX_LIMIT);
        const r = await api.get(`/api/messages/${msg}/thread`);
        const all = [...(r?.messages ?? [])].sort((x, y) => x.id - y.id).filter((m) => !after || Number(m.id) > after);
        const page = all.slice(0, limit);
        return budgeted(`thread of [${msg}]: ${all.length} messages${after ? ` after [${after}]` : ""}, oldest first`,
          page.map((m) => frameItem(m, r?.actors ?? {})),
          (picked) => `[showing ${picked.length} of ${all.length}; the rest: call read_thread again with after=${idAt(page, picked)}]`,
          { more: all.length > page.length });
      }),

    channels: tool("channels",
      `List the conversations you can see: channels (joined or not), your DMs and groups, with ids and unread counts. after: only ids after this one (the cursor). ${budgetNote}`,
      { after: int("Optional: only conversations with a larger id") }, [],
      async (args, api) => {
        const after = optId(args, "after");
        const r = await api.get("/api/conversations");
        const member = new Set((r?.memberships ?? []).map((/** @type {any} */ m) => Number(m.conversationId)));
        /** @type {Map<number, number>} */
        const unread = new Map((r?.unread ?? []).map((/** @type {any} */ u) => [Number(u.conversationId), Number(u.unread) || 0]));
        const list = [...(r?.conversations ?? [])].sort((x, y) => x.id - y.id).filter((c) => !after || Number(c.id) > after);
        const items = list.map((c) => {
          const id = Number(c.id) || 0;
          const kind = safeLabel(c.kind);
          const name = c.kind === "dm" || c.kind === "group"
            ? `${kind}:${(c.others ?? []).map((/** @type {any} */ p) => `@${safeLabel(p.handle)}`).join(",") || "?"}`
            : `#${safeLabel(c.slug)}`;
          const state = member.has(id) ? `member, unread ${unread.get(id) ?? 0}` : "not joined";
          const line = `[${id}] ${name} (${kind}, ${state})`;
          return typeof c.topic === "string" && c.topic.trim() ? `${line}\n${quoteBody(c.topic, MAX_SHORT_CHARS, "read_conversation")}` : line;
        });
        return budgeted(`${list.length} conversations`, items,
          (picked) => `[showing ${picked.length} of ${list.length}; the rest: call channels again with after=${idAt(list, picked)}]`);
      }),

    who: tool("who",
      `Who is around: sessions with online/typing state, their label and what they say they are doing (quoted). ${budgetNote}`,
      { skip: skipProp }, [],
      async (args, api) => {
        const skip = optRange(args, "skip", 0, Number.MAX_SAFE_INTEGER, 0);
        const r = await api.get("/api/presence");
        const all = r?.presence ?? [];
        const list = all.slice(skip);
        const items = list.map((/** @type {any} */ p) => {
          const state = [p.online ? "online" : "offline", ...(p.typing ? ["typing"] : []), ...(p.stale ? ["stale"] : [])].join(", ");
          const line = `@${safeLabel(p.handle)} [${safeLabel(p.label)}] (${state}) last seen ${when(p.lastSeenAt)}`;
          return typeof p.doing === "string" && p.doing.trim() ? `${line}\n${quoteBody(p.doing, MAX_SHORT_CHARS, "who")}` : line;
        });
        return budgeted(`${all.length} sessions${skip ? `, from ${skip}` : ""}`, items,
          (picked) => `[showing ${picked.length} of ${list.length}; the rest: call who again with skip=${skip + picked.length}]`);
      }),

    search: tool("search",
      `Full-text search of the message history you may read, quoted as data. ${budgetNote}`,
      { q: str("The search phrase"), conversation_id: int("Optional: only this conversation"), limit: limitProp, skip: skipProp },
      ["q"],
      async (args, api) => {
        const q = needText(args, "q", MAX_QUERY_CHARS);
        const conv = optId(args, "conversation_id");
        const limit = optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
        const skip = optRange(args, "skip", 0, MAX_SKIP, 0);
        const qs = new URLSearchParams({ q, limit: String(skip + limit), ...(conv ? { conversationId: String(conv) } : {}) });
        const r = await api.get(`/api/search?${qs}`);
        const fetched = r?.messages ?? [];
        const messages = fetched.slice(skip);
        return budgeted(`search: ${messages.length} messages${skip ? `, from ${skip}` : ""}`,
          messages.map((/** @type {any} */ m) => frameItem(m, r?.actors ?? {})),
          (picked) => skip + picked.length <= MAX_SKIP ? `[showing ${picked.length}; more may match: call search again with skip=${skip + picked.length}]` : `[showing ${picked.length}; more may match: narrow the query]`,
          { more: fetched.length >= skip + limit && skip + limit < MAX_SKIP + MAX_LIMIT });
      }),

    mentions: tool("mentions",
      `Messages that mention you, oldest first, quoted as data. after: only those after a message id (the cursor). ${budgetNote}`,
      { after: int("Optional: only mentions after this message id"), limit: limitProp }, [],
      async (args, api) => {
        const after = optId(args, "after");
        const limit = optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
        const r = await api.get(`/api/mentions?limit=${limit}${after ? `&after=${after}` : ""}`);
        const messages = [...(r?.messages ?? [])].sort((x, y) => x.id - y.id);
        const actors = messages.length ? await actorMap(api) : {};
        return budgeted(`mentions: ${messages.length} messages, oldest first`,
          messages.map((m) => frameItem(m, actors)),
          (picked) => `[showing ${picked.length}; more may exist: call mentions again with after=${idAt(messages, picked)}]`,
          { more: messages.length >= limit });
      }),

    wiki_search: tool("wiki_search",
      `Search the shared wiki (titles and content). Check here before asking: a page may already have the answer. ${budgetNote}`,
      { q: str("The search phrase"), limit: limitProp }, ["q"],
      async (args, api) => {
        const q = needText(args, "q", MAX_QUERY_CHARS);
        const limit = optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
        const r = await api.get(`/api/wiki/search?${new URLSearchParams({ q, limit: String(limit) })}`);
        const hits = r?.hits ?? [];
        return budgeted(`wiki search: ${hits.length} pages`,
          hits.map((/** @type {any} */ h) => `wiki:${safeLabel(h.slug)} updated ${when(h.updatedAt)}\n${quoteBody(`title: ${h.title ?? ""}\n${h.snippet ?? ""}`, MAX_SHORT_CHARS * 2, "wiki_read")}`),
          (picked) => `[showing ${picked.length} of ${hits.length}; narrow the query for the rest]`);
      }),

    wiki_read: tool("wiki_read",
      `Read a wiki page by its slug, quoted as data. A page whose framed text fits in ${MAX_RESULT_CHARS} characters comes whole, and only such a whole read unlocks wiki_write for its revision. A larger one returns its outline: read a section with section=<heading>, or the page in parts with offset (each result ends with the next offset); parts and sections never unlock a write.`,
      { slug: str("The page name"), section: str("Optional: one section (with its subsections) by heading"), offset: int("Optional: read from this character offset (the cursor of the previous part)") }, ["slug"],
      async (args, api) => {
        const slug = needText(args, "slug", MAX_SLUG_CHARS).trim();
        const section = optText(args, "section", MAX_TITLE_CHARS);
        const offset = optRange(args, "offset", 0, Number.MAX_SAFE_INTEGER, null);
        const path = `/api/wiki/${encodeURIComponent(slug)}`;
        const room = MAX_RESULT_CHARS - NOTE_RESERVE - 600;
        /** A part of `text` from `offset`: never a proof for a write.
         *  @param {string} lead @param {string} text @param {number} from @param {string} again */
        const part = (lead, text, from, again) => {
          const { quoted, next } = chunk(text, Math.min(from, text.length), room);
          return [PREAMBLE, `${lead} (partial: does not unlock wiki_write)`, quoted,
            next !== null ? `[more: call wiki_read again with ${again}offset=${next}]` : "[end]"].join("\n");
        };
        if (section !== null) {
          const r = await api.get(`${path}?section=${encodeURIComponent(section)}`);
          return part(`wiki:${safeLabel(r?.page?.slug ?? slug)} revision ${Number(r?.page?.lastRevisionId) || 0}, one section${offset ? ` from offset ${offset}` : ""}`,
            String(r?.section?.body ?? ""), offset ?? 0, "the same section and ");
        }
        if (offset !== null) {
          const r = await api.get(path);
          return part(`wiki:${safeLabel(r?.page?.slug ?? slug)} revision ${Number(r?.page?.lastRevisionId) || 0}, from offset ${offset}`,
            String(r?.page?.body ?? ""), offset, "");
        }
        // The outline does not mark the page seen; only a whole read can prove anything.
        const ol = await api.get(`${path}?outline=1`);
        const outlineRev = Number(ol?.page?.lastRevisionId) || 0;
        if ((Number(ol?.page?.bytes) || 0) <= MAX_RESULT_CHARS) {
          const r = await api.get(path);
          const page = r?.page ?? {};
          const rev = Number(page.lastRevisionId) || 0;
          const whole = [PREAMBLE, `wiki:${safeLabel(page.slug ?? slug)} revision ${rev}, the whole page`,
            quoteBody(`title: ${page.title ?? ""}\n${String(page.body ?? "")}`, Number.MAX_SAFE_INTEGER, "wiki_read")].join("\n");
          if (whole.length <= MAX_RESULT_CHARS) {
            proved(slug, rev);
            return whole;
          }
          // Grown since the outline, or too many lines once quoted: nothing is delivered.
          return [PREAMBLE, `wiki:${safeLabel(page.slug ?? slug)} revision ${rev}: too large for one result once quoted (it does not unlock wiki_write); read it in parts with offset=0, or a section with section=<heading>`].join("\n");
        }
        const heads = (ol?.outline ?? []).map((/** @type {any} */ s) => `${"#".repeat(Math.min(Math.max(Number(s.level) || 1, 1), 6))} ${s.heading ?? ""}`).join("\n");
        return [PREAMBLE, `wiki:${safeLabel(ol?.page?.slug ?? slug)} revision ${outlineRev}: ${Number(ol.page.bytes)} characters, too large for one result (an outline does not unlock wiki_write); read a section with section=<heading>, or the page in parts with offset=0. Outline:`,
          capItem(quoteBody(heads, Number.MAX_SAFE_INTEGER, "wiki_read"))].join("\n");
      }),

    wiki_write: tool("wiki_write",
      "Create or replace a wiki page (every save is a revision). Allowed only for a page wiki_read delivered whole in this session (its revision is sent as the base, so a page changed since is refused, HTTP 409), or with base_revision 0 to create a page that does not exist yet.",
      { slug: str("The page name"), title: str("The page title"), body: str("The whole page in markdown"), note: str("Optional: what changed"), base_revision: int("Optional: a revision wiki_read delivered whole (default: the newest one it delivered); 0 = create only") },
      ["slug", "title", "body"],
      async (args, api) => {
        const slug = needText(args, "slug", MAX_SLUG_CHARS).trim();
        const title = needText(args, "title", MAX_TITLE_CHARS);
        const body = needText(args, "body", MAX_WIKI_WRITE_CHARS);
        const note = optText(args, "note", MAX_NOTE_CHARS);
        const asked = optRange(args, "base_revision", 0, Number.MAX_SAFE_INTEGER, null);
        const known = delivered.get(slug) ?? [];
        /** @type {number} */
        let base;
        if (asked === 0) base = 0;
        else if (asked !== null) {
          if (!known.includes(asked)) throw new InputError(`wiki_write refused: revision ${asked} of wiki:${safeLabel(slug)} was not delivered whole by wiki_read in this session; read the whole page with wiki_read first`);
          base = asked;
        } else {
          if (known.length === 0) throw new InputError(`wiki_write refused: read the whole page wiki:${safeLabel(slug)} with wiki_read first (or pass base_revision 0 to create a new page)`);
          base = known[known.length - 1];
        }
        try {
          const r = await api.put(`/api/wiki/${encodeURIComponent(slug)}`, {
            title, body, ...(note ? { note } : {}), baseRevision: base,
          });
          const rev = Number(r?.page?.lastRevisionId) || 0;
          proved(slug, rev);
          return `saved wiki:${safeLabel(r?.page?.slug ?? slug)} revision ${rev || "?"}`;
        } catch (/** @type {any} */ err) {
          if (Number(err?.status) === 409) throw new InputError("wiki_write refused (HTTP 409): the page changed since your read, or exists already (base_revision 0); read the whole page with wiki_read again");
          throw err;
        }
      }),

    claim: tool("claim",
      `Take an exclusive lease on a shared resource before you touch it (ttl_sec 1 to ${MAX_TTL_SEC}, default 120; claim again to renew). Refused when somebody else holds it.`,
      { resource: str("The resource, e.g. deploy or wiki/ops"), ttl_sec: int("Optional: lease length in seconds"), note: str("Optional: why (others see it)") },
      ["resource"],
      async (args, api) => {
        const resource = needText(args, "resource", MAX_ADDRESS_CHARS);
        const ttl = optRange(args, "ttl_sec", 1, MAX_TTL_SEC, null);
        const note = optText(args, "note", MAX_NOTE_CHARS);
        try {
          const r = await api.post("/api/leases", { resource, ...(ttl ? { ttlSec: ttl } : {}), ...(note ? { note } : {}), ...session });
          return `granted until ${when(r?.lease?.expiresAt)}`;
        } catch (/** @type {any} */ err) {
          if (Number(err?.status) !== 409) throw err;
          const l = await api.get("/api/leases").catch(() => null);
          const held = (l?.leases ?? []).find((/** @type {any} */ x) => x.resource === resource);
          throw new InputError(held ? `not granted: held by @${safeLabel(held.handle)} until ${when(held.expiresAt)}` : "not granted: somebody else holds it");
        }
      }),

    release: tool("release",
      "Release a lease you took with claim.",
      { resource: str("The resource") }, ["resource"],
      async (args, api) => {
        const resource = needText(args, "resource", MAX_ADDRESS_CHARS);
        try {
          await api.post("/api/leases/release", { resource });
          return "released";
        } catch (/** @type {any} */ err) {
          if (Number(err?.status) === 409) throw new InputError("not released: somebody else holds it");
          throw err;
        }
      }),

    leases: tool("leases",
      `The active leases: holder, expiry, and the resource and note quoted. ${budgetNote}`,
      { skip: skipProp }, [],
      async (args, api) => {
        const skip = optRange(args, "skip", 0, Number.MAX_SAFE_INTEGER, 0);
        const r = await api.get("/api/leases");
        const all = r?.leases ?? [];
        const list = all.slice(skip);
        return budgeted(`${all.length} leases${skip ? `, from ${skip}` : ""}`,
          list.map((/** @type {any} */ x) => `lease by @${safeLabel(x.handle)} until ${when(x.expiresAt)}\n${quoteBody(`resource: ${x.resource ?? ""}${x.note ? `\nnote: ${x.note}` : ""}`, MAX_NOTE_CHARS + MAX_ADDRESS_CHARS + 20, "leases")}`),
          (picked) => `[showing ${picked.length} of ${list.length}; the rest: call leases again with skip=${skip + picked.length}]`);
      }),

    ask: tool("ask",
      "Post an open question to a conversation; anybody who comes back can answer it.",
      { conversation_id: int("The conversation"), text: str("The question") }, ["conversation_id", "text"],
      async (args, api) => {
        const conv = needId(args, "conversation_id");
        const text = needText(args, "text", MAX_TEXT_CHARS);
        const r = await api.post(`/api/conversations/${conv}/ask`, { body: text, ...session });
        return `asked question ${Number(r?.question) || "?"} as [${Number(r?.message?.id) || "?"}] in conversation ${conv}`;
      }),

    answer: tool("answer",
      "Answer an open question (question_id from open_questions) and close it.",
      { question_id: int("The question"), text: str("The answer") }, ["question_id", "text"],
      async (args, api) => {
        const q = needId(args, "question_id");
        const text = needText(args, "text", MAX_TEXT_CHARS);
        const r = await api.post(`/api/questions/${q}/answer`, { body: text, ...session });
        return `answered question ${q} with [${Number(r?.message?.id) || "?"}]`;
      }),

    open_questions: tool("open_questions",
      `Open questions waiting for an answer, quoted as data, each with its question id. after: only question ids after this one (the cursor). ${budgetNote}`,
      { conversation_id: int("Optional: only this conversation"), after: int("Optional: only questions with a larger id") }, [],
      async (args, api) => {
        const conv = optId(args, "conversation_id");
        const after = optId(args, "after");
        const r = await api.get(`/api/questions/open${conv ? `?conversationId=${conv}` : ""}`);
        const qs = [...(r?.questions ?? [])].sort((x, y) => x.id - y.id).filter((q) => !after || Number(q.id) > after);
        const actors = qs.length ? await actorMap(api) : {};
        return budgeted(`${qs.length} open questions`,
          qs.map((q) => frameItem(q.message ?? {}, actors, ` question:[${Number(q.id) || 0}]`)),
          (picked) => `[showing ${picked.length} of ${qs.length}; the rest: call open_questions again with after=${idAt(qs, picked)}]`);
      }),

    react: tool("react",
      "React to a message with an emoji (the same emoji again removes it).",
      { message_id: int("The message"), emoji: str("The emoji") }, ["message_id", "emoji"],
      async (args, api) => {
        const msg = needId(args, "message_id");
        const emoji = needText(args, "emoji", MAX_EMOJI_CHARS).trim();
        await api.post(`/api/messages/${msg}/reactions`, { emoji });
        return `reaction toggled on [${msg}]`;
      }),
  };
  return tools;
}
