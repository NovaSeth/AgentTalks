/**
 * The live event stream: resumption with a cursor, backoff, notifications.
 */
import { ACTOR_KEY, CSRF_KEY, api, newSessionGeneration, onUnauthorized, sessionGeneration, setCsrf } from "./api.js";
import { cancelMarkRead, ensureActors, loadConversationsList, loadReactionsForMessage, loadWikiList, markReadDebounced, refreshNotifications, refreshPresence, refreshQuestions, stopDigestTimer, stopPresenceHeartbeat } from "./data.js";
import { announce, closeAccountOverlays, isScrolledToBottom, scrollToBottom, updateJumpPill, updateTitleBadge } from "./dom.js";
import { t } from "./i18n.js";
import { actorHandle, findMsgById, mentionsMe, preserveUnsent, resetState, saveDraft, state, upsertMessage, views } from "./state.js";
import { showToast } from "./toasts.js";

// ------------------------------------------------------------ session lost (S7)
// A 401 from any call (or from the stream, probed below) means the session ended under the
// user. The old behaviour was a dead interface: every click failed with a raw server sentence.
// Now: the draft is saved FIRST, the shell goes back to sign-in, and a toast says why. Unlike
// doLogout this keeps the drafts (memory and localStorage): the user did not choose to leave.
export function onSessionLost() {
  if (!state.actor) return;
  // F1: from here on, every answer to a request of this session is dropped by api().
  newSessionGeneration();
  saveDraft();
  // F3: in-flight and failed messages become stored "not sent" bubbles of this account, before
  // the reset below drops them from memory.
  preserveUnsent();
  setCsrf(null);
  sessionStorage.removeItem(CSRF_KEY);
  sessionStorage.removeItem(ACTOR_KEY);
  stopPresenceHeartbeat();
  stopDigestTimer();
  cancelMarkRead();
  disconnectSSE();
  // F2: windows (a freshly issued token included), menus, pickers and old toasts live outside
  // #app; they go before the sign-in screen is drawn.
  closeAccountOverlays();
  const drafts = state.drafts;
  const pending = state.pending;
  const owner = state.actor.id;
  resetState();
  state.drafts = drafts;
  state.pending = pending;
  state.draftsOwner = owner;
  document.title = "AgentTalks";
  views.render();
  showToast(t("Your session ended, your draft is kept"));
}

onUnauthorized(onSessionLost);

// -------------------------------------------------------------- SSE (live)
// EventSource resumes BY ITSELF only from a TCP-level break. An HTTP response other than 200
// (a 429 from the stream limit, a 401 after the session expires, a 502/504 during a
// deployment) puts it into the CLOSED state and it never tries again - and a silent death of
// live updates is worse than a visible error. Hence our own resumption with a growing pause,
// a replay cursor, and a visible connection state in the sidebar footer.
let es = null;

let sseRetry = 0;        // attempt number: 1s, 2s, 4s ... max 30 s

let sseTimer = null;

let sseResume = false; // whether this connection is a return after a break

function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  // The connection state is a bar ABOVE THE CONVERSATION, not fine print under the channel
  // list: "you are not seeing new messages" matters more than the interface version number,
  // with which it used to share one line in the footer.
  views.offlineBar();
}

function scheduleReconnect() {
  clearTimeout(sseTimer);
  const delay = Math.min(30000, 1000 * 2 ** sseRetry);
  sseRetry = Math.min(sseRetry + 1, 5);
  sseResume = true;
  sseTimer = setTimeout(() => { if (state.actor) connectSSE(); }, delay);
}

/** Returning to the tab: the stream may have died in the background. We leave CONNECTING
/**  alone - the browser is trying by itself right now. */
export function ensureSSE() {
  if (!es || es.readyState === EventSource.CLOSED) connectSSE();
}

export function disconnectSSE() {
  clearTimeout(sseTimer);
  if (es) { es.close(); es = null; }
  sseRetry = 0;
  state.sseCursor = 0;
  sseResume = false;
}

