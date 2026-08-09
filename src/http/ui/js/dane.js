/**
 * Pobieranie i odswiezanie danych. Rysowanie wola przez rejestr `widok`.
 */
import { SID_KEY, api } from "./api.js";
import { updateTitleBadge } from "./dom.js";
import { animatedMsgs, applyUnreadRows, mergeActors, mergeReactions, state, upsertMessage, widok } from "./stan.js";
import { showError } from "./toasty.js";

// ------------------------------------------------------------------- ladowanie
export async function loadConversationsList() {
  const data = await api("GET", "/api/conversations");
  state.conversations = data.conversations;
  const memberships = {};
  for (const m of data.memberships) memberships[m.conversationId] = m;
  state.memberships = memberships;
  applyUnreadRows(data.unread);
}

// Wejscie w rozmowe ma pokazac NAJNOWSZE od razu, wiec pierwsza paczka jest
// mala (tyle, ile mniej wiecej miesci sie na ekranie); starsze doczytuja sie
// same, po 20, gdy przewijasz w gore. Pobieranie 200 wiadomosci na otwarcie
// bylo placeniem czasem do pierwszego widoku za historie, ktorej nikt nie czyta.
const PIERWSZA_PACZKA = 30;

const STARSZA_PACZKA = 20;

export async function loadMessages(convId) {
  const pierwszyRaz = !state.loaded[convId];
  const data = await api("GET", `/api/conversations/${convId}/messages?limit=${PIERWSZA_PACZKA}`);
  // SCALAMY zamiast podmieniac tablice: przypisanie `state.msgs[id] = ...`
  // kasowalo wszystko, co uzytkownik doladowal przewijaniem w gore.
  // Historia wchodzi bez animacji - "wjazd" odgrywa tylko wiadomosc, ktora
  // przyszla na zywo (SSE), nie kazde otwarcie kanalu.
  for (const m of data.messages) { upsertMessage(convId, m); animatedMsgs.add(m.id); }
  // Znacznik "historia POBRANA" (nie "sa jakies wiadomosci"): pojedyncza
  // wiadomosc z SSE nie moze udawac wczytanej rozmowy.
  state.loaded[convId] = true;
  // Pelna paczka = pewnie jest starsza historia do doladowania. Przy odswiezeniu
  // juz wczytanej rozmowy nowa paczka nie mowi nic o tym, co jest NAD nasza lista.
  if (pierwszyRaz) state.hasMore[convId] = data.messages.length >= PIERWSZA_PACZKA;
  mergeActors(data.actors);
  mergeReactions(data.messages, data.reactions);
  // Odpowiedzi w watkach nie stoja na glownej liscie, wiec paczka 30 wiadomosci
  // moze dac ekran z trzema. Dobieramy, dopoki nie ma z czego przewijac - bez
  // tego lazy loading nigdy by sie nie uruchomil, bo scrolla po prostu nie ma.
  let dobrane = 0;
  while (
    state.hasMore[convId] && dobrane < 4 &&
    (state.msgs[convId] || []).filter((m) => !m.threadId).length < 15
  ) {
    dobrane++;
    await loadOlderMessages(convId);
  }
}

/** Doladowanie starszej historii nad tym, co juz mamy - z zachowaniem pozycji
 *  scrolla (tresc nie moze uciec spod oczu, gdy nad nia wjezdza starsze). */
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
    // Kotwica: po dolozeniu starszych nad spodem tresc, na ktora patrzysz, ma
    // zostac pod tym samym palcem - inaczej lazy loading "wyrywa" widok.
    if (el) el.scrollTop = beforeTop + (el.scrollHeight - beforeH);
  } catch (e) { showError(e); }
  finally { doladowanieTrwa = false; }
}

// Uchwyt cyklicznego odswiezania dzierzaw/digestu. W zmiennej modulowej, bo bez
// niego kazde ponowne logowanie w tej samej karcie zostawialo kolejny, rownolegle
// dzialajacy interwal (i trzeci po trzecim logowaniu). Dzierzawy zyja minutami,
// wiec 30 s wystarcza na "tablice".
let digestTimer = null;

export function startDigestTimer() {
  clearInterval(digestTimer);
  digestTimer = setInterval(refreshDigestAndLeases, 30000);
}

export function stopDigestTimer() { clearInterval(digestTimer); digestTimer = null; }

/** Digest "Co Cie ominelo" i tablica dzierzaw - dane do sidebara.
 *  summary=1: sidebar potrzebuje z digestu JEDNEJ liczby, a pelna odpowiedz to
 *  komplet wzmianek i otwartych pytan z trescia (dziesiatki KB co 30 s). Gdy
 *  serwer parametru nie zna, po prostu odda wszystko - nic sie nie psuje. */
