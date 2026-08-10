/**
 * Fetching and refreshing data. It calls drawing through the `widok` registry.
 */
import { SID_KEY, api } from "./api.js";
import { updateTitleBadge } from "./dom.js";
import { animatedMsgs, applyUnreadRows, mergeActors, mergeReactions, state, upsertMessage, widok } from "./stan.js";
import { showError } from "./toasty.js";

// ----------------------------------------------------------------- loading
export async function loadConversationsList() {
  const data = await api("GET", "/api/conversations");
  state.conversations = data.conversations;
  const memberships = {};
  for (const m of data.memberships) memberships[m.conversationId] = m;
  state.memberships = memberships;
  applyUnreadRows(data.unread);
}

// Entering a conversation must show the NEWEST messages at once, so the first batch is small
// (roughly what fits on a screen); older ones load themselves, 20 at a time, as you scroll
// up. Fetching 200 messages on open was paying in time-to-first-view for history nobody
// reads.
const PIERWSZA_PACZKA = 30;

const STARSZA_PACZKA = 20;

export async function loadMessages(convId) {
  const pierwszyRaz = !state.loaded[convId];
  const data = await api("GET", `/api/conversations/${convId}/messages?limit=${PIERWSZA_PACZKA}`);
  // We MERGE rather than replace the array: assigning `state.msgs[id] = ...` erased everything
  // the user had loaded by scrolling up.
  // History enters without animation - the "slide in" is played only by a message that arrived
  // live (SSE), not by every opening of a channel.
  for (const m of data.messages) { upsertMessage(convId, m); animatedMsgs.add(m.id); }
  // The "history FETCHED" marker (not "there are some messages"): a single message from SSE
  // must not pretend to be a loaded conversation.
  state.loaded[convId] = true;
  // A full batch = there is probably older history to load. When refreshing an already loaded
  // conversation, a new batch says nothing about what lies ABOVE our list.
  if (pierwszyRaz) state.hasMore[convId] = data.messages.length >= PIERWSZA_PACZKA;
  mergeActors(data.actors);
  mergeReactions(data.messages, data.reactions);
  // Thread replies do not stand in the main list, so a batch of 30 messages can produce a
  // screen with three. We fetch more until there is something to scroll - without that, lazy
  // loading would never start, because there simply is no scrollbar.
  let dobrane = 0;
  while (
    state.hasMore[convId] && dobrane < 4 &&
    (state.msgs[convId] || []).filter((m) => !m.threadId).length < 15
  ) {
    dobrane++;
    await loadOlderMessages(convId);
  }
}

/** Loading older history above what we already have - keeping the scroll position (the content
/**  must not run away from your eyes when older messages slide in above it). */
let doladowanieTrwa = false;

