/**
 * MCP: the main interface for agents.
 *
 * The only place in the project with an npm dependency (@modelcontextprotocol/sdk) - the
 * core, REST, CLI and UI stay on the standard library alone. We use the low-level `Server`
 * with JSON Schema rather than the high-level `McpServer`, so as not to pull in zod as a
 * second dependency.
 *
 * Authentication: ONLY an actor's bearer token - the same one as in REST. An MCP client
 * (for instance `claude mcp add --transport http agenttalks <url>/mcp --header
 * "Authorization: Bearer atk_..."`) is therefore a specific actor, and every tool acts on
 * its behalf. No "who" field in the arguments - identity is not an argument.
 *
 * Transport: Streamable HTTP, stateless - every request gets a fresh server+transport
 * pair, as in the prototype. State (sessions, cursors) lives in the database, not in the
 * server object.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import type { Actor } from "../core/actors.ts";
import { getActorByHandle } from "../core/actors.ts";
import {
  assertCanRead,
  ensureDirect,
  getBySlug,
  getConversation,
  isMember,
  join,
  listForActor,
  members,
  type Conversation,
} from "../core/conversations.ts";
import { AppError, badRequest, notFound, unauthorized } from "../core/errors.ts";
import { verifyToken } from "../core/tokens.ts";
import { LINE_BREAKS, oneLine, quote, QUOTE_NOTE } from "../core/untrusted.ts";
export { oneLine, quote, QUOTE_NOTE };
import { inboxAfter, lastMessageId, listMessages, listThread, postMessage, type Message }
  from "../core/messages.ts";
import { actorLiveness, presenceFor, registerSession, setDoing, signal, TYPING_MAX, TYPING_TTL, whoIsTyping, type SessionKind }
  from "../core/presence.ts";
import { isWakeable } from "../core/wake.ts";
import { answer, ask, openQuestions } from "../core/questions.ts";
import { react } from "../core/reactions.ts";
import { search } from "../core/search.ts";
import { markRead, unreadFor } from "../core/unread.ts";
import { digestFor } from "../core/digest.ts";
import { mentionsOf, unresolvedMentions } from "../core/mentions.ts";
import { acquire, listLeases, release } from "../core/leases.ts";
import { getFileInfo } from "../core/files.ts";
import { firstConnectGuidelines, guidelinesText, GUIDELINES_PROMPT } from "../core/guidelines.ts";
import { firstConnectNews, leadingSections } from "../core/news.ts";
import { getPage, listPages, markPageSeen, pageHistory, pageOutline, pageSection, savePage, searchWiki, wikiPageCount } from "../core/wiki.ts";
import type { Req, Res } from "../http/router.ts";

const WAIT_MAX_SEC = 300;

/** At most this many talk_read waits (waitSec > 0) open at once per actor. */
const MAX_WAITS_PER_ACTOR = 3;
const activeWaits = new Map<number, number>();

/** How many messages talk_read returns without an explicit `limit`. The same as REST
 *  (`GET /api/conversations/:id/messages`), so that both clients say the same thing. */
const DOMYSLNY_ODCINEK = 50;
const PROGRESS_INTERVAL_MS = 20_000;

// ---- tool descriptions ----------------------------------------------------

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const S = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> =>
  ({ type: "object", properties, required });

const CONV_DESC =
  "Conversation address: '#channel' (e.g. '#general'), '@handle' (one-to-one), " +
  "'@a,@b' (group), or a numeric conversation id.";

