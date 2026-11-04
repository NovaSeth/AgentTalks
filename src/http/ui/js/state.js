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
// current actor's namespace, and nothing global decides visibility. F5 (r5): unsent messages too,
// so no account ever reads, filters or rewrites another account's list.
const DRAFT_KEY = (owner, id) => `atalks_draft_${owner}_${id}`;
const WIKI_DRAFT_KEY = (owner, slug) => `atalks_wiki_draft_${owner}_${slug}`;
const LAST_CONV_KEY = (owner) => `atalks_last_conv_${owner}`;
const RECENT_KEY = (owner) => `atalks_recent_${owner}`;
// r4 (item 9): the Threads view's "seen" marks (root id -> last reply id seen) per actor too.
const THREADS_SEEN_KEY = (owner) => `atalks_threads_seen_${owner}`;
// T-MG-16 (F8 r7): one key per unsent message. A per-conversation list was a read-modify-write
// that two tabs (a migration and a normal write) could interleave, so the later write dropped the
// other one's entry. With one key per message no write ever rewrites another message: listing is a
// scan of the prefix, and migration and cleanup add or remove single keys.
const UNSENT_KEY = (owner, convId, clientMsgId) => `atalks_unsent_${owner}_${convId}_${clientMsgId}`;
const UNSENT_ENTRY = /^atalks_unsent_(\d+)_(\d+)_(.+)$/;
// Written before r3 (and by a tab still running that code): one marker for the whole browser and
// un-namespaced keys; before r5 one unsent list per conversation shared by every account; in r5
// one unsent list per account and conversation. Read only by the migration below.
const LEGACY_OWNER_KEY = "atalks_owner";
const LEGACY_DRAFT = /^atalks_draft_(\d+)$/;
const LEGACY_WIKI_PREFIX = "atalks_wiki_draft_";
const LEGACY_THREADS_SEEN_KEY = "atalks_threads_seen";
const LEGACY_UNSENT = /^atalks_unsent_(\d+)$/;
const R5_UNSENT = /^atalks_unsent_(\d+)_(\d+)$/;
// F4 (r5): the migration's versioned flag. Once it is set, a legacy key is something an old,
// unreloaded tab wrote AFTER the migration: there is no owner it can be proven to belong to, so it
// is dropped, never claimed.
const STORAGE_VERSION_KEY = "atalks_storage_v";
const STORAGE_VERSION = "2";
// T-MG-16 fix round 1 (codex F1, F2): localStorage has no compare-and-set across tabs, and a tab
// still running older code keeps rewriting its whole unsent list. So the old unsent lists are
// never deleted or rewritten while such a tab may be alive: every sweep only READS them and COPIES
// an entry into its owner's per-message key when that key does not exist yet. A message sent or
// discarded through this code leaves its clientMsgId in the owner's tombstone set, and no import
// or restore brings a tombstoned message back, so a late or stale copy cannot resurrect it.
const UNSENT_DONE_KEY = (owner) => `atalks_unsent_done_${owner}`;
const UNSENT_DONE_MAX = 500;
// The first time this layout saw the browser, stored next to the flag. The old lists are collected
// 7 days after it (an old tab left unreloaded for a week is the accepted limit), each after a last
// copy of its entries. A check "every entry is copied, then remove" would be the same unguarded
// read-then-delete that lost F1's b2, so the age alone decides.
const STORAGE_SINCE_KEY = "atalks_storage_v_since";
const LEGACY_UNSENT_TTL_MS = 7 * 24 * 3600 * 1000;

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

/** The migration of legacy (un-namespaced) data, run before every claim and every sign-out.
 *  First run (no flag): un-namespaced keys go to the actor the old owner marker names, and only to
 *  it; with no valid marker they are deleted. A namespaced key that already exists wins over its
 *  legacy copy. The flag is then recorded and the marker removed. Every later run deletes whatever
 *  legacy key or marker an old tab wrote since: unattributed data is quarantined, never handed to
 *  whoever signs in next (F4 r5). Unsent lists are the exception that every run handles: an entry
 *  names its writer, so a pre-r5 shared list is split by each entry's `ownerId` and an r5 list by
 *  its key into one key per message (importUnsentLists, F7/F8 r7, fix round 1); the lists
 *  themselves are only read, and an entry with no owner is never imported (the marker vouches for
 *  it on the first run only). A legacy wiki
 *  slug that itself starts with digits and "_" reads as namespaced and is left alone (it belongs
 *  to nobody visible). */
