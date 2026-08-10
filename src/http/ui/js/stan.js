/**
 * Application state and pure operations on it. It does NOT import views - communication in
 * that direction goes through the `widok` registry (injected drawing functions).
 */
import { t } from "./i18n.js";

// ------------------------------------------------------------------ state
export const state = {
  actor: null,
  conversations: [],
  memberships: {},         // convId -> membership
  unread: {},              // convId -> number of unread (bold + counter)
  unreadBadge: {},         // convId -> how many of them "weigh" (DM/group: every one; channel: mentions)
  activeId: null,
  msgs: {},                // convId -> Message[] (rosnaco po id)
  loaded: {},              // convId -> whether the history was FETCHED (not: whether any messages exist)
  readMark: {},            // convId -> id ostatniej przeczytanej, ZAMROZONE przy wejsciu (kreska "nowe")
  drafts: {},              // convId -> {text, replyTo} - szkic przezywajacy przelaczenie rozmowy
  pending: {},             // convId -> local in-flight messages (ids "tmp-...")
  actorsCache: {},         // id -> {handle, displayName, kind}
  actorsAt: 0,             // kiedy ostatnio pobrano katalog aktorow (TTL)
  online: true,            // czy strumien zdarzen zyje (stopka sidebara)
  reactions: {},           // messageId -> {emoji: [handle,...]}
  presence: [],            // PresenceRow[] (sesje)
  threadOpen: null,
  threadMsgs: [],
  detailsOpen: false,      // panel szczegolow rozmowy (uczestnicy/piny/akcje)
  convMembers: [],         // czlonkowie aktywnej rozmowy (z GET /:id)
  convPins: [],            // piny aktywnej rozmowy
  replyTo: null,
  drawerOpen: false,
  loadingConv: false,
  guidelines: null,
  news: null,              // "What's new" from /api/me - shown once, then null
  digest: null,            // "What you missed" from GET /api/digest (null = nothing)
  leases: [],              // aktywne dzierzawy zasobow (GET /api/leases)
  hasMore: {},             // convId -> whether there are older messages to load
  actorsList: [],
  openQuestions: {},       // messageId -> questionId (otwarte, widoczne dla mnie)
  lastDelivery: null,      // {conversationId, messageId, delivery[]} z ostatniej wysylki
  pendingFiles: [],        // files waiting to be sent (previews in the composer)
  sseCursor: 0,            // highest message id seen = the SSE replay cursor (?after=)
  newBelow: 0,             // how many new ones arrived while the list was scrolled up
  askMode: false,          // the composer sends a QUESTION to the channel instead of an ordinary message
  view: "chat",            // "chat" | "wiki" | "users" | "notifications"
  notifUnread: 0,          // licznik centrum powiadomien (dzwonek w sidebarze)
  notifications: [],       // ostatnie powiadomienia (GET /api/notifications)
  wiki: {
    pages: [], slug: null, page: null, files: [], history: [],
    revision: null,        // podgladana STARA rewizja (null = najnowsza)
    editing: false, tab: "info", draft: null,
  },
};

/** The registry of drawing functions. The data and action layers do NOT import views - that
/**  would close an import cycle (a view calls an action, the action redraws the view). Views
/**  register here once, at startup; the rest of the code calls them through this object. The
/**  default empty functions mean everything works even before any view exists at all (say, an
/**  error during login). */
export const widok = {
  render: () => {},           // the whole screen: login or the shell
  powloka: () => {},          // rail + panel boczny + kolumna glowna
  glowny: () => {},           // kolumna glowna biezacego widoku
  sidebar: () => {},          // the list of channels, messages and wiki
  wiersz: () => {},           // ONE conversation row (bold + badge)
  obecnosc: () => {},         // kropki, pasek "pisze/pracuje", topbar, kuleczki wiki
  wiadomosci: () => {},       // the whole message list
  wiadomosc: () => {},        // ONE bubble
  naDol: () => {},            // scrolling the list to the newest
  watek: () => {},
  otworzWatek: () => {},      // otwarcie panelu watku dla danego korzenia
  pasekOffline: () => {},     // pasek "brak polaczenia" nad rozmowa
  composer: () => {},
  szczegoly: () => {},
  wiki: () => {},
  powiadomienia: () => {},
  uzytkownicy: () => {},
  podepnijTresc: () => {},    // delegated events in freshly rendered content
  pisze: () => "",            // HTML kuleczek piszacych dla danego miejsca
  szczegolyDane: async () => {},
  otworzRozmowe: () => {},
  otworzWiki: () => {},
  poZalogowaniu: async () => {},
};

export function zarejestrujWidoki(fns) { Object.assign(widok, fns); }

export function actorHandle(id) { return (state.actorsCache[id] && state.actorsCache[id].handle) || "?"; }

export function actorKind(id) { return (state.actorsCache[id] && state.actorsCache[id].kind) || "agent"; }

export function mergeActors(map) { Object.assign(state.actorsCache, map || {}); }

