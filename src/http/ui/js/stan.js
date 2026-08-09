/**
 * Stan aplikacji i czyste operacje na nim. NIE importuje widokow - komunikacja
 * w te strone idzie przez rejestr `widok` (wstrzykiwane funkcje rysujace).
 */

// ------------------------------------------------------------------- stan
export const state = {
  actor: null,
  conversations: [],
  memberships: {},         // convId -> membership
  unread: {},              // convId -> liczba nieprzeczytanych (pogrubienie + licznik)
  unreadBadge: {},         // convId -> ile z nich "wazy" (DM/grupa: kazda; kanal: wzmianki)
  activeId: null,
  msgs: {},                // convId -> Message[] (rosnaco po id)
  loaded: {},              // convId -> czy historia byla POBRANA (nie: czy sa jakies wiadomosci)
  readMark: {},            // convId -> id ostatniej przeczytanej, ZAMROZONE przy wejsciu (kreska "nowe")
  drafts: {},              // convId -> {text, replyTo} - szkic przezywajacy przelaczenie rozmowy
  pending: {},             // convId -> lokalne wiadomosci w locie (id "tmp-...")
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
  news: null,              // "Co nowego" z /api/me - do pokazania raz, po czym null
  digest: null,            // "Co Cie ominelo" z GET /api/digest (null = nic)
  leases: [],              // aktywne dzierzawy zasobow (GET /api/leases)
  hasMore: {},             // convId -> czy sa starsze wiadomosci do doladowania
  actorsList: [],
  openQuestions: {},       // messageId -> questionId (otwarte, widoczne dla mnie)
  lastDelivery: null,      // {conversationId, messageId, delivery[]} z ostatniej wysylki
  pendingFiles: [],        // pliki czekajace na wyslanie (podglady w composerze)
  sseCursor: 0,            // najwyzsze widziane id wiadomosci = kursor dosylki SSE (?after=)
  newBelow: 0,             // ile nowych przyszlo, gdy lista byla przewinieta w gore
  askMode: false,          // composer wysyla PYTANIE do kanalu zamiast zwyklej wiadomosci
  view: "chat",            // "chat" | "wiki" | "users" | "notifications"
  notifUnread: 0,          // licznik centrum powiadomien (dzwonek w sidebarze)
  notifications: [],       // ostatnie powiadomienia (GET /api/notifications)
  wiki: {
    pages: [], slug: null, page: null, files: [], history: [],
    revision: null,        // podgladana STARA rewizja (null = najnowsza)
    editing: false, tab: "info", draft: null,
  },
};

/** Rejestr funkcji rysujacych. Warstwa danych i akcji NIE importuje widokow -
 *  to zamykaloby cykl importow (widok wola akcje, akcja przerysowuje widok).
 *  Widoki rejestruja sie tutaj raz, przy starcie; reszta kodu wola je przez ten
 *  obiekt. Domyslne puste funkcje sprawiaja, ze wszystko dziala takze zanim
 *  jakikolwiek widok w ogole powstal (np. blad w trakcie logowania). */
