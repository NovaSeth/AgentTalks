/**
 * AgentTalks - sklejka interfejsu. Waniliowe moduly ES, zero bundlera, zero zaleznosci.
 *
 * Ten plik jest KORZENIEM: jako jedyny zna wszystkie widoki naraz. Dzieki temu
 * warstwy nizsze (stan, dane, akcje, strumien zdarzen) nie musza importowac
 * niczego, co rysuje - dostaja funkcje rysujace przez rejestr `widok`, a graf
 * importow zostaje acykliczny.
 *
 * Poza rejestracja widokow siedzi tu tylko to, co z natury jest globalne:
 * powloka aplikacji, start i skroty klawiszowe calego okna.
 */
import {
  ensureActors, loadConversationsList, loadWikiList, markReadDebounced, refreshDigestAndLeases,
  refreshNotifications, refreshPresence, registerPresenceSession, startDigestTimer,
} from "./dane.js";
import { $app, isScrolledToBottom, scrollToBottom, toggleDrawerClass, updateTitleBadge } from "./dom.js";
import { iconBell, iconChat, iconUsers } from "./ikony.js";
import { lastMessageId, rebuildMentionRe, saveDraft, state, zarejestrujWidoki } from "./stan.js";
import { showToast } from "./toasty.js";
import { openSearchPalette } from "./szukaj.js";
import { openUsersView, renderUsersMain, resetUsersError } from "./widok-admin.js";
import {
  bindMessageEvents, closeThread, openConversation, openThread, refreshDetailsData, renderComposer,
  renderDetails, renderMain, renderMessages, renderPresenceBar, renderThread, renderTopbar,
  typingFacesHtml, updateOfflineBar, upsertMessageNode,
} from "./widok-czat.js";
import { maybeOfferPasskey, renderLogin, tryRestoreSession } from "./widok-login.js";
import { openNotificationsView, renderNotificationsMain, showNewsModal } from "./widok-powiadomienia.js";
import { renderSidebar, renderSidebarList, updateConvRow, updatePresenceDots } from "./widok-sidebar.js";
import { openWikiPage, renderWikiMain } from "./widok-wiki.js";
import { connectSSE, ensureSSE } from "./zdarzenia-sse.js";

// ------------------------------------------------------------------ powloka
function render() {
  if (!state.actor) { renderLogin(); return; }
  renderShell();
}

