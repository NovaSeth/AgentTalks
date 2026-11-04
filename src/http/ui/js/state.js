/**
 * Application state and pure operations on it. It does NOT import views - communication in
 * that direction goes through the `views` registry (injected drawing functions).
 */
import { t } from "./i18n.js";

// ------------------------------------------------------------------ state
export const state = {
  actor: null,
  conversations: [],
  memberships: {},         // convId -> membership
  unread: {},              // convId -> number of unread (bold + counter)
  unreadBadge: {},         // convId -> how many of them "weigh" (DM/group: every one; channel: mentions)
  lastUnread: {},          // convId -> id of the newest unread message (the server's unread row, W2-S7-A)
  activeId: null,
  msgs: {},                // convId -> Message[] (ascending by id)
  loaded: {},              // convId -> whether the history was FETCHED (not: whether any messages exist)
  readMark: {},            // convId -> last read id, FROZEN on entry (the new-messages divider)
  draftsOwner: null,       // actor id the in-memory drafts belong to (kept across a lost session)
  drafts: {},              // convId -> {text, replyTo} - a draft surviving a conversation switch
  pending: {},             // convId -> local in-flight messages (ids "tmp-...")
  actorsCache: {},         // id -> {handle, displayName, kind}
  actorsAt: 0,             // when the actor directory was last fetched (TTL)
  online: true,            // whether the event stream is alive (connection status)
  reactions: {},           // messageId -> {emoji: [handle,...]}
  presence: [],            // PresenceRow[] (sessions)
  threadOpen: null,
  threadMsgs: [],
  detailsOpen: false,      // the conversation details panel (members/pins/actions)
  convMembers: [],         // members of the active conversation (from GET /:id)
  convPins: [],            // pins of the active conversation
  convMembersFor: null,    // which conversation convMembers belong to (S6 details panel)
  profileHandle: null,     // the handle whose profile card is open (S6), null when none
  replyTo: null,
  drawerOpen: false,
  loadingConv: false,
  guidelines: null,
  news: null,              // "What's new" from /api/me - shown once, then null
  digest: null,            // "What you missed" from GET /api/digest (null = nothing)
  leases: [],              // active resource leases (GET /api/leases)
  hasMore: {},             // convId -> whether there are older messages to load
  actorsList: [],
  openQuestions: {},       // messageId -> questionId (open and visible to me)
  reportFilter: false,     // S5: the "N open" pill narrows the list to unresolved reports
  lastDelivery: null,      // {conversationId, messageId, delivery[]} from the last send
  pendingFiles: [],        // files waiting to be sent (previews in the composer)
  sseCursor: 0,            // highest message id delivered by SSE, never by REST
  newBelow: 0,             // how many new ones arrived while the list was scrolled up
  view: "chat",            // "chat" | "wiki" | "users" | "notifications"
  route: null,             // parsed hash route (S3): {view, slug, messageId} or null
  sidePanel: null,         // what the side panel shows (S2): null | "thread" | "details" | ...
  sbCollapsed: {},         // sidebar section -> collapsed? (S1), persisted per browser
  notifUnread: 0,          // notification center count (the bell badge)
  notifications: [],       // recent notifications (GET /api/notifications)
  wiki: {
    pages: [], slug: null, page: null, files: [], history: [],
    revision: null,        // OLD revision being previewed (null = latest)
    editing: false, tab: "info", draft: null,
  },
};

const initialState = structuredClone(state);

/** Drop account data without replacing the state object imported by every view. */
export function resetState() {
  Object.assign(state, structuredClone(initialState));
  for (const id of Object.keys(dmMembersCache)) delete dmMembersCache[id];
  animatedMsgs.clear();
  reports.clear();
  resetMentionRe();
}