export function connectSSE() {
  clearTimeout(sseTimer);
  if (es) es.close();
  // NO parameter and after=0 are two different things to the server: absent means "the future
  // only", zero means "replay from the beginning". On a first connection we want the former,
  // after a break - a replay from the cursor.
  es = new EventSource(state.sseCursor ? `/api/events?after=${state.sseCursor}` : "/api/events");
  es.onopen = async () => {
    sseRetry = 0;
    setOnline(true);
    if (!sseResume) return;
    sseResume = false;
    // After a break the unread counters and list contents can be arbitrarily stale - a replay
    // carries messages only, not state.
    try { await loadConversationsList(); views.sidebar(); updateTitleBadge(); }
    catch { /* best effort */ }
  };
  es.addEventListener("message", (e) => onMessageEvent(JSON.parse(e.data)));
  es.addEventListener("message_updated", (e) => onMessageEvent(JSON.parse(e.data)));
  es.addEventListener("reaction", (e) => onReactionEvent(JSON.parse(e.data)));
  es.addEventListener("read", () => {});
  es.addEventListener("presence", () => refreshPresence());
  es.addEventListener("notification", () => refreshNotifications());
  es.addEventListener("wiki", (e) => {
    // Somebody else's wiki edit: refresh the list (the change badge), and when you are looking at
    // that very page (and not editing it), its content and history as well.
    loadWikiList();
    try {
      const ev = JSON.parse(e.data);
      if (state.view === "wiki" && !state.wiki.editing && ev.slug === state.wiki.slug) {
        views.openWiki(ev.slug);
      }
    } catch { /* event without data */ }
  });
  es.addEventListener("conversation", async (e) => {
    // A channel change (edit/archive/membership): refresh the list; when it concerns the active
    // conversation, the view and the open details panel as well. Archiving the active one moves
    // you to the first available conversation.
    await loadConversationsList();
    views.sidebar();
    try {
      const ev = JSON.parse(e.data);
      if (ev.conversationId === state.activeId) {
        if (!state.conversations.some((c) => c.id === state.activeId)) {
          const next = state.conversations.find((c) => state.memberships[c.id]);
          state.activeId = null;
          state.detailsOpen = false;
          if (next) { views.openConversation(next.id); return; }
        }
        if (state.detailsOpen) await views.detailsData();
        views.main();
      }
    } catch { /* event without data */ }
  });
  es.onerror = () => {
    // readyState CONNECTING (0) = the browser is resuming by itself, we do not interfere.
    // CLOSED (2) = the end, nobody will try again - that is our job.
    setOnline(false);
    if (es && es.readyState === EventSource.CLOSED) {
      // EventSource hides the status code. A closed stream with a dead session must not loop on
      // reconnecting forever: one cheap probe - a 401 there fires onSessionLost through api().
      api("GET", "/api/me").catch(() => {});
      scheduleReconnect();
    }
  };
}