function migrateLegacy() {
  try {
    const firstRun = localStorage.getItem(STORAGE_VERSION_KEY) !== STORAGE_VERSION;
    const marker = localStorage.getItem(LEGACY_OWNER_KEY);
    const owner = firstRun && marker != null && /^\d+$/.test(marker) ? marker : null;
    const move = (from, to) => {
      const value = localStorage.getItem(from);
      if (owner != null && value != null) {
        const target = to(owner);
        if (localStorage.getItem(target) == null) localStorage.setItem(target, value);
      }
      localStorage.removeItem(from);
    };
    for (const key of storageKeys()) {
      let m;
      if ((m = LEGACY_DRAFT.exec(key))) { const id = m[1]; move(key, (o) => DRAFT_KEY(o, id)); }
      else if (key.startsWith(LEGACY_WIKI_PREFIX) && !/^\d+_/.test(key.slice(LEGACY_WIKI_PREFIX.length))) {
        const slug = key.slice(LEGACY_WIKI_PREFIX.length);
        move(key, (o) => WIKI_DRAFT_KEY(o, slug));
      } else if (key === "atalks_last_conv") move(key, LAST_CONV_KEY);
      else if (key === "atalks_recent") move(key, RECENT_KEY);
      else if (key === LEGACY_THREADS_SEEN_KEY) move(key, THREADS_SEEN_KEY);
    }
    localStorage.removeItem(LEGACY_OWNER_KEY);
    if (firstRun) localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
    let since = Number(localStorage.getItem(STORAGE_SINCE_KEY));
    if (!(since > 0)) { since = Date.now(); localStorage.setItem(STORAGE_SINCE_KEY, String(since)); }
    // F7 (r7) and fix round 1: EVERY sweep copies, for every owner (an unreloaded old tab keeps
    // writing after the upgrade, and an entry tagged with its writer is still that writer's); only
    // the first run lets the old marker vouch for an untagged entry. A late copy is harmless: the
    // restore drops whatever is tombstoned.
    importUnsentLists(owner, null, Date.now() - since > LEGACY_UNSENT_TTL_MS);
  } catch { /* private browsing */ }
}

/** The old unsent lists in storage, each with its conversation and a function naming the account
 *  of an entry: the pre-r5 shared list `atalks_unsent_<conv>` carries the writer in each entry's
 *  `ownerId` (8c92d64; an entry written before that, 4aa92d5, has only the old marker, which
 *  vouches for it on the first run alone), the r5 list `atalks_unsent_<actor>_<conv>` in its key.
 *  An owner that is not a valid actor id is no owner: such an entry is never imported. */
function oldUnsentLists(markerOwner) {
  const lists = [];
  for (const key of storageKeys()) {
    let m;
    if ((m = LEGACY_UNSENT.exec(key))) {
      lists.push({ key, convId: m[1], ownerOf: (u) => (u.ownerId != null ? String(u.ownerId) : markerOwner) });
    } else if ((m = R5_UNSENT.exec(key))) {
      const listOwner = m[1];
      lists.push({ key, convId: m[2], ownerOf: () => listOwner });
    }
  }
  return lists;
}

/** The valid entries of one old list with their owner (only `only`'s when it is given). */
function oldUnsentEntries({ key, ownerOf }, only) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(key) || "[]"); } catch { /* unreadable: nothing in it */ }
  const out = [];
  for (const u of Array.isArray(list) ? list : []) {
    if (!u || typeof u !== "object" || !u.clientMsgId || typeof u.body !== "string") continue;
    const who = ownerOf(u);
    if (who == null || !/^\d+$/.test(String(who))) continue;
    if (only != null && String(who) !== only) continue;
    out.push({ who: String(who), u });
  }
  return out;
}

/** Copies the entries of the old lists into per-message keys: only into a key that does not exist
 *  (an existing one is the newer write) and never for a tombstoned clientMsgId. The lists are only
 *  read; with `collect` (the 7 days are over) each is removed after its copy. */
function importUnsentLists(markerOwner, only, collect) {
  const tombstones = new Map();
  const doneOf = (who) => { if (!tombstones.has(who)) tombstones.set(who, readUnsentDone(who)); return tombstones.get(who); };
  for (const list of oldUnsentLists(markerOwner)) {
    for (const { who, u } of oldUnsentEntries(list, only)) {
      if (doneOf(who).has(String(u.clientMsgId))) continue;
      const target = UNSENT_KEY(who, list.convId, u.clientMsgId);
      if (localStorage.getItem(target) != null) continue;
      const entry = { ...u };
      delete entry.ownerId;                  // the key names the owner now
      try { localStorage.setItem(target, JSON.stringify(entry)); } catch { /* full: the list still holds it */ }
    }
    if (collect) localStorage.removeItem(list.key);
  }
}

/** The account's tombstones: clientMsgIds of messages sent or discarded through this code. */
function readUnsentDone(owner) {
  try {
    const ids = JSON.parse(localStorage.getItem(UNSENT_DONE_KEY(owner)) || "[]");
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch { return new Set(); }
}

/** Adds ids to the account's tombstones, newest last, keeping the UNSENT_DONE_MAX newest. The set
 *  is read right before the write, so the window in which two tabs of the SAME account can lose
 *  each other's id is one synchronous read-write (another account never writes this key). */
function addUnsentDone(owner, ids) {
  if (!ids.length) return;
  try {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(UNSENT_DONE_KEY(owner)) || "[]"); } catch { /* unreadable: start over */ }
    const add = new Set(ids.map(String));
    const kept = (Array.isArray(list) ? list.map(String) : []).filter((id) => !add.has(id));
    localStorage.setItem(UNSENT_DONE_KEY(owner), JSON.stringify([...kept, ...add].slice(-UNSENT_DONE_MAX)));
  } catch { /* full or blocked: the per-message key is still removed */ }
}

