/**
 * Fetching and refreshing data. It calls drawing through the `views` registry.
 */
import { SID_KEY, api, sessionGeneration } from "./api.js";
import { acceptDigest, badgeText, dividerAfter, railBadges } from "./counters.js";
import { updateTitleBadge } from "./dom.js";
import { t } from "./i18n.js";
import { animatedMsgs, applyUnreadRows, mergeActors, mergeReactions, state, upsertMessage, views } from "./state.js";
import { showError } from "./toasts.js";

// ----------------------------------------------------------------- loading
export async function loadConversationsList() {
  const data = await api("GET", "/api/conversations");
  state.conversations = data.conversations;
  const memberships = {};
  for (const m of data.memberships) memberships[m.conversationId] = m;
  state.memberships = memberships;
  applyUnreadRows(data.unread);
}

/** U30 (r4): the conversation a route's slug names (a channel slug, or the id of a conversation
 *  without one). A slug the loaded list does not know is looked up on the server ONCE - a public
 *  channel created after this page loaded is otherwise "no access" until a reload. null when the
 *  server does not list it either (private, archived, misspelt), or when the refresh fails. */
export async function conversationBySlug(slug) {
  const find = () => state.conversations.find((x) => x.slug === slug)
    || state.conversations.find((x) => !x.slug && String(x.id) === slug) || null;
  const known = find();
  if (known) return known;
  try { await loadConversationsList(); } catch { return null; }
  return find();
}

// Entering a conversation must show the NEWEST messages at once, so the first batch is small
// (roughly what fits on a screen); older ones load themselves, 20 at a time, as you scroll
// up. Fetching 200 messages on open was paying in time-to-first-view for history nobody
// reads.
const INITIAL_BATCH_SIZE = 30;

const OLDER_BATCH_SIZE = 20;

/** The reactions of just these messages: a skipped message keeps the reactions it already has. */
export function reactionsOf(msgs, reactions) {
  return Object.fromEntries(msgs.filter((m) => reactions && m.id in reactions).map((m) => [m.id, reactions[m.id]]));
}

export async function loadMessages(convId, { keepTouched = false } = {}) {
  const firstLoad = !state.loaded[convId];
  // keepTouched (resume refresh, codex r3 F4): a message whose held object changed while the request
  // was in flight was replaced by a live event or a newer action, so the answer (cut earlier on the
  // server) must not put the older revision back. A reference comparison: every writer replaces the object.
  const before = keepTouched ? new Map((state.msgs[convId] || []).map((m) => [m.id, m])) : null;
  const data = await api("GET", `/api/conversations/${convId}/messages?limit=${INITIAL_BATCH_SIZE}`);
  // We MERGE rather than replace the array: assigning `state.msgs[id] = ...` erased everything
  // the user had loaded by scrolling up.
  // History enters without animation - the "slide in" is played only by a message that arrived
  // live (SSE), not by every opening of a channel.
  const touched = (m) => {
    const held = state.msgs[convId]?.find((h) => h.id === m.id);
    return before !== null && held !== undefined && held !== before.get(m.id);
  };
  const fresh = data.messages.filter((m) => !touched(m));
  for (const m of fresh) { upsertMessage(convId, m); animatedMsgs.add(m.id); }
  // The "history FETCHED" marker (not "there are some messages"): a single message from SSE
  // must not pretend to be a loaded conversation.
  state.loaded[convId] = true;
  // A full batch = there is probably older history to load. When refreshing an already loaded
  // conversation, a new batch says nothing about what lies ABOVE our list.
  if (firstLoad) state.hasMore[convId] = data.messages.length >= INITIAL_BATCH_SIZE;
  mergeActors(data.actors);
  mergeReactions(fresh, reactionsOf(fresh, data.reactions));
  // Thread replies do not stand in the main list, so a batch of 30 messages can produce a
  // screen with three. We fetch more until there is something to scroll - without that, lazy
  // loading would never start, because there simply is no scrollbar.
  let extraBatches = 0;
  while (
    state.hasMore[convId] && extraBatches < 4 &&
    (state.msgs[convId] || []).filter((m) => !m.threadId).length < 15
  ) {
    extraBatches++;
    await loadOlderMessages(convId);
  }
}

/** Loading older history above what we already have - keeping the scroll position (the content
/**  must not run away from your eyes when older messages slide in above it). */
let loadingOlder = false;

export async function loadOlderMessages(convId) {
  const list = state.msgs[convId] || [];
  const oldest = list[0];
  if (!oldest || loadingOlder || !state.hasMore[convId]) return;
  loadingOlder = true;
  try {
    const data = await api("GET", `/api/conversations/${convId}/messages?before=${oldest.id}&limit=${OLDER_BATCH_SIZE}`);
    for (const m of data.messages) { upsertMessage(convId, m); animatedMsgs.add(m.id); }
    mergeActors(data.actors);
    mergeReactions(data.messages, data.reactions);
    state.hasMore[convId] = data.messages.length >= OLDER_BATCH_SIZE;
    const el = document.getElementById("messages");
    const beforeH = el ? el.scrollHeight : 0, beforeTop = el ? el.scrollTop : 0;
    views.messages();
    // An anchor: after adding older messages above, what you are looking at has to stay under the
    // same finger - otherwise lazy loading "yanks" the view.
    if (el) el.scrollTop = beforeTop + (el.scrollHeight - beforeH);
  } catch (e) { showError(e); }
  finally { loadingOlder = false; }
}

