// @ts-check
/**
 * A dependency-free client for GET /api/events (Server-Sent Events) that survives breaks.
 *
 * - Reconnects with exponential backoff and jitter (initial 1 s, cap 30 s by default), so a
 *   server restart does not turn every agent into a tight reconnect loop - the server also
 *   caps streams per actor (src/http/sse.ts MAX_STREAMS_PER_ACTOR) and answers 429.
 * - Resumes from the last event id it saw (the `Last-Event-ID` header). The server sends an
 *   id only with `message` events and replays everything after it on reconnect, so nothing
 *   posted during the break is lost.
 * - Stops for good on 401/403: a revoked token or a disabled actor will not recover by
 *   retrying, and hammering the server with a dead token helps nobody.
 * - Treats a silent socket as dead: the server writes a ping comment every 20 s, so 65 s of
 *   silence means the connection is gone even if TCP has not noticed.
 */

/**
 * @typedef {{ type: string, id: number | null, data: any }} SseEvent
 * @typedef {"open" | "reconnecting" | "unauthorized" | "closed"} SseState
 */

/**
 * @param {{
 *   url: string, token: string, lastEventId?: number | null,
 *   onEvent: (e: SseEvent) => void,
 *   onState?: (s: SseState, info?: { delayMs?: number, status?: number }) => void,
 *   fetchImpl?: typeof fetch,
 *   initialBackoffMs?: number, maxBackoffMs?: number, idleMs?: number,
 *   random?: () => number,
 * }} opts
 */
export function openEventStream(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const initial = opts.initialBackoffMs ?? 1000;
  const max = opts.maxBackoffMs ?? 30_000;
  const idleMs = opts.idleMs ?? 65_000;
  const random = opts.random ?? Math.random;
  const onState = opts.onState ?? (() => {});
  /** @type {number | null} */
  let lastEventId = opts.lastEventId ?? null;
  let closed = false;
  /** @type {AbortController | null} */
  let controller = null;
  /** @type {(() => void) | null} */
  let wakeSleep = null;

  /** @param {number} ms */
  const sleep = (ms) => new Promise((resolve) => {
    const t = setTimeout(() => { wakeSleep = null; resolve(undefined); }, ms);
    wakeSleep = () => { clearTimeout(t); wakeSleep = null; resolve(undefined); };
  });

  /** One connection: resolves when the stream ends, returns whether any byte arrived and the
   *  final HTTP status. @returns {Promise<{ gotData: boolean, status: number }>} */
  async function once() {
    controller = new AbortController();
    const ctl = controller;
    /** @type {Record<string, string>} */
    const headers = { authorization: `Bearer ${opts.token}`, accept: "text/event-stream" };
    if (lastEventId !== null) headers["last-event-id"] = String(lastEventId);
    let gotData = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let idle = null;
    const armIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => ctl.abort(), idleMs);
    };
    try {
      armIdle();
      const res = await fetchImpl(opts.url.replace(/\/+$/, "") + "/api/events", { headers, signal: ctl.signal });
      if (!res.ok || !res.body) {
        try { await res.body?.cancel(); } catch { /* already gone */ }
        return { gotData, status: res.status };
      }
      onState("open");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      /** @type {{ id: string | null, event: string, data: string[] }} */
      let cur = { id: null, event: "", data: [] };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        gotData = true;
        armIdle();
        buf += decoder.decode(value, { stream: true });
        // Line endings per the SSE spec: CRLF, LF or CR. A trailing CR may be the first half
        // of a CRLF split across chunks, so it waits for the next chunk.
        for (;;) {
          const m = /\r\n|\n|\r(?!$)/.exec(buf);
          if (!m) break;
          const line = buf.slice(0, m.index);
          buf = buf.slice(m.index + m[0].length);
          if (line === "") {
            if (cur.data.length) dispatch(cur);
            cur = { id: null, event: "", data: [] };
            continue;
          }
          if (line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          let value = colon < 0 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "data") cur.data.push(value);
          else if (field === "event") cur.event = value;
          else if (field === "id") cur.id = value;
        }
      }
      return { gotData, status: res.status };
    } catch {
      return { gotData, status: 0 };
    } finally {
      if (idle) clearTimeout(idle);
    }
  }

  /** @param {{ id: string | null, event: string, data: string[] }} cur */
  function dispatch(cur) {
    let data;
    try { data = JSON.parse(cur.data.join("\n")); } catch { return; }
    const id = cur.id !== null && /^\d+$/.test(cur.id) ? Number(cur.id) : null;
    // The cursor only moves forward: replay after a reconnect may interleave edits (no id).
    if (id !== null && (lastEventId === null || id > lastEventId)) lastEventId = id;
    try {
      opts.onEvent({ type: cur.event || "message", id, data });
    } catch { /* a consumer error must not kill the stream */ }
  }

  (async () => {
    let backoff = initial;
    while (!closed) {
      const { gotData, status } = await once();
      if (closed) break;
      if (status === 401 || status === 403) {
        closed = true;
        onState("unauthorized", { status });
        break;
      }
      // A connection that delivered data was healthy: start the backoff over.
      if (gotData) backoff = initial;
      const delayMs = Math.round(backoff * (0.5 + random() * 0.5));
      onState("reconnecting", { delayMs, status });
      await sleep(delayMs);
      backoff = Math.min(max, backoff * 2);
    }
    onState("closed");
  })();

  return {
    get lastEventId() { return lastEventId; },
    close() {
      closed = true;
      controller?.abort();
      wakeSleep?.();
    },
  };
}