/** An actor's avatar URL, or null (then we draw the dot with initials).
/**  `?v=<fingerprint>` in the URL makes an avatar change visible immediately despite a year of
/**  caching - without it, "I changed my avatar and nothing happened". */
export function avatarUrl(handleOrId) {
  const id = typeof handleOrId === "number" ? handleOrId : actorIdByHandle(handleOrId);
  const a = id != null ? state.actorsCache[id] : null;
  return a && a.avatar ? `/api/actors/${id}/avatar?v=${encodeURIComponent(a.avatar)}` : null;
}

function actorIdByHandle(h) {
  const low = String(h).toLowerCase();
  for (const [id, a] of Object.entries(state.actorsCache)) if (a.handle.toLowerCase() === low) return Number(id);
  return null;
}

// Aliases that call the whole channel - EXACTLY the same list as in the core
// (core/mentions.ts), otherwise an @all announcement would count for less on the client than
// on the server and the counter would change on a mere refresh.
const WOLANIA_OGOLNE = ["all", "channel", "here", "wszyscy", "kanal"];

/** "Does this message call me" - an expression built ONCE after login, rather than for every
/**  bubble on every render. The character class before @ is the same as in mdInline, so
/**  "(@michal" counts the same as " @michal". */
// A handle allows a dot and a hyphen (core/ids.ts), and a dot in a regular expression means
// "any character" - without escaping, "@jan.kowalski" would match "@janXkowalski".
// The helper lives here rather than in dom.js, because stan.js deliberately imports nothing.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let mentionRe = null;

/** Logging out clears the pattern - otherwise the next user in the same tab would count
/**  mentions against somebody else's handle. */
export function resetMentionRe() { mentionRe = null; }

export function rebuildMentionRe() {
  const mine = state.actor ? escapeRe(state.actor.handle) : null;
  const alias = [...(mine ? [mine] : []), ...WOLANIA_OGOLNE].join("|");
  mentionRe = new RegExp(`(^|[\\s(>])@(${alias})\\b`, "i");
}

export function mentionsMe(text) {
  if (!mentionRe) rebuildMentionRe();
  return mentionRe.test(String(text ?? ""));
}

/** The only place a message enters the state - and the only one where the SSE replay cursor
/**  moves. */
export function upsertMessage(convId, msg) {
  const list = state.msgs[convId] || (state.msgs[convId] = []);
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) list[i] = msg; else { list.push(msg); list.sort((a, b) => a.id - b.id); }
  if (msg.id > state.sseCursor) state.sseCursor = msg.id;
}

/** Unread rows from the server (fields: unread, badge) into two state maps.
/**  NOTE: the field is called `unread`, not `count` - the old read of row.count returned
/**  undefined and the server's counters NEVER loaded (only SSE increments worked in a live
/**  session; after a refresh they disappeared). */
export function applyUnreadRows(rows) {
  state.unread = {};
  state.unreadBadge = {};
  for (const row of rows || []) {
    state.unread[row.conversationId] = row.unread || 0;
    state.unreadBadge[row.conversationId] = row.badge || 0;
  }
}

/** Merges reactions from a server response. It first DELETES the entries for the fetched
/**  messages: a message with no reactions has no key in the response, so a plain Object.assign
/**  never removes the last reaction (the chip stayed forever). */
export function mergeReactions(messages, reactions) {
  for (const m of messages) delete state.reactions[m.id];
  Object.assign(state.reactions, reactions || {});
}

// ------------------------------------------------------------------ drafts
// Switching conversation while writing is the norm in a messenger, not an accident - so the
// text and the attached files have to survive it. The text additionally lands in localStorage
// so that it survives F5 and a deployment; the files stay in the tab's memory (a File object
// cannot be serialised).
const DRAFT_KEY = (id) => `atalks_draft_${id}`;

/** It looks into the text field, because that is the source of truth about a draft's content
/**  (the state does not track every keystroke). This is the only place in this module that
/**  touches the DOM - and it creates no dependency on any view. */
export function saveDraft() {
  const id = state.activeId;
  if (!id) return;
  const ta = document.getElementById("composer-input");
  const text = ta ? ta.value : (state.drafts[id]?.text ?? "");
  const files = state.pendingFiles;
  if (text.trim() || state.replyTo || files.length) {
    state.drafts[id] = { text, replyTo: state.replyTo, files };
    try { localStorage.setItem(DRAFT_KEY(id), text); } catch { /* prywatny tryb */ }
  } else {
    clearDraft(id);
  }
}

export function loadDraft(convId) {
  if (state.drafts[convId]) return state.drafts[convId];
  try {
    const text = localStorage.getItem(DRAFT_KEY(convId));
    if (text) return (state.drafts[convId] = { text, replyTo: null, files: [] });
  } catch { /* prywatny tryb */ }
  return null;
}

