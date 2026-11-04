// @ts-check
/**
 * The live feed shared by the channel server and the monitor: the SSE stream, the filter and
 * the data needed to frame a message (conversation label, author handle and kind).
 *
 * Events are processed ONE AT A TIME, in arrival order, through a promise chain: some need a
 * REST lookup first (an unknown conversation, a thread started before the feed did), and
 * without the chain a slow lookup would let a later message overtake an earlier one.
 *
 * No duplicates: every message id is handled once (a bounded set), whether it came live, in
 * the replay after a reconnect, or through the mention list.
 */
import { createApi } from "./api.mjs";
import { openEventStream } from "./sse.mjs";
import { classify, newFilterState, noteOwn } from "./filter.mjs";

const SEEN_MAX = 10_000;
const MEMBERSHIP_REFRESH_MS = 60_000;
const ROSTER_REFRESH_MIN_MS = 30_000;

/**
 * @typedef {{ id: number, conversationId: number, threadId: number | null,
 *   kind: import("./filter.mjs").PushKind, convLabel: string, author: string,
 *   authorKind: string, body: string }} FeedItem
 */

/**
 * @param {{
 *   identity: { url: string, token: string, source?: string },
 *   onItem: (item: FeedItem) => void,
 *   onState?: (state: string, info?: object) => void,
 *   onCursor?: (lastEventId: number) => void,
 *   lastEventId?: number | null,
 *   mentionCursor?: number | null,
 *   log?: (line: string) => void,
 *   fetchImpl?: typeof fetch,
 *   sse?: { initialBackoffMs?: number, maxBackoffMs?: number, idleMs?: number },
 * }} opts
 */
