/**
 * Centrum powiadomien i zgoda na powiadomienia systemowe.
 */
import { api } from "./api.js";
import { refreshNotifications } from "./dane.js";
import { emptyStateHtml, escapeHtml, fmtDateTime, hamburgerHtml, openModal, toggleDrawerClass } from "./dom.js";
import { iconBell, iconChat, iconDoc, iconWrench } from "./ikony.js";
import { mdToHtml } from "./markdown.js";
import { dmLabel, state, widok } from "./stan.js";
import { showError, showToast } from "./toasty.js";
import { openWikiPage } from "./widok-wiki.js";

/** Prosba o zgode na powiadomienia. Wolana z centrum powiadomien - czyli w
 *  miejscu, w ktorym uzytkownik sam mysli o tym, jak chce byc wolany. */
// Jedno miejsce na "co mnie dotyczy": zawolania po nazwie, wiadomosci prywatne,
// reakcje na moje wpisy i zmiany stron, ktore wspoltworzylem. Kazdy wiersz ma
// CEL - klikniecie prowadzi tam, gdzie rzecz sie stala, a nie w okolice.
async function askNotificationPermission() {
  if (!("Notification" in window)) { showToast("Ta przeglądarka nie umie powiadomień systemowych."); return; }
  if (Notification.permission === "granted") { showToast("Powiadomienia są już włączone."); return; }
  if (Notification.permission === "denied") {
    showToast("Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony.", { alert: true });
    return;
  }
  const perm = await Notification.requestPermission();
  showToast(perm === "granted" ? "Powiadomienia włączone." : "Bez powiadomień - licznik zostaje w tytule karty.");
  renderNotificationsMain();
}

/** Modal "Co nowego": lista swiezych mozliwosci, pokazywana raz po zmianie.
 *  Tresc przychodzi z serwera (NEWS.md) i jest juz oznaczona jako dostarczona.
 *  @param poZamknieciu wolane, gdy okno zniknie - powitania stoja w kolejce,
 *         wiec kolejne moze ruszyc dopiero, gdy to zwolni ekran. */
export function showNewsModal(news, poZamknieciu) {
  const { modal, close } = openModal(`
      <h2 id="m-title">Co nowego</h2>
      <div class="md news-body">${mdToHtml(news.text, "page", state.actor.handle)}</div>
      <div class="row"><button class="btn" id="news-ok">Jasne, dzięki</button></div>`,
  { modalClass: "wide news-modal" });
  let zamkniete = false;
  const koniec = () => { if (zamkniete) return; zamkniete = true; poZamknieciu?.(); };
  modal.querySelector("#news-ok").addEventListener("click", () => { close(); koniec(); });
  // Escape i klik w tlo zamykaja okno z pominieciem naszego przycisku - bez tego
  // kolejka powitan zatrzymywalaby sie na zawsze.
  modal.closest(".overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) koniec(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key !== "Escape") return;
    document.removeEventListener("keydown", esc, true);
    koniec();
  }, true);
}

export async function openNotificationsView() {
  state.view = "notifications";
  state.drawerOpen = false;
  widok.powloka();
  widok.glowny();
  toggleDrawerClass();
  await refreshNotifications();
  renderNotificationsMain();
}

// Kazdy rodzaj ma WLASNE zdanie. Zgloszenie domkniete przez kogos innego
// przychodzilo dotad jako `mention` i mowilo "zawołał(a) Cię" - czyli
// powiadomienie klamalo o tym, co sie stalo, i kazalo szukac wzmianki, ktorej
// nie bylo. Serwer wysyla je teraz jako `fix`.
const NOTIF_OPIS = {
  mention: "zawołał(a) Cię",
  dm: "napisał(a) prywatnie",
  reaction: "zareagował(a) na Twój wpis",
  wiki: "zmienił(a) stronę, którą współtworzysz",
  fix: "naprawił(a) to, co zgłosiłeś - potwierdź, czy objaw zniknął",
};

function notifIcon(kind) {
  if (kind === "wiki") return iconDoc();
  if (kind === "reaction") return "🙂";
  if (kind === "dm") return iconChat();
  if (kind === "fix") return iconWrench();
  return "@";
}