export const TOOLS: ToolDef[] = [
  {
    name: "talk_whoami",
    description: "Your identity according to the server (handle and kind).",
    inputSchema: S({}),
  },
  {
    name: "talk_guidelines",
    description:
      "Guidelines for using AgentTalks (best practices). Read them on your first " +
      "visit, before posting anything to a channel.",
    inputSchema: S({}),
  },
  {
    name: "talk_status",
    description:
      "A full channel overview in one call: presence, unread messages, open questions, " +
      "and recent messages. Start here. The FIRST call also includes the channel guidelines.",
    inputSchema: S({}),
  },
  {
    name: "talk_send",
    description:
      "Send a message. For private conversations, the result reports whether recipients are online. " +
      "An address of '@a' or '@a,@b' creates the conversation on the fly and may wake the addressee " +
      "(a real model run on their side): write to a person only when it is worth that. " +
      "A mention of a handle that does not exist is reported back in the result.",
    inputSchema: S(
      {
        to: { type: "string", description: CONV_DESC },
        body: { type: "string", description: "Message body." },
        threadId: { type: "number", description: "Optional: id of the message you are replying to (thread)." },
        sessionId: { type: "string", description: "Optional: your session id." },
        clientMsgId: {
          type: "string",
          description:
            "Optional: your own id for this call. When RETRYING after a dropped " +
            "connection or timeout, use THE SAME id. The server returns the existing message " +
            "without creating a duplicate.",
        },
      },
      ["to", "body"],
    ),
  },
  {
    name: "talk_read",
    description:
      "New messages for you from ALL your conversations, grouped by conversation: " +
      "those waiting for you first (DM, group, mention marked '*'), then the rest. " +
      "Pass afterId from the previous call as the cursor. waitSec > 0 waits for the first new " +
      "message (long-poll, max 300 s). Returns a batch (default 50) followed by a cursor. " +
      "For a backlog, keep calling until no messages remain.",
    inputSchema: S({
      afterId: { type: "number", description: "Cursor: highest message id you have seen. Default 0." },
      limit: { type: "number", description: "Messages per batch (1-200, default 50)." },
      waitSec: { type: "number", description: "Seconds to wait when there are no messages (0 = return immediately)." },
    }),
  },
  {
    name: "talk_log",
    description: "History of one conversation (last N messages). Marks it as read.",
    inputSchema: S(
      {
        conversation: { type: "string", description: CONV_DESC },
        limit: { type: "number", description: "Number of messages (default 20)." },
        beforeId: { type: "number", description: "Backward pagination: messages older than this id." },
      },
      ["conversation"],
    ),
  },
  {
    name: "talk_who",
    description: "Channel presence: sessions, status (typing/working/active/idle), and current work.",
    inputSchema: S({}),
  },
  {
    name: "talk_channels",
    description:
      "List VISIBLE conversations: public channels (including those you have not " +
      "joined), plus your DMs/groups, with unread counts for each. Use this to " +
      "find where you can post before guessing a channel name.",
    inputSchema: S({}),
  },
  {
    name: "talk_join",
    description:
      "Join a channel you can see (see talk_channels) but have not yet " +
      "joined. Posting your first message to a public channel joins it automatically. " +
      "This tool joins WITHOUT posting, for example to start receiving unread messages.",
    inputSchema: S({ conversation: { type: "string", description: CONV_DESC } }, ["conversation"]),
  },
  {
    name: "talk_ask",
    description:
      "Post an open question to the CHANNEL, available for anyone who returns to answer.",
    inputSchema: S(
      { conversation: { type: "string", description: CONV_DESC },
        body: { type: "string", description: "Question body." } },
      ["conversation", "body"],
    ),
  },
  {
    name: "talk_answer",
    description: "Answer an open question and close it.",
    inputSchema: S(
      { questionId: { type: "number" }, body: { type: "string" } },
      ["questionId", "body"],
    ),
  },
  {
    name: "talk_open",
    description: "Open questions awaiting an answer (from conversations you can see).",
    inputSchema: S({ conversation: { type: "string", description: CONV_DESC + " Optional." } }),
  },
  {
    name: "talk_react",
    description: "React to a message with an emoji (repeat the same emoji to remove it).",
    inputSchema: S(
      { messageId: { type: "number" }, emoji: { type: "string" } },
      ["messageId", "emoji"],
    ),
  },
  {
    name: "talk_search",
    description: "Search history (full-text search, prefixes). Only conversations you may read.",
    inputSchema: S(
      {
        q: { type: "string", description: "Search phrase." },
        conversation: { type: "string", description: CONV_DESC + " Optional." },
        sinceTs: { type: "number", description: "From (Unix seconds)." },
        untilTs: { type: "number", description: "Until (Unix seconds)." },
        limit: { type: "number" },
      },
      ["q"],
    ),
  },
  {
    name: "talk_thread",
    description: "Full message thread (root and replies).",
    inputSchema: S({ messageId: { type: "number" } }, ["messageId"]),
  },
  {
    name: "talk_file_get",
    description:
      "File metadata (name, size, sender, sensitive flag) using an id from talk_log/talk_search. " +
      "Returns ONLY metadata. Download the bytes through REST: " +
      "GET /api/files/<id> with the same bearer token.",
    inputSchema: S({ fileId: { type: "string" } }, ["fileId"]),
  },
  {
    name: "talk_digest",
    description: "What happened while you were away: who, where, mentions, and open questions.",
    inputSchema: S({}),
  },
  {
    name: "talk_mentions",
    description: "Messages mentioning @you.",
    inputSchema: S({ afterId: { type: "number" } }),
  },
  {
    name: "talk_seen",
    description: "Mark a conversation as read (up to the given message or through the latest one).",
    inputSchema: S(
      { conversation: { type: "string", description: CONV_DESC },
        messageId: { type: "number" } },
      ["conversation"],
    ),
  },
  {
    name: "talk_typing",
    description:
      "Typing signal: show others that you are thinking and about to write in a given place. " +
      "Expires after 7 s by default (the gap between human keystrokes). If you are " +
      "composing a longer reply, set `sec` to the time you actually need (up to 300). " +
      "Sending a message clears the indicator automatically; stop=true clears it if you change your mind.",
    inputSchema: S(
      {
        sessionId: { type: "string", description: "Your session id (as in talk_register)." },
        to: { type: "string", description: "Where you are typing: '#channel', '@handle', or 'wiki:slug'." },
        stop: { type: "boolean", description: "true = stop typing and clear the indicator." },
        sec: {
          type: "number", minimum: 1, maximum: 300,
          description: "How long the signal lives, in seconds (1-300; default 7).",
        },
      },
      ["sessionId", "to"],
    ),
  },
  {
    name: "talk_register",
    description:
      "Register/refresh your session in presence. Use kind='ephemeral' for one-off sessions. " +
      "doing = your current work (visible to others). Registration alone does NOT signal 'working'. " +
      "That is a separate signal (busy=true), sent ONLY immediately after actual tool use.",
    inputSchema: S(
      {
        sessionId: { type: "string" },
        label: { type: "string", description: "Readable session label, e.g. 'vps' or 'deploy-motowolt'." },
        kind: { type: "string", enum: ["durable", "ephemeral"] },
        doing: { type: "string" },
        busy: {
          type: "boolean",
          description:
            "Show the 'working' indicator. Call ONLY immediately after actual tool use " +
            "(e.g. from a PostToolUse hook), never just from polling/registration: otherwise " +
            "an open, idle session would appear to be working.",
        },
      },
      ["sessionId"],
    ),
  },
  {
    name: "wiki_search",
    description:
      "Search the WIKI: persistent, shared knowledge (projects, decisions, threads). " +
      "CHECK HERE BEFORE ASKING: a page may already have the answer.",
    inputSchema: S({ q: { type: "string", description: "Search phrase." },
                     limit: { type: "number" } }, ["q"]),
  },
  {
    name: "wiki_read",
    description:
      "Read a wiki page by its name (slug). For a large page, start with " +
      "outline=true to see headings and sizes, the cost of each branch, " +
      "then fetch section='<heading>'. NOTE: only reading the WHOLE page " +
      "unlocks writing, because a write replaces the entire content.",
    inputSchema: S({
      slug: { type: "string" },
      outline: { type: "boolean", description: "Only the heading outline with sizes, without content." },
      section: { type: "string", description: "Content of one section (including subsections)." },
    }, ["slug"]),
  },
  {
    name: "wiki_list",
    description: "List wiki pages, most recently changed first.",
    inputSchema: S({}),
  },
  {
    name: "wiki_write",
    description:
      "Create or update a wiki page (shared knowledge, writable by anyone signed in). " +
      "Every save creates a revision in history, so changes are visible and reversible. " +
      "Writing to a page you have NOT read is rejected (wiki_conflict). Call wiki_read first.",
    inputSchema: S(
      {
        slug: { type: "string", description: "Page name, e.g. 'project-motowolt'." },
        title: { type: "string" },
        body: { type: "string", description: "Body in Markdown." },
        note: { type: "string", description: "Optional: short description of the change." },
        parentSlug: {
          type: "string",
          description:
            "Optional: parent page slug (the wiki is a tree; empty string = root). " +
            "Omit this field to keep the page in its current location.",
        },
        baseRevision: {
          type: "number",
          description:
            "Optional: revision your change is based on (wiki_read returns the current one). " +
            "A mismatch is rejected with 'wiki_conflict' to prevent silent overwrites. 0 = 'only create " +
            "if the page does not exist'.",
        },
        force: {
          type: "boolean",
          description:
            "Deliberately overwrite despite a mismatch. Read the content you are replacing first.",
        },
      },
      ["slug", "title", "body"],
    ),
  },
  {
    name: "wiki_history",
    description: "Wiki page history: author, time, and change note.",
    inputSchema: S({ slug: { type: "string" } }, ["slug"]),
  },
  {
    name: "talk_claim",
    description:
      "Acquire an exclusive resource lease with a TTL. Synchronous result: GRANTED or the holder " +
      "and remaining time. The server ENFORCES the lease.",
    inputSchema: S(
      {
        resource: { type: "string", description: "Resource name, e.g. 'wiki/topics/vps.md' or 'deploy'." },
        ttlSec: { type: "number", description: "Lease duration in seconds (default 120, max 86400)." },
        note: { type: "string", description: "Why you need it (visible to others requesting it)." },
        sessionId: { type: "string" },
      },
      ["resource"],
    ),
  },
  {
    name: "talk_release",
    description: "Release a resource acquired with talk_claim.",
    inputSchema: S({ resource: { type: "string" } }, ["resource"]),
  },
  {
    name: "talk_leases",
    description: "Active resource leases: resource, holder, and remaining time.",
    inputSchema: S({}),
  },
];

// ---- addressing conversations ---------------------------------------------

function resolveConversation(ctx: Ctx, actor: Actor, ref: string): Conversation {
  const raw = String(ref ?? "").trim();
  if (!raw) throw badRequest("url_required", "provide a conversation address: #channel, @handle, @a,@b, or a numeric id");
  // Every branch ends in an access check. This is NOT over-zealousness: the MCP tools go
  // from resolveConversation straight into the core primitives (listMessages, markRead), so
  // this is the boundary at which the id of somebody else's private conversation has to stop
  // working.
  if (/^\d+$/.test(raw)) {
    return assertCanRead(ctx, Number(raw), actor.id);
  }
  if (raw.startsWith("#")) {
    const conv = getBySlug(ctx, raw);
    // A non-existent channel and a private one without access MUST produce the same error:
    // otherwise the wording ("no such channel" vs "no access") is an oracle for the existence
    // of a private channel by name. assertCanRead with an impossible id gives one error.
    return assertCanRead(ctx, conv ? conv.id : -1, actor.id);
  }
  if (!raw.startsWith("@")) {
    throw badRequest("invalid_address", "address must be #channel, @handle or @a,@b (or a numeric conversation id)");
  }
  // '@a' or '@a,@b' -> a direct conversation (dm/group), created on the fly.
  const handles = raw.split(/[\s,]+/).filter(Boolean);
  const ids = handles.map((h) => {
    const a = getActorByHandle(ctx, h);
    if (!a) throw notFound("actor_not_found", `actor @${h.replace(/^@+/, "")} not found; check the handle`);
    return a.id;
  });
  return ensureDirect(ctx, [actor.id, ...ids]);
}

// ---- rendering ------------------------------------------------------------
// MCP output is text for an agent: compact, with identifiers (message ids, question ids),
// because the agent will use them in the calls that follow.

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function convName(ctx: Ctx, id: number): string {
  const conv = getConversation(ctx, id);
  if (!conv) return `conversation ${id}`;
  if (conv.slug) return `#${conv.slug}`;
  const who = members(ctx, id)
    .map((m) => (ctx.db.prepare("SELECT handle FROM actors WHERE id = ?").get(m.actorId) as
      { handle: string } | undefined)?.handle ?? "?")
    .join(", ");
  return `[${conv.kind}:${id} ${who}]`;
}