/** The registry of drawing functions. The data and action layers do NOT import views - that
/**  would close an import cycle (a view calls an action, the action redraws the view). Views
/**  register here once, at startup; the rest of the code calls them through this object. The
/**  default empty functions mean everything works even before any view exists at all (say, an
/**  error during login). */
export const views = {
  render: () => {},           // the whole screen: login or the shell
  shell: () => {},          // rail + sidebar + main column
  main: () => {},           // main column of the current view
  sidebar: () => {},          // the list of channels, messages and wiki
  conversationRow: () => {},           // ONE conversation row (bold + badge)
  presence: () => {},         // presence dots, typing/working bar, topbar and wiki typing bubbles
  messages: () => {},       // the whole message list
  message: () => {},        // ONE bubble
  scrollToBottom: () => {},            // scrolling the list to the newest
  thread: () => {},
  openThread: () => {},      // opening the thread panel for a given root
  offlineBar: () => {},     // the "no connection" bar above the conversation
  composer: () => {},
  details: () => {},
  wiki: () => {},
  notifications: () => {},
  users: () => {},
  bindContent: () => {},    // delegated events in freshly rendered content
  typing: () => "",            // typing-bubble HTML for a given location
  detailsData: async () => {},
  openConversation: () => {},
  openWiki: () => {},
  afterLogin: async () => {},
};

export function registerViews(fns) { Object.assign(views, fns); }

export function actorHandle(id) { return (state.actorsCache[id] && state.actorsCache[id].handle) || "?"; }

export function actorKind(id) { return (state.actorsCache[id] && state.actorsCache[id].kind) || "agent"; }

/** The kind of the actor behind a handle (with or without "@"); null when the directory does
 *  not know the handle yet, so a caller can keep a neutral default. */
export function handleKind(handle) {
  const h = String(handle || "").replace(/^@/, "");
  for (const a of Object.values(state.actorsCache)) if (a && a.handle === h) return a.kind || "agent";
  return null;
}

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
const CHANNEL_MENTIONS = ["all", "channel", "here", "wszyscy", "kanal"];

/** "Does this message call me" - an expression built ONCE after login, rather than for every
/**  bubble on every render. The character class before @ is the same as in mdInline, so
/**  "(@michal" counts the same as " @michal". */
// A handle allows a dot and a hyphen (core/ids.ts), and a dot in a regular expression means
// "any character" - without escaping, "@jan.kowalski" would match "@janXkowalski".
// The helper lives here rather than in dom.js, because state.js deliberately imports nothing.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let mentionRe = null;

/** Logging out clears the pattern - otherwise the next user in the same tab would count
/**  mentions against somebody else's handle. */
export function resetMentionRe() { mentionRe = null; }

export function rebuildMentionRe() {
  const mine = state.actor ? escapeRe(state.actor.handle) : null;
  const alias = [...(mine ? [mine] : []), ...CHANNEL_MENTIONS].join("|");
  mentionRe = new RegExp(`(^|[\\s(>])@(${alias})\\b`, "i");
}

export function mentionsMe(text) {
  if (!mentionRe) rebuildMentionRe();
  return mentionRe.test(String(text ?? ""));
}

/** Merge messages from either REST or SSE. Only the SSE handler advances its replay cursor. */
export function upsertMessage(convId, msg) {
  const list = state.msgs[convId] || (state.msgs[convId] = []);
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) list[i] = msg; else { list.push(msg); list.sort((a, b) => a.id - b.id); }
}

