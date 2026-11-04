/**
 * Hash routing (S3): every view has a URL, Back and Forward walk the views you opened.
 *
 * Routes (spec section 1):
 *   #/c/<slug>                 a channel          #/c/<slug>/m/<id>   one message (scroll + flash)
 *   #/c/<slug>/t/<rootId>      a thread           #/dm/<handle>[,<handle>]  a direct conversation
 *   #/wiki/<slug>              a wiki page        #/wiki  the Wiki place (the tree and the claimed resources)
 *   #/activity  #/dms  #/admin  #/threads  #/unreads  #/people  #/search?q=
 *
 * parseRoute() turns a hash into a plain object the views can read; buildRoute() is its inverse.
 * Both are pure. syncRoute() is the one place that writes `location.hash`: it records what it
 * wrote so the `hashchange` listener in app.js can tell a Back/Forward (open the route) from an
 * echo of our own push (nothing to do).
 */

const HOME = Object.freeze({ view: "home" });

/** @returns {{ view: string, slug?: string, handles?: string[], messageId?: number, threadId?: number, q?: string }} */
export function parseRoute(hash) {
  const h = typeof hash === "string" ? hash : "";
  const body = h.startsWith("#") ? h.slice(1) : h;
  if (!body.startsWith("/")) return { ...HOME };
  const [pathPart, query = ""] = body.split("?", 2);
  const parts = pathPart.split("/").slice(1);
  const head = parts[0];
  if (head === "activity" && parts.length === 1) return { view: "activity" };
  if (head === "dms" && parts.length === 1) return { view: "dms" };
  // T-MG-38: the Wiki place has an address of its own, like DMs; a slug opens a page instead.
  if (head === "wiki" && parts.length === 1) return { view: "wikiPlace" };
  if (head === "admin" && parts.length === 1) return { view: "admin" };
  if (head === "threads" && parts.length === 1) return { view: "threads" };
  if (head === "unreads" && parts.length === 1) return { view: "unreads" };
  // W6-C2-B: the directory ("Who is here") has an address; app.js opens the sidebar section.
  if (head === "people" && parts.length === 1) return { view: "people" };
  if (head === "search" && parts.length === 1) {
    const q = new URLSearchParams(query).get("q") ?? "";
    return { view: "search", q };
  }
  if (head === "wiki" && parts.length === 2 && parts[1]) return { view: "wiki", slug: safeDecode(parts[1]) };
  if ((head === "c" || head === "dm") && parts[1]) {
    const route = head === "c"
      ? { view: "chat", slug: safeDecode(parts[1]) }
      : { view: "dm", handles: parts[1].split(",").map(safeDecode).filter(Boolean) };
    if (head === "dm" && !route.handles.length) return { ...HOME };
    if (parts.length === 2) return route;
    if (parts.length === 4 && /^\d+$/.test(parts[3])) {
      if (parts[2] === "m") return { ...route, messageId: Number(parts[3]) };
      if (parts[2] === "t") return { ...route, threadId: Number(parts[3]) };
    }
  }
  return { ...HOME };
}

/** The hash for a route object; "" for home or anything unknown. */
export function buildRoute(route) {
  if (!route || typeof route !== "object") return "";
  const tail = route.messageId ? `/m/${route.messageId}` : route.threadId ? `/t/${route.threadId}` : "";
  switch (route.view) {
    case "chat": return route.slug ? `#/c/${encodeURIComponent(route.slug)}${tail}` : "";
    case "dm": return route.handles?.length ? `#/dm/${route.handles.map(encodeURIComponent).join(",")}${tail}` : "";
    case "wiki": return route.slug ? `#/wiki/${encodeURIComponent(route.slug)}` : "";
    case "activity": return "#/activity";
    case "dms": return "#/dms";
    case "wikiPlace": return "#/wiki";
    case "admin": return "#/admin";
    case "threads": return "#/threads";
    case "unreads": return "#/unreads";
    case "people": return "#/people";
    case "search": return `#/search?q=${encodeURIComponent(route.q ?? "")}`;
    default: return "";
  }
}

/** The route of a conversation: `#/c/<slug>` for a channel, `#/dm/<handles>` (sorted, so the
 *  same people give the same link) for a direct one; `#/c/<id>` when neither is known yet. */
export function conversationRoute(c, others, opts = {}) {
  const extra = { messageId: opts.messageId, threadId: opts.threadId };
  if (c.kind === "dm" || c.kind === "group") {
    const handles = (others || []).map((o) => o.handle).filter(Boolean).sort();
    if (handles.length) return buildRoute({ view: "dm", handles, ...extra });
  }
  return buildRoute({ view: "chat", slug: c.slug || String(c.id), ...extra });
}

/** What "Copy link" copies: the origin, a slash, the hash. The app is served at "/" so the
 *  path is fixed here, independently of the page that produced the link. */
export function permalink(hash, origin) {
  return `${String(origin).replace(/\/+$/, "")}/${hash}`;
}

/** The unread count after "Mark unread" on `messageId`: the others' live messages from that one
 *  on (the server's rule: newer than the marker, not mine, not deleted). */
export function unreadFrom(list, messageId, me) {
  return (list || []).filter((m) => m && m.id >= messageId && m.actorId !== me && !m.deletedAt).length;
}

// ------------------------------------------------------------ writing the hash
// Hashes written by us, waiting for their `hashchange` echo. A Set, not a flag: two pushes in one
// tick (open a conversation, then its thread) each fire their own event.
const ownPushes = new Set();

/** Write a hash to the address bar (a new history entry, so Back returns here). The same hash
 *  twice is a no-op: the browser fires no event and adds no entry. */
export function syncRoute(hash) {
  if (typeof location === "undefined" || !hash || location.hash === hash) return;
  ownPushes.add(hash);
  location.hash = hash;
}

/** The hash a `hashchange` event moved to. Keyed on the EVENT, not on `location.hash`
 *  (W5-S10-D): two pushes in one tick fire two events while `location.hash` already holds the
 *  second, so reading the location consumed the second push twice and left the first in the set.
 *  A plain string is accepted too (a caller that already holds the hash). */
export function hashOfEvent(e) {
  if (typeof e === "string") return e;
  const url = e && typeof e.newURL === "string" ? e.newURL : "";
  const i = url.indexOf("#");
  return i < 0 ? "" : url.slice(i);
}

/** Called by the `hashchange` listener with the event: true when it only echoes our own push. */
export function consumeOwnPush(e) {
  const hash = hashOfEvent(e);
  if (!hash || !ownPushes.has(hash)) return false;
  ownPushes.delete(hash);
  return true;
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}