export const widok = {
  render: () => {},           // caly ekran: login albo powloka
  powloka: () => {},          // rail + panel boczny + kolumna glowna
  glowny: () => {},           // kolumna glowna biezacego widoku
  sidebar: () => {},          // lista kanalow, wiadomosci i wiki
  wiersz: () => {},           // JEDEN wiersz rozmowy (pogrubienie + plakietka)
  obecnosc: () => {},         // kropki, pasek "pisze/pracuje", topbar, kuleczki wiki
  wiadomosci: () => {},       // cala lista wiadomosci
  wiadomosc: () => {},        // JEDEN dymek
  naDol: () => {},            // przewiniecie listy na najnowsza
  watek: () => {},
  otworzWatek: () => {},      // otwarcie panelu watku dla danego korzenia
  pasekOffline: () => {},     // pasek "brak polaczenia" nad rozmowa
  composer: () => {},
  szczegoly: () => {},
  wiki: () => {},
  powiadomienia: () => {},
  uzytkownicy: () => {},
  podepnijTresc: () => {},    // delegowane zdarzenia w swiezo wyrenderowanej tresci
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

/** Adres awatara aktora albo null (wtedy rysujemy kropke z inicjalami).
 *  `?v=<odcisk>` w adresie sprawia, ze zmiana awatara jest widoczna od razu mimo
 *  rocznego cache'owania - bez tego "zmienilem awatar i nic sie nie stalo". */
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

// Aliasy wolania calego kanalu - DOKLADNIE ta sama lista co w rdzeniu
// (core/mentions.ts), inaczej ogloszenie z @all liczyloby sie na kliencie
// slabiej niz na serwerze i licznik zmienialby sie po samym odswiezeniu.
const WOLANIA_OGOLNE = ["all", "channel", "here", "wszyscy", "kanal"];

/** "Czy ta wiadomosc wola mnie" - wyrazenie budowane RAZ po zalogowaniu, a nie
 *  dla kazdego dymka przy kazdym renderze. Klasa znakow przed @ jest ta sama co
 *  w mdInline, wiec "(@michal" liczy sie tak samo jak " @michal". */
// Handle dopuszcza kropke i myslnik (core/ids.ts), a kropka w wyrazeniu regularnym
// znaczy "dowolny znak" - bez ucieczki "@jan.kowalski" pasowalby do "@janXkowalski".
// Helper stoi tu, a nie w dom.js, bo stan.js celowo nie importuje niczego.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let mentionRe = null;

/** Wylogowanie zeruje wzorzec - inaczej nastepny uzytkownik w tej samej karcie
 *  liczylby wzmianki po cudzym handle. */
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

/** Jedyne miejsce, w ktorym wiadomosc wchodzi do stanu - i jedyne, w ktorym
 *  przesuwa sie kursor dosylki SSE. */
export function upsertMessage(convId, msg) {
  const list = state.msgs[convId] || (state.msgs[convId] = []);
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) list[i] = msg; else { list.push(msg); list.sort((a, b) => a.id - b.id); }
  if (msg.id > state.sseCursor) state.sseCursor = msg.id;
}

/** Wiersze unread z serwera (pola: unread, badge) do dwoch map stanu.
 *  UWAGA: pole nazywa sie `unread`, nie `count` - stary odczyt row.count dawal
 *  undefined i liczniki z serwera NIGDY sie nie ladowaly (dzialaly tylko
 *  przyrosty SSE w zywej sesji; po odswiezeniu znikaly). */
export function applyUnreadRows(rows) {
  state.unread = {};
  state.unreadBadge = {};
  for (const row of rows || []) {
    state.unread[row.conversationId] = row.unread || 0;
    state.unreadBadge[row.conversationId] = row.badge || 0;
  }
}

/** Scala reakcje z odpowiedzi serwera. Najpierw KASUJE wpisy dla pobranych
 *  wiadomosci: wiadomosc bez reakcji nie ma klucza w odpowiedzi, wiec samo
 *  Object.assign nigdy nie zdejmuje ostatniej reakcji (chip zostawal na zawsze). */
export function mergeReactions(messages, reactions) {
  for (const m of messages) delete state.reactions[m.id];
  Object.assign(state.reactions, reactions || {});
}

// ------------------------------------------------------------------- szkice
// Przelaczenie rozmowy w trakcie pisania to w komunikatorze norma, a nie wypadek
// przy pracy - wiec tekst i podpiete pliki maja to przezyc. Tekst dodatkowo
// laduje w localStorage, zeby przezyl F5 i deploy; pliki zostaja w pamieci karty
// (obiektu File nie da sie zserializowac).
const DRAFT_KEY = (id) => `atalks_draft_${id}`;