// The handle of the periodic leases/digest refresh. In a module variable, because without it
// every re-login in the same tab left another interval running in parallel (and a third after
// a third login). Leases live for minutes, so 30 s is enough for a "board".
let digestTimer = null;

export function startDigestTimer() {
  clearInterval(digestTimer);
  digestTimer = setInterval(refreshDigestAndLeases, 30000);
}

export function stopDigestTimer() { clearInterval(digestTimer); digestTimer = null; }

/** The "What you missed" digest and the lease board - data for the sidebar.
/**  summary=1: the sidebar needs ONE number from the digest, while the full response is the
/**  complete set of mentions and open questions with their content (tens of KB every 30 s).
/**  When the server does not know the parameter it simply returns everything - nothing breaks. */
/** @param force skips the tab-visibility condition. A periodic refresh in the background is
/**  pointless, but a refresh AFTER A USER ACTION (they claimed a resource, released one) has to
/**  go through always - otherwise the list contradicts the message that has just said "done". */
// Every digest poll carries a sequence number: the 30 s timer and a forced refresh after an
// action can be in flight at once, and the older answer must not land on top of the newer one.
let digestSeq = 0;

export async function refreshDigestAndLeases(force) {
  if (!force && document.visibilityState !== "visible") return;  // a background tab does not need the lease board
  const seq = ++digestSeq;
  const gen = sessionGeneration();
  try {
    const [d, l] = await Promise.all([
      api("GET", "/api/digest?summary=1").catch(() => ({ digest: undefined })),
      api("GET", "/api/leases").catch(() => ({ leases: [] })),
    ]);
    // The fallbacks above must not blank the next account's board either (F1).
    if (gen !== sessionGeneration()) return;
    const incoming = d.digest ? { ...d.digest, seq } : d.digest;
    state.digest = acceptDigest(state.digest, incoming);
    state.leases = l.leases || [];
    views.sidebar();
  } catch { /* optional additions, not core functionality */ }
}

/** The reactions of ONE message. There is no dedicated endpoint, but `before=<id+1>&limit=1`
/**  returns exactly that one message together with its reaction map - instead of 200 full
/**  messages (hundreds of KB) after every emoji click by every member. */
export async function loadReactionsForMessage(convId, messageId) {
  if (!convId || !messageId) return;
  try {
    const data = await api("GET", `/api/conversations/${convId}/messages?before=${messageId + 1}&limit=1`);
    mergeReactions(data.messages, data.reactions);
    mergeActors(data.actors);
    if (state.loaded[convId]) for (const m of data.messages) upsertMessage(convId, m);
  } catch { /* best effort */ }
}

// The actor directory: ONE rule instead of three different ones (mentionAutocomplete fetched
// it when the list was empty; a new conversation did the same; the details panel had its own
// way). A simple TTL plus a shared request, so that a run of messages from unknown authors
// does not fire a run of identical requests.
const ACTORS_TTL_MS = 60000;

let actorsRequest = null;

let actorsRequestGen = -1;

export async function ensureActors(opts = {}) {
  const fresh = Date.now() - state.actorsAt < (opts.maxAgeMs ?? ACTORS_TTL_MS);
  if (!opts.force && fresh && state.actorsList.length) return state.actorsList;
  // The shared request is shared within ONE session only: the next account must not wait on
  // (and get nothing from) the previous account's request (F1).
  if (actorsRequest && actorsRequestGen === sessionGeneration()) return actorsRequest;
  actorsRequestGen = sessionGeneration();
  const request = api("GET", "/api/actors")
    .then((d) => {
      state.actorsList = d.actors || [];
      for (const a of state.actorsList) {
        // `avatar` MUST travel into the cache: avatarUrl() reads ONLY the cache, so dropping
        // the field here rendered every uploaded avatar as initials across the whole UI -
        // sidebar, messages, typing bubbles - while the API kept serving the image correctly.
        state.actorsCache[a.id] = {
          handle: a.handle, displayName: a.displayName, kind: a.kind,
          avatar: a.avatar ?? null, lastActiveAt: a.lastActiveAt,
        };
      }
      state.actorsAt = Date.now();
      return state.actorsList;
    })
    .catch(() => state.actorsList)
    .finally(() => { if (actorsRequest === request) actorsRequest = null; });
  actorsRequest = request;
  return request;
}

export async function refreshPresence() {
  try {
    const data = await api("GET", "/api/presence");
    state.presence = data.presence;
    // Pointwise: presence changes ONLY the dots in the sidebar. Web sessions beat a heartbeat
    // every 30 s, so a full rebuild of the list on every breath would yank the list out from
    // under the user's cursor.
    views.presence();
  } catch { /* presence is not critical */ }
}

