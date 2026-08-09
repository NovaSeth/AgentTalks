/**
 * Panel boczny: kanaly, wiadomosci, drzewo wiki, dzierzawy, digest.
 */
import { api } from "./api.js";
import { UI_STAMP, escapeHtml, leaseCountdown, openModal } from "./dom.js";
import { iconChevron, iconDigest, iconDoc, iconInfo, iconLock, iconOut, iconSearch } from "./ikony.js";
import { mdToHtml } from "./markdown.js";
import { actorHandle, actorOnline, dmLabel, dmMembersCache, state, wikiCollapsed } from "./stan.js";
import { openSearchPalette } from "./szukaj.js";
import { showToast } from "./toasty.js";
import { openConversation, openNewConversationModal, openQuestionsPanel } from "./widok-czat.js";
import { doLogout } from "./widok-login.js";
import { newWikiPageModal, openWikiPage } from "./widok-wiki.js";

// ------------------------------------------------------------- sidebar
export function renderSidebar() {
  const el = document.getElementById("sidebar");
  el.innerHTML = `
    <div class="sb-head">
      <div class="who">
        <div class="me"><span class="dot"></span><span class="mename">@${escapeHtml(state.actor.handle)}</span></div>
      </div>
      <button class="iconbtn" id="btn-search" aria-label="Szukaj i przełącz rozmowę (Cmd+K)" title="Szukaj (Cmd+K)">${iconSearch()}</button>
      <button class="iconbtn" id="btn-guidelines" aria-label="Zasady kanału" title="Zasady kanału">${iconInfo()}</button>
      <button class="iconbtn" id="btn-logout" aria-label="Wyloguj" title="Wyloguj">${iconOut()}</button>
    </div>
    <div class="sb-scroll" id="sb-scroll"></div>
    <div class="sb-foot" id="sb-foot">
      <span class="sb-net" id="sb-net" hidden></span>
      <span id="sb-ui" title="Wersja interfejsu, ktory wlasnie masz zaladowany. Jesli po wdrozeniu sie nie zmienila, to Twoja przegladarka trzyma stara kopie (odswiez z pominieciem cache)."></span>
    </div>`;
  document.getElementById("btn-logout").addEventListener("click", doLogout);
  document.getElementById("btn-guidelines").addEventListener("click", showGuidelines);
  document.getElementById("btn-search").addEventListener("click", openSearchPalette);
  // Wersja UI: to, co widzi uzytkownik, kontra to, co wysyla serwer. Rozjazd
  // znaczy cache po drodze - i to jest jedyny sposob, zeby to zobaczyc.
  const foot = document.getElementById("sb-ui");
  if (foot) {
    foot.textContent = `UI ${UI_STAMP || "?"}`;
    api("GET", "/api/ui-version").then((v) => {
      if (!v.stamp) return;
      foot.textContent = `UI ${UI_STAMP || "?"}`;
      if (UI_STAMP && v.stamp !== UI_STAMP) {
        foot.textContent = `UI ${UI_STAMP} - serwer ma ${v.stamp}`;
        foot.classList.add("stale");
        foot.title = "Masz starszy interfejs niz serwer. Odswiez strone z pominieciem cache.";
      }
    }).catch(() => {});
  }
  // Stan strumienia zdarzen odtwarzamy po kazdej przebudowie panelu - inaczej
  // po przerysowaniu sidebara "offline" znikaloby mimo zerwanego polaczenia.
  const net = document.getElementById("sb-net");
  if (net) { net.hidden = state.online; net.textContent = state.online ? "" : "offline - próbuję połączyć..."; }
  renderSidebarList();
}

/** Punktowa aktualizacja JEDNEGO wiersza: pogrubienie i plakietka. Lista
 *  nawigacyjna musi byc nieruchomym punktem odniesienia - gdy przy kazdej
 *  wiadomosci przebudowuje sie w calosci, uzytkownik klika nie w to, w co celowal. */
export function updateConvRow(convId) {
  const row = document.querySelector(`#sb-scroll [data-open="${convId}"]`);
  if (!row) return;
  const unread = state.unread[convId] || 0;
  row.classList.toggle("unread", unread > 0);
  const nazwa = row.querySelector(".nm")?.textContent ?? "";
  row.setAttribute("aria-label", `${nazwa}${unread ? `, ${unread} nieprzeczytanych` : ""}`);
  let badge = row.querySelector(".badge");
  if (!unread) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "badge";
    badge.setAttribute("aria-hidden", "true");
    row.appendChild(badge);
  }
  badge.classList.toggle("soft", (state.unreadBadge[convId] || 0) === 0);
  badge.textContent = unread > 99 ? "99+" : String(unread);
}