/** Unread rows from the server (fields: unread, badge) into two state maps.
/**  NOTE: the field is called `unread`, not `count` - the old read of row.count returned
/**  undefined and the server's counters NEVER loaded (only SSE increments worked in a live
/**  session; after a refresh they disappeared). */
export function applyUnreadRows(rows) {
  state.unread = {};
  state.unreadBadge = {};
  state.lastUnread = {};
  for (const row of rows || []) {
    state.unread[row.conversationId] = row.unread || 0;
    state.unreadBadge[row.conversationId] = row.badge || 0;
    // The newest unread id bounds the "New messages" divider: the server's `unread` counts
    // thread replies the main list hides, so a count alone puts the line too high (W2-S7-A).
    if (row.lastUnreadMessageId) state.lastUnread[row.conversationId] = row.lastUnreadMessageId;
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
//
// F2 (r3): localStorage is shared by every tab of the browser, and two tabs may be signed in as
// two accounts at once (the session lives in sessionStorage). A single "owner" marker therefore
// could not decide whose data a key is: tab B overwrote it and read tab A's drafts. Every
// per-account key now carries the actor in its name, every read and write goes through the
// current actor's namespace, and nothing global decides visibility. Unsent messages stay one
// list per conversation with an `ownerId` on every entry (8c92d64).
const DRAFT_KEY = (owner, id) => `atalks_draft_${owner}_${id}`;
const WIKI_DRAFT_KEY = (owner, slug) => `atalks_wiki_draft_${owner}_${slug}`;
const LAST_CONV_KEY = (owner) => `atalks_last_conv_${owner}`;
const RECENT_KEY = (owner) => `atalks_recent_${owner}`;
// r4 (item 9): the Threads view's "seen" marks (root id -> last reply id seen) per actor too.
const THREADS_SEEN_KEY = (owner) => `atalks_threads_seen_${owner}`;
const LEGACY_THREADS_SEEN_KEY = "atalks_threads_seen";
// Written before r3: one marker for the whole browser and un-namespaced keys. Read only by the
// one-time migration below.
const LEGACY_OWNER_KEY = "atalks_owner";
const LEGACY_DRAFT = /^atalks_draft_(\d+)$/;
const LEGACY_WIKI_PREFIX = "atalks_wiki_draft_";

/** The account whose namespace this tab reads and writes: the signed-in actor, or during a lost
 *  session the one the in-memory drafts are kept for. null = no account: nothing is stored. */
function storageOwner() {
  return state.actor?.id ?? state.draftsOwner ?? null;
}

function storageKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) keys.push(key);
  }
  return keys;
}

/** The one-time migration of pre-r3 data: un-namespaced keys go to the actor the old marker
 *  names (or, with no marker at all, to `fallback`: the first account that signs in), legacy
 *  unsent entries without an ownerId get the marker's id, and the marker is removed. A namespaced
 *  key that already exists wins over its legacy copy. Idempotent: with nothing legacy left it
 *  changes nothing. A legacy wiki slug that itself starts with digits and "_" reads as namespaced
 *  and is left alone (it then belongs to nobody visible). */
function migrateLegacy(fallback) {
  try {
    const marker = localStorage.getItem(LEGACY_OWNER_KEY);
    const owner = marker ?? (fallback == null ? null : String(fallback));
    const move = (from, to) => {
      const value = localStorage.getItem(from);
      if (owner != null && value != null && localStorage.getItem(to) == null) localStorage.setItem(to, value);
      localStorage.removeItem(from);
    };
    for (const key of storageKeys()) {
      let m;
      if ((m = LEGACY_DRAFT.exec(key))) move(key, DRAFT_KEY(owner, m[1]));
      else if (key.startsWith(LEGACY_WIKI_PREFIX) && !/^\d+_/.test(key.slice(LEGACY_WIKI_PREFIX.length))) {
        move(key, WIKI_DRAFT_KEY(owner, key.slice(LEGACY_WIKI_PREFIX.length)));
      } else if (key === "atalks_last_conv") move(key, LAST_CONV_KEY(owner));
      else if (key === "atalks_recent") move(key, RECENT_KEY(owner));
      else if (key === LEGACY_THREADS_SEEN_KEY) move(key, THREADS_SEEN_KEY(owner));
      else if (marker !== null && key.startsWith(UNSENT_PREFIX)) {
        // Written by 4aa92d5 before entries carried an owner: the old marker is all we have.
        let list = null;
        try { list = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* a broken entry */ }
        if (!Array.isArray(list) || !list.some((u) => u && u.ownerId == null)) continue;
        for (const u of list) if (u && u.ownerId == null) u.ownerId = Number(marker);
        localStorage.setItem(key, JSON.stringify(list));
      }
    }
    localStorage.removeItem(LEGACY_OWNER_KEY);
  } catch { /* private browsing */ }
}

