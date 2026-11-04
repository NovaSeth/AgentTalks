// @ts-check
/**
 * The live feed shared by the channel server and the monitor: the SSE stream, the filter and
 * the data needed to frame a message (conversation label, author handle and kind).
 *
 * Events are processed ONE AT A TIME, in arrival order, from a queue: some need a REST lookup
 * first (an unknown conversation, a thread started before the feed did), and without the
 * order a slow lookup would let a later message overtake an earlier one.
 *
 * An event is DECIDED (marked seen) only once the filter has an answer. When a lookup the
 * decision needs fails for a reason that can pass (a network error, a 5xx, a 429), the event
 * stays at the head of the queue and is retried with backoff; a stale membership list never
 * decides "not for me".
 *
 * The cursors follow DELIVERY, not the decision: `onItem` may return a promise that settles
 * when the item is actually written (the channel's notification after its rate limit, the
 * monitor's line), and an event id (or a mention id) becomes the committed cursor only once
 * it and EVERY earlier event are decided and delivered (an in-order ledger). The committed
 * cursors are the only ones ever reported (`lastEventId`, `mentionCursor`, `onCursor`), so a
 * process that stops with items still undelivered (held by the rate limit, a write still in
 * flight, a lookup that hangs) hands over a cursor BEFORE them, and whoever resumes from it
 * gets them again by replay. A promise that rejects means "not delivered": the cursor stays.
 *
 * The queue is bounded: past `maxQueue` events the feed drops the stream, finishes what it
 * holds, and reconnects from the committed cursor, so the server replays what it dropped.
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
export const MAX_QUEUE = 2000;

/** A lookup failed for a reason that can pass: decide later, acknowledge nothing now. */
class RetryLater extends Error {}

/** @param {unknown} err */
function describe(err) {
  return err instanceof Error ? err.message : String(err);
}

/** A 4xx other than 408/429 is an answer (no access, gone), not a hiccup. @param {any} err */
function isDefinitive(err) {
  const s = Number(err?.status) || 0;
  return s >= 400 && s < 500 && s !== 408 && s !== 429;
}

/**
 * @typedef {void | Promise<unknown>} Delivery
 * @typedef {{ id: number, conversationId: number, threadId: number | null,
 *   kind: import("./filter.mjs").PushKind, convLabel: string, author: string,
 *   authorKind: string, body: string }} FeedItem
 * @typedef {{ type: string, id: number | null, data: any }} QueuedEvent
 */

/**
 * @param {{
 *   identity: { url: string, token: string, source?: string },
 *   onItem: (item: FeedItem) => Delivery,
 *   onState?: (state: string, info?: object) => void,
 *   onCursor?: (lastEventId: number | null) => void,
 *   lastEventId?: number | null,
 *   mentionCursor?: number | null,
 *   log?: (line: string) => void,
 *   fetchImpl?: typeof fetch,
 *   sse?: { initialBackoffMs?: number, maxBackoffMs?: number, idleMs?: number },
 *   retry?: { initialMs?: number, maxMs?: number },
 *   maxQueue?: number,
 * }} opts
 */
