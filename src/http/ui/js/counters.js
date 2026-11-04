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

/** The rail badges: Activity (the bell) shows the notification center count. */
export function railBadges(state) {
  return { activity: Number(state?.notifUnread) || 0 };
}

/** Where the "New messages" divider goes. Returns a MARK: the divider is drawn before the first
 *  message by somebody else whose id is above it; null means no divider.
 *  - mark > 0 (the server's last read id): that mark, when somebody else wrote after it.
 *  - mark 0 (never read here, or a first visit): the server still knows how many are unread, so
 *    the line goes above the `unread`-th message from the end (own messages do not count). */
export function dividerAfter(list, mark, unread, me) {
  const others = (list || []).filter((m) => m && typeof m.id === "number" && m.actorId !== me);
  if (mark > 0) return others.some((m) => m.id > mark) ? mark : null;
  const n = Number(unread) || 0;
  if (n <= 0 || !others.length) return null;
  const first = others[Math.max(0, others.length - n)];
  return first.id - 1;
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
