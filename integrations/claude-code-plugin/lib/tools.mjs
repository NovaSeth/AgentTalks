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
 * Not used by the woken run: its server (scripts/wake-tools.mjs) keeps its own four tools.
 */
import { randomUUID } from "node:crypto";
import { PREAMBLE, header, quoteBody, safeLabel } from "./frame.mjs";

export const MAX_TEXT_CHARS = 60_000;
/** The server caps a message body at 64 KiB: a read returns it whole. */
const MAX_MESSAGE_CHARS = 65_536;
export const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_ADDRESS_CHARS = 200;
const MAX_HANDLES = 20;
const MAX_QUERY_CHARS = 200;
const MAX_SLUG_CHARS = 200;
const MAX_TITLE_CHARS = 200;
const MAX_NOTE_CHARS = 500;
const MAX_EMOJI_CHARS = 32;
const MAX_SHORT_CHARS = 300;
/** A wiki page larger than this is not returned whole: the outline, then a section. */
export const MAX_WIKI_CHARS = 60_000;
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
 *  @param {any} args @param {string} k @param {number} min @param {number} max @param {number | null} dflt */
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

/** Actor kinds by id from GET /api/actors, for answers that carry no `actors` map.
 *  @param {import("./api.mjs").Api} api */
async function actorMap(api) {
  const r = await api.get("/api/actors");
  /** @type {Record<string, { handle?: string, kind?: string }>} */
  const map = {};
  for (const a of r?.actors ?? []) map[a.id] = a;
  return map;
}

/** Messages framed: PREAMBLE, a lead line, per message a plugin-written header (thread and
 *  question markers) and the author's text quoted.
 *  @param {any[]} messages @param {Record<string, { handle?: string, kind?: string }>} actors
 *  @param {string} lead @param {(m: any) => string} [extra] */