/** Sign-out: removes the persisted UI data of THIS account only (drafts, wiki drafts, the last
 *  conversation, the recent list, the Threads marks, its unsent messages). Only keys in this
 *  account's namespace are touched - removed, never read and rewritten - so another account
 *  signed in in another tab keeps all of its own, including what it writes meanwhile (F5 r5).
 *  The old unsent lists are not touched (fix round 1): the account's entries in them are
 *  tombstoned instead, so the kept lists cannot hand them back at the next sign-in. The tombstone
 *  set itself stays (opaque ids only, no text). */
export function clearLocalAccountData(actorId) {
  if (actorId == null) return;
  migrateLegacy();
  const me = String(actorId);
  try {
    const old = [];
    for (const list of oldUnsentLists(null)) for (const { u } of oldUnsentEntries(list, me)) old.push(u.clientMsgId);
    addUnsentDone(me, old);
    for (const key of storageKeys()) {
      const unsent = UNSENT_ENTRY.exec(key);
      if (key.startsWith(DRAFT_KEY(me, "")) || key.startsWith(WIKI_DRAFT_KEY(me, "")) || (unsent && unsent[1] === me)
          || key === LAST_CONV_KEY(me) || key === RECENT_KEY(me) || key === THREADS_SEEN_KEY(me)) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* Storage may be unavailable in private browsing. */ }
}

/** Called right after the signed-in actor is known: legacy data is migrated (or quarantined), the
 *  memory of another account (a lost session followed by a different sign-in) is dropped, and this
 *  account's unsent messages come back. Storage of other accounts is left alone: it is not
 *  readable from this namespace. */
export function claimLocalData(actorId) {
  migrateLegacy();
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
// stored per account, conversation and message (`atalks_unsent_<actorId>_<conv>_<clientMsgId>`,
// F5 r5, F8 r7), so only the account that wrote them gets them back, and no other account's
// cleanup and no other tab's write can rewrite them.

/** Writes each in-flight or failed message of the conversation to its own key in this account's
 *  namespace and removes the keys of the messages just sent or discarded (`done`). No other key
 *  is read or written, so what another tab of the same account stored stays as it is. */
export function persistUnsent(convId, done = []) {
  const owner = storageOwner();
  if (owner == null) return;               // no known account: writing an unattributed entry would leak it
  const gone = new Set(done);
  // The tombstones first (fix round 1): a copy of a finished message that a paused migration or an
  // old list still holds is never restored. Then the removals, and every write on its own: a full
  // storage refusing one write must neither keep a sent message stored (it would come back as
  // "not sent") nor stop the other writes.
  addUnsentDone(owner, [...gone]);
  for (const id of gone) {
    try { localStorage.removeItem(UNSENT_KEY(owner, convId, id)); } catch { /* unavailable */ }
  }
  for (const p of state.pending[convId] || []) {
    if (!p.clientMsgId || gone.has(p.clientMsgId)) continue;
    try {
      localStorage.setItem(UNSENT_KEY(owner, convId, p.clientMsgId), JSON.stringify({
        clientMsgId: p.clientMsgId, body: p.body, threadId: p.threadId ?? null, ts: p.ts,
        // An in-flight entry has no error yet; if it comes back from storage, it was never confirmed.
        error: p.failed ? p.error || null : null,
      }));
    } catch { /* private browsing or full: the memory copy is all there is */ }
  }
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

/** Sign-in: this account's stored unsent messages (its own keys only) come back as failed
 *  bubbles, merged with what the tab still holds, oldest first (storage keys have no order).
 *  Restore = the account's per-message keys minus its tombstones, after a last import of the
 *  account's entries from the old lists (an old tab may have written since the sweep). A
 *  tombstoned key is a stale copy of a finished message and is removed. */
function restoreUnsent(actorId) {
  const me = String(actorId);
  const found = [];
  try {
    importUnsentLists(null, me, false);
    const done = readUnsentDone(me);
    for (const key of storageKeys()) {
      const m = UNSENT_ENTRY.exec(key);
      if (!m || m[1] !== me) continue;
      if (done.has(m[3])) { localStorage.removeItem(key); continue; }
      let u = null;
      try { u = JSON.parse(localStorage.getItem(key) || "null"); } catch { continue; }
      if (!u || typeof u.body !== "string" || u.clientMsgId !== m[3]) continue;
      found.push({ convId: Number(m[2]), u });
    }
  } catch { return; }
  const ts = (x) => Number(x.u.ts) || 0;
  found.sort((x, y) => ts(x) - ts(y) || String(x.u.clientMsgId).localeCompare(String(y.u.clientMsgId)));
  for (const { convId, u } of found) {
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