function renderShell() {
  // Icon-rail: staly pasek nawigacji na skrajnej lewej. Trzy MIEJSCA, a nie trzy
  // skroty do tego samego: powiadomienia ("co mnie wolalo"), rozmowy ("gdzie
  // gadamy"), uzytkownicy ("kto ma dostep"). Plakietka przy dzwonku jest jedynym
  // licznikiem, ktory widac bez wchodzenia gdziekolwiek.
  const adminHuman = state.actor?.isAdmin && state.actor?.kind === "human";
  // Panel boczny nalezy do ROZMOW, nie do calej aplikacji: trzyma kanaly, DM-y
  // i drzewo wiki. W powiadomieniach i w kontach nie ma czego z niego wybrac -
  // stal tam tylko dlatego, ze powloka renderowala go bezwarunkowo, i zabieral
  // trzecia szerokosci ekranu na liste, ktora do niczego w tym widoku nie
  // prowadzi (zgloszenie @michal).
  const zPanelem = state.view === "chat" || state.view === "wiki";
  $app.innerHTML = `
    <div class="shell with-rail ${zPanelem ? "" : "bez-panelu"} ${state.drawerOpen ? "drawer" : ""}" id="shell">
      <div class="scrim" id="scrim"></div>
      <nav class="rail" id="rail" aria-label="Główna nawigacja">
        <button class="rail-btn ${state.view === "notifications" ? "on" : ""}" id="rail-notif"
          ${state.view === "notifications" ? `aria-current="page"` : ""}
          aria-label="Powiadomienia${state.notifUnread ? `, ${state.notifUnread} nowych` : ""}"
          title="Powiadomienia: wzmianki, wiadomości prywatne, reakcje, zmiany Twoich stron wiki">
          ${iconBell()}
          <span class="rail-badge ${state.notifUnread ? "" : "off"}" id="rail-badge" aria-hidden="true">${state.notifUnread > 99 ? "99+" : state.notifUnread}</span>
        </button>
        <button class="rail-btn ${state.view === "chat" || state.view === "wiki" ? "on" : ""}" id="rail-chats"
          ${state.view === "chat" || state.view === "wiki" ? `aria-current="page"` : ""}
          aria-label="Rozmowy i wiki" title="Rozmowy i wiki">${iconChat()}</button>
        ${adminHuman ? `
        <button class="rail-btn ${state.view === "users" ? "on" : ""}" id="rail-users"
          ${state.view === "users" ? `aria-current="page"` : ""}
          aria-label="Konta i dostęp" title="Konta i dostęp">${iconUsers()}</button>` : ""}
      </nav>
      ${zPanelem ? `<aside class="sidebar" id="sidebar" aria-label="Kanały, wiadomości i wiki"></aside>` : ""}
      <main class="main" id="main"></main>
    </div>`;
  document.getElementById("scrim").addEventListener("click", () => { state.drawerOpen = false; toggleDrawerClass(); });
  document.getElementById("rail-notif").addEventListener("click", openNotificationsView);
  document.getElementById("rail-chats").addEventListener("click", () => {
    resetUsersError();
    if (state.view === "chat") {
      // Na telefonie szuflada jest jedyna droga do listy, wiec klik ja przelacza.
      // Na desktopie lista jest widoczna zawsze i klik nie robil NIC - a ikona
      // wygladala na klikalna. Przewijamy liste na gore: to jest odpowiednik
      // "wroc na poczatek", ktorego szuka sie w tym miejscu.
      if (window.matchMedia("(max-width:760px)").matches) {
        state.drawerOpen = !state.drawerOpen;
        toggleDrawerClass();
      } else {
        document.getElementById("sb-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    state.view = "chat";
    renderShell();
  });
  const ru = document.getElementById("rail-users");
  if (ru) ru.addEventListener("click", openUsersView);
  if (zPanelem) renderSidebar();
  renderMain();
}

// ------------------------------------------------------- rejestracja widokow
// Jedyne miejsce, w ktorym warstwa danych i akcji "poznaje" widoki. Kazda inna
// droga (import widoku w akcje.js) zamykalaby cykl: widok wola akcje, akcja
// przerysowuje widok.
zarejestrujWidoki({
  render,
  powloka: renderShell,
  glowny: renderMain,
  sidebar: renderSidebarList,
  wiersz: updateConvRow,
  // Obecnosc dotyka czterech miejsc naraz - sklejamy je tutaj, zeby refreshPresence
  // nie musial wiedziec, gdzie sa kropki, pasek, topbar i kuleczki w wiki.
  obecnosc: () => {
    updatePresenceDots();
    renderPresenceBar();
    renderTopbar();
    const wt = document.getElementById("wiki-typing");
    if (wt && state.wiki.slug) wt.innerHTML = typingFacesHtml(`w:${state.wiki.slug}`);
  },
  wiadomosci: renderMessages,
  wiadomosc: upsertMessageNode,
  naDol: scrollToBottom,
  watek: renderThread,
  otworzWatek: openThread,
  pasekOffline: updateOfflineBar,
  composer: renderComposer,
  szczegoly: renderDetails,
  wiki: renderWikiMain,
  powiadomienia: renderNotificationsMain,
  uzytkownicy: renderUsersMain,
  podepnijTresc: bindMessageEvents,
  pisze: typingFacesHtml,
  szczegolyDane: refreshDetailsData,
  otworzRozmowe: openConversation,
  otworzWiki: openWikiPage,
  poZalogowaniu: afterLogin,
});

// ------------------------------------------------------------------- start
// Pierwsze wejscie witalo czlowieka toastem i DWOMA modalami naraz - changelogiem
// wdrozeniowym i propozycja passkeya - zanim zobaczyl jedna wiadomosc. Teraz
// wszystko, co chce czegos od uzytkownika, stoi w kolejce ZA otwarciem pierwszej
// rozmowy, a passkey czeka do drugiego logowania: propozycja "zaloguj sie
// szybciej" ma sens dopiero, gdy wiadomo, ze sie tu wraca.
const LOGOWANIA_KEY = "atalks_logowania";

function policzLogowanie() {
  let n = 0;
  try {
    n = Number(localStorage.getItem(LOGOWANIA_KEY) || "0") + 1;
    localStorage.setItem(LOGOWANIA_KEY, String(n));
  } catch { n = 1; }
  return n;
}

/** Powitania i propozycje po kolei, nie na kupe. Kazdy krok czeka, az poprzedni
 *  zniknie z ekranu - dwa modale naraz to dla uzytkownika jeden nieczytelny stos. */
async function kolejkaPowitan(logowanie) {
  // Krok 1: "Co nowego" - dotyczy tego, co sie zmienilo, wiec idzie pierwsze.
  if (state.news) {
    await new Promise((gotowe) => showNewsModal(state.news, gotowe));
    state.news = null;
  }
  // Krok 2: zasady - tylko przy PIERWSZYM polaczeniu i tylko jako toast
  // z odeslaniem, nie jako sciana tekstu na wejsciu.
  if (state.guidelines) {
    showToast("Witaj. Krótkie „Jak tu rozmawiamy” znajdziesz pod znakiem zapytania w panelu bocznym.");
    state.guidelines = null;
  }
  // Krok 3: passkey - dopiero od drugiego logowania.
  if (logowanie >= 2) await maybeOfferPasskey();
}

async function afterLogin() {
  rebuildMentionRe();
  // Gdy sesje odtworzylo /api/me, mamy juz komplet: rozmowy, liczniki i
  // czlonkostwa. Powtorzenie GET /api/conversations to drugi przebieg tego
  // samego, najdrozszego zapytania agregujacego na kazde wejscie.
  if (!Object.keys(state.memberships).length) await loadConversationsList();
  connectSSE();
  registerPresenceSession();
  refreshPresence();
  loadWikiList();
  // Pierwsze pobranie z pominieciem warunku widocznosci: przy logowaniu
  // uzytkownik na pewno jest przy karcie, a gdy zaraz potem przelaczy sie gdzie
  // indziej, tablica dzierzaw i digest zostalyby puste az do przypadkowego
  // tykniecia zegara przy widocznej karcie.
  refreshDigestAndLeases(true);
  refreshNotifications();
  // Katalog kont jest teraz czescia glownego widoku ("Kto tu jest"), a nie
  // dodatkiem podpowiedzi @ - wiec pobieramy go od razu.
  ensureActors();
  startDigestTimer();
  render();
  updateTitleBadge();
  const logowanie = policzLogowanie();
  // Ostatnio ogladana rozmowa, nie pierwsza nieprzeczytana: auto-otwarcie
  // nieprzeczytanej znaczylo ja jako przeczytana, zanim user zobaczyl licznik.
  const lastId = Number(localStorage.getItem("atalks_last_conv"));
  const last = state.conversations.find((c) => c.id === lastId && state.memberships[c.id]);
  const first = last || state.conversations.find((c) => state.memberships[c.id]) || state.conversations[0];
  if (first) await openConversation(first.id);
  // Dopiero teraz - uzytkownik widzi juz produkt, a nie okna o produkcie.
  kolejkaPowitan(logowanie);
}

(async function boot() {
  const restored = await tryRestoreSession();
  if (restored) { await afterLogin(); return; }
  render();
})();

// ------------------------------------------------------- zdarzenia globalne
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.actor) return;
  ensureSSE();
  // Powrot do karty = dopiero teraz "przeczytane" to, na co user patrzy (i tylko
  // gdy naprawde widzi najnowsze, czyli jest na dole listy).
  if (state.view === "chat" && state.activeId && state.memberships[state.activeId]
      && state.unread[state.activeId] > 0 && isScrolledToBottom()) {
    markReadDebounced(state.activeId, lastMessageId(state.activeId));
  }
});

// Upuszczenie pliku POZA strefa zrzutu nie moze zabrac uzytkownika na plik
// (domyslne zachowanie przegladarki to nawigacja do niego).
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
// Zamkniecie karty nie moze kasowac tego, co uzytkownik wlasnie napisal.
window.addEventListener("beforeunload", () => saveDraft());

document.addEventListener("keydown", (e) => {
  if (!state.actor) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearchPalette();
    return;
  }
  if (e.key !== "Escape") return;
  // Modale, lightbox i paleta maja wlasna obsluge Escape - tu domykamy warstwy,
  // ktore nie sa oknami: szuflade, watek i panel szczegolow.
  if (document.querySelector(".overlay")) return;
  if (state.drawerOpen) {
    state.drawerOpen = false;
    toggleDrawerClass();
    document.getElementById("btn-menu")?.focus();
  } else if (state.threadOpen) {
    closeThread();
  } else if (state.detailsOpen) {
    state.detailsOpen = false;
    renderMain();
    document.getElementById("btn-details")?.focus();
  }
});