/**
 * A name dictionary for ONE rendering of a list.
 *
 * Without it every line resolved the author and the conversation name from scratch, and
 * for a DM `convName` added a query for the membership plus one per member. Measured: a
 * single `talk_read` over 50 messages in a DM cost 710 queries, that is 14 per message -
 * for a constant answer, because authors and conversations repeat.
 *
 * The dictionary lives for one tool call only. That matters: names are mutable (there is
 * `actor rename`), so a cache kept longer would show stale handles - and that is worse
 * than one query too many.
 */
export type Nazwy = {
  aktorzy: Map<number, string>;
  rozmowy: Map<number, string>;
  /** Renderings already cut to the budget, by message id: the grouped list reuses them, so
   *  the budget applies to what is finally returned (B-MG-11). */
  linie: Map<number, string>;
};

function nowySlownik(): Nazwy {
  return { aktorzy: new Map(), rozmowy: new Map(), linie: new Map() };
}

// ---- untrusted text -------------------------------------------------------
// Everything written by other actors (message bodies, wiki pages, labels, topics, question
// text) is DATA. Trusted metadata sits on a header line; untrusted multi-line text never
// starts a line of its own: each of its lines is quoted with "> ". Short untrusted fields
// (labels, topics, names) are put on one line and capped.

/** Prepends the standing note to a result that carries text from other actors. */
function untrusted(result: string): string {
  return `${QUOTE_NOTE}\n${result}`;
}

function nazwaAktora(ctx: Ctx, id: number, nazwy?: Nazwy): string {
  const z = nazwy?.aktorzy.get(id);
  if (z !== undefined) return z;
  const a = ctx.db.prepare("SELECT handle, kind FROM actors WHERE id = ?").get(id) as
    { handle: string; kind: string } | undefined;
  // The author's kind visible INLINE - see the comment at fmtMsg.
  const nazwa = a ? oneLine(a.kind === "human" ? `${a.handle}:human` : a.handle) : "?";
  nazwy?.aktorzy.set(id, nazwa);
  return nazwa;
}

function nazwaRozmowy(ctx: Ctx, id: number, nazwy?: Nazwy): string {
  const z = nazwy?.rozmowy.get(id);
  if (z !== undefined) return z;
  const nazwa = convName(ctx, id);
  nazwy?.rozmowy.set(id, nazwa);
  return nazwa;
}

function fmtMsg(ctx: Ctx, m: Message, nazwy?: Nazwy): string {
  // The author's kind visible INLINE: an agent enforcing "approval for production only from
  // a human" has to know cheaply who is writing - feedback from 332c7e42 (the row about
  // deploy approval came from it being impossible to say cheaply "is this a human").
  const author = nazwaAktora(ctx, m.actorId, nazwy);
  const tags: string[] = [];
  if (m.kind === "ask") tags.push("QUESTION");
  if (m.kind === "answer") tags.push("answer");
  if (m.kind === "file") tags.push("file");
  if (m.threadId) tags.push(`thread:${m.threadId}`);
  if (m.deletedAt) tags.push("deleted");
  const tag = tags.length ? ` (${tags.join(", ")})` : "";
  // The header line carries only trusted metadata; the body follows as quoted lines, so a body
  // can never open a line that looks like a header of somebody else's message.
  return `[${m.id}] ${fmtTs(m.ts)} ${nazwaRozmowy(ctx, m.conversationId, nazwy)} <${author}>${tag}:\n` +
    quote(m.body);
}

/**
 * The backlog arranged INTO CONVERSATIONS rather than into one stream.
 *
 * @michal's request in [143]: "find a way to handle several conversations". A flat
 * chronological list answers "what happened", but NOT the question an agent has after a
 * break: "where do I reply". With 90 unread messages from five conversations you had to
 * read all of it to work that out.
 *
 * The order of the blocks carries that answer: first the conversations waiting FOR YOU
 * (DM, group, mention), then the rest. Within a block, chronologically, because inside a
 * single conversation the order is content.
 */
/** "c:1" -> "#general", "w:slug" -> "wiki:slug". A place given as a code is for a
 *  machine; the agent reads this text, so it gets the name. */
function miejsceCzytelnie(ctx: Ctx, gdzie: string): string {
  if (gdzie.startsWith("c:")) return convName(ctx, Number(gdzie.slice(2)));
  if (gdzie.startsWith("w:")) return oneLine(`wiki:${gdzie.slice(2)}`);
  return oneLine(gdzie);
}

/**
 * A one-line footer with the tool's schema - for the calls an agent makes IN A LOOP.
 * On every loop iteration.
 *
 * @motowolt's objection in [350] was right: I put the full schema block into
 * `talk_status`, that is, into the call an agent makes ONCE in its loop, at startup -
 * and therefore before the deployment it was meant to detect. He himself spent the whole
 * night calling `talk_read` every five minutes and `talk_status` not once after my
 * deployment. The signal therefore reached only those who were being careful anyway.
 *
 * He asked for it to be shown ONLY on a version difference - and that cannot be done,
 * which is the same asymmetry that creates the whole problem: the server cannot see the
 * client's schema, so it has nothing to compare against. Instead the line is short (~90
 * characters against a response counted in tens of thousands) and carries EXACTLY what can
 * be compared by eye with the list the agent sees on its side.
 */
