/**
 * Unread counters (S7 owns the behaviour; S0 only creates the file).
 */

/** The total of unread messages across conversations; a pure function over the unread map. */
export function countUnread(unread) {
  let n = 0;
  for (const v of Object.values(unread || {})) n += Number(v) || 0;
  return n;
}