async function onMessageEvent(ev) {
  const convId = ev.conversationId, msg = ev.message;
  const isUpdate = ev.type === "message_updated";
  // F1: an event of this session that resumes after an await under another account is dropped.
  const gen = sessionGeneration();
  const known = state.conversations.some((c) => c.id === convId);
  if (!known) {
    try { await loadConversationsList(); } catch { return; }
    if (gen !== sessionGeneration()) return;
    views.sidebar();
  }
  // An unknown author: we fetch the ACTOR DIRECTORY, not the messages. Reloading the list
  // replaced the array with the 30 newest and erased all the loaded history - and that for one
  // missing handle.
  if (!state.actorsCache[msg.actorId]) await ensureActors({ force: true });
  if (gen !== sessionGeneration() || !state.actor) return;
  // A visible message restores a silent actor immediately. SSE replay must not age them again.
  const cachedActor = state.actorsCache[msg.actorId];
  if (cachedActor) {
    const listedActor = state.actorsList.find((a) => a.id === msg.actorId);
    const lastActiveAt = Math.max(cachedActor.lastActiveAt ?? 0, listedActor?.lastActiveAt ?? 0, msg.ts);
    cachedActor.lastActiveAt = lastActiveAt;
    if (listedActor && lastActiveAt > (listedActor.lastActiveAt ?? 0)) {
      listedActor.lastActiveAt = lastActiveAt;
      views.sidebar();
    }
  }
  const wasMine = msg.actorId === state.actor.id;
  const conversationOpen = state.view === "chat" && state.activeId === convId;
  const atBottom = conversationOpen && isScrolledToBottom();
  // A message for a conversation we have never opened does NOT create an array: an
  // empty-but-existing one then looked like "history already loaded", and after entering you
  // saw one message with nothing before it.
  if (state.loaded[convId] || conversationOpen) upsertMessage(convId, msg);
  if (msg.id > state.sseCursor) state.sseCursor = msg.id;
  if (msg.kind === "ask" || msg.kind === "answer") refreshQuestions(convId);
  // "Looking at a conversation" is not the same as "seeing the newest": with the history
  // scrolled up, messages were neither counted nor marked - the client showed 0 while the
  // server knew about thirty.
  const viewing = conversationOpen && document.visibilityState === "visible";
  const viewingLatest = viewing && atBottom;
  if (!isUpdate && !viewingLatest && !wasMine) {
    state.unread[convId] = (state.unread[convId] || 0) + 1;
    const conv = state.conversations.find((c) => c.id === convId);
    const direct = !!conv && (conv.kind === "dm" || conv.kind === "group");
    if (direct || mentionsMe(msg.body)) {
      state.unreadBadge[convId] = (state.unreadBadge[convId] || 0) + 1;
      maybeNotify(conv, msg, direct);
    }
    views.conversationRow(convId);
    updateTitleBadge();
  }
  if (conversationOpen) {
    views.message(msg);
    if (!isUpdate) {
      if (atBottom || wasMine) { scrollToBottom(true); }
      else if (!wasMine) { state.newBelow += 1; }
      updateJumpPill();
      if (viewingLatest && !wasMine) markReadDebounced(convId, msg.id);
      if (!wasMine) announce(`@${actorHandle(msg.actorId)}: ${String(msg.body ?? "").slice(0, 160)}`);
    }
  }
  if (state.threadOpen && (msg.id === state.threadOpen || msg.threadId === state.threadOpen)) {
    const i = state.threadMsgs.findIndex((m) => m.id === msg.id);
    if (i >= 0) state.threadMsgs[i] = msg; else { state.threadMsgs.push(msg); state.threadMsgs.sort((a, b) => a.id - b.id); }
    views.thread();
  }
}

// ----------------------------------------------- browser notifications
// We ask for permission IN CONTEXT - on the first mention or from the notification centre,
// never at startup. A request with no reason is refused once and for all, and then there is
// no way to ask again.
function maybeNotify(conv, msg, direct) {
  if (!("Notification" in window) || document.visibilityState === "visible") return;
  const notify = (conv && state.memberships[conv.id]?.notify) || "all";
  if (notify === "none") return;
  if (notify === "mentions" && !direct && !mentionsMe(msg.body)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(`@${actorHandle(msg.actorId)}`, {
      body: String(msg.body ?? "").slice(0, 180),
      tag: `conv-${msg.conversationId}`,
      icon: "/icons/icon-192.png",
    });
    n.onclick = () => { window.focus(); n.close(); views.openConversation(msg.conversationId, msg.id); };
  } catch { /* some browsers require a ServiceWorker; notifications are best effort */ }
}

function onReactionEvent(ev) {
  // A reaction carries a messageId, so there is no reason to fetch 200 full messages (57 KB)
  // for every member of the conversation - and that also when the reaction landed in a
  // conversation we do not even have open.
  if (ev.conversationId !== state.activeId && !state.threadOpen) return;
  loadReactionsForMessage(ev.conversationId, ev.messageId).then(() => {
    if (state.view === "chat" && state.activeId === ev.conversationId) views.message(findMsgById(ev.messageId));
    if (state.threadOpen) views.thread();
  });
}