/** Sign-out: removes the persisted UI data of THIS account only (drafts, wiki drafts, the last
 *  conversation, the recent list, its unsent entries). Another account signed in in another tab
 *  keeps all of its own. */
export function clearLocalAccountData(actorId) {
  if (actorId == null) return;
  migrateLegacy(actorId);
  const me = String(actorId);
  try {
    for (const key of storageKeys()) {
      if (key.startsWith(DRAFT_KEY(me, "")) || key.startsWith(WIKI_DRAFT_KEY(me, ""))
          || key === LAST_CONV_KEY(me) || key === RECENT_KEY(me) || key === THREADS_SEEN_KEY(me)) {
        localStorage.removeItem(key);
      } else if (key.startsWith(UNSENT_PREFIX)) {
        let list = null;
        try { list = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* a broken entry */ }
        const rest = Array.isArray(list) ? list.filter((u) => u && String(u.ownerId) !== me) : [];
        if (rest.length) localStorage.setItem(key, JSON.stringify(rest));
        else localStorage.removeItem(key);
      }
    }
  } catch { /* Storage may be unavailable in private browsing. */ }
}

/** Called right after the signed-in actor is known: pre-r3 data is migrated once, the memory of
 *  another account (a lost session followed by a different sign-in) is dropped, and this
 *  account's unsent messages come back. Storage of other accounts is left alone: it is not
 *  readable from this namespace. */
export function claimLocalData(actorId) {
  migrateLegacy(actorId);
  if (state.draftsOwner != null && String(state.draftsOwner) !== String(actorId)) { state.drafts = {}; state.pending = {}; }
  state.draftsOwner = actorId;
  restoreUnsent(actorId);
}

// The Threads view's "seen" marks (r4, item 9): root id -> the last reply id seen, per account.
export function loadThreadsSeen() {
  const owner = storageOwner();
  if (owner == null) return {};
  try { return JSON.parse(localStorage.getItem(THREADS_SEEN_KEY(owner)) || "{}") || {}; } catch { return {}; }
}

export function saveThreadsSeen(seen) {
  const owner = storageOwner();
  if (owner == null) return;
  try { localStorage.setItem(THREADS_SEEN_KEY(owner), JSON.stringify(seen)); } catch { /* storage full or blocked: the dot stays */ }
}

// The wiki editor's draft (W5-S14): per account and page, the same namespace rule.
export function saveWikiDraft(slug, draft) {
  const owner = storageOwner();
  if (!slug || !draft || owner == null) return;
  try { localStorage.setItem(WIKI_DRAFT_KEY(owner, slug), JSON.stringify(draft)); } catch { /* private browsing */ }
}