/** Kropki obecnosci - jedyne, co zmienia w sidebarze heartbeat sesji co 30 s. */
export function updatePresenceDots() {
  for (const row of document.querySelectorAll("#sb-scroll [data-open]")) {
    const dot = row.querySelector(".ppresence");
    if (!dot) continue;
    const ids = dmMembersCache[Number(row.dataset.open)];
    const other = ids && ids[0];
    dot.classList.toggle("on", other != null && actorOnline(other));
  }
}

export function renderSidebarList() {
  const el = document.getElementById("sb-scroll");
  if (!el) return;
  // Kontener sam sie przewija: bez zapamietania pozycji kazda przebudowa
  // wyrzucalaby liste na gore pod kursorem uzytkownika.
  const scrollTop = el.scrollTop;
  const mine = state.conversations.filter((c) => state.memberships[c.id]);
  const channels = mine.filter((c) => c.kind === "public" || c.kind === "private");
  const directs = mine.filter((c) => c.kind === "dm" || c.kind === "group");
  const discoverable = state.conversations.filter((c) => !state.memberships[c.id] && c.kind === "public");
  const openCount = Object.keys(state.openQuestions).length;

  const row = (c) => {
    const active = state.view === "chat" && c.id === state.activeId;
    const unread = state.unread[c.id] || 0;
    const isDirect = c.kind === "dm" || c.kind === "group";
    const label = isDirect ? dmLabel(c) : (c.slug || c.topic || "bez-nazwy");
    const other = isDirect ? (dmMembersCache[c.id] && dmMembersCache[c.id][0]) : null;
    const online = other != null && actorOnline(other);
    const pre = isDirect ? `<span class="ppresence ${online ? "on" : ""}"></span>`
      : c.kind === "private" ? `<span class="pre">${iconLock()}</span>` : `<span class="pre">#</span>`;
    return `
      <button class="conv ${active ? "active" : ""} ${unread ? "unread" : ""}" data-open="${c.id}"
        ${active ? `aria-current="page"` : ""}
        aria-label="${escapeHtml(label)}${unread ? `, ${unread} nieprzeczytanych` : ""}">
        ${pre}
        <span class="nm">${escapeHtml(label)}</span>
        ${unread ? `<span class="badge ${(state.unreadBadge[c.id] || 0) > 0 ? "" : "soft"}" aria-hidden="true">${unread > 99 ? "99+" : unread}</span>` : ""}
      </button>`;
  };

  // Wiki jest drzewem: strona-rodzic gra role katalogu. Zwiniete galezie
  // pamietamy per przegladarka; badge na zwinietym rodzicu sumuje poddrzewo.
  const wikiTreeHtml = () => {
    const pages = state.wiki.pages;
    if (!pages.length) return `<div class="sb-empty">jeszcze pusto</div>`;
    const bySlug = new Set(pages.map((p) => p.slug));
    const kids = new Map();
    for (const p of pages) {
      const key = p.parentSlug && bySlug.has(p.parentSlug) ? p.parentSlug : "";
      if (!kids.has(key)) kids.set(key, []);
      kids.get(key).push(p);
    }
    for (const list of kids.values()) {
      list.sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug, "pl"));
    }
    const subtreeUnseen = (slug) => (kids.get(slug) || [])
      .reduce((n, c) => n + (c.unseen || 0) + subtreeUnseen(c.slug), 0);
    // Chevron jest RODZENSTWEM wiersza, nie elementem w jego srodku: przycisk
    // w przycisku jest niedozwolony w HTML, nie da sie go dosiegnac Tabem
    // (Enter na wierszu zawsze otwieral strone), a cel dotykowy 16 px lezacy
    // wewnatrz innego celu nie ratuje sie nawet wyjatkiem odstepu z WCAG 2.5.8.
    const row = (p, depth) => {
      const active = state.view === "wiki" && state.wiki.slug === p.slug;
      const hasKids = kids.has(p.slug);
      const closed = hasKids && wikiCollapsed.has(p.slug);
      const unseen = (p.unseen || 0) + (closed ? subtreeUnseen(p.slug) : 0);
      const title = escapeHtml(p.title || p.slug);
      return `
      <div class="conv-row" style="padding-left:${(0.15 + depth * 0.85).toFixed(2)}rem">
        ${hasKids
          ? `<button class="twist ${closed ? "closed" : ""}" data-wikitwist="${escapeHtml(p.slug)}"
               aria-expanded="${closed ? "false" : "true"}" aria-label="${closed ? "Rozwiń" : "Zwiń"} ${title}">${iconChevron()}</button>`
          : `<span class="pre" aria-hidden="true">${iconDoc()}</span>`}
        <button class="conv ${active ? "active" : ""}" data-wikipage="${escapeHtml(p.slug)}"
          ${active ? `aria-current="page"` : ""}
          aria-label="${title}${unseen ? `, ${unseen} zmian` : ""}">
          <span class="nm">${title}</span>
          ${unseen ? `<span class="badge soft" aria-hidden="true">${unseen > 99 ? "99+" : unseen}</span>` : ""}
        </button>
      </div>
      ${hasKids && !closed ? level(p.slug, depth + 1) : ""}`;
    };
    const level = (key, depth) => (kids.get(key) || []).map((p) => row(p, depth)).join("");
    return level("", 0);
  };

  // Przyciski "+" niosly nazwe dostepna "+" (tresc wygrywa z title), stad
  // aria-label na przycisku i aria-hidden na samym znaku.
  const plus = (kind, label) =>
    `<button data-new="${kind}" aria-label="${label}" title="${label}"><span aria-hidden="true">+</span></button>`;
  el.innerHTML = `
    <div class="sb-group">
      <h3>Kanały ${plus("channel", "Nowy kanał")}</h3>
      ${channels.map(row).join("") || `<div class="sb-empty">brak</div>`}
    </div>
    <div class="sb-group">
      <h3>Wiadomości ${plus("dm", "Nowa wiadomość")}</h3>
      ${directs.map(row).join("") || `<div class="sb-empty">brak</div>`}
    </div>
    <div class="sb-group">
      <h3>Wiki ${plus("wiki", "Nowa strona")}</h3>
      ${wikiTreeHtml()}
    </div>
    ${openCount ? `
    <div class="sb-group">
      <h3>Do podjęcia</h3>
      <button class="conv qcount" id="btn-questions">
        <span class="pre">?</span><span class="nm">Otwarte pytania</span>
        <span class="badge coral">${openCount}</span>
      </button>
    </div>` : ""}
    ${state.digest && state.digest.count > 0 ? `
    <div class="sb-group">
      <button class="conv" id="btn-digest">
        <span class="pre">${iconDigest()}</span><span class="nm">Co Cię ominęło</span>
        <span class="badge soft">${state.digest.count > 99 ? "99+" : state.digest.count}</span>
      </button>
    </div>` : ""}
    ${state.leases.length ? `
    <div class="sb-group">
      <h3 title="Dzierżawy: agent przed dotknięciem wspólnego zasobu (np. deployu) rezerwuje go na czas pracy (atalk claim / talk_claim). Inni dostaną odmowę, dopóki blokada nie wygaśnie.">Zajęte zasoby</h3>
      ${state.leases.map((l) => `
      <div class="lease-row" title="Zasób &quot;${escapeHtml(l.resource)}&quot; zajęty przez @${escapeHtml(l.handle)}${l.note ? ` - ${escapeHtml(l.note)}` : ""}. Blokada puści za ${leaseCountdown(l.expiresAt)} (albo gdy właściciel zwolni).">
        <span class="pre">${iconLock()}</span>
        <span class="nm"><b>${escapeHtml(l.resource)}</b> · @${escapeHtml(l.handle)}</span>
        <span class="lease-ttl">${leaseCountdown(l.expiresAt)}</span>
      </div>`).join("")}
    </div>` : ""}
    ${discoverable.length ? `<div class="sb-group"><h3>Do odkrycia</h3>${discoverable.map(row).join("")}</div>` : ""}
  `;
  el.scrollTop = scrollTop;
  el.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => openConversation(Number(b.dataset.open))));
  el.querySelectorAll("[data-wikipage]").forEach((b) =>
    b.addEventListener("click", () => openWikiPage(b.dataset.wikipage)));
  // Chevron jest osobnym przyciskiem obok wiersza, wiec stopPropagation nie jest
  // juz potrzebny - klik nie ma czego "przebijac".
  el.querySelectorAll("[data-wikitwist]").forEach((t) =>
    t.addEventListener("click", () => {
      const slug = t.dataset.wikitwist;
      if (wikiCollapsed.has(slug)) wikiCollapsed.delete(slug); else wikiCollapsed.add(slug);
      try { localStorage.setItem("atalks_wiki_collapsed", JSON.stringify([...wikiCollapsed])); } catch { /* ok */ }
      renderSidebarList();
    }));
  el.querySelectorAll("[data-new]").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.new === "wiki") newWikiPageModal();
      else openNewConversationModal(b.dataset.new);
    }));
  const qb = el.querySelector("#btn-questions");
  if (qb) qb.addEventListener("click", openQuestionsPanel);
  const dg = el.querySelector("#btn-digest");
  if (dg) dg.addEventListener("click", openDigestModal);
}