export function createFeed(opts) {
  const api = createApi(opts.identity, { fetchImpl: opts.fetchImpl });
  const log = opts.log ?? (() => {});
  const retryInitial = opts.retry?.initialMs ?? 1000;
  const retryMax = opts.retry?.maxMs ?? 30_000;
  const maxQueue = opts.maxQueue ?? MAX_QUEUE;
  /** @type {import("./filter.mjs").FilterState | null} */
  let state = null;
  /** conversation id -> label shown in the header */
  const labels = new Map();
  /** actor id -> { handle, kind } */
  const actors = new Map();
  /** @type {Set<number>} */
  const seen = new Set();
  /** message ids the server's mention list confirmed, in conversations the stream carries */
  /** @type {Set<number>} */
  const serverMentioned = new Set();
  /** thread roots already looked up on the server (negative answers included) */
  const threadChecked = new Set();
  /** The last mention id delivered (with every mention before it): the reported cursor. */
  let mentionCursor = opts.mentionCursor ?? 0;
  /** The last mention id decided: where the next GET /api/mentions starts. */
  let pullCursor = mentionCursor;
  let rosterAt = 0;
  /** The last event id delivered, with every event before it: the only event cursor ever
   *  reported. */
  /** @type {number | null} */
  let committed = opts.lastEventId ?? null;
  /** Events up to here were handled by an earlier run (the cursor this feed resumed from). */
  const resumedFrom = opts.lastEventId ?? null;
  /** The cursor the current stream was opened with: it replays every message after it.
   *  null = opened without one (only what arrives from now on). */
  /** @type {number | null} */
  let streamFrom = null;
  /** In-order delivery ledger: an entry is applied (moves a cursor) only once it and every
   *  entry before it are done. */
  /** @type {Array<{ done: boolean, apply: () => void }>} */
  const ledger = [];
  /** @type {QueuedEvent[]} */
  const queue = [];
  let processing = false;
  let overflowed = false;
  /** @type {Array<() => void>} */
  const idleWaiters = [];
  /** @type {(() => void) | null} */
  let wakeRetry = null;
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

  /** @param {number} id */
  function commit(id) {
    if (committed !== null && id <= committed) return;
    committed = id;
    opts.onCursor?.(id);
  }

  /** @param {number} id */
  function commitMention(id) {
    if (id <= mentionCursor) return;
    mentionCursor = id;
    opts.onCursor?.(committed);
  }

  /** Queues a cursor move behind every earlier one; it happens once `delivery` settles.
   *  @param {Delivery} delivery @param {() => void} apply */
  function track(delivery, apply) {
    const entry = { done: false, apply };
    ledger.push(entry);
    const finish = () => {
      entry.done = true;
      while (ledger.length > 0 && ledger[0].done) /** @type {{ apply: () => void }} */ (ledger.shift()).apply();
      checkIdle();
    };
    if (delivery && typeof delivery.then === "function") {
      delivery.then(finish, (err) => log(`delivery failed, the cursor stays before it: ${describe(err)}`));
    } else {
      finish();
    }
  }

  function checkIdle() {
    if (processing) return;
    if (stopped || (queue.length === 0 && ledger.length === 0)) for (const w of idleWaiters.splice(0)) w();
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
    let r;
    try {
      r = await api.get(`/api/messages/${threadId}/thread`);
    } catch (err) {
      if (isDefinitive(err)) { threadChecked.add(threadId); return; }
      throw new RetryLater(`thread lookup failed: ${describe(err)}`);
    }
    threadChecked.add(threadId);
    for (const m of r.messages ?? []) noteOwn(state, { ...m, threadId: m.threadId ?? threadId });
  }

  /** The delivery comes back WRAPPED ({ delivery }): an async function returning the bare
   *  promise would make every caller wait for the delivery itself, and the rate limit would
   *  then hold up the whole queue.
   *  @param {any} msg @param {{ serverMention?: boolean }} [extra] @returns {Promise<{ delivery: Delivery } | undefined>} */
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
      // Maybe a conversation created a moment ago (a new DM): the list must be re-read before
      // deciding. If it cannot be read, the decision waits: never "not a member" on old data.
      try { await refreshMemberships(); } catch (err) {
        throw new RetryLater(`membership lookup failed: ${describe(err)}`);
      }
    }
    const mem = state.memberships.get(convId);
    if (msg.threadId && mem && mem.notify !== "none" && mem.kind !== "dm" && mem.kind !== "group") {
      await checkThread(msg.threadId);
    }
    const verdict = classify({ type: "message", conversationId: convId, message: msg }, state,
      serverMentioned.has(msg.id) ? { ...extra, serverMention: true } : extra);
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
    return { delivery: opts.onItem({
      id: msg.id,
      conversationId: convId,
      threadId: msg.threadId ?? null,
      kind: verdict.kind,
      convLabel: labels.get(convId) ?? String(convId),
      author: author?.handle ?? msg.actorHandle ?? "?",
      authorKind: author?.kind === "human" ? "human" : "agent",
      body: String(msg.body ?? ""),
    }) };
  }

  /** The server's mention list: authoritative, and the only source for a call into a public
   *  conversation the agent is not a member of (the stream carries members only).
   *
   *  A mention in a conversation the agent IS a member of is left to the stream ONLY when the
   *  stream is certain to carry it: the stream was opened with a cursor before it, so it
   *  delivers (or replays) it in order. Otherwise - no replay cursor (a server without
   *  GET /api/status), or a message from before the stream's cursor that no earlier run
   *  handled - nothing else would ever deliver it, so it is delivered from here; the
   *  stream's copy, if one comes, is a duplicate the seen set drops (codex r3 F9). A mention
   *  at or before the cursor this feed resumed from was handled by the run that committed
   *  that cursor.
   *
   *  The mention cursor moves past a message only once it is delivered (or left to a stream
   *  whose event cursor, saved with it, still replays it). */
  async function pullMentions() {
    let r;
    try { r = await api.get(`/api/mentions?after=${pullCursor}&limit=200`); } catch (err) {
      throw new RetryLater(`mention list failed: ${describe(err)}`);
    }
    for (const m of r.messages ?? []) {
      if (!state || typeof m?.id !== "number") continue;
      /** @type {Delivery} */
      let delivery = undefined;
      if (state.memberships.has(Number(m.conversationId))) {
        if (resumedFrom !== null && m.id <= resumedFrom) {
          // handled by the run whose cursor this feed resumed from
        } else if (streamFrom !== null && m.id > streamFrom) {
          serverMentioned.add(m.id);
          const oldest = serverMentioned.size > SEEN_MAX ? serverMentioned.values().next().value : undefined;
          if (oldest !== undefined) serverMentioned.delete(oldest);
        } else {
          delivery = (await consider(m, { serverMention: true }))?.delivery;
        }
      } else {
        delivery = (await consider(m, { serverMention: true }))?.delivery;
      }
      if (m.id > pullCursor) pullCursor = m.id;
      const id = m.id;
      track(delivery, () => commitMention(id));
    }
  }

  /** @param {QueuedEvent} e @returns {Promise<{ delivery: Delivery } | undefined>} */
  async function handle(e) {
    if (!state) return;
    const data = e.data ?? {};
    if (e.type === "message" && data.message) {
      return consider({ ...data.message, conversationId: data.message.conversationId ?? data.conversationId });
    } else if (e.type === "conversation" || e.type === "refresh") {
      // Best effort: a message in a conversation the list does not know re-reads it anyway.
      try { await refreshMemberships(); } catch (err) { log(`membership refresh failed: ${describe(err)}`); }
    } else if (e.type === "notification") {
      await pullMentions();
    }
    // message_updated, reaction, read, presence, wiki: nothing to push.
  }

  /** @param {number} ms */
  function sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { wakeRetry = null; resolve(undefined); }, ms);
      wakeRetry = () => { clearTimeout(t); wakeRetry = null; resolve(undefined); };
    });
  }

  async function drain() {
    if (processing) return;
    processing = true;
    let delay = retryInitial;
    try {
      while (queue.length > 0) {
        const e = queue[0];
        /** @type {Delivery} */
        let delivery = undefined;
        try {
          delivery = (await handle(e))?.delivery;
        } catch (err) {
          if (err instanceof RetryLater) {
            if (stopped) break; // the event stays unacknowledged; the saved cursor is before it
            log(`${err.message}; retrying in ${delay} ms`);
            await sleep(delay);
            delay = Math.min(delay * 2, retryMax);
            if (stopped) break;
            continue;
          }
          // A bug, not a hiccup: skip the event rather than wedge the feed on it forever.
          log(`event handling failed: ${describe(err)}`);
        }
        delay = retryInitial;
        queue.shift();
        const id = e.id;
        track(delivery, () => { if (id !== null) commit(id); });
      }
    } finally {
      processing = false;
    }
    if (queue.length === 0 && overflowed && !stopped) {
      overflowed = false;
      log(`resuming the stream from ${committed ?? "now"} after a full queue`);
      openStream(committed);
      queue.push({ type: "notification", id: null, data: {} });
      void drain();
      return;
    }
    checkIdle();
  }

  /** @param {QueuedEvent} e */
  function enqueue(e) {
    if (stopped || overflowed) return;
    if (committed === null && e.id !== null) {
      // A fresh feed has no cursor yet: the first id it receives sets one just before it, so
      // even the first event can be replayed if it is not handled before a stop.
      committed = e.id - 1;
    }
    if (queue.length >= maxQueue) {
      // Drop the stream, finish what is queued, then reconnect from the committed cursor:
      // the server replays everything after it, the dropped events included.
      overflowed = true;
      log(`event queue full (${maxQueue}): reconnecting from the last handled event once it drains`);
      stream?.close();
      stream = null;
      return;
    }
    queue.push(e);
    void drain();
  }

  /** @param {number | null} from */
  function openStream(from) {
    streamFrom = from;
    stream = openEventStream({
      url: opts.identity.url,
      token: opts.identity.token,
      lastEventId: from,
      ...opts.sse,
      onState: (s, info) => opts.onState?.(s, info),
      onEvent: (e) => enqueue(e),
    });
  }

  return {
    async start() {
      const me = await api.get("/api/me");
      state = newFilterState({ id: me.actor.id, handle: me.actor.handle });
      for (const c of me.conversations ?? []) labels.set(c.id, labelOf(c));
      await refreshMemberships();
      try { await refreshRoster(); } catch { /* handles on events are the fallback */ }
      if (committed === null) {
        // A fresh feed: the stream starts from the newest message id NOW, so it has a replay
        // cursor from its first connection (nothing between this call and the connect is
        // lost, and the mention list knows what the stream will carry). Older messages are
        // the SessionStart summary's job. A server without GET /api/status: no cursor.
        try {
          const st = await api.get("/api/status");
          if (Number.isInteger(st?.lastMessageId) && st.lastMessageId >= 0) committed = st.lastMessageId;
        } catch (err) {
          if (!isDefinitive(err)) throw err;
        }
      }
      if (opts.mentionCursor !== undefined && opts.mentionCursor !== null) {
        // A resumed feed (0 included: no mention existed when the last run started):
        // mentions after the saved cursor are read first (and retried like any event), so a
        // call into a non-member conversation during the gap is not lost.
        enqueue({ type: "notification", id: null, data: {} });
      } else {
        // A fresh feed starts the mention cursor at "now": older mentions are the
        // SessionStart summary's job. Nothing is marked seen here: a message is marked seen
        // only once decided, or the stream's copy of it would be dropped unseen.
        try {
          const r = await api.get("/api/mentions?limit=1");
          for (const m of r.messages ?? []) {
            if (typeof m?.id === "number") mentionCursor = Math.max(mentionCursor, m.id);
          }
          pullCursor = mentionCursor;
        } catch { /* starts from 0: at worst old mentions are pushed once */ }
      }
      if (stopped) return;
      openStream(committed);
      refreshTimer = setInterval(() => {
        // notify changes publish no event, so memberships are re-read on a slow beat.
        enqueue({ type: "refresh", id: null, data: {} });
      }, MEMBERSHIP_REFRESH_MS);
      refreshTimer.unref?.();
    },
    /** @returns {{ handle: string, id: number } | null} */
    get me() { return state ? state.me : null; },
    /** The last event id DELIVERED, with everything before it (never one that is only
     *  received or only decided). */
    get lastEventId() { return committed; },
    /** The last mention id delivered, with every mention before it. */
    get mentionCursor() { return mentionCursor; },
    stop() {
      stopped = true;
      stream?.close();
      if (refreshTimer) clearInterval(refreshTimer);
      wakeRetry?.();
      checkIdle();
    },
    /** Resolves once every event received so far is handled and delivered, or, after stop(),
     *  once nothing is being handled (for tests and clean exits; deliveries still in flight
     *  then settle on their own). */
    idle() {
      if (!processing && (stopped || (queue.length === 0 && ledger.length === 0))) return Promise.resolve();
      return new Promise((resolve) => { idleWaiters.push(() => resolve(undefined)); });
    },
  };
}
