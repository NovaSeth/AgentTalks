// @ts-check
/**
 * Rate limit for pushes into the session: at most one push per interval (1 s), sustained.
 * A burst does not become a burst of interruptions: everything that arrives inside the
 * window goes out together, as ONE push listing several messages, when the window ends.
 *
 * The queue is bounded: past MAX_QUEUE items the oldest are dropped and counted, and the next
 * push says how many were skipped, so a flood cannot grow the process without limit and the
 * agent still learns that it should read the backlog itself.
 */

export const MAX_BATCH = 20;
export const MAX_QUEUE = 500;

/**
 * @template T
 * @param {{
 *   send: (items: T[], info: { dropped: number }) => void,
 *   intervalMs?: number, maxBatch?: number, maxQueue?: number,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => unknown,
 * }} opts
 */
export function createPusher(opts) {
  const intervalMs = opts.intervalMs ?? 1000;
  const maxBatch = opts.maxBatch ?? MAX_BATCH;
  const maxQueue = opts.maxQueue ?? MAX_QUEUE;
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  });
  /** @type {T[]} */
  const queue = [];
  let lastAt = -Infinity;
  let pending = false;
  let dropped = 0;

  function flush() {
    pending = false;
    if (queue.length === 0) return;
    const batch = queue.splice(0, maxBatch);
    lastAt = now();
    const info = { dropped };
    dropped = 0;
    try { opts.send(batch, info); } catch { /* a failed write must not wedge the queue */ }
    if (queue.length) schedule(intervalMs);
  }

  /** @param {number} ms */
  function schedule(ms) {
    pending = true;
    setTimer(flush, ms);
  }

  return {
    /** @param {T} item */
    push(item) {
      queue.push(item);
      if (queue.length > maxQueue) { queue.shift(); dropped++; }
      if (pending) return;
      const wait = lastAt + intervalMs - now();
      if (wait <= 0) flush();
      else schedule(wait);
    },
    get size() { return queue.length; },
  };
}