/** Nazwa miejsca, do ktorego prowadzi powiadomienie - zeby wiersz dalo sie
 *  zrozumiec bez klikania ("#bugs" mowi wiecej niz "rozmowa 2"). */
function notifTarget(n) {
  if (n.wikiSlug) {
    const page = state.wiki.pages.find((p) => p.slug === n.wikiSlug);
    return page ? (page.title || page.slug) : n.wikiSlug;
  }
  const c = state.conversations.find((x) => x.id === n.conversationId);
  if (!c) return "";
  return (c.kind === "dm" || c.kind === "group") ? dmLabel(c) : `#${c.slug || c.id}`;
}

export function renderNotificationsMain() {
  const el = document.getElementById("main");
  if (!el) return;
  const list = state.notifications;
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title"><div class="t">${iconBell()} Powiadomienia</div>
        <div class="topic">${state.notifUnread ? `${state.notifUnread} nowych` : "nic nieprzeczytanego"}</div></div>
      ${("Notification" in window) && Notification.permission !== "granted"
        ? `<button class="pillbtn" id="btn-notif-perm">Włącz powiadomienia systemowe</button>` : ""}
      <button class="btn ghost" id="btn-notif-read" ${state.notifUnread ? "" : "disabled"}>Oznacz wszystkie jako przeczytane</button>
    </div>
    <div class="notif-list viewfade" id="notif-list">
      ${list.length
        ? list.map((n) => `
        <button class="notif ${n.readAt ? "" : "fresh"}" data-notif="${n.id}">
          <span class="ni">${notifIcon(n.kind)}</span>
          <span class="nb">
            <span class="nh"><b>@${escapeHtml(n.from ?? "?")}</b> ${NOTIF_OPIS[n.kind] || "zrobił(a) coś, co Cię dotyczy - otwórz, żeby zobaczyć"}
              ${notifTarget(n) ? `<span class="nw">${escapeHtml(notifTarget(n))}</span>` : ""}</span>
            ${n.excerpt ? `<span class="nx">${escapeHtml(n.excerpt)}</span>` : ""}
          </span>
          <span class="nt">${fmtDateTime(n.createdAt)}</span>
        </button>`).join("")
        : emptyStateHtml(iconBell(2.4), "Nic nowego",
          "Tu trafia to, co dotyczy Ciebie osobiście: zawołania po nazwie, rozmowy prywatne, reakcje na Twoje wpisy i zmiany stron wiki, które współtworzysz.",
          { id: "notif-go-chat", label: "Wróć do rozmów" })}
    </div>`;
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  const perm = document.getElementById("btn-notif-perm");
  // O zgode pytamy TUTAJ, czyli w miejscu, w ktorym uzytkownik sam mysli o tym,
  // jak chce byc wolany - a nie odruchowo na starcie, gdzie odmowa jest trwala.
  if (perm) perm.addEventListener("click", askNotificationPermission);
  const rb = document.getElementById("btn-notif-read");
  if (rb) rb.addEventListener("click", async () => {
    rb.disabled = true;
    try {
      await api("POST", "/api/notifications/read", {});
      await refreshNotifications();
    } catch (e) { showError(e); }
  });
  el.querySelector("#notif-go-chat")?.addEventListener("click", () => {
    state.view = "chat"; widok.powloka();
  });
  el.querySelectorAll("[data-notif]").forEach((b) =>
    b.addEventListener("click", () => openNotification(Number(b.dataset.notif))));
}

/** Klikniecie: odhacz TO powiadomienie i przejdz do miejsca zdarzenia. */
async function openNotification(id) {
  const n = state.notifications.find((x) => x.id === id);
  if (!n) return;
  if (!n.readAt) {
    api("POST", "/api/notifications/read", { ids: [id] })
      .then(() => refreshNotifications())
      .catch(() => {});
  }
  if (n.wikiSlug) { openWikiPage(n.wikiSlug); return; }
  if (n.conversationId) widok.otworzRozmowe(n.conversationId, n.messageId ?? undefined);
}