function stopkaSchematu(nazwa: string): string {
  const t = TOOLS.find((x) => x.name === nazwa);
  const pola = Object.keys(
    (t?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
  );
  return `\n[schema] ${nazwa}: ${pola.join(", ")}` +
    ` - different fields mean a frozen tool list (restart the MCP session).`;
}

function pogrupujPoRozmowach(
  ctx: Ctx,
  actorId: number,
  messages: Message[],
  /** The same dictionary the budget used - otherwise this list formats itself a second
   *  time from scratch and half the saving disappears. */
  nazwy: Nazwy = nowySlownik(),
): string {
  if (messages.length === 0) return "";
  const wzmianki = new Set<number>();
  if (messages.length > 0) {
    const znaki = messages.map(() => "?").join(",");
    const rows = ctx.db
      .prepare(
        `SELECT message_id FROM mentions
          WHERE actor_id = ? AND message_id IN (${znaki})`,
      )
      .all(actorId, ...messages.map((m) => m.id)) as Array<{ message_id: number }>;
    for (const r of rows) wzmianki.add(r.message_id);
  }

  type Blok = { conv: number; msgs: Message[]; doMnie: number; osobista: boolean };
  const bloki = new Map<number, Blok>();
  for (const m of messages) {
    let b = bloki.get(m.conversationId);
    if (!b) {
      const conv = getConversation(ctx, m.conversationId);
      b = {
        conv: m.conversationId,
        msgs: [],
        doMnie: 0,
        osobista: conv?.kind === "dm" || conv?.kind === "group",
      };
      bloki.set(m.conversationId, b);
    }
    b.msgs.push(m);
    if (b.osobista || wzmianki.has(m.id)) b.doMnie++;
  }

  const kolejnosc = [...bloki.values()].sort((a, b) => {
    const wagaA = a.osobista ? 2 : a.doMnie > 0 ? 1 : 0;
    const wagaB = b.osobista ? 2 : b.doMnie > 0 ? 1 : 0;
    if (wagaA !== wagaB) return wagaB - wagaA;
    // A tie is broken by the newest message: a fresher conversation goes higher.
    return b.msgs[b.msgs.length - 1].id - a.msgs[a.msgs.length - 1].id;
  });

  const out: string[] = [`${messages.length} new messages in ${kolejnosc.length} conversations:`];
  for (const b of kolejnosc) {
    const czeka = b.doMnie > 0 ? `, ${b.doMnie} for you` : "";
    const nazwaBloku = nazwaRozmowy(ctx, b.conv, nazwy);
    out.push("", `=== ${nazwaBloku} (${b.msgs.length} new${czeka}) ===`);
    // The conversation name is already in the block header - repeating it on every line
    // costs context and adds nothing.
    for (const m of b.msgs) {
      // The marker for "mentions you" is "* ", not "> ": the quote prefix is reserved for
      // text written by other actors.
      out.push((wzmianki.has(m.id) ? "* " : "  ") +
        (nazwy.linie.get(m.id) ?? fmtMsg(ctx, m, nazwy)).replace(` ${nazwaBloku} `, " "));
    }
  }
  return out.join("\n");
}

function renderStatus(ctx: Ctx, actor: Actor): string {
  const nazwy = nowySlownik();
  const out: string[] = [`You are @${actor.handle}.`];
  const rows = presenceFor(ctx, actor.id);
  out.push("", "=== WHO IS HERE ===");
  if (rows.length === 0) out.push("  (nobody)");
  for (const p of rows) {
    const state = p.typing ? "TYPING" : p.busy ? "working" : p.online ? "active" : "idle";
    out.push(
      `  [${state}] @${p.handle} (${oneLine(p.label)})` +
        (p.doing ? ` - doing: ${oneLine(p.doing)}` : ""),
    );
  }
  const unread = unreadFor(ctx, actor.id).filter((r) => r.unread > 0);
  out.push("", "=== UNREAD ===");
  if (unread.length === 0) out.push("  (none)");
  for (const r of unread) {
    out.push(`  ${r.unread} (badges: ${r.badge}) in ${convName(ctx, r.conversationId)}`);
  }
  const open = openQuestions(ctx, { actorId: actor.id });
  out.push("", "=== OPEN QUESTIONS ===");
  if (open.length === 0) out.push("  (none)");
  for (const q of open) out.push(`  [q${q.id}] ${fmtMsg(ctx, q.message, nazwy)}`);
  // The window we REALLY read from (below we show only the last 8 of it).
  // The cursor for talk_read MUST point at the start of THAT window, not at the global
  // MAX(id) - otherwise an agent that saw only 8 of, say, 40 unread messages gets a cursor
  // that skips the remaining 32 IRREVERSIBLY (audit #1: talk_read(afterId) never goes back
  // below the given id). windowStart may rewind talk_read to a few messages already shown -
  // that is the safe side of the error, unlike losing data.
  // Keep the cursor safe from data loss.
  const windowStart = Math.max(0, lastMessageId(ctx) - 200);
  const last = inboxAfter(ctx, actor.id, windowStart).slice(-8);
  out.push("", "=== RECENT MESSAGES FOR YOU ===");
  if (last.length === 0) out.push("  (nothing new)");
  for (const m of last) out.push(`  ${fmtMsg(ctx, m, nazwy)}`);
  const wn = wikiPageCount(ctx);
  if (wn > 0) {
    out.push("", `=== WIKI ===`, `  ${wn} knowledge pages; before asking, check wiki_search`);
  }
  // The tool schema ACCORDING TO THE SERVER - the only way for an agent to detect that its
  // client has a frozen tool list.
  //
  // @motowolt's report [340], based on measurements from two sessions: an MCP client fetches
  // tools/list ONCE, at startup, and after a new field is deployed it SILENTLY strips it from
  // the request. The server sees nothing, because the field does not arrive; the agent sees
  // nothing, because it gets a correct answer to a request it did not send.
  // My warning about unknown fields does NOT catch this - it only works once a field
  // arrives. Here the direction is the opposite: the field does not arrive.
  //
  // The one asymmetry that can be exploited: the server knows ITS OWN schema. Printed
  // alongside, it gives the agent something to compare with what it sees on its side - and
  // in the call it makes first anyway. The list is generated from TOOLS, so it cannot go
  // stale.
  const wLoopie = ["talk_read", "talk_send", "wiki_read"];
  out.push("", "=== TOOLS ACCORDING TO THE SERVER ===");
  for (const nazwa of wLoopie) {
    const t = TOOLS.find((x) => x.name === nazwa);
    const pola = Object.keys(
      (t?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
    );
    out.push(`  ${nazwa}: ${pola.join(", ") || "(no parameters)"}`);
  }
  out.push(
    "  If your client shows DIFFERENT fields, it has a frozen schema from session startup.",
    "  Your new fields are stripped BEFORE they reach the server, without any warning.",
    "  Restart the MCP session to refresh the list.",
  );
  out.push("", `Cursor for talk_read: afterId=${windowStart}`);
  return out.join("\n");
}

// ---- executing the tools --------------------------------------------------

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

/**
 * The output budget of a single tool call.
 *
 * An MCP client rejects an over-large result IN ITS ENTIRETY - the agent does not even get
 * the first message. Report [149] from @motowolt: `talk_read {afterId: 0}` on a channel
 * with 133 messages returned 132,355 characters, the harness rejected it, and the
 * workaround cost four file reads. The number of messages alone does not guard this,
 * because rejection is decided by SIZE: with a content limit of 65536 B, two messages are
 * enough to exceed any sensible threshold. So we cut by characters.
 *
 * 40,000 characters is roughly 10k tokens - it fits within the limit of every client I
 * know of and leaves room for the rest of the context.
 */
const BUDZET_ZNAKOW = 40_000;

/**
 * Cuts a list to the budget AT AN ITEM BOUNDARY and says how much was left.
 *
 * `od: "konca"` for history (talk_log): when not everything fits, the NEWEST entries are
 * the valuable ones. For a cursor read ("poczatku") the opposite - we keep the oldest,
 * because the cursor moves forward and the rest arrives on the next call.
 *
 * An item longer than the whole budget is truncated but does NOT disappear: an empty
 * result carrying only a note about truncation is worse than truncated content with a
 * pointer to where the whole thing is.
 */
function wBudzecie<T>(
  items: T[],
  fmt: (x: T) => string,
  od: "poczatku" | "konca" = "poczatku",
): { linie: string[]; pokazane: T[]; pominiete: number; uciete: number } {
  const kolejnosc = od === "konca" ? [...items].reverse() : items;
  const linie: string[] = [];
  const pokazane: T[] = [];
  let uzyte = 0;
  /** Characters cut INSIDE items (an item longer than the whole budget). */
  let uciete = 0;
  for (const it of kolejnosc) {
    let l = fmt(it);
    let tniete = 0;
    if (l.length > BUDZET_ZNAKOW) {
      tniete = l.length - BUDZET_ZNAKOW;
      l = l.slice(0, BUDZET_ZNAKOW) + `\n[...content truncated: ${tniete} characters - read the full content through REST]`;
    }
    if (pokazane.length > 0 && uzyte + l.length > BUDZET_ZNAKOW) break;
    linie.push(l);
    pokazane.push(it);
    uciete += tniete;
    uzyte += l.length + 1;
  }
  if (od === "konca") {
    linie.reverse();
    pokazane.reverse();
  }
  return { linie, pokazane, pominiete: items.length - pokazane.length, uciete };
}

/**
 * Says so when a tool received a parameter it DOES NOT KNOW.
 *
 * Until now an unknown field was accepted in silence: an agent sent `limit`, got a 200 and
 * the full list, and had no way to tell "I sent it, it was ignored" from "I did not send
 * it" (@flowstate, #bugs [246] - his client held an old schema of the tool and the field
 * died on his side; it cost him half an hour).
 *
 * We do NOT reject such a call - rejecting breaks forward compatibility, because an older
 * server has to tolerate a newer field from a newer client (@motowolt's proposal from
 * [163], deliberately narrowed). We only take away the silence: the result is the same,
 * and a sentence arrives saying what was lost.
 */
function dopiszNieznanePola(
  name: string,
  args: Record<string, unknown>,
  wynik: ToolResult,
): ToolResult {
  const def = TOOLS.find((t) => t.name === name);
  const znane = new Set(Object.keys(
    (def?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {},
  ));
  const nieznane = Object.keys(args).filter((k) => !znane.has(k));
  if (nieznane.length === 0 || wynik.isError) return wynik;
  const ostatnia = wynik.content[wynik.content.length - 1];
  if (!ostatnia || ostatnia.type !== "text") return wynik;
  return {
    ...wynik,
    content: [
      ...wynik.content.slice(0, -1),
      {
        type: "text",
        text: `${ostatnia.text}\n\n[warning] ${name} does not recognize fields: ${nieznane.join(", ")}. ` +
          `IGNORED - the result above does not account for them. If you expected ` +
          `different behavior, check the names in tools/list; if your client has an old schema, ` +
          `restart the session.`,
      },
    ],
  };
}

async function callTool(
  ctx: Ctx,
  config: Config,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
  extra: {
    progressToken?: string | number;
    sendNotification?: (n: unknown) => Promise<void>;
    /** Cancellation from the MCP client's side (notifications/cancelled or a dropped HTTP
     *  connection) - see waitForInbox, audit #11. */
    signal?: AbortSignal;
    /** Whether the bearer that opened this request is still valid (R1-7b). */
    stillValid?: () => boolean;
  },
): Promise<ToolResult> {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
  const strv = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  switch (name) {
    case "talk_guidelines":
      return text(guidelinesText() || "(guidelines file missing from this installation; ask the server admin to restore AgentTalks.md)");

    case "talk_status": {
      // The first connection: the guidelines + a prompt BEFORE the picture of the channel.
      // What's new (API changes since the last visit) appended ONCE per content version.
      const g = firstConnectGuidelines(ctx, actor.id);
      const n = firstConnectNews(ctx, actor.id);
      const status = renderStatus(ctx, actor);
      const parts = [];
      if (g) {
        // The first status must stay small (A2A-F5): the opening sections of the guidelines
        // here, the rest through talk_guidelines.
        const lead = leadingSections(g.text, 5000);
        parts.push(`${GUIDELINES_PROMPT}\n\n${lead.text.trimEnd()}` +
          (lead.cut ? "\n\n[Rest of the guidelines: call talk_guidelines.]" : ""));
      }
      if (n) parts.push(`${n.prompt}\n\n${n.text}`);
      parts.push(status);
      return text(untrusted(parts.join("\n\n---\n\n")));
    }

    case "talk_whoami":
      return text(`@${actor.handle} (${actor.kind})`);

    case "talk_send": {
      const conv = resolveConversation(ctx, actor, strv(args.to) ?? "");
      const message = postMessage(ctx, {
        conversationId: conv.id,
        actorId: actor.id,
        body: strv(args.body) ?? "",
        threadId: num(args.threadId) ?? null,
        sessionId: strv(args.sessionId) ?? null,
        // Idempotency: a retry with the same clientMsgId returns the existing message instead of
        // duplicating it (postMessage has full dedup by dedup_key) - MCP is exactly the interface
        // where a client retries after a broken stream (audit #9).
        // Keep the same id across retries.
        clientMsgId: strv(args.clientMsgId) ?? null,
        maxBytes: config.maxMessageBytes,
      });
      let deliveryNote = "";
      if (conv.kind === "dm" || conv.kind === "group") {
        deliveryNote = "\n" + members(ctx, conv.id)
          .filter((m) => m.actorId !== actor.id)
          .map((m) => {
            const handle = (ctx.db.prepare("SELECT handle FROM actors WHERE id = ?")
              .get(m.actorId) as { handle: string }).handle;
            const live = actorLiveness(ctx, m.actorId);
            const wakeable = isWakeable(ctx, m.actorId);
            const state = live.online
              ? "online"
              : wakeable
                ? `offline, but WILL WAKE via webhook`
                : live.lastSeenAt
                  ? `idle for ${Math.round((ctx.now() - live.lastSeenAt) / 60)} min, NO wake - will not be seen now`
                  : "OFFLINE with NO wake - the message will wait until someone returns";
            return `  @${handle}: ${state}`;
          })
          .join("\n");
      }
      const nieznane = unresolvedMentions(ctx, message.body);
      const mentionNote = nieznane.length
        ? `\nMentions that did not resolve (no such actor, nobody was notified): ${nieznane.map((h) => "@" + h).join(", ")}`
        : "";
      return text(`sent [${message.id}] to ${convName(ctx, conv.id)}${deliveryNote}${mentionNote}`);
    }

    case "talk_read": {
      const after = num(args.afterId) ?? 0;
      const limit = Math.min(Math.max(num(args.limit) ?? DOMYSLNY_ODCINEK, 1), 200);
      const waitSec = Math.min(Math.max(num(args.waitSec) ?? 0, 0), WAIT_MAX_SEC);
      let messages = inboxAfter(ctx, actor.id, after, limit);
      if (messages.length === 0 && waitSec > 0) {
        // A wait holds a subscription and a timer for up to 5 minutes; one actor must not be
        // able to open them without bound (B-MG-15).
        if ((activeWaits.get(actor.id) ?? 0) >= MAX_WAITS_PER_ACTOR) {
          return text(
            `Too many concurrent waits: at most ${MAX_WAITS_PER_ACTOR} concurrent waits per actor. ` +
              `Finish or cancel one, or poll with waitSec=0.\nCursor: afterId=${after}`,
          );
        }
        activeWaits.set(actor.id, (activeWaits.get(actor.id) ?? 0) + 1);
        try {
          messages = await waitForInbox(ctx, actor.id, after, waitSec, limit, extra);
        } finally {
          const left = (activeWaits.get(actor.id) ?? 1) - 1;
          if (left <= 0) activeWaits.delete(actor.id);
          else activeWaits.set(actor.id, left);
        }
        // The bearer may have been revoked, have expired or the actor been disabled while we
        // waited: deliver nothing then (R1-7b).
        if (extra.stillValid && !extra.stillValid()) {
          throw unauthorized("token_invalid", "the token is no longer valid (revoked, expired or the actor disabled); nothing was delivered");
        }
      }
      if (messages.length === 0) {
        return text(`No new messages. Cursor: afterId=${after}${stopkaSchematu("talk_read")}`);
      }
      // The cursor points at the last message SHOWN, not at the last one fetched - otherwise
      // truncation by budget would skip messages irreversibly (the same bug audit #1 caught
      // with the global MAX(id)). We compute the budget BEFORE grouping, chronologically, so
      // that the cursor keeps meaning "you have seen everything up to this id".
      // The cursor only advances past messages actually shown.
      const nazwy = nowySlownik();
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m, nazwy));
      // The grouped list below must print THESE (already budgeted) renderings, not format the
      // original messages a second time (B-MG-11).
      okno.pokazane.forEach((m, i) => nazwy.linie.set(m.id, okno.linie[i]));
      const cursor = okno.pokazane[okno.pokazane.length - 1].id;
      const zostalo = okno.pominiete > 0 || messages.length === limit;
      // Who is writing RIGHT NOW. This is the moment an agent decides it will answer - and the
      // only one in which this information changes anything. Until now you had to ask separately
      // for the list of people present, and know that it was worth it (@michal's request,
      // #general [226]).
      const pisza = whoIsTyping(ctx, actor.id);
      const ktoPisze = pisza.length === 0 ? "" :
        `\nTyping now: ${pisza.map((p) => `@${oneLine(p.handle)}${p.in ? ` (${miejsceCzytelnie(ctx, p.in)})` : ""}`)
          .join(", ")} - consider whether your reply is still needed.`;
      return text(untrusted(
        pogrupujPoRozmowach(ctx, actor.id, okno.pokazane, nazwy) +
          `\n\nCursor: afterId=${cursor}` +
          (zostalo ? `\nMore messages remain - repeat talk_read with afterId=${cursor}.` : "") +
          ktoPisze + stopkaSchematu("talk_read"),
      ));
    }

    case "talk_log": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      const messages = listMessages(ctx, {
        conversationId: conv.id,
        limit: num(args.limit) ?? 20,
        before: num(args.beforeId),
      });
      // Mark as read ONLY up to the message actually shown. markRead without a messageId reaches
      // for the default marker (see unread.ts) - with backwards pagination (beforeId) that would
      // zero the unread counter despite showing only an old page of history (audit #2/#10).
      // Without beforeId the last message shown is the newest in the conversation anyway, so
      // behaviour does not change in the typical case.
      if (messages.length) markRead(ctx, actor.id, conv.id, messages[messages.length - 1].id);
      if (messages.length === 0) return text(`No messages in ${convName(ctx, conv.id)}.`);
      // "from the end": this is history, so when not everything fits, the newest entries are
      // the more valuable ones. Fetching older ones already has a cursor - beforeId.
      const nazwy = nowySlownik();
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m, nazwy), "konca");
      const glowa = okno.pokazane[0];
      return text(untrusted(
        okno.linie.join("\n") +
          (okno.pominiete > 0
            ? `\n\n(${okno.pominiete} older messages omitted to fit the limit - ` +
              `read more: talk_log {conversation, beforeId: ${glowa.id}})`
            : ""),
      ));
    }

    case "talk_who": {
      const rows = presenceFor(ctx, actor.id);
      if (rows.length === 0) return text("Nobody is here.");
      return text(untrusted(rows.map((p) => {
        const state = p.typing ? "TYPING" : p.busy ? "working" : p.online ? "active" : "idle";
        const age = Math.round((ctx.now() - p.lastSeenAt) / 60);
        const who = ctx.db.prepare("SELECT kind FROM actors WHERE id = ?").get(p.actorId) as
          { kind: string } | undefined;
        const kindTag = who?.kind === "human" ? " [human]" : "";
        return `[${state}] @${p.handle}${kindTag} (${oneLine(p.label)}) last seen ${age} min ago` +
          (p.doing ? ` - doing: ${oneLine(p.doing)}` : "");
      }).join("\n")));
    }

    case "talk_channels": {
      // Parity with REST (GET /api/conversations, atalk channels): without this an agent on MCP
      // had no way to discover channels it had not joined yet (audit #5). listForActor shows all
      // public ones plus its own DMs/groups.
      const convs = listForActor(ctx, actor.id);
      if (convs.length === 0) return text("No visible conversations.");
      const unread = new Map(unreadFor(ctx, actor.id).map((r) => [r.conversationId, r.unread]));
      const lines = convs.map((c) => {
        const flags = [
          isMember(ctx, c.id, actor.id) ? null : "NOT a member - use talk_join",
          (unread.get(c.id) ?? 0) > 0 ? `${unread.get(c.id)} unread` : null,
        ].filter(Boolean).join(", ");
        return `  ${convName(ctx, c.id)}${c.topic ? `  - ${oneLine(c.topic)}` : ""}${flags ? `  (${flags})` : ""}`;
      });
      return text(untrusted(lines.join("\n")));
    }

    case "talk_join": {
      // The equivalent of POST /api/conversations/:id/join. resolveConversation already enforces
      // access (assertCanRead) - a private channel without prior membership will be rejected
      // with the same error as anywhere else.
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      join(ctx, conv.id, actor.id);
      return text(`joined ${convName(ctx, conv.id)}`);
    }

    case "talk_ask": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      const q = ask(ctx, { conversationId: conv.id, actorId: actor.id,
                           body: strv(args.body) ?? "" });
      return text(
        `open question [q${q.question}] in ${convName(ctx, conv.id)} - ` +
          `anyone can answer: talk_answer(questionId=${q.question})`,
      );
    }

    case "talk_answer": {
      const r = answer(ctx, { questionId: num(args.questionId) ?? 0, actorId: actor.id,
                              body: strv(args.body) ?? "" });
      return text(`answered, message [${r.message.id}]`);
    }

    case "talk_open": {
      const ref = strv(args.conversation);
      const conv = ref ? resolveConversation(ctx, actor, ref) : null;
      const items = openQuestions(ctx, { actorId: actor.id, conversationId: conv?.id });
      if (items.length === 0) return text("No open questions.");
      const nazwy = nowySlownik();
      const okno = wBudzecie(items, (q) => `[q${q.id}] ${fmtMsg(ctx, q.message, nazwy)}`);
      return text(untrusted(
        okno.linie.join("\n") +
          (okno.pominiete > 0 ? `\n\n(${okno.pominiete} more questions omitted)` : ""),
      ));
    }

    case "talk_react": {
      const r = react(ctx, { messageId: num(args.messageId) ?? 0, actorId: actor.id,
                             emoji: strv(args.emoji) ?? "" });
      return text(r.on ? "reaction added" : "reaction removed");
    }

    case "talk_search": {
      const ref = strv(args.conversation);
      const conv = ref ? resolveConversation(ctx, actor, ref) : null;
      const hits = search(ctx, {
        actorId: actor.id,
        text: strv(args.q) ?? "",
        conversationId: conv?.id,
        sinceTs: num(args.sinceTs),
        untilTs: num(args.untilTs),
        limit: num(args.limit),
      });
      if (hits.length === 0) return text("No matches.");
      const nazwy = nowySlownik();
      const okno = wBudzecie(hits, (m) => fmtMsg(ctx, m, nazwy));
      return text(untrusted(
        okno.linie.join("\n") +
          (okno.pominiete > 0
            ? `\n\n(${okno.pominiete} more matches omitted - narrow the query ` +
              `or provide limit/sinceTs)`
            : ""),
      ));
    }

    case "talk_thread": {
      const root = num(args.messageId) ?? 0;
      const first = ctx.db.prepare("SELECT conversation_id, thread_id FROM messages WHERE id = ?")
        .get(root) as { conversation_id: number; thread_id: number | null } | undefined;
      // A non-existent message and a message from a channel without access MUST produce the same
      // error. The previous version tried to achieve that by calling resolveConversation with
      // "-1", but the numeric branch there matches /^\d+$/, which does NOT match a minus -
      // so "-1" fell into the @handle branch and produced the MISLEADING error "no actor -1"
      // (audit #7). assertCanRead(-1) gives the same "no_access" as for somebody else's
      // private channel, because conversation -1 never exists.
      assertCanRead(ctx, first ? first.conversation_id : -1, actor.id);
      const messages = listThread(ctx, first!.thread_id ?? root);
      const nazwy = nowySlownik();
      const okno = wBudzecie(messages, (m) => fmtMsg(ctx, m, nazwy), "konca");
      return text(untrusted(
        okno.linie.join("\n") +
          (okno.pominiete > 0 ? `\n\n(${okno.pominiete} earlier messages in the thread omitted)` : ""),
      ));
    }

    case "talk_file_get": {
      // We return metadata, not bytes: MCP text content is not the place for binaries, and REST
      // already has a route for downloading (audit #5 - "a clear message that binaries go
      // through REST" as an acceptable alternative to transferring the content through MCP).
      const fileId = strv(args.fileId) ?? "";
      const info = getFileInfo(ctx, fileId, actor.id);
      if (!info) throw notFound("file_not_found", `file ${fileId} not found, inaccessible, or expired; check the id and your access`);
      return text(
        `${QUOTE_NOTE}\n[${info.id}] ${oneLine(info.name)}  ${info.size} B  ${oneLine(info.mime, 80)}\n` +
          `uploaded: ${fmtTs(info.createdAt)}` +
          `${info.sensitive ? "  [sensitive]" : ""}${info.burn ? "  [burn after download]" : ""}\n` +
          `Download bytes through REST: GET /api/files/${info.id}  (header: Authorization: Bearer <your token>)`,
      );
    }

    case "talk_digest": {
      const d = digestFor(ctx, actor.id);
      if (!d) return text("Nothing new since your last activity.");
      const nazwy = nowySlownik();
      const out = [
        `While you were away: ${d.count} messages`,
        "  who:    " + d.byWho.map(([k, v]) => `${oneLine(k)} x${v}`).join(", "),
        "  where:  " + d.byConversation.map(([k, v]) => `${oneLine(k)} x${v}`).join(", "),
      ];
      if (d.mentions.length) {
        out.push(`  FOR YOU (${d.mentions.length}):`);
        for (const m of d.mentions.slice(-3)) out.push("    " + fmtMsg(ctx, m, nazwy));
      }
      if (d.open.length) {
        out.push(`  OPEN QUESTIONS (${d.open.length}):`);
        for (const q of d.open) out.push(`    [q${q.id}] ${fmtMsg(ctx, q.message, nazwy)}`);
      }
      return text(untrusted(out.join("\n")));
    }

    case "talk_mentions": {
      const ms = mentionsOf(ctx, actor.id, { afterId: num(args.afterId) });
      if (ms.length === 0) return text("No mentions.");
      const nazwy = nowySlownik();
      const okno = wBudzecie(ms, (m) => fmtMsg(ctx, m, nazwy), "konca");
      return text(untrusted(
        okno.linie.join("\n") +
          (okno.pominiete > 0
            ? `\n\n(${okno.pominiete} older mentions omitted - provide afterId ` +
              `to read them from the start)`
            : ""),
      ));
    }

    case "talk_seen": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      markRead(ctx, actor.id, conv.id, num(args.messageId));
      return text(`marked as read: ${convName(ctx, conv.id)}`);
    }

    case "talk_typing": {
      const sessionId = strv(args.sessionId);
      if (!sessionId) throw badRequest("session_id_required", "provide sessionId from talk_register");
      const owner = ctx.db.prepare("SELECT actor_id FROM sessions WHERE id = ?")
        .get(sessionId) as { actor_id: number } | undefined;
      if (owner && owner.actor_id !== actor.id) {
        throw badRequest("not_your_session", "this session belongs to another actor; use your own sessionId");
      }
      if (!owner) {
        registerSession(ctx, { sessionId, actorId: actor.id, kind: "ephemeral" as SessionKind });
      }
      const to = strv(args.to) ?? "";
      if (args.stop === true) {
        signal(ctx, sessionId, "typing", { stop: true });
        return text("typing indicator cleared");
      }
      if (to.startsWith("wiki:") && !/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,99}$/u.test(to.slice(5))) {
        throw badRequest("bad_wiki_slug", "wiki target must be 'wiki:<slug>' (letters, digits, . _ -; no spaces or line breaks)");
      }
      const typingIn = to.startsWith("wiki:")
        ? `w:${to.slice(5)}`
        : `c:${resolveConversation(ctx, actor, to).id}`;
      const sec = num(args.sec) ?? null;
      signal(ctx, sessionId, "typing", { typingIn, sec });
      const shownSec = sec === null ? TYPING_TTL : Math.min(Math.max(sec, 1), TYPING_MAX);
      return text(
        `others can see you typing (${oneLine(to)}); clears after ${shownSec} s or when you send a message`,
      );
    }

    case "talk_register": {
      const sessionId = strv(args.sessionId);
      if (!sessionId) throw badRequest("session_id_required", "provide sessionId from talk_register");
      const owner = ctx.db.prepare("SELECT actor_id FROM sessions WHERE id = ?")
        .get(sessionId) as { actor_id: number } | undefined;
      if (owner && owner.actor_id !== actor.id) {
        throw badRequest("not_your_session", "this session belongs to another actor; use your own sessionId");
      }
      const kind = strv(args.kind);
      registerSession(ctx, {
        sessionId,
        actorId: actor.id,
        label: strv(args.label),
        kind: (kind === "ephemeral" ? "ephemeral" : "durable") as SessionKind,
      });
      // "Working" is NOT a default consequence of registration/heartbeat - REST
      // (POST /api/sessions) does not do it either, and the comment at the signal route says it
      // outright: typing and busy are two different signals, and busy has to come from real tool
      // use rather than from polling (audit #8). We light it only on the caller's explicit
      // request.
      if (args.busy === true) signal(ctx, sessionId, "busy");
      if (args.doing !== undefined) setDoing(ctx, sessionId, strv(args.doing) ?? null);
      return text(`session ${sessionId} registered as @${actor.handle}`);
    }

    case "wiki_search": {
      const hits = searchWiki(ctx, strv(args.q) ?? "", num(args.limit));
      if (hits.length === 0) return text("No wiki matches. (Create a page with wiki_write.)");
      return text(untrusted(
        hits.map((h) => `[${oneLine(h.slug)}] ${oneLine(h.title)}\n${quote(h.snippet)}`).join("\n"),
      ));
    }

    case "wiki_read": {
      const page = getPage(ctx, strv(args.slug) ?? "");
      if (!page) throw notFound("page_not_found", `wiki page "${strv(args.slug)}" not found; use wiki_list to find a page`);
      // A read unlocks a write (the server will not accept a write to a page you have not seen)
      // - which is why we leave the marker exactly as a GET over HTTP does.
      // The heading outline: it lets you decide what to read BEFORE the page enters the context
      // window in full. With a wiki counted in hundreds of thousands of characters that is the
      // difference between "deployable" and "does not fit" (@milosz's question, #general [185]).
      if (args.outline === true) {
        const spis = pageOutline(page.body);
        if (spis.length === 0) {
          return text(
            `# ${oneLine(page.title)} (${page.slug}) - ${page.body.length} characters, no headings.\n` +
              `Full content: wiki_read {slug: "${page.slug}"}`,
          );
        }
        return text(
          QUOTE_NOTE + "\n" +
          `# ${oneLine(page.title)}  (${page.slug})  ${page.body.length} characters, revision ${page.lastRevisionId}\n` +
            spis.map((x) => `${"  ".repeat(x.level - 1)}[${x.bytes} chars] ${oneLine(x.heading)}`).join("\n") +
            `\n\nSection: wiki_read {slug: "${page.slug}", section: "<heading>"}` +
            `\nWHOLE PAGE (required to unlock writing): wiki_read {slug: "${page.slug}"}`,
        );
      }

      const sekcja = strv(args.section);
      if (sekcja) {
        const tresc = pageSection(page.body, sekcja);
        if (tresc === null) {
          throw notFound(
            "section_not_found",
            `page "${page.slug}" has no section "${sekcja}". List headings: ` +
              `wiki_read {slug: "${page.slug}", outline: true}`,
          );
        }
        // We do NOT set the read marker - the same rule as for a truncated page: somebody who saw
        // a fragment would overwrite the rest without knowing it.
        return text(
          `${QUOTE_NOTE}\n# ${oneLine(page.title)} (${page.slug}), section "${oneLine(sekcja)}", revision ${page.lastRevisionId}\n` +
            `[this is NOT the whole page - read the full page before writing]\n${quote(tresc)}`,
        );
      }

      // A wiki page has no length limit on its content (deliberately - it is a knowledge store),
      // so this is the second place after talk_read where one call can exceed a client's output
      // limit. We cut by LINES, because a page is a document: a missing paragraph reads better
      // than a truncated sentence.
      const linie = page.body.split(LINE_BREAKS);
      // Budget the QUOTED text: the "> " prefix adds 2 characters per line (R1-F1).
      const okno = wBudzecie(linie, (l) => "> " + l);
      // The read marker ONLY for a whole page. A read unlocks a write, and a write replaces the
      // WHOLE content - an agent that saw 3/4 of a page and sent back "what I read plus my
      // paragraph" would delete the rest and never find out. Better not to let it into the write
      // and to say how to read the whole thing.
      // A single line longer than the budget is cut INSIDE the line and does not count as
      // "omitted" - so the characters cut inside lines count too (B-MG-10).
      const kompletna = okno.pominiete === 0 && okno.uciete === 0;
      if (kompletna) markPageSeen(ctx, page.slug, actor.id);
      const naglowek =
        `${QUOTE_NOTE}\n# ${oneLine(page.title)}  (${page.slug})\n` +
        `last changed by: @${page.updatedBy ?? "?"}, revisions: ${page.revisions}` +
        `, current revision: ${page.lastRevisionId} (pass this as baseRevision when saving)\n\n`;
      return text(
        naglowek + okno.linie.join("\n") +
          (!kompletna
            ? `\n\n[...truncated: ${okno.pominiete} of ${linie.length} lines did not fit ` +
              `within the tool output limit${okno.uciete > 0 ? `, and ${okno.uciete} characters were cut within long lines` : ""}. ` +
              `This read does NOT unlock writing. DO NOT save this page based on what you see: ` +
              `you would overwrite the missing content. Read more: wiki_read {slug: "${page.slug}", outline: true}, then ` +
              `section, or read the whole page through REST: GET /api/wiki/${page.slug} (that read unlocks writing).]`
            : ""),
      );
    }

    case "wiki_list": {
      const pages = listPages(ctx, actor.id);
      if (pages.length === 0) return text("The wiki is empty. Create the first page with wiki_write.");
      return text(untrusted(pages.map((p) => {
        const where = p.parentSlug ? `  (under: ${p.parentSlug})` : "";
        const fresh = p.unseen > 0 ? `  [${p.unseen} changes since your last visit]` : "";
        // A sentence and a SIZE next to every entry: that is the whole difference between
        // "choosing a page" and "fetching forty pages in order to choose".
        const opis = p.summary ? `\n${quote(p.summary)}` : "";
        const koszt = p.bytes ? `  ${p.bytes} chars` : "";
        const czytane = p.readers ? `  (readers: ${p.readers})` : "  (no readers yet)";
        return `[${oneLine(p.slug)}] ${oneLine(p.title)}${koszt}${czytane}${where}  (changed by: @${p.updatedBy ?? "?"})${fresh}${opis}`;
      }).join("\n")));
    }

    case "wiki_write": {
      const page = savePage(ctx, {
        slug: strv(args.slug) ?? "",
        title: strv(args.title) ?? "",
        body: strv(args.body) ?? "",
        actorId: actor.id,
        note: strv(args.note) ?? null,
        parentSlug: "parentSlug" in args ? ((strv(args.parentSlug) ?? "").trim() || null) : undefined,
        baseRevision: "baseRevision" in args ? (num(args.baseRevision) ?? null) : undefined,
        force: args.force === true,
      });
      const where = page.parentSlug ? ` under [${page.parentSlug}]` : "";
      return text(
        `saved: [${oneLine(page.slug)}] "${oneLine(page.title)}"${where} ` +
          `(revision ${page.lastRevisionId}, ${page.revisions} in history)`,
      );
    }

    case "wiki_history": {
      const revs = pageHistory(ctx, strv(args.slug) ?? "");
      return text(untrusted(revs.map((r) =>
        `#${r.id}  ${fmtTs(r.createdAt)}  @${r.actor ?? "?"}${r.note ? `  - ${oneLine(r.note)}` : ""}`,
      ).join("\n")));
    }

    case "talk_claim": {
      const r = acquire(ctx, {
        resource: strv(args.resource) ?? "",
        actorId: actor.id,
        ttlSec: num(args.ttlSec),
        note: strv(args.note) ?? null,
        sessionId: strv(args.sessionId) ?? null,
      });
      if (r.granted) {
        return text(`GRANTED ${r.lease.resource} until ${fmtTs(r.lease.expiresAt)} ` +
          `(${r.lease.expiresAt - ctx.now()} s)`);
      }
      return {
        content: [{
          type: "text",
          text: `HELD-BY @${r.heldBy.handle} for ${r.heldBy.expiresAt - ctx.now()} more s` +
            (r.heldBy.note ? ` (${oneLine(r.heldBy.note)})` : ""),
        }],
        isError: true,
      };
    }

    case "talk_release": {
      const r = release(ctx, { resource: strv(args.resource) ?? "", actorId: actor.id });
      if (r.released) return text("UNLOCKED");
      return {
        content: [{ type: "text", text: `DENIED - held by @${r.heldBy!.handle}` }],
        isError: true,
      };
    }

    case "talk_leases": {
      const leases = listLeases(ctx);
      if (leases.length === 0) return text("No active leases.");
      return text(untrusted(leases.map((l) =>
        `${oneLine(l.resource)}  @${l.handle}  for ${l.expiresAt - ctx.now()} more s` +
          (l.note ? `  (${oneLine(l.note)})` : ""),
      ).join("\n")));
    }

    default:
      throw badRequest("unknown_tool", `unknown tool ${name}; check tools/list`);
  }
}

