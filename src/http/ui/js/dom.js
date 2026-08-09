/**
 * Helpery DOM: ucieczka HTML, awatary, formaty czasu, okno modalne, szuflada.
 */
import { iconMenu } from "./ikony.js";
import { avatarUrl, state } from "./stan.js";

export const $app = document.getElementById("app");

// Wersja zaladowanego UI - czytana z adresu WLASNEGO modulu (?v=...), wiec mowi
// o pliku, ktory faktycznie sie wykonuje, a nie o tym, co serwer ma na dysku.
// W module nie ma document.currentScript (jest null), za to jest import.meta.url.
export const UI_STAMP = (() => {
  const m = import.meta.url.match(/[?&]v=([a-f0-9]+)/);
  return m ? m[1] : "";
})();

// ---------------------------------------------------------------- pomocnicze
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// Preferencja "mniej ruchu" czytana raz: samo CSS nie wylaczy scrollTo({behavior})
// ani scrollIntoView, bo one nie sa animacja CSS tylko wywolaniem API.
const RUCH_OGRANICZONY = window.matchMedia("(prefers-reduced-motion: reduce)");

export const zachowanieScrolla = (smooth) => (smooth && !RUCH_OGRANICZONY.matches ? "smooth" : "auto");

/** Jedyny region "na zywo" w aplikacji (#live). Oglaszamy NOWOSC, a nie cala
 *  przerysowana galaz - dlatego tekst skladamy recznie, zamiast opakowywac
 *  aria-live wokol kontenera, ktory przy kazdym renderze wymienia sie w calosci. */
export function announce(text) {
  const el = document.getElementById("live");
  if (el) el.textContent = String(text ?? "");
}

/** Licznik nieprzeczytanych w tytule karty. To jedyny (obok powiadomien systemowych)
 *  sygnal, ktory dziala, gdy karta jest w tle - a tam jest przez wiekszosc czasu.
 *
 *  Liczymy WIADOMOSCI, nie powiadomienia: kazda wzmianka i kazdy DM ma i wiersz
 *  nieprzeczytanych, i powiadomienie, wiec proste `unread + notifUnread` liczylo
 *  te sama rzecz dwa razy i tytul przeczyl plakietkom w panelu bocznym. Doliczamy
 *  tylko te powiadomienia, ktore NIE maja odpowiednika w licznikach rozmow -
 *  czyli zmiany stron wiki. */
export function updateTitleBadge() {
  const rozmowy = Object.values(state.unread).reduce((n, v) => n + (v || 0), 0);
  const wiki = (state.notifications || []).filter((n) => !n.readAt && n.wikiSlug).length;
  const suma = rozmowy + wiki;
  document.title = suma > 0 ? `(${suma > 99 ? "99+" : suma}) AgentTalks` : "AgentTalks";
}

const PALETTE = ["#3b5ce0", "#ff6b3d", "#1fae7a", "#a45ee5", "#e0466b", "#0ea5c4", "#c98a1f", "#5c6bc0"];

function colorFor(handle) {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(nameOrHandle) {
  const s = String(nameOrHandle ?? "?").replace(/^@/, "");
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export function avatarHtml(handle, size) {
  const c = colorFor(handle || "?");
  // Male awatary: proporcjonalnie mniejsze inicjaly i lzejszy krój (klasa sm).
  const style = size ? `width:${size}px;height:${size}px;font-size:${Math.max(7, Math.round(size * 0.36))}px` : "";
  const cls = size && size <= 28 ? "av sm" : "av";
  // Obrazek, gdy aktor go ma; inicjaly, gdy nie ma. Znikniecie pliku ma dac kropke,
  // a nie pusta ramke z ikona zepsutego obrazka - to samo miejsce, ten sam rozmiar,
  // zadnego przeskoku ukladu.
  //
  // Dane do zastepstwa ida w atrybutach `data-`, a nie w kodzie `onerror`.
  // Pierwsza wersja sklejala tam JavaScript z inicjalami przepuszczonymi przez
  // escapeHtml - a to NIE chroni w tym miejscu: przegladarka najpierw odkodowuje
  // encje atrybutu, a dopiero potem czyta jego tresc jako kod, wiec `&#39;` wraca
  // jako apostrof i zamyka literal. Dzis handle jest walidowany do [a-z0-9._-],
  // wiec nie da sie tego wykorzystac - ale zabezpieczenie, ktore trzyma sie na
  // walidacji w innym pliku, przestaje istniec przy pierwszym nowym miejscu
  // wywolania. Atrybut `data-` + textContent nie ma tej klasy w ogole.
  const url = avatarUrl(handle);
  if (url) {
    return `<img class="${cls} avimg" src="${escapeHtml(url)}" alt="" loading="lazy"` +
      ` style="${style}" data-ini="${escapeHtml(initials(handle))}" data-bg="${escapeHtml(c)}">`;
  }
  return `<div class="${cls}" style="background:${c};${style}">${escapeHtml(initials(handle))}</div>`;
}

// Zdarzenie `error` obrazka NIE bakieluje, wiec nasluch musi byc w fazie
// przechwytywania - i wystarczy JEDEN na dokument, bo listy przerysowuja sie
// przez innerHTML i podpinanie po kazdym renderze gubiloby sie przy pierwszym
// zapomnianym miejscu.
document.addEventListener("error", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement) || !el.classList.contains("avimg")) return;
  const kropka = document.createElement("div");
  kropka.className = el.className.replace(/\bavimg\b/, "").trim();
  kropka.setAttribute("style", el.getAttribute("style") || "");
  kropka.style.background = el.dataset.bg || "";
  kropka.textContent = el.dataset.ini || "";
  el.replaceWith(kropka);
}, true);

