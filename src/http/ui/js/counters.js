/**
 * Unread counters: ONE derivation for the tab title, the rail badge, the "New messages"
 * divider and the digest count (S7). Every function here is pure - it reads what it is given
 * and touches no DOM - so the views cannot drift apart again (the title said 12 while the
 * badges summed to 5).
 */

/** The total of unread messages across conversations; a pure function over the unread map. */
export function countUnread(unread) {
  let n = 0;
  for (const v of Object.values(unread || {})) n += Number(v) || 0;
  return n;
}

/** Badge text with the same cap the server uses. */
export function badgeText(n) {
  const v = Number(n) || 0;
  return v > 99 ? "99+" : String(v);
}

/** The tab title count: the WEIGHTED unread (unreadBadge: every DM/group message, mentions in
 *  channels - the coral badges) plus notifications that have no counterpart in the conversation
 *  counters, i.e. wiki page changes. Mentions and DMs produce both an unread row and a
 *  notification, so adding notifUnread would count them twice. */
export function titleCount(state) {
  const badges = countUnread(state?.unreadBadge);
  const wiki = (state?.notifications || []).filter((n) => n && !n.readAt && n.wikiSlug).length;
  return badges + wiki;
}

/** Unread messages in the direct and group conversations I belong to: the DMs rail badge. */
export function unreadDmCount(state) {
  return (state?.conversations || [])
    .filter((c) => state.memberships?.[c.id] && (c.kind === "dm" || c.kind === "group"))
    .reduce((n, c) => n + (Number(state.unread?.[c.id]) || 0), 0);
}

/** The rail badges, ONE source (W5-S8-B): Activity (the bell) shows the notification center
 *  count, DMs the unread of my direct and group conversations. */
export function railBadges(state) {
  return { activity: Number(state?.notifUnread) || 0, dms: unreadDmCount(state) };
}

/** Where the "New messages" divider goes. Returns a MARK: the divider is drawn before the first
 *  message by somebody else whose id is above it; null means no divider.
 *  - mark > 0 (the server's last read id): that mark, when somebody else wrote after it.
 *  - mark 0 (never read here, or a first visit): the server still knows how many are unread, so
 *    the line goes above the `unread`-th message from the end (own messages do not count).
 *    `lastUnreadId` (the server's newest unread id, W2-S7-A) bounds that estimate: a message
 *    above it is read and does not count, and the count never reaches past the oldest visible
 *    candidate, so the thread replies the server counted and the main list hides cannot push
 *    the line higher than the first message. */
export function dividerAfter(list, mark, unread, me, lastUnreadId = 0) {
  let others = (list || []).filter((m) => m && typeof m.id === "number" && m.actorId !== me);
  if (mark > 0) return others.some((m) => m.id > mark) ? mark : null;
  const n = Number(unread) || 0;
  if (n <= 0 || !others.length) return null;
  const last = Number(lastUnreadId) || 0;
  if (last > 0) others = others.filter((m) => m.id <= last);
  if (!others.length) return null;
  const first = others[Math.max(0, others.length - n)];
  return first.id - 1;
}

/** T-MG-44: the ids that get the unread HIGHLIGHT when the user comes back: every message by
 *  somebody else above `mark` (the divider's mark on entry; the newest id seen while present on
 *  a return to the tab). `null` mark = no divider = nothing. Own and deleted messages never. */
export function highlightUnreadIds(list, mark, me) {
  if (mark === null || mark === undefined) return [];
  const since = Number(mark) || 0;
  return (list || [])
    .filter((m) => m && typeof m.id === "number" && m.id > since && m.actorId !== me && !m.deletedAt)
    .map((m) => m.id);
}

/** The digest count moves forward in time only. Every poll carries a sequence number; an answer
 *  from an OLDER request arriving after a newer one is stale and dropped (that was the
 *  12 -> 5 -> 12 jump: the 30 s timer and a forced refresh after an action in flight at once).
 *  `undefined` = the fetch failed: keep what we have. `null` = nothing missed: clear. */
export function acceptDigest(current, incoming) {
  if (incoming === undefined) return current ?? null;
  if (incoming === null) return null;
  if (current && Number(incoming.seq) < Number(current.seq)) return current;
  return incoming;
}