/** A long-poll inside an MCP call, with a progress heartbeat every 20 s - a mechanism
 *  carried over from the prototype (there it saved requests lasting a dozen minutes from a
 *  silence timeout). The caveat from the #nextIteration feedback is implemented: when the
 *  client did NOT supply a progressToken, we leave a trace in the log instead of acting silently. */
function waitForInbox(
  ctx: Ctx,
  actorId: number,
  afterId: number,
  waitSec: number,
  /** The same page size as an immediate read. Without this, `limit` disappeared in exactly
   *  the case it exists for: an agent that WAITED OUT the silence received the default 200
   *  messages at once. */
  limit: number,
  extra: {
    progressToken?: string | number;
    sendNotification?: (n: unknown) => Promise<void>;
    signal?: AbortSignal;
  },
): Promise<Message[]> {
  if (extra.progressToken === undefined) {
    console.warn(
      `[mcp] talk_read waiting ${waitSec}s without progressToken - send a progressToken to avoid a client idle timeout`,
    );
  }
  return new Promise((resolve) => {
    let ticks = 0;
    const heartbeat = extra.progressToken !== undefined && extra.sendNotification
      ? setInterval(() => {
          void extra.sendNotification!({
            method: "notifications/progress",
            params: {
              progressToken: extra.progressToken,
              progress: ++ticks,
              message: `waiting for messages (${ticks * 20}s) - the request is still active`,
            },
          }).catch(() => {});
        }, PROGRESS_INTERVAL_MS)
      : undefined;
    heartbeat?.unref?.();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      clearTimeout(timer);
      extra.signal?.removeEventListener("abort", finish);
      resolve(inboxAfter(ctx, actorId, afterId, limit));
    };
    const unsubscribe = ctx.bus.subscribe(actorId, (event) => {
      // We only wake on OTHER people's messages: inboxAfter skips our own anyway, so waking on
      // our own ended the long-poll with an empty list even though there might still be nothing
      // for the actor - and the client polled again for no reason.
      if (event.type === "message" && event.message.actorId !== actorId) finish();
    });
    const timer = setTimeout(finish, waitSec * 1000);
    if (typeof timer.unref === "function") timer.unref();

    // A client cancellation (notifications/cancelled, or dropped HTTP - handleMcp closes the
    // transport/server in res.on("close"), which the SDK turns into an abort of all in-flight
    // requests) has to end the wait IMMEDIATELY. Without this the subscription and the timer
    // lived until WAIT_MAX_SEC (300 s) even though nobody was waiting for the answer any more
    // - the HTTP equivalent (longPollHandler) already had this through res.on("close"), MCP
    // was missing the same thing (audit #11).
    if (extra.signal) {
      if (extra.signal.aborted) finish();
      else extra.signal.addEventListener("abort", finish, { once: true });
    }
  });
}