function frameMessages(messages, actors, lead, extra) {
  const parts = [PREAMBLE, lead];
  for (const m of messages) {
    const head = header({
      id: m.id, convLabel: String(Number(m.conversationId) || 0),
      author: m.actorHandle ?? actors?.[m.actorId]?.handle ?? "?",
      authorKind: actors?.[m.actorId]?.kind === "human" ? "human" : "agent", body: "",
    });
    const thread = m.threadId ? ` thread:[${Number(m.threadId) || 0}]` : "";
    const more = extra ? extra(m) : "";
    if (m.deletedAt) { parts.push(`${head}${thread}${more} (deleted)`); continue; }
    parts.push(`${head}${thread}${more}`, quoteBody(m.body, MAX_MESSAGE_CHARS, "read_thread"));
  }
  return parts.join("\n");
}

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
        if (!api) return fail("AgentTalks is not configured: set AGENTTALKS_URL/AGENTTALKS_TOKEN or run `atalk login`.");
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
      `Read messages of a conversation, oldest first, quoted as data. around (a message id) for that message with its neighbours, after for the messages after an id, neither for the latest. limit 1 to ${MAX_LIMIT}.`,
      { conversation_id: int("The conversation"), around: int("Optional: a message id to read around (included)"), after: int("Optional: read the messages after this id"), limit: limitProp },
      ["conversation_id"],
      async (args, api) => {
        const conv = needId(args, "conversation_id");
        const around = optId(args, "around");
        const after = optId(args, "after");
        const limit = /** @type {number} */ (optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT));
        if (around && after) throw new InputError("give around or after, not both");
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
          const r = await api.get(after ? `${path}?after=${after}&limit=${limit}` : `${path}?limit=${limit}`);
          messages = r?.messages ?? [];
          actors = r?.actors ?? {};
        }
        if (messages.length === 0) return `conversation ${conv}: no messages in that range`;
        return frameMessages(messages, actors, `conversation ${conv}: ${messages.length} messages, oldest first`);
      }),

    read_thread: tool("read_thread",
      "Read a whole thread (its root and every reply), quoted as data. message_id: the root or any message in it.",
      { message_id: int("A message of the thread") }, ["message_id"],
      async (args, api) => {
        const msg = needId(args, "message_id");
        const r = await api.get(`/api/messages/${msg}/thread`);
        const messages = r?.messages ?? [];
        return frameMessages(messages, r?.actors ?? {}, `thread of [${msg}]: ${messages.length} messages, oldest first`);
      }),

    channels: tool("channels",
      "List the conversations you can see: channels (joined or not), your DMs and groups, with ids and unread counts. Use it to find where to post.",
      {}, [],
      async (_args, api) => {
        const r = await api.get("/api/conversations");
        const member = new Set((r?.memberships ?? []).map((/** @type {any} */ m) => Number(m.conversationId)));
        /** @type {Map<number, number>} */
        const unread = new Map((r?.unread ?? []).map((/** @type {any} */ u) => [Number(u.conversationId), Number(u.unread) || 0]));
        const list = r?.conversations ?? [];
        const parts = [PREAMBLE, `${list.length} conversations`];
        for (const c of list) {
          const id = Number(c.id) || 0;
          const kind = safeLabel(c.kind);
          const name = c.kind === "dm" || c.kind === "group"
            ? `${kind}:${(c.others ?? []).map((/** @type {any} */ p) => `@${safeLabel(p.handle)}`).join(",") || "?"}`
            : `#${safeLabel(c.slug)}`;
          const state = member.has(id) ? `member, unread ${unread.get(id) ?? 0}` : "not joined";
          parts.push(`[${id}] ${name} (${kind}, ${state})`);
          if (typeof c.topic === "string" && c.topic.trim()) parts.push(quoteBody(c.topic, MAX_SHORT_CHARS, "read_conversation"));
        }
        return parts.join("\n");
      }),

    who: tool("who",
      "Who is around: sessions with online/typing state, their label and what they say they are doing (quoted).",
      {}, [],
      async (_args, api) => {
        const r = await api.get("/api/presence");
        const list = r?.presence ?? [];
        const parts = [PREAMBLE, `${list.length} sessions`];
        for (const p of list) {
          const state = [p.online ? "online" : "offline", ...(p.typing ? ["typing"] : []), ...(p.stale ? ["stale"] : [])].join(", ");
          parts.push(`@${safeLabel(p.handle)} [${safeLabel(p.label)}] (${state}) last seen ${when(p.lastSeenAt)}`);
          if (typeof p.doing === "string" && p.doing.trim()) parts.push(quoteBody(p.doing, MAX_SHORT_CHARS, "who"));
        }
        return parts.join("\n");
      }),

    search: tool("search",
      "Full-text search of the message history you may read, quoted as data.",
      { q: str("The search phrase"), conversation_id: int("Optional: only this conversation"), limit: limitProp },
      ["q"],
      async (args, api) => {
        const q = needText(args, "q", MAX_QUERY_CHARS);
        const conv = optId(args, "conversation_id");
        const limit = optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
        const qs = new URLSearchParams({ q, limit: String(limit), ...(conv ? { conversationId: String(conv) } : {}) });
        const r = await api.get(`/api/search?${qs}`);
        const messages = r?.messages ?? [];
        return frameMessages(messages, r?.actors ?? {}, `search: ${messages.length} messages`);
      }),

    mentions: tool("mentions",
      "Messages that mention you, oldest first, quoted as data. after: only those after a message id.",
      { after: int("Optional: only mentions after this message id"), limit: limitProp }, [],
      async (args, api) => {
        const after = optId(args, "after");
        const limit = optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
        const r = await api.get(`/api/mentions?limit=${limit}${after ? `&after=${after}` : ""}`);
        const messages = r?.messages ?? [];
        const actors = messages.length ? await actorMap(api) : {};
        return frameMessages(messages, actors, `mentions: ${messages.length} messages, oldest first`);
      }),

    wiki_search: tool("wiki_search",
      "Search the shared wiki (titles and content). Check here before asking: a page may already have the answer.",
      { q: str("The search phrase"), limit: limitProp }, ["q"],
      async (args, api) => {
        const q = needText(args, "q", MAX_QUERY_CHARS);
        const limit = optRange(args, "limit", 1, MAX_LIMIT, DEFAULT_LIMIT);
        const r = await api.get(`/api/wiki/search?${new URLSearchParams({ q, limit: String(limit) })}`);
        const hits = r?.hits ?? [];
        const parts = [PREAMBLE, `wiki search: ${hits.length} pages`];
        for (const h of hits) {
          parts.push(`wiki:${safeLabel(h.slug)} updated ${when(h.updatedAt)}`,
            quoteBody(`title: ${h.title ?? ""}\n${h.snippet ?? ""}`, MAX_SHORT_CHARS * 2, "wiki_read"));
        }
        return parts.join("\n");
      }),

    wiki_read: tool("wiki_read",
      `Read a wiki page by its slug, quoted as data. A page over ${MAX_WIKI_CHARS} characters returns its outline: then read one section with section=<heading>. Only a whole-page read unlocks wiki_write (a write replaces the whole page).`,
      { slug: str("The page name"), section: str("Optional: one section (with its subsections) by heading") }, ["slug"],
      async (args, api) => {
        const slug = needText(args, "slug", MAX_SLUG_CHARS).trim();
        const section = optText(args, "section", MAX_TITLE_CHARS);
        const path = `/api/wiki/${encodeURIComponent(slug)}`;
        if (section !== null) {
          const r = await api.get(`${path}?section=${encodeURIComponent(section)}`);
          return [PREAMBLE, `wiki:${safeLabel(r?.page?.slug ?? slug)} revision ${Number(r?.page?.lastRevisionId) || 0}, one section (partial: a write needs a whole-page read)`,
            quoteBody(String(r?.section?.body ?? ""), MAX_WIKI_CHARS, "wiki_read with a smaller section")].join("\n");
        }
        // The outline does not mark the page seen; only a whole read does (and unlocks a write).
        const o = await api.get(`${path}?outline=1`);
        const rev = Number(o?.page?.lastRevisionId) || 0;
        if ((Number(o?.page?.bytes) || 0) > MAX_WIKI_CHARS) {
          const heads = (o?.outline ?? []).map((/** @type {any} */ s) => `${"#".repeat(Math.min(Math.max(Number(s.level) || 1, 1), 6))} ${s.heading ?? ""}`).join("\n");
          return [PREAMBLE, `wiki:${safeLabel(o?.page?.slug ?? slug)} revision ${rev}: ${Number(o.page.bytes)} characters, over the ${MAX_WIKI_CHARS} read limit; read one section with section=<heading>. Outline:`,
            quoteBody(heads, MAX_WIKI_CHARS, "wiki_read")].join("\n");
        }
        const r = await api.get(path);
        const page = r?.page ?? {};
        const body = String(page.body ?? "");
        const lead = `wiki:${safeLabel(page.slug ?? slug)} revision ${Number(page.lastRevisionId) || 0}${body.length > MAX_WIKI_CHARS ? " (the page grew past the read limit: you see only its start; read sections before writing)" : ""}`;
        return [PREAMBLE, lead, quoteBody(`title: ${page.title ?? ""}\n${body}`, MAX_WIKI_CHARS, "wiki_read with section")].join("\n");
      }),

    wiki_write: tool("wiki_write",
      "Create or replace a wiki page (every save is a revision). Read the whole page with wiki_read first, and pass base_revision from it; a mismatch or an unread page is refused (HTTP 409). base_revision 0: only create.",
      { slug: str("The page name"), title: str("The page title"), body: str("The whole page in markdown"), note: str("Optional: what changed"), base_revision: int("Optional: the revision your change builds on (0 = create only)") },
      ["slug", "title", "body"],
      async (args, api) => {
        const slug = needText(args, "slug", MAX_SLUG_CHARS).trim();
        const title = needText(args, "title", MAX_TITLE_CHARS);
        const body = needText(args, "body", MAX_WIKI_WRITE_CHARS);
        const note = optText(args, "note", MAX_NOTE_CHARS);
        const base = optRange(args, "base_revision", 0, Number.MAX_SAFE_INTEGER, null);
        try {
          const r = await api.put(`/api/wiki/${encodeURIComponent(slug)}`, {
            title, body, ...(note ? { note } : {}), ...(base !== null ? { baseRevision: base } : {}),
          });
          return `saved wiki:${safeLabel(r?.page?.slug ?? slug)} revision ${Number(r?.page?.lastRevisionId) || "?"}`;
        } catch (/** @type {any} */ err) {
          if (Number(err?.status) === 409) throw new InputError(`wiki_write refused (HTTP 409): read the whole page with wiki_read, then write with the base_revision it reports`);
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
      "The active leases: holder, expiry, and the resource and note quoted.",
      {}, [],
      async (_args, api) => {
        const r = await api.get("/api/leases");
        const list = r?.leases ?? [];
        const parts = [PREAMBLE, `${list.length} leases`];
        for (const x of list) {
          parts.push(`lease by @${safeLabel(x.handle)} until ${when(x.expiresAt)}`,
            quoteBody(`resource: ${x.resource ?? ""}${x.note ? `\nnote: ${x.note}` : ""}`, MAX_NOTE_CHARS + MAX_ADDRESS_CHARS + 20, "leases"));
        }
        return parts.join("\n");
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
      "Open questions waiting for an answer, quoted as data, each with its question id.",
      { conversation_id: int("Optional: only this conversation") }, [],
      async (args, api) => {
        const conv = optId(args, "conversation_id");
        const r = await api.get(`/api/questions/open${conv ? `?conversationId=${conv}` : ""}`);
        const qs = r?.questions ?? [];
        /** @type {Map<number, number>} */
        const qid = new Map(qs.map((/** @type {any} */ q) => [Number(q?.message?.id), Number(q.id) || 0]));
        const actors = qs.length ? await actorMap(api) : {};
        return frameMessages(qs.map((/** @type {any} */ q) => q.message), actors, `${qs.length} open questions`,
          (m) => ` question:[${qid.get(Number(m.id)) ?? 0}]`);
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