export function createFeed(opts) {
  const api = createApi(opts.identity, { fetchImpl: opts.fetchImpl });
  const log = opts.log ?? (() => {});
  /** @type {import("./filter.mjs").FilterState | null} */
  let state = null;
  /** conversation id -> label shown in the header */
  const labels = new Map();
  /** actor id -> { handle, kind } */
  const actors = new Map();
  /** @type {Set<number>} */
  const seen = new Set();
  /** thread roots already looked up on the server (negative answers included) */
  const threadChecked = new Set();
  let mentionCursor = opts.mentionCursor ?? 0;
  let rosterAt = 0;
  /** @type {Promise<void>} */
  let chain = Promise.resolve();
  /** @type {ReturnType<typeof openEventStream> | null} */
  let stream = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let refreshTimer = null;
  let stopped = false;

  /** @param {number} id */
  function markSeen(id) {
    seen.add(id);
    if (seen.size > SEEN_MAX) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
  }

  /** @param {any} c */
  function labelOf(c) {
    if (c.kind === "dm" || c.kind === "group") {
      const others = Array.isArray(c.others) ? c.others.map((/** @type {any} */ o) => o.handle) : [];
      return `dm:${others.join(",") || c.id}`;
    }
    return c.slug ?? String(c.id);
  }

  async function refreshMemberships() {
    const r = await api.get("/api/conversations");
    if (!state) return;
    const kinds = new Map();
    for (const c of r.conversations ?? []) {
      kinds.set(c.id, c.kind);
      labels.set(c.id, labelOf(c));
    }
    state.memberships.clear();
    for (const m of r.memberships ?? []) {
      state.memberships.set(m.conversationId, { notify: m.notify, kind: kinds.get(m.conversationId) ?? "public" });
    }
  }

  async function refreshRoster() {
    rosterAt = Date.now();
    const r = await api.get("/api/actors");
    for (const a of r.actors ?? []) actors.set(a.id, { handle: a.handle, kind: a.kind });
  }

  /** @param {number} threadId */
  async function checkThread(threadId) {
    if (!state || threadChecked.has(threadId) || state.threads.has(threadId)) return;
    threadChecked.add(threadId);
    try {
      const r = await api.get(`/api/messages/${threadId}/thread`);
      for (const m of r.messages ?? []) noteOwn(state, { ...m, threadId: m.threadId ?? threadId });
    } catch (err) {
      threadChecked.delete(threadId);
      log(`thread lookup failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** @param {any} msg @param {{ serverMention?: boolean }} [extra] */
  async function consider(msg, extra = {}) {
    if (!state || !msg || typeof msg.id !== "number") return;
    if (seen.has(msg.id)) return;
    if (msg.actorId === state.me.id) {
      markSeen(msg.id);
      noteOwn(state, msg);
      return;
    }
    const convId = Number(msg.conversationId);
    if (!state.memberships.has(convId) && !extra.serverMention) {
      // Maybe a conversation created a moment ago (a new DM): one refresh before deciding.
      try { await refreshMemberships(); } catch { /* decide with what we have */ }
    }
    const mem = state.memberships.get(convId);
    if (msg.threadId && mem && mem.notify !== "none" && mem.kind !== "dm" && mem.kind !== "group") {
      await checkThread(msg.threadId);
    }
    const verdict = classify({ type: "message", conversationId: convId, message: msg }, state, extra);
    markSeen(msg.id);
    if (!verdict) return;
    let author = actors.get(msg.actorId);
    if (!author && Date.now() - rosterAt > ROSTER_REFRESH_MIN_MS) {
      try { await refreshRoster(); } catch { /* fall back to the handle on the event */ }
      author = actors.get(msg.actorId);
    }
    if (!labels.has(convId)) {
      try { await refreshMemberships(); } catch { /* label falls back to the id */ }
    }
    opts.onItem({
      id: msg.id,
      conversationId: convId,
      threadId: msg.threadId ?? null,
      kind: verdict.kind,
      convLabel: labels.get(convId) ?? String(convId),
      author: author?.handle ?? msg.actorHandle ?? "?",
      authorKind: author?.kind === "human" ? "human" : "agent",
      body: String(msg.body ?? ""),
    });
  }

  /** The server's mention list: authoritative, and the only source for a call into a public
   *  conversation the agent is not a member of (the stream carries members only). */
  async function pullMentions() {
    const r = await api.get(`/api/mentions?after=${mentionCursor}&limit=200`);
    for (const m of r.messages ?? []) {
      if (m.id > mentionCursor) mentionCursor = m.id;
      await consider(m, { serverMention: true });
    }
  }

  /** @param {import("./sse.mjs").SseEvent} e */
  async function handle(e) {
    if (!state) return;
    const data = e.data ?? {};
    if (e.type === "message" && data.message) {
      await consider({ ...data.message, conversationId: data.message.conversationId ?? data.conversationId });
      if (e.id !== null) opts.onCursor?.(e.id);
    } else if (e.type === "conversation") {
      await refreshMemberships();
    } else if (e.type === "notification") {
      await pullMentions();
    }
    // message_updated, reaction, read, presence, wiki: nothing to push.
  }

  return {
    async start() {
      const me = await api.get("/api/me");
      state = newFilterState({ id: me.actor.id, handle: me.actor.handle });
      for (const c of me.conversations ?? []) labels.set(c.id, labelOf(c));
      await refreshMemberships();
      try { await refreshRoster(); } catch { /* handles on events are the fallback */ }
      if (opts.mentionCursor) {
        // A resumed feed (the monitor after a restart): mentions after the saved cursor are
        // read now, so a call into a non-member conversation during the gap is not lost.
        try { await pullMentions(); } catch { /* the next notification retries */ }
      } else {
        // A fresh feed starts the mention cursor at "now": older mentions are the
        // SessionStart summary's job.
        try {
          const r = await api.get("/api/mentions?limit=1");
          for (const m of r.messages ?? []) {
            mentionCursor = Math.max(mentionCursor, m.id);
            markSeen(m.id);
          }
        } catch { /* starts from 0: at worst old mentions are pushed once */ }
      }
      if (stopped) return;
      stream = openEventStream({
        url: opts.identity.url,
        token: opts.identity.token,
        lastEventId: opts.lastEventId ?? null,
        ...opts.sse,
        onState: (s, info) => opts.onState?.(s, info),
        onEvent: (e) => {
          chain = chain.then(() => handle(e)).catch((err) => {
            log(`event handling failed: ${err instanceof Error ? err.message : err}`);
          });
        },
      });
      refreshTimer = setInterval(() => {
        // notify changes publish no event, so memberships are re-read on a slow beat.
        chain = chain.then(() => refreshMemberships()).catch(() => {});
      }, MEMBERSHIP_REFRESH_MS);
      refreshTimer.unref?.();
    },
    /** @returns {{ handle: string, id: number } | null} */
    get me() { return state ? state.me : null; },
    get lastEventId() { return stream?.lastEventId ?? opts.lastEventId ?? null; },
    get mentionCursor() { return mentionCursor; },
    stop() {
      stopped = true;
      stream?.close();
      if (refreshTimer) clearInterval(refreshTimer);
    },
    /** Waits until every event received so far is handled (for tests and clean exits). */
    idle() { return chain; },
  };
}