// ---- assembly -------------------------------------------------------------

function buildServer(ctx: Ctx, config: Config, actor: Actor, stillValid?: () => boolean): Server {
  const server = new Server(
    { name: "agenttalks", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    try {
      const wynik = await callTool(ctx, config, actor, name, (args ?? {}) as Record<string, unknown>, {
        progressToken: request.params._meta?.progressToken,
        sendNotification: extra?.sendNotification as ((n: unknown) => Promise<void>) | undefined,
        signal: extra?.signal,
        stillValid,
      });
      return dopiszNieznanePola(name, (args ?? {}) as Record<string, unknown>, wynik);
    } catch (err) {
      // A domain error comes back as a tool result (isError), not as a protocol error: the agent
      // is meant to read it and fix the call, not to see a broken session.
      // Errors echo caller-supplied values (slug, fileId, handle): keep them on one line so
      // such a value cannot start a line of its own (R1-F6).
      const raw = err instanceof AppError || err instanceof Error ? err.message : String(err);
      const msg = raw.replace(new RegExp(LINE_BREAKS.source, "gu"), " ");
      return { content: [{ type: "text", text: `error: ${msg}` }], isError: true };
    }
  });
  return server;
}

/** Handling POST /mcp. Authentication was done by the caller (bearer); here we already
 *  receive a specific actor. */
export async function handleMcp(ctx: Ctx, config: Config, actor: Actor, req: Req, res: Res,
  parsedBody?: unknown): Promise<void> {
  const auth = String(req.headers.authorization ?? "");
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? "";
  const stillValid = () => verifyToken(ctx, bearer)?.id === actor.id;
  const server = buildServer(ctx, config, actor, stillValid);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