/** @param force pomija warunek widocznosci karty. Cykliczne odswiezanie w tle
 *  jest bez sensu, ale odswiezenie PO CZYNNOSCI uzytkownika (zajal zasob,
 *  zwolnil) musi dojsc zawsze - inaczej lista przeczy komunikatowi, ktory
 *  wlasnie powiedzial "gotowe". */
export async function refreshDigestAndLeases(force) {
  if (!force && document.visibilityState !== "visible") return;  // karta w tle nie potrzebuje tablicy dzierzaw
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

/** Reakcje JEDNEJ wiadomosci. Osobnego endpointu nie ma, ale `before=<id+1>&limit=1`
 *  zwraca dokladnie te jedna wiadomosc razem z jej mapa reakcji - zamiast 200
 *  pelnych wiadomosci (kilkaset KB) po kazdym kliknieciu emoji u kazdego czlonka. */
export async function loadReactionsForMessage(convId, messageId) {
  if (!convId || !messageId) return;
  try {
    const data = await api("GET", `/api/conversations/${convId}/messages?before=${messageId + 1}&limit=1`);
    mergeReactions(data.messages, data.reactions);
    mergeActors(data.actors);
    if (state.loaded[convId]) for (const m of data.messages) upsertMessage(convId, m);
  } catch { /* best effort */ }
}

// Katalog aktorow: JEDNA regula zamiast trzech roznych (mentionAutocomplete brala
// go, gdy lista byla pusta; nowa rozmowa tak samo; panel szczegolow po swojemu).
// Prosty TTL + wspolne zapytanie, zeby seria wiadomosci od nieznanych autorow nie
// wystrzelila serii identycznych zadan.
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
    // Punktowo: obecnosc zmienia w sidebarze WYLACZNIE kropki. Sesje web bija
    // heartbeat co 30 s, wiec pelna przebudowa listy przy kazdym oddechu
    // wyrzucalaby uzytkownikowi liste spod kursora.
    widok.obecnosc();
  } catch { /* obecnosc nie jest krytyczna */ }
}

export async function refreshQuestions(convId) {
  try {
    const data = await api("GET", "/api/questions/open");
    const open = {};
    for (const q of data.questions) open[q.message.id] = q.id;
    // Bez tego porownania kazde wejscie do rozmowy i kazda odpowiedz
    // przerysowywaly cala liste wiadomosci, zwykle po to, zeby nic nie zmienic.
    const zmiana = Object.keys(open).join(",") !== Object.keys(state.openQuestions).join(",");
    state.openQuestions = open;
    if (!zmiana) return;
    widok.sidebar();
    if (state.view === "chat" && (!convId || convId === state.activeId)) widok.wiadomosci();
  } catch { /* best effort */ }
}

/** Piny aktywnej rozmowy. Wczesniej pobieral je WYLACZNIE panel szczegolow,
 *  wiec menu wiadomosci nie mialo skad wiedziec, czy pokazac "Przypnij" czy
 *  "Odepnij". Odpowiedz jest maleńka (lista identyfikatorow), a wchodzi raz na
 *  wejscie do rozmowy. */
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

/** @param messageId do ktorej wiadomosci czytamy. Bez niego serwer przesuwa
 *  znacznik na NAJNOWSZA wiadomosc w systemie - czyli skok do wpisu sprzed
 *  godziny kasowalby takze wszystko, co przyszlo po nim. */
export function markReadDebounced(convId, messageId) {
  clearTimeout(markReadTimers[convId]);
  markReadTimers[convId] = setTimeout(async () => {
    try {
      await api("POST", `/api/conversations/${convId}/read`, messageId ? { messageId } : {});
      // Zerujemy DOPIERO po potwierdzeniu serwera: licznik, ktory raz sklamal,
      // przestaje byc czytany w ogole.
      state.unread[convId] = 0;
      state.unreadBadge[convId] = 0;
      widok.wiersz(convId);
      updateTitleBadge();
    } catch { /* best effort */ }
  }, 500);
}

// -------------------------------------------------- sesja czlowieka (obecnosc)
// Rejestrujemy sesje przegladarki, zeby INNI widzieli nasza obecnosc i "pisze...".
// Efemeryczna + heartbeat: zamkniecie karty po prostu wygasza sesje.
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

/** Sygnal "pisze" z miejscem: loc = "c:<convId>" / "w:<slug>". Bez loc bierze
 *  aktywna rozmowe. Throttle 3 s - TTL na serwerze to 7 s. */
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