export function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" }) + ", " +
    d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

export function dayKey(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function dayLabel(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Dzisiaj";
  if (sameDay(d, y)) return "Wczoraj";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

export function timeAgo(ts) {
  if (!ts) return "dawno temu";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 90) return "przed chwila";
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  if (s < 86400) return `${Math.floor(s / 3600)} godz. temu`;
  return `${Math.floor(s / 86400)} dni temu`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const IMG_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

// ------------------------------------------------------------------- modale
// JEDNA implementacja okna modalnego dla calego UI. Powod: okno bez pulapki
// fokusu wyglada jak modal, ale nim nie jest - Tab wychodzi na strone pod
// spodem, Escape nie dziala, a po zamknieciu fokus laduje na <body>, czyli
// uzytkownik klawiatury zaczyna nawigacje od poczatku dokumentu.
const FOKUSOWALNE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** @param html tresc modala; naglowek powinien miec id="m-title" (aria-labelledby).
 *  @param opts.trwaly okno, ktorego NIE da sie zamknac Escapem ani klikiem w tlo.
 *         Zarezerwowane dla tresci pokazywanej raz i nie do odzyskania (kod
 *         zaproszenia): odruchowy Escape kosztowal tam cala czynnosc od nowa. */
export function openModal(html, opts = {}) {
  const wrocDo = document.activeElement;
  const ov = document.createElement("div");
  ov.className = `overlay ${opts.overlayClass ?? ""}`.trim();
  ov.innerHTML = `<div class="modal ${opts.modalClass ?? ""}" role="dialog" aria-modal="true"
    aria-labelledby="m-title" ${opts.style ? `style="${opts.style}"` : ""}>${html}</div>`;
  document.body.appendChild(ov);

  const onKey = (e) => {
    if (e.key === "Escape" && !ov.dataset.trwaly) { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...ov.querySelectorAll(FOKUSOWALNE)].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  function close() {
    document.removeEventListener("keydown", onKey, true);
    ov.remove();
    // Fokus wraca tam, skad przyszedl - inaczej po zamknieciu okna czytnik
    // ekranu zaczyna od poczatku strony, a nie od przycisku, ktory je otworzyl.
    if (wrocDo && document.contains(wrocDo)) wrocDo.focus();
  }
  document.addEventListener("keydown", onKey, true);
  ov.addEventListener("click", (e) => { if (e.target === ov && !ov.dataset.trwaly) close(); });
  const modal = ov.querySelector(".modal");
  if (opts.trwaly) ov.dataset.trwaly = "1";
  // Fokus na pierwszym polu, a gdy okno jest samym komunikatem - na oknie.
  const firstField = modal.querySelector('input:not([type="hidden"]),textarea,select,button');
  if (firstField) firstField.focus();
  else { modal.tabIndex = -1; modal.focus(); }
  // Zamiana okna w "nie do zgubienia" po jego otwarciu: kod zaproszenia powstaje
  // dopiero po kliknieciu "Utwórz", czyli juz w otwartym oknie.
  return {
    overlay: ov,
    modal,
    close,
    zablokujZamykanie: () => { ov.dataset.trwaly = "1"; },
  };
}

/** Potwierdzenie nieodwracalnej czynnosci. Systemowy `confirm()` mowil wszedzie
 *  "OK / Anuluj" - to samo przy skasowaniu jednej wiadomosci i przy skasowaniu
 *  dzialu wiki razem z historia. Tutaj przycisk NAZYWA czynnosc, a wersja
 *  `danger` odroznia wage kolorem, wiec da sie odczytac, na co sie zgadzasz,
 *  nie czytajac calego zdania.
 *  @returns Promise<boolean> */
export function confirmModal({ title, body, ok = "Tak, zrób to", cancel = "Anuluj", danger = false }) {
  return new Promise((resolve) => {
    const { modal, close } = openModal(`
      <h2 id="m-title">${escapeHtml(title)}</h2>
      ${body ? `<p class="mhint">${escapeHtml(body)}</p>` : ""}
      <div class="row">
        <button class="btn ghost" id="cf-no">${escapeHtml(cancel)}</button>
        <button class="btn ${danger ? "danger" : ""}" id="cf-yes">${escapeHtml(ok)}</button>
      </div>`);
    let odpowiedziano = false;
    const zakoncz = (v) => { if (odpowiedziano) return; odpowiedziano = true; resolve(v); };
    // Escape i klik w tlo znacza "nie" - a bez tego obietnica nigdy by sie nie
    // rozwiazala i wywolujacy czekalby w nieskonczonosc.
    modal.closest(".overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) zakoncz(false); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key !== "Escape") return;
      document.removeEventListener("keydown", esc, true);
      zakoncz(false);
    }, true);
    modal.querySelector("#cf-no").addEventListener("click", () => { close(); zakoncz(false); });
    modal.querySelector("#cf-yes").addEventListener("click", () => { close(); zakoncz(true); });
    // Fokus na wyjsciu, nie na czynnosci: Enter odruchowo nacisniety w oknie
    // ostrzegajacym nie moze potwierdzac kasowania.
    modal.querySelector("#cf-no").focus();
  });
}

export function toggleDrawerClass() {
  const shell = document.getElementById("shell");
  if (shell) shell.classList.toggle("drawer", state.drawerOpen);
  const sb = document.getElementById("sidebar");
  const mobile = window.matchMedia("(max-width:760px)").matches;
  // Transform wypycha szuflade poza ekran, ale NIE usuwa jej z kolejnosci Tab
  // ani z drzewa dostepnosci: bez `inert` uzytkownik klawiatury wpadal
  // w niewidoczna liste kanalow i nie mial jak z niej wyjsc.
  if (sb) sb.inert = mobile && !state.drawerOpen;
  const menu = document.getElementById("btn-menu");
  if (menu) menu.setAttribute("aria-expanded", String(!!state.drawerOpen));
  if (mobile && state.drawerOpen && sb) sb.querySelector("button")?.focus();
}

/** Ile zostalo dzierzawie - tekst odswiezany razem z sidebar (poll 30 s). */
export function leaseCountdown(expiresAt) {
  const s = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  if (s >= 60) return `${Math.floor(s / 60)} min`;
  return `${s} s`;
}

// ------------------------------------------------------- czesci wspolne widokow
// Hamburger jest w czterech widokach i wszedzie steruje ta sama szuflada -
// wiec i nazwa dostepna, i aria-expanded maja byc w jednym miejscu.
export const hamburgerHtml = () => `<button class="iconbtn hamburger" id="btn-menu" aria-label="Lista rozmów"
  aria-expanded="${state.drawerOpen}" aria-controls="sidebar" title="Lista rozmów">${iconMenu()}</button>`;

/** Pusty stan mowi, CO TU ZROBIC, a nie tylko "brak". Trzeci argument to
 *  opcjonalny przycisk {id, label} - podpiecie zostaje po stronie widoku,
 *  bo to on wie, co ma sie stac. */
export function emptyStateHtml(iconHtml, title, sub, akcja) {
  return `<div class="empty"><div class="big">${iconHtml}</div><h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(sub)}</p>
    ${akcja ? `<button class="btn slim" id="${akcja.id}">${escapeHtml(akcja.label)}</button>` : ""}</div>`;
}

/** Pusta sekcja panelu bocznego: jedno zdanie i, gdy jest co zrobic, przycisk. */
export function sidebarEmptyHtml(text, akcja) {
  return `<div class="sb-empty">${escapeHtml(text)}
    ${akcja ? `<button class="sb-cta" id="${akcja.id}">${escapeHtml(akcja.label)}</button>` : ""}</div>`;
}

export function skeletonHtml() {
  return Array.from({ length: 5 }).map(() => `
    <div class="skeleton"><div class="sk-line w40"></div><div class="sk-line w80"></div></div>`).join("");
}

// ------------------------------------------------- pozycja czytania na liscie
export function isScrolledToBottom() {
  const el = document.getElementById("messages");
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

export function scrollToBottom(smooth) {
  const el = document.getElementById("messages");
  if (!el) return;
  // Preferencja "mniej ruchu" musi byc uszanowana takze tutaj: scrollTo nie jest
  // animacja CSS, wiec zadna regula @media by go nie zatrzymala.
  el.scrollTo({ top: el.scrollHeight, behavior: zachowanieScrolla(smooth) });
}

/** Pill "nowe ponizej": widoczny, gdy nie jestes na dole; klik przewija do
 *  najnowszej. Licznik rosnie od wiadomosci, ktore przyszly poza polem widzenia. */
export function updateJumpPill() {
  const pill = document.getElementById("jump-newest");
  if (!pill) return;
  const atBottom = isScrolledToBottom();
  if (atBottom) { state.newBelow = 0; pill.classList.remove("show"); return; }
  pill.classList.add("show");
  const label = pill.querySelector(".jn-label");
  if (label) label.textContent = state.newBelow > 0
    ? `${state.newBelow} ${state.newBelow === 1 ? "nowa wiadomość" : "nowe wiadomości"}`
    : "Najnowsze";
  pill.classList.toggle("hascount", state.newBelow > 0);
}
