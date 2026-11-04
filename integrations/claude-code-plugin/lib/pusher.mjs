// @ts-check
/**
 * Rate limit for pushes into the session: at most one push per interval (1 s), sustained.
 * A burst does not become a burst of interruptions: everything that arrives inside the
 * window goes out together, as ONE push listing several messages, when the window ends.
 *
 * The queue is bounded: past MAX_QUEUE items the oldest are dropped and counted, and the next
 * push says how many were skipped, so a flood cannot grow the process without limit and the
 * agent still learns that it should read the backlog itself.
 *
 * push() returns a promise that settles when the item is DELIVERED: when `send` for its batch
 * has returned (and the promise `send` returned, if any, resolved: the write callback). A
 * dropped item counts as delivered with the batch that carries the "N were skipped" notice.
 * An item still waiting for its window when the process stops never resolves, so the feed's
 * cursor stays before it.
 */

export const MAX_BATCH = 20;
export const MAX_QUEUE = 500;

/**
 * @template T
 * @param {{
 *   send: (items: T[], info: { dropped: number }) => void | Promise<unknown>,
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
  /** @type {Array<{ item: T, delivered: () => void, failed: (err: unknown) => void }>} */
  const queue = [];
  let lastAt = -Infinity;
  let pending = false;
  let dropped = 0;
  /** resolvers of dropped items: delivered with the next batch's notice */
  /** @type {Array<() => void>} */
  let droppedDone = [];

  function flush() {
    pending = false;
    if (queue.length === 0) return;
    const batch = queue.splice(0, maxBatch);
    lastAt = now();
    const info = { dropped };
    dropped = 0;
    const carried = droppedDone;
    droppedDone = [];
    /** @type {Promise<unknown>} */
    let written;
    // A failed write must not wedge the queue; its items stay undelivered (rejected).
    try { written = Promise.resolve(opts.send(batch.map((b) => b.item), info)); } catch (err) { written = Promise.reject(err); }
    written.then(() => {
      for (const b of batch) b.delivered();
      for (const d of carried) d();
    }, (err) => { for (const b of batch) b.failed(err); });
    if (queue.length) schedule(intervalMs);
  }

  /** @param {number} ms */
  function schedule(ms) {
    pending = true;
    setTimer(flush, ms);
  }

  return {
    /** @param {T} item @returns {Promise<void>} settles when the item is delivered */
    push(item) {
      /** @type {Promise<void>} */
      const delivered = new Promise((resolve, reject) => {
        queue.push({ item, delivered: () => resolve(), failed: reject });
      });
      delivered.catch(() => {}); // the caller decides whether to wait; never an unhandled rejection
      if (queue.length > maxQueue) {
        const old = /** @type {{ delivered: () => void }} */ (queue.shift());
        droppedDone.push(old.delivered);
        dropped++;
      }
      if (!pending) {
        const wait = lastAt + intervalMs - now();
        if (wait <= 0) flush();
        else schedule(wait);
      }
      return delivered;
    },
    get size() { return queue.length; },
  };
}
