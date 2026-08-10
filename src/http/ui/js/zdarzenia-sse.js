/**
 * The live event stream: resumption with a cursor, backoff, notifications.
 */
import { api } from "./api.js";
import { ensureActors, loadConversationsList, loadReactionsForMessage, loadWikiList, markReadDebounced, refreshNotifications, refreshPresence, refreshQuestions } from "./dane.js";
import { announce, isScrolledToBottom, scrollToBottom, updateJumpPill, updateTitleBadge } from "./dom.js";
import { actorHandle, findMsgById, mentionsMe, state, upsertMessage, widok } from "./stan.js";

// -------------------------------------------------------------- SSE (live)
// EventSource resumes BY ITSELF only from a TCP-level break. An HTTP response other than 200
// (a 429 from the stream limit, a 401 after the session expires, a 502/504 during a
// deployment) puts it into the CLOSED state and it never tries again - and a silent death of
// live updates is worse than a visible error. Hence our own resumption with a growing pause,
// a replay cursor, and a visible connection state in the sidebar footer.
let es = null;

let sseRetry = 0;        // numer proby: 1s, 2s, 4s ... max 30 s

let sseTimer = null;

let sseWznowienie = false; // czy to polaczenie jest powrotem po przerwie

function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  // The connection state is a bar ABOVE THE CONVERSATION, not fine print under the channel
  // list: "you are not seeing new messages" matters more than the interface version number,
  // with which it used to share one line in the footer.
  widok.pasekOffline();
}

function scheduleReconnect() {
  clearTimeout(sseTimer);
  const delay = Math.min(30000, 1000 * 2 ** sseRetry);
  sseRetry = Math.min(sseRetry + 1, 5);
  sseWznowienie = true;
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
  sseWznowienie = false;
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
    if (!sseWznowienie) return;
    sseWznowienie = false;
    // After a break the unread counters and list contents can be arbitrarily stale - a replay
    // carries messages only, not state.
    try { await loadConversationsList(); widok.sidebar(); updateTitleBadge(); }
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
        widok.otworzWiki(ev.slug);
      }
    } catch { /* zdarzenie bez danych */ }
  });
  es.addEventListener("conversation", async (e) => {
    // A channel change (edit/archive/membership): refresh the list; when it concerns the active
    // conversation, the view and the open details panel as well. Archiving the active one moves
    // you to the first available conversation.
    await loadConversationsList();
    widok.sidebar();
    try {
      const ev = JSON.parse(e.data);
      if (ev.conversationId === state.activeId) {
        if (!state.conversations.some((c) => c.id === state.activeId)) {
          const next = state.conversations.find((c) => state.memberships[c.id]);
          state.activeId = null;
          state.detailsOpen = false;
          if (next) { widok.otworzRozmowe(next.id); return; }
        }
        if (state.detailsOpen) await widok.szczegolyDane();
        widok.glowny();
      }
    } catch { /* zdarzenie bez danych */ }
  });
  es.onerror = () => {
    // readyState CONNECTING (0) = the browser is resuming by itself, we do not interfere.
    // CLOSED (2) = the end, nobody will try again - that is our job.
    setOnline(false);
    if (es && es.readyState === EventSource.CLOSED) scheduleReconnect();
  };
}

async function onMessageEvent(ev) {
  const convId = ev.conversationId, msg = ev.message;
  const known = state.conversations.some((c) => c.id === convId);
  if (!known) { await loadConversationsList(); widok.sidebar(); }
  // An unknown author: we fetch the ACTOR DIRECTORY, not the messages. Reloading the list
  // replaced the array with the 30 newest and erased all the loaded history - and that for one
  // missing handle.
  if (!state.actorsCache[msg.actorId]) await ensureActors({ force: true });
  const wasMine = msg.actorId === state.actor.id;
  const otwarta = state.view === "chat" && state.activeId === convId;
  const atBottom = otwarta && isScrolledToBottom();
  // A message for a conversation we have never opened does NOT create an array: an
  // empty-but-existing one then looked like "history already loaded", and after entering you
  // saw one message with nothing before it.
  if (state.loaded[convId] || otwarta) upsertMessage(convId, msg);
  else if (msg.id > state.sseCursor) state.sseCursor = msg.id;
  if (msg.kind === "ask" || msg.kind === "answer") refreshQuestions(convId);
  // "Looking at a conversation" is not the same as "seeing the newest": with the history
  // scrolled up, messages were neither counted nor marked - the client showed 0 while the
  // server knew about thirty.
  const viewing = otwarta && document.visibilityState === "visible";
  const widzeNajnowsze = viewing && atBottom;
  if (!widzeNajnowsze && !wasMine) {
    state.unread[convId] = (state.unread[convId] || 0) + 1;
    const conv = state.conversations.find((c) => c.id === convId);
    const direct = !!conv && (conv.kind === "dm" || conv.kind === "group");
    if (direct || mentionsMe(msg.body)) {
      state.unreadBadge[convId] = (state.unreadBadge[convId] || 0) + 1;
      maybeNotify(conv, msg, direct);
    }
    widok.wiersz(convId);
    updateTitleBadge();
  }
  if (otwarta) {
    widok.wiadomosc(msg);
    if (atBottom || wasMine) { scrollToBottom(true); }
    else if (!wasMine) { state.newBelow += 1; }  // przyszlo poza polem widzenia
    updateJumpPill();
    if (widzeNajnowsze && !wasMine) markReadDebounced(convId, msg.id);
    if (!wasMine) announce(`@${actorHandle(msg.actorId)}: ${String(msg.body ?? "").slice(0, 160)}`);
  }
  if (state.threadOpen && (msg.id === state.threadOpen || msg.threadId === state.threadOpen)) {
    const i = state.threadMsgs.findIndex((m) => m.id === msg.id);
    if (i >= 0) state.threadMsgs[i] = msg; else { state.threadMsgs.push(msg); state.threadMsgs.sort((a, b) => a.id - b.id); }
    widok.watek();
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
    n.onclick = () => { window.focus(); n.close(); widok.otworzRozmowe(msg.conversationId, msg.id); };
  } catch { /* niektore przegladarki wymagaja ServiceWorkera - trudno */ }
}

function onReactionEvent(ev) {
  // A reaction carries a messageId, so there is no reason to fetch 200 full messages (57 KB)
  // for every member of the conversation - and that also when the reaction landed in a
  // conversation we do not even have open.
  if (ev.conversationId !== state.activeId && !state.threadOpen) return;
  loadReactionsForMessage(ev.conversationId, ev.messageId).then(() => {
    if (state.view === "chat" && state.activeId === ev.conversationId) widok.wiadomosc(findMsgById(ev.messageId));
    if (state.threadOpen) widok.watek();
  });
}