/** Zaglada do pola tekstowego, bo to ono jest zrodlem prawdy o tresci szkicu
 *  (stan nie sledzi kazdego nacisniecia klawisza). To jedyne miejsce w tym
 *  module, ktore dotyka DOM - i nie tworzy zaleznosci od zadnego widoku. */
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

/** Historia rozmow, ktorych nie ogladamy, nie moze rosnac w karcie w nieskonczonosc.
 *  Kasujemy ja RAZEM ze znacznikiem "wczytana", zeby powrot dociagnal ja tak samo
 *  jak za pierwszym razem - stan i pamiec nie moga sie rozjechac. */
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

/** Id ostatniej wiadomosci rozmowy. Pomija wpisy optymistyczne (id "tmp-..."),
 *  bo serwer takiego identyfikatora nie zna. */
export function lastMessageId(convId) {
  const list = state.msgs[convId] || [];
  for (let i = list.length - 1; i >= 0; i--) if (typeof list[i].id === "number") return list[i].id;
  return undefined;
}

export function actorOnline(actorId) {
  return state.presence.some((p) => p.actorId === actorId && p.online);
}

/** Obecnosc po nazwie, nie po id. Rozmowcy z `others` przychodza z serwera jako
 *  handle/displayName/kind - bez identyfikatorow - a lista rozmow ma pokazywac
 *  kropke obecnosci od pierwszej klatki, jeszcze zanim katalog aktorow dojdzie. */
export function handleOnline(handle) {
  const low = String(handle ?? "").toLowerCase();
  return state.presence.some((p) => p.online && String(p.handle).toLowerCase() === low);
}

// Zwiniete galezie drzewa wiki - pamiec per przegladarka.
export const wikiCollapsed = new Set((() => {
  try { return JSON.parse(localStorage.getItem("atalks_wiki_collapsed") || "[]"); }
  catch { return []; }
})());

export const dmMembersCache = {}; // convId -> [actorId,...] (bez mnie)

/** Rozmowcy rozmowy prywatnej: [{handle, displayName, kind}], bez mnie.
 *
 *  Zrodlem prawdy jest pole `others` z serwera (GET /api/me i /api/conversations) -
 *  dzieki niemu lista rozmow ma nazwy i twarze OD RAZU. Cache po autorach
 *  wiadomosci zostaje jako zapas dla starszego serwera, ktory `others` nie zna;
 *  wczesniej byl jedynym zrodlem, wiec kazda rozmowa prywatna nazywala sie
 *  "Wiadomosc" do czasu, az sie ja otworzylo. */
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
  return c.topic || (c.kind === "group" ? "Rozmowa grupowa" : "Rozmowa prywatna");
}

/** Wiadomosci "w obiegu zgloszen": tylko przy nich ma sens klucz "naprawiłem"
 *  i check "potwierdzam". Serwer nie ma pola "to jest zgloszenie" - jest tylko
 *  slad po czynnosciach (fixedAt/resolvedAt) - wiec jawne wskazanie przez
 *  czlowieka ("Potraktuj jako zgłoszenie") trzymamy tutaj, w pamieci karty.
 *  Bez tego oba przyciski wisialy przy KAZDEJ cudzej wiadomosci, takze w
 *  rozmowie prywatnej o obiedzie, a przypadkowy klik wysylal komus falszywe
 *  zadanie potwierdzenia. */
export const zgloszenia = new Set();

export function czyZgloszenie(m) {
  return !!(m && (m.fixedAt || m.resolvedAt || zgloszenia.has(m.id)));
}

/** Czy moge zarzadzac ta rozmowa (rola admin w kanale albo admin instancji). */
export function canManageActive() {
  const m = state.memberships[state.activeId];
  return !!(state.actor?.isAdmin || (m && m.role === "admin"));
}

/** Wiadomosci widoczne na glownej liscie: te z serwera plus wpisy w locie
 *  (optymistyczne). Odpowiedzi w watkach nie stoja na glownej liscie. */
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

// Ostatnio otwierane rozmowy - pamiec palety przy pustym zapytaniu.
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