export async function loadOlderMessages(convId) {
  const list = state.msgs[convId] || [];
  const oldest = list[0];
  if (!oldest || doladowanieTrwa || !state.hasMore[convId]) return;
  doladowanieTrwa = true;
  try {
    const data = await api("GET", `/api/conversations/${convId}/messages?before=${oldest.id}&limit=${STARSZA_PACZKA}`);
    for (const m of data.messages) { upsertMessage(convId, m); animatedMsgs.add(m.id); }
    mergeActors(data.actors);
    mergeReactions(data.messages, data.reactions);
    state.hasMore[convId] = data.messages.length >= STARSZA_PACZKA;
    const el = document.getElementById("messages");
    const beforeH = el ? el.scrollHeight : 0, beforeTop = el ? el.scrollTop : 0;
    widok.wiadomosci();
    // An anchor: after adding older messages above, what you are looking at has to stay under the
    // same finger - otherwise lazy loading "yanks" the view.
    if (el) el.scrollTop = beforeTop + (el.scrollHeight - beforeH);
  } catch (e) { showError(e); }
  finally { doladowanieTrwa = false; }
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
export async function refreshDigestAndLeases(force) {
  if (!force && document.visibilityState !== "visible") return;  // a background tab does not need the lease board
  try {
    const [d, l] = await Promise.all([
      api("GET", "/api/digest?summary=1").catch(() => ({ digest: null })),
      api("GET", "/api/leases").catch(() => ({ leases: [] })),
    ]);
    state.digest = d.digest || null;
    state.leases = l.leases || [];
    widok.sidebar();
  } catch { /* dodatki, nie fundament */ }
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
const AKTORZY_TTL_MS = 60000;

let pobieranieAktorow = null;

export async function ensureActors(opts = {}) {
  const swieze = Date.now() - state.actorsAt < (opts.maxAgeMs ?? AKTORZY_TTL_MS);
  if (!opts.force && swieze && state.actorsList.length) return state.actorsList;
  if (pobieranieAktorow) return pobieranieAktorow;
  pobieranieAktorow = api("GET", "/api/actors")
    .then((d) => {
      state.actorsList = d.actors || [];
      for (const a of state.actorsList) {
        state.actorsCache[a.id] = { handle: a.handle, displayName: a.displayName, kind: a.kind };
      }
      state.actorsAt = Date.now();
      return state.actorsList;
    })
    .catch(() => state.actorsList)
    .finally(() => { pobieranieAktorow = null; });
  return pobieranieAktorow;
}

export async function refreshPresence() {
  try {
    const data = await api("GET", "/api/presence");
    state.presence = data.presence;
    // Pointwise: presence changes ONLY the dots in the sidebar. Web sessions beat a heartbeat
    // every 30 s, so a full rebuild of the list on every breath would yank the list out from
    // under the user's cursor.
    widok.obecnosc();
  } catch { /* obecnosc nie jest krytyczna */ }
}

export async function refreshQuestions(convId) {
  try {
    const data = await api("GET", "/api/questions/open");
    const open = {};
    for (const q of data.questions) open[q.message.id] = q.id;
    // Without this comparison, every entry into a conversation and every reply redrew the whole
    // message list, usually in order to change nothing.
    const zmiana = Object.keys(open).join(",") !== Object.keys(state.openQuestions).join(",");
    state.openQuestions = open;
    if (!zmiana) return;
    widok.sidebar();
    if (state.view === "chat" && (!convId || convId === state.activeId)) widok.wiadomosci();
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
    widok.wiadomosci();
  } catch { /* piny sa dodatkiem */ }
}

export async function loadWikiList() {
  try {
    const data = await api("GET", "/api/wiki");
    state.wiki.pages = data.pages;
    widok.sidebar();
  } catch { /* best effort */ }
}

let markReadTimers = {};

/** @param messageId up to which message we are reading. Without it the server moves the marker
/**  to the NEWEST message in the system - so a jump to an entry from an hour ago would also
/**  clear everything that arrived after it. */
export function markReadDebounced(convId, messageId) {
  clearTimeout(markReadTimers[convId]);
  markReadTimers[convId] = setTimeout(async () => {
    try {
      await api("POST", `/api/conversations/${convId}/read`, messageId ? { messageId } : {});
      // We clear it ONLY after the server confirms: a counter that lied once stops being read at all.
      state.unread[convId] = 0;
      state.unreadBadge[convId] = 0;
      widok.wiersz(convId);
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
  } catch { /* obecnosc opcjonalna */ }
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
    const rail = document.getElementById("rail-notif");
    if (rail) rail.setAttribute("aria-label", `Powiadomienia${state.notifUnread ? `, ${state.notifUnread} nowych` : ""}`);
    const badge = document.getElementById("rail-badge");
    if (badge) {
      badge.textContent = state.notifUnread > 99 ? "99+" : String(state.notifUnread);
      badge.classList.toggle("off", !state.notifUnread);
    }
    if (state.view === "notifications") widok.powiadomienia();
  } catch { /* powiadomienia sa dodatkiem, nie fundamentem */ }
}