export function loadWikiDraft(slug) {
  const owner = storageOwner();
  if (!slug || owner == null) return null;
  try {
    const raw = localStorage.getItem(WIKI_DRAFT_KEY(owner, slug));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearWikiDraft(slug) {
  const owner = storageOwner();
  if (!slug || owner == null) return;
  try { localStorage.removeItem(WIKI_DRAFT_KEY(owner, slug)); } catch { /* private browsing */ }
}

/** The conversation an empty address opens next time (per account). */
export function rememberLastConv(id) {
  const owner = storageOwner();
  if (owner == null) return;
  try { localStorage.setItem(LAST_CONV_KEY(owner), String(id)); } catch { /* private browsing */ }
}

export function lastConvId() {
  const owner = storageOwner();
  if (owner == null) return null;
  try {
    const id = Number(localStorage.getItem(LAST_CONV_KEY(owner)));
    return id > 0 ? id : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ unsent messages
// A message that did not reach the server (offline, a lost session, F5 mid-send) is kept as a
// "not sent" bubble rather than folded into the composer text (T-MG-3 F3, W3-S4-B): the bubble
// keeps its clientMsgId, so "Send again" can never post it twice even when the first attempt
// did land, a thread reply stays a thread reply, and two failed messages stay two. They are
// stored per conversation, every entry with the `ownerId` that wrote it, so only the account that
// wrote them gets them back.
const UNSENT_PREFIX = "atalks_unsent_";

/** Writes the conversation's in-flight and failed messages to storage (or removes the key).
 *  Storage is shared by every tab of the browser, so the stored list is MERGED: entries another
 *  tab wrote stay, unless this tab holds them or has just sent or discarded them (`done`).
 *  Every entry stores the `ownerId` that wrote it. Entries of another account are kept untouched
 *  (a different account in another tab may still need them): never re-owned, never shown. */
export function persistUnsent(convId, done = []) {
  const owner = state.actor?.id ?? state.draftsOwner;
  if (owner == null) return;               // no known account: writing an unattributed entry would leak it
  const mine = (state.pending[convId] || []).map((p) => ({
    ownerId: owner, clientMsgId: p.clientMsgId, body: p.body, threadId: p.threadId ?? null, ts: p.ts,
    // An in-flight entry has no error yet; if it comes back from storage, it was never confirmed.
    error: p.failed ? p.error || null : null,
  }));
  const skip = new Set([...done, ...mine.map((u) => u.clientMsgId)]);
  let others = [];
  try {
    const stored = JSON.parse(localStorage.getItem(UNSENT_PREFIX + convId) || "[]");
    if (Array.isArray(stored)) others = stored.filter((u) => u && u.clientMsgId && !skip.has(u.clientMsgId));
  } catch { /* unreadable or unavailable: this tab's list replaces it */ }
  const list = [...others, ...mine];
  try {
    if (list.length) {
      localStorage.setItem(UNSENT_PREFIX + convId, JSON.stringify(list));
    } else {
      localStorage.removeItem(UNSENT_PREFIX + convId);
    }
  } catch { /* private browsing: the memory copy is all there is */ }
}

/** Teardown (a lost session): every entry becomes a failed one and is stored, so the same
 *  account finds it after signing in again or after a reload. */
export function preserveUnsent() {
  for (const convId of Object.keys(state.pending)) {
    for (const p of state.pending[convId]) {
      // The thread box that held a failed reply's text is gone with the shell: every entry now
      // stands in the main list.
      p.restored = true;
      if (p.failed) continue;
      p.pending = false; p.failed = true;
      p.error = t("This message may not have been sent. Send it again - it will not be posted twice.");
    }
    persistUnsent(convId);
  }
}

/** Sign-in: the stored unsent messages of THIS account (entries of any other account are
 *  skipped by their ownerId) come back as failed bubbles, merged with what the tab still holds. */
function restoreUnsent(actorId) {
  let keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(UNSENT_PREFIX)) keys.push(key);
    }
  } catch { return; }
  for (const key of keys) {
    const convId = Number(key.slice(UNSENT_PREFIX.length));
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* a broken entry */ }
    if (!Number.isFinite(convId) || !Array.isArray(list)) continue;
    for (const u of list) {
      if (!u || typeof u.body !== "string" || !u.clientMsgId) continue;
      // An entry with no ownerId left after the migration (no old marker named anyone) belongs
      // to nobody we can prove: it is never shown.
      if (u.ownerId == null || String(u.ownerId) !== String(actorId)) continue;
      // Created only for an entry of this account: another account's list leaves no trace here.
      const mine = state.pending[convId] || (state.pending[convId] = []);
      if (mine.some((p) => p.clientMsgId === u.clientMsgId)) continue;
      mine.push({
        id: `tmp-${u.clientMsgId}`, clientMsgId: u.clientMsgId, conversationId: convId, actorId,
        body: u.body, ts: u.ts || Math.floor(Date.now() / 1000), kind: "text", threadId: u.threadId ?? null,
        pending: false, failed: true, restored: true,
        error: u.error || t("This message may not have been sent. Send it again - it will not be posted twice."),
      });
    }
  }
}

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
    const owner = storageOwner();
    // No known account: the draft stays in memory only - an unattributed key would leak it.
    if (owner == null) return;
    try { localStorage.setItem(DRAFT_KEY(owner, id), text); } catch { /* private browsing */ }
  } else {
    clearDraft(id);
  }
}