export function clearDraft(convId) {
  delete state.drafts[convId];
  try { localStorage.removeItem(DRAFT_KEY(convId)); } catch { /* prywatny tryb */ }
}

/** The history of conversations we are not looking at must not grow in the tab forever.
/**  We delete it TOGETHER with the "loaded" marker, so that returning fetches it exactly as it
/**  did the first time - the state and the memory must not drift apart. */
const CACHE_ROZMOW = 5;

export function przytnijCache() {
  const zostaw = new Set([state.activeId, ...recentConvIds().slice(0, CACHE_ROZMOW)]);
  for (const key of Object.keys(state.msgs)) {
    const id = Number(key);
    if (zostaw.has(id)) continue;
    delete state.msgs[id];
    delete state.loaded[id];
    delete state.hasMore[id];
  }
}

/** The id of a conversation's last message. It skips optimistic entries (ids "tmp-..."),
/**  because the server does not know such an identifier. */
export function lastMessageId(convId) {
  const list = state.msgs[convId] || [];
  for (let i = list.length - 1; i >= 0; i--) if (typeof list[i].id === "number") return list[i].id;
  return undefined;
}

export function actorOnline(actorId) {
  return state.presence.some((p) => p.actorId === actorId && p.online);
}

/** Presence by name, not by id. The participants in `others` arrive from the server as
/**  handle/displayName/kind - with no identifiers - and the conversation list has to show the
/**  presence dot from the first frame, before the actor directory arrives. */
export function handleOnline(handle) {
  const low = String(handle ?? "").toLowerCase();
  return state.presence.some((p) => p.online && String(p.handle).toLowerCase() === low);
}

// Collapsed branches of the wiki tree - remembered per browser.
export const wikiCollapsed = new Set((() => {
  try { return JSON.parse(localStorage.getItem("atalks_wiki_collapsed") || "[]"); }
  catch { return []; }
})());

export const dmMembersCache = {}; // convId -> [actorId,...] (without me)

/** The participants of a direct conversation: [{handle, displayName, kind}], without me.
/**  The source of truth is the `others` field from the server (GET /api/me and
/**  /api/conversations) - thanks to it the conversation list has names and faces AT ONCE. The
/**  cache built from message authors remains as a fallback for an older server that does not
/**  know `others`; it used to be the only source, so every direct conversation was called
/**  "Message" until you opened it. */
export function dmOthers(c) {
  if (Array.isArray(c.others) && c.others.length) return c.others;
  const ids = dmMembersCache[c.id];
  if (ids && ids.length) {
    return ids.map((id) => state.actorsCache[id] || { handle: actorHandle(id), displayName: "", kind: "agent" });
  }
  return [];
}

export function dmLabel(c) {
  const others = dmOthers(c);
  if (others.length) return others.map((o) => "@" + o.handle).join(", ");
  return c.topic || (c.kind === "group" ? t("Group conversation") : t("Direct conversation"));
}

/** Messages "in the report cycle": the "I fixed it" wrench and the "I confirm" check only make
/**  sense next to those. The server has no "this is a report" field - there is only the trace
/**  of the actions (fixedAt/resolvedAt) - so an explicit indication by a human ("Treat as a
/**  report") is kept here, in the tab's memory. Without it both buttons hung next to EVERY
/**  message from somebody else, including in a private conversation about lunch, and an
/**  accidental click sent somebody a false request to confirm something they never reported. */
export const zgloszenia = new Set();

export function czyZgloszenie(m) {
  return !!(m && (m.fixedAt || m.resolvedAt || zgloszenia.has(m.id)));
}

/** Whether I can manage this conversation (an admin role in the channel, or the instance admin). */
export function canManageActive() {
  const m = state.memberships[state.activeId];
  return !!(state.actor?.isAdmin || (m && m.role === "admin"));
}

/** Messages visible in the main list: those from the server plus in-flight (optimistic)
/**  entries. Thread replies do not stand in the main list. */
export function widoczneWiadomosci(convId) {
  const msgs = (state.msgs[convId] || []).filter((m) => !m.threadId);
  const pend = (state.pending[convId] || []).filter((m) => !m.threadId);
  return pend.length ? [...msgs, ...pend] : msgs;
}

export const animatedMsgs = new Set();

export function findMsgById(id) {
  for (const arr of Object.values(state.msgs)) { const f = arr.find((m) => m.id === id); if (f) return f; }
  return null;
}

// Recently opened conversations - what the palette shows for an empty query.
const RECENT_KEY = "atalks_recent";

function recentConvIds() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

export function pushRecent(id) {
  const lista = [id, ...recentConvIds().filter((x) => x !== id)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(lista)); } catch { /* prywatny tryb */ }
}

export function ostatnieRozmowy(moje) {
  const kolejnosc = recentConvIds();
  const wg = new Map(moje.map((c) => [c.id, c]));
  const out = kolejnosc.map((id) => wg.get(id)).filter(Boolean);
  for (const c of moje) if (!out.includes(c)) out.push(c);
  return out;
}