/** Modal "Co Cie ominelo": rozmowy i autorzy od ostatniej wizyty, wzmianki
 *  ze skokiem do wiadomosci, otwarte pytania. */
async function openDigestModal() {
  // Sidebar potrzebuje z digestu JEDNEJ liczby; komplet (wzmianki, otwarte
  // pytania z pelnymi trescia) pobieramy dopiero tutaj, czyli wtedy, gdy jest
  // naprawde ogladany - a nie co 30 s w tle.
  let d = state.digest;
  if (!d || !Array.isArray(d.byConversation)) {
    try { d = (await api("GET", "/api/digest")).digest; }
    catch (e) { showToast(e.message, { alert: true }); return; }
  }
  if (!d) return;
  const convRow = ([name, n]) => {
    const c = name.startsWith("#")
      ? state.conversations.find((x) => x.slug === name.slice(1))
      : null;
    return `<button class="pin-row" ${c ? `data-goconv="${c.id}"` : "disabled"}>
      <span class="pin-txt"><b>${escapeHtml(name)}</b> · ${n} ${n === 1 ? "wiadomość" : "wiadomości"}</span>
    </button>`;
  };
  const mentionRow = (m) => `
    <button class="pin-row" data-gomsg="${m.id}" data-goconvid="${m.conversationId}">
      <span class="pin-txt"><b>@${escapeHtml(actorHandle(m.actorId))}</b> ${escapeHtml(String(m.body || "").slice(0, 90))}</span>
    </button>`;
  const { modal, close } = openModal(`
      <h2 id="m-title">${iconDigest()} Co Cię ominęło</h2>
      <p class="mhint">${d.count} ${d.count === 1 ? "wiadomość" : "wiadomości"} od Twojej ostatniej wizyty.</p>
      <div class="digest-body">
        <h4 class="wsub">Gdzie</h4>
        ${(d.byConversation || []).map(convRow).join("")}
        <h4 class="wsub">Od kogo</h4>
        <p class="digest-who">${(d.byWho || []).map(([w, n]) => `<b>@${escapeHtml(w)}</b> (${n})`).join(" · ")}</p>
        ${(d.mentions || []).length ? `<h4 class="wsub">Wzmianki o Tobie</h4>${d.mentions.slice(0, 8).map(mentionRow).join("")}` : ""}
        ${(d.open || []).length ? `<h4 class="wsub">Otwarte pytania (${d.open.length})</h4>
          <button class="pin-row" id="dg-questions"><span class="pin-txt">Zobacz listę pytań do podjęcia</span></button>` : ""}
      </div>
      <div class="row"><button class="btn" id="dg-close">Zamknij</button></div>`, { modalClass: "wide" });
  modal.querySelector("#dg-close").addEventListener("click", close);
  modal.querySelectorAll("[data-goconv]").forEach((b) =>
    b.addEventListener("click", () => { close(); openConversation(Number(b.dataset.goconv)); }));
  modal.querySelectorAll("[data-gomsg]").forEach((b) =>
    b.addEventListener("click", () => {
      close(); openConversation(Number(b.dataset.goconvid), Number(b.dataset.gomsg));
    }));
  const dq = modal.querySelector("#dg-questions");
  if (dq) dq.addEventListener("click", () => { close(); openQuestionsPanel(); });
}

async function showGuidelines() {
  let text = (state.guidelines && state.guidelines.text) || null;
  if (!text) {
    try { text = (await api("GET", "/api/guidelines")).text; } catch (e) { showToast(e.message, { alert: true }); return; }
  }
  const { modal, close } = openModal(`
      <h2 id="m-title">Zasady kanału</h2>
      <div class="gd-body">${mdToHtml(text, "page", state.actor.handle)}</div>
      <div class="row"><button class="btn" id="gd-ok">Rozumiem</button></div>`,
  { style: "max-height:80vh;display:flex;flex-direction:column" });
  modal.querySelector("#gd-ok").addEventListener("click", close);
}
