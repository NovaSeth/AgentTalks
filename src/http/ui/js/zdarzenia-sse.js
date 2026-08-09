/**
 * Strumien zdarzen na zywo: wznawianie z kursorem, backoff, powiadomienia.
 */
import { api } from "./api.js";
import { ensureActors, loadConversationsList, loadReactionsForMessage, loadWikiList, markReadDebounced, refreshNotifications, refreshPresence, refreshQuestions } from "./dane.js";
import { announce, isScrolledToBottom, scrollToBottom, updateJumpPill, updateTitleBadge } from "./dom.js";
import { actorHandle, findMsgById, mentionsMe, state, upsertMessage, widok } from "./stan.js";

// --------------------------------------------------------------- SSE (na zywo)
// EventSource wznawia SAM tylko zerwanie na poziomie TCP. Odpowiedz HTTP inna niz
// 200 (429 z limitu strumieni, 401 po wygasnieciu sesji, 502/504 podczas deployu)
// przestawia go w stan CLOSED i nie probuje juz nigdy - a cicha smierc live-update
// jest gorsza od widocznego bledu. Stad wlasne wznawianie z narastajaca przerwa,
// kursor dosylki i widoczny stan polaczenia w stopce panelu bocznego.
let es = null;

let sseRetry = 0;        // numer proby: 1s, 2s, 4s ... max 30 s

let sseTimer = null;

let sseWznowienie = false; // czy to polaczenie jest powrotem po przerwie

function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  const el = document.getElementById("sb-net");
  if (!el) return;
  el.hidden = online;
  el.textContent = online ? "" : "offline - próbuję połączyć...";
}

function scheduleReconnect() {
  clearTimeout(sseTimer);
  const delay = Math.min(30000, 1000 * 2 ** sseRetry);
  sseRetry = Math.min(sseRetry + 1, 5);
  sseWznowienie = true;
  sseTimer = setTimeout(() => { if (state.actor) connectSSE(); }, delay);
}

/** Powrot do karty: strumien mogl paść w tle. CONNECTING zostawiamy w spokoju -
 *  przegladarka wlasnie probuje sama. */
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
  // BRAK parametru i after=0 to dla serwera dwie rozne rzeczy: brak znaczy
  // "tylko przyszlosc", zero znaczy "dosylaj od poczatku". Przy pierwszym
  // polaczeniu chcemy pierwszego, po zerwaniu - dosylki od kursora.
  es = new EventSource(state.sseCursor ? `/api/events?after=${state.sseCursor}` : "/api/events");
  es.onopen = async () => {
    sseRetry = 0;
    setOnline(true);
    if (!sseWznowienie) return;
    sseWznowienie = false;
    // Po przerwie liczniki nieprzeczytanych i sklad list moga byc dowolnie stare -
    // dosylka niesie tylko wiadomosci, nie stan.
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
    // Czyjas edycja wiki: odswiez liste (badge zmian), a gdy patrzysz wlasnie
    // na te strone (i jej nie edytujesz), takze jej tresc i historie.
    loadWikiList();
    try {
      const ev = JSON.parse(e.data);
      if (state.view === "wiki" && !state.wiki.editing && ev.slug === state.wiki.slug) {
        widok.otworzWiki(ev.slug);
      }
    } catch { /* zdarzenie bez danych */ }
  });
  es.addEventListener("conversation", async (e) => {
    // Zmiana kanalu (edycja/archiwum/sklad): odswiez liste; gdy dotyczy aktywnej
    // rozmowy, takze widok i otwarty panel szczegolow. Archiwizacja aktywnej
    // przenosi na pierwsza dostepna rozmowe.
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
    // readyState CONNECTING (0) = przegladarka wznawia sama, nie przeszkadzamy.
    // CLOSED (2) = koniec, dalej juz nikt nie sprobuje - to nasza robota.
    setOnline(false);
    if (es && es.readyState === EventSource.CLOSED) scheduleReconnect();
  };
}

async function onMessageEvent(ev) {
  const convId = ev.conversationId, msg = ev.message;
  const known = state.conversations.some((c) => c.id === convId);
  if (!known) { await loadConversationsList(); widok.sidebar(); }
  // Nieznany autor: dociagamy KATALOG AKTOROW, a nie wiadomosci. Przeladowanie
  // listy podmienialo tablice na 30 najnowszych i kasowalo cala doladowana
  // historie - i to za jeden brakujacy handle.
  if (!state.actorsCache[msg.actorId]) await ensureActors({ force: true });
  const wasMine = msg.actorId === state.actor.id;
  const otwarta = state.view === "chat" && state.activeId === convId;
  const atBottom = otwarta && isScrolledToBottom();
  // Wiadomosc do rozmowy, ktorej nigdy nie otwieralismy, NIE zaklada tablicy:
  // pusta-ale-istniejaca wygladala potem jak "historia juz wczytana" i po
  // wejsciu bylo widac jedna wiadomosc bez niczego przed nia.
  if (state.loaded[convId] || otwarta) upsertMessage(convId, msg);
  else if (msg.id > state.sseCursor) state.sseCursor = msg.id;
  if (msg.kind === "ask" || msg.kind === "answer") refreshQuestions(convId);
  // "Patrze na rozmowe" to nie to samo co "widze najnowsze": przy historii
  // przewinietej w gore wiadomosci nie byly ani liczone, ani oznaczane -
  // klient pokazywal 0, serwer wiedzial o trzydziestu.
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

// ------------------------------------------------- powiadomienia przegladarki
// O zgode pytamy KONTEKSTOWO - przy pierwszej wzmiance albo z centrum powiadomien,
// nigdy na starcie. Prosba bez powodu jest odrzucana raz na zawsze i wtedy nie ma
// juz jak jej ponowic.
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
  // Reakcja niesie messageId, wiec nie ma powodu pobierac 200 pelnych wiadomosci
  // (57 KB) u kazdego czlonka rozmowy - i to takze wtedy, gdy reakcja padla
  // w rozmowie, ktorej nawet nie mamy otwartej.
  if (ev.conversationId !== state.activeId && !state.threadOpen) return;
  loadReactionsForMessage(ev.conversationId, ev.messageId).then(() => {
    if (state.view === "chat" && state.activeId === ev.conversationId) widok.wiadomosc(findMsgById(ev.messageId));
    if (state.threadOpen) widok.watek();
  });
}