export function loadDraft(convId) {
  if (state.drafts[convId]) return state.drafts[convId];
  const owner = storageOwner();
  if (owner == null) return null;
  try {
    const text = localStorage.getItem(DRAFT_KEY(owner, convId));
    if (text) return (state.drafts[convId] = { text, replyTo: null, files: [] });
  } catch { /* private browsing */ }
  return null;
}

export function clearDraft(convId) {
  delete state.drafts[convId];
  const owner = storageOwner();
  if (owner == null) return;
  try { localStorage.removeItem(DRAFT_KEY(owner, convId)); } catch { /* private browsing */ }
}

/** The history of conversations we are not looking at must not grow in the tab forever.
/**  We delete it TOGETHER with the "loaded" marker, so that returning fetches it exactly as it
/**  did the first time - the state and the memory must not drift apart. */
const CONVERSATION_CACHE_LIMIT = 5;

export function trimConversationCache() {
  const keep = new Set([state.activeId, ...recentConvIds().slice(0, CONVERSATION_CACHE_LIMIT)]);
  for (const key of Object.keys(state.msgs)) {
    const id = Number(key);
    if (keep.has(id)) continue;
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
export const reports = new Set();

/** The channel rule (S5, G19): in a channel named for bugs, issues or incidents every top-level
/**  text message IS a report, so "Mark fixed" is one click away with no prior step. Outside such
/**  channels the explicit mark ("Treat as a report") and the trace of the cycle still decide. */
export const REPORT_CHANNEL_RE = /bug|issue|incident/i;

export function isReportChannel(conv) {
  return !!(conv && conv.slug && REPORT_CHANNEL_RE.test(conv.slug));
}

/** @param m the message; @param conv optional - looked up by m.conversationId when omitted */
export function isReport(m, conv) {
  if (!m) return false;
  if (m.fixedAt || m.resolvedAt || reports.has(m.id)) return true;
  if (m.kind !== "text" || m.threadId || m.deletedAt) return false;
  const c = conv || state.conversations.find((x) => x.id === m.conversationId);
  return isReportChannel(c);
}

/** Whether I can manage this conversation (an admin role in the channel, or the instance admin). */
export function canManageActive() {
  const m = state.memberships[state.activeId];
  return !!(state.actor?.isAdmin || (m && m.role === "admin"));
}

/** Messages visible in the main list: those from the server plus in-flight (optimistic)
/**  entries. Thread replies do not stand in the main list. */
export function visibleMessages(convId) {
  const msgs = (state.msgs[convId] || []).filter((m) => !m.threadId);
  // A thread reply that came back from storage or a lost session has no thread box holding its
  // text any more: it stands in the main list as "not sent", where Send again still posts it
  // to its thread.
  const pend = (state.pending[convId] || []).filter((m) => !m.threadId || m.restored);
  return pend.length ? [...msgs, ...pend] : msgs;
}

export const animatedMsgs = new Set();

export function findMsgById(id) {
  for (const arr of Object.values(state.msgs)) { const f = arr.find((m) => m.id === id); if (f) return f; }
  return null;
}

// Recently opened conversations - what the palette shows for an empty query (per account, F2 r3).
function recentConvIds() {
  const owner = storageOwner();
  if (owner == null) return [];
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY(owner)) || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function pushRecent(id) {
  const owner = storageOwner();
  if (owner == null) return;
  const list = [id, ...recentConvIds().filter((x) => x !== id)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY(owner), JSON.stringify(list)); } catch { /* private browsing */ }
}

export function recentConversations(myConversations) {
  const order = recentConvIds();
  const byId = new Map(myConversations.map((c) => [c.id, c]));
  const out = order.map((id) => byId.get(id)).filter(Boolean);
  for (const c of myConversations) if (!out.includes(c)) out.push(c);
  return out;
}