export async function refreshQuestions(convId) {
  try {
    const data = await api("GET", "/api/questions/open");
    const open = {};
    for (const q of data.questions) open[q.message.id] = q.id;
    // Without this comparison, every entry into a conversation and every reply redrew the whole
    // message list, usually in order to change nothing.
    const changed = Object.keys(open).join(",") !== Object.keys(state.openQuestions).join(",");
    state.openQuestions = open;
    if (!changed) return;
    views.sidebar();
    if (state.view === "chat" && (!convId || convId === state.activeId)) views.messages();
  } catch { /* best effort */ }
}

/** The active conversation's pins. Previously ONLY the details panel fetched them, so the
/**  message menu had no way of knowing whether to offer "Pin" or "Unpin". The response is tiny
/**  (a list of identifiers) and arrives once per entry into a conversation. */
export async function loadPins(convId) {
  try {
    const data = await api("GET", `/api/conversations/${convId}/pins`);
    if (state.activeId !== convId) return;
    state.convPins = data.pins || [];
    views.messages();
    // W5-S10-C: the header's pins pill lives in the topbar meta, which only the presence glue
    // repaints; without this the pill appeared on the second open, never on the first.
    views.presence();
  } catch { /* pins are optional */ }
}

export async function loadWikiList() {
  try {
    const data = await api("GET", "/api/wiki");
    state.wiki.pages = data.pages;
    views.sidebar();
  } catch { /* best effort */ }
}

let markReadTimers = {};

/** Teardown: a debounced "read" of the previous account must not fire under the next one. */
export function cancelMarkRead() {
  for (const id of Object.keys(markReadTimers)) clearTimeout(markReadTimers[id]);
  markReadTimers = {};
}

/** @param messageId up to which message we are reading. Without it the server moves the marker
/**  to the NEWEST message in the system - so a jump to an entry from an hour ago would also
/**  clear everything that arrived after it. */
export function markReadDebounced(convId, messageId) {
  clearTimeout(markReadTimers[convId]);
  markReadTimers[convId] = setTimeout(async () => {
    try {
      await api("POST", `/api/conversations/${convId}/read`, messageId ? { messageId } : {});
      // A frozen mark of 0 ("never read here") still produced a divider from the unread count;
      // that count is about to become 0, so the mark takes over the divider's position first.
      if (state.readMark[convId] === 0 && state.actor) {
        const frozen = dividerAfter(state.msgs[convId], 0, state.unread[convId], state.actor.id, state.lastUnread[convId]);
        if (frozen !== null) state.readMark[convId] = frozen;
      }
      // We clear it ONLY after the server confirms: a counter that lied once stops being read at all.
      state.unread[convId] = 0;
      state.unreadBadge[convId] = 0;
      views.conversationRow(convId);
      updateTitleBadge();
    } catch { /* best effort */ }
  }, 500);
}

// -------------------------------------------------- the human's session (presence)
// We register the browser session so that OTHERS see our presence and our "typing...".
// Ephemeral + a heartbeat: closing the tab simply lets the session expire.
export let mySessionId = sessionStorage.getItem(SID_KEY) || null;

let heartbeatTimer = null;

export function stopPresenceHeartbeat() { clearInterval(heartbeatTimer); heartbeatTimer = null; }

export async function registerPresenceSession() {
  if (!mySessionId) {
    mySessionId = "web-" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(SID_KEY, mySessionId);
  }
  try {
    await api("POST", "/api/sessions", { sessionId: mySessionId, label: "web", kind: "ephemeral" });
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      api("POST", "/api/sessions", { sessionId: mySessionId, label: "web", kind: "ephemeral" }).catch(() => {});
    }, 30000);
  } catch { /* presence is optional */ }
}

let lastTypingSignal = 0;

/** The "typing" signal with a place: loc = "c:<convId>" / "w:<slug>". Without loc it takes the
/**  active conversation. Throttled to 3 s - the server TTL is 7 s. */
export function signalTyping(loc) {
  const now = Date.now();
  if (!mySessionId || now - lastTypingSignal < 3000) return;
  lastTypingSignal = now;
  const where = loc || (state.activeId ? `c:${state.activeId}` : null);
  api("POST", `/api/sessions/${mySessionId}/signal`, {
    kind: "typing", ...(where ? { in: where } : {}),
  }).catch(() => {});
}

export async function refreshNotifications() {
  try {
    const data = await api("GET", "/api/notifications?limit=60");
    state.notifications = data.notifications;
    state.notifUnread = data.unread;
    updateTitleBadge();
    const { activity } = railBadges(state);
    const rail = document.getElementById("rail-notif");
    if (rail) rail.setAttribute("aria-label", `${t("Activity")}${activity ? `, ${t("{n} new", { n: activity })}` : ""}`);
    const badge = document.getElementById("rail-badge");
    if (badge) {
      badge.textContent = badgeText(activity);
      badge.classList.toggle("off", !activity);
    }
    if (state.view === "notifications") views.notifications();
  } catch { /* notifications are optional, not core functionality */ }
}
