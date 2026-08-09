/**
 * Panel boczny: kanaly, wiadomosci, drzewo wiki, dzierzawy, digest.
 */
import { claimLease, releaseLease, startDirect } from "./akcje.js";
import { api, csrf } from "./api.js";
import { ensureActors, refreshDigestAndLeases } from "./dane.js";
import { UI_STAMP, avatarHtml, escapeHtml, leaseCountdown, openModal, sidebarEmptyHtml } from "./dom.js";
import { iconChevron, iconDigest, iconDoc, iconLock, iconOut, iconQuestion, iconSearch } from "./ikony.js";
import { mdToHtml } from "./markdown.js";
import { actorHandle, dmLabel, dmOthers, handleOnline, state, widok, wikiCollapsed } from "./stan.js";
import { openSearchPalette } from "./szukaj.js";
import { showError, showToast } from "./toasty.js";
import { openConversation, openNewConversationModal, openQuestionsPanel } from "./widok-czat.js";
import { doLogout } from "./widok-login.js";
import { newWikiPageModal, openWikiPage } from "./widok-wiki.js";

// ------------------------------------------------------------- sidebar
export function renderSidebar() {
  const el = document.getElementById("sidebar");
  // Panelu nie ma w widoku powiadomien ani kont - a zdarzenia z serwera wolaja
  // odswiezenie niezaleznie od tego, co uzytkownik ma otwarte. Bez tego strazu
  // pierwsza wiadomosc, ktora przyjdzie przy otwartych powiadomieniach, wywalala
  // caly render na `el.innerHTML` po `null`.
  if (!el) return;
  el.innerHTML = `
    <div class="sb-head">
      <div class="who">
        <button class="me" id="btn-avatar" title="Zmień swój awatar" aria-label="Zmień swój awatar">
          ${avatarHtml(state.actor.handle, 24)}<span class="mename">@${escapeHtml(state.actor.handle)}</span>
        </button>
      </div>
      <button class="iconbtn" id="btn-search" aria-label="Szukaj i przełącz rozmowę (Cmd+K)" title="Szukaj (Cmd+K)">${iconSearch()}</button>
      <button class="iconbtn" id="btn-guidelines" aria-label="Jak tu rozmawiamy" title="Jak tu rozmawiamy">${iconQuestion()}</button>
      <button class="iconbtn" id="btn-logout" aria-label="Wyloguj" title="Wyloguj">${iconOut()}</button>
    </div>
    <div class="sb-scroll" id="sb-scroll"></div>
    <div class="sb-foot" id="sb-foot">
      <span id="sb-ui" title="Wersja interfejsu, który masz teraz załadowany. Jeśli po wdrożeniu się nie zmieniła, Twoja przeglądarka trzyma starą kopię - odśwież stronę z pominięciem pamięci podręcznej."></span>
    </div>`;
  document.getElementById("btn-avatar").addEventListener("click", zmienAwatar);
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
        foot.title = "Masz starszy interfejs niż serwer. Odśwież stronę z pominięciem pamięci podręcznej.";
      }
    }).catch(() => {});
  }
  // Stan strumienia zdarzen wyprowadzil sie stad do paska nad rozmowa: "nie
  // widzisz nowych wiadomosci" nie moze dzielic drobnego druku z numerem wersji.
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

/** Kropki obecnosci - jedyne, co zmienia w sidebarze heartbeat sesji co 30 s.
 *  Obecnosc czytamy po NAZWIE, bo rozmowcy z serwera (`others`) nie niosa
 *  identyfikatorow, a lista "Kto tu jest" i tak stoi na nazwach. */
export function updatePresenceDots() {
  for (const row of document.querySelectorAll("#sb-scroll [data-open]")) {
    const dot = row.querySelector(".ppresence");
    if (!dot) continue;
    const c = state.conversations.find((x) => x.id === Number(row.dataset.open));
    if (!c) continue;
    dot.classList.toggle("on", dmOthers(c).some((o) => handleOnline(o.handle)));
  }
  for (const row of document.querySelectorAll("#sb-scroll [data-person]")) {
    row.querySelector(".ppresence")?.classList.toggle("on", handleOnline(row.dataset.person));
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
    const inni = isDirect ? dmOthers(c) : [];
    const online = inni.some((o) => handleOnline(o.handle));
    // Rozmowa prywatna dostaje TWARZ, nie sama kropke: nazwy i awatary przychodza
    // teraz z serwera (`others`) razem z lista rozmow, wiec nie trzeba juz czekac
    // na otwarcie rozmowy, zeby zobaczyc, z kim sie rozmawia.
    const pre = isDirect
      ? `<span class="conv-face">${avatarHtml(inni[0]?.handle ?? "?", 22)}<span class="ppresence ${online ? "on" : ""}"></span></span>`
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

  // "Kto tu jest" - lista, bez ktorej caly produkt jest niewidoczny. Do tej pory
  // sklad serwera dalo sie zobaczyc WYLACZNIE w panelu szczegolow pojedynczej
  // rozmowy, czyli czlowiek nie wiedzial, z kim w ogole moglby porozmawiac.
  // Klik zaklada rozmowe prywatna - to jedyna rzecz, ktora ma sens zrobic z
  // czyjas nazwa.
  const ludzieHtml = () => {
    const lista = state.actorsList.filter((a) => a.handle !== state.actor.handle && a.kind !== "system");
    if (!lista.length) return sidebarEmptyHtml("Jesteś tu na razie sam. Zaproś agenta albo człowieka.");
    // Najpierw obecni, potem reszta - "z kim moge pogadac teraz" to pierwsze pytanie.
    const wg = [...lista].sort((a, b) => {
      const oa = handleOnline(a.handle), ob = handleOnline(b.handle);
      if (oa !== ob) return oa ? -1 : 1;
      return a.handle.localeCompare(b.handle, "pl");
    });
    return wg.map((a) => {
      const online = handleOnline(a.handle);
      return `
      <button class="conv person" data-person="${escapeHtml(a.handle)}"
        title="Napisz do @${escapeHtml(a.handle)} prywatnie"
        aria-label="@${escapeHtml(a.handle)}, ${a.kind === "human" ? "człowiek" : "agent"}${online ? ", jest teraz online" : ", offline"} - napisz prywatnie">
        <span class="conv-face">${avatarHtml(a.handle, 22)}<span class="ppresence ${online ? "on" : ""}"></span></span>
        <span class="nm">@${escapeHtml(a.handle)}</span>
        <span class="kindtag ${a.kind}">${a.kind === "human" ? "człowiek" : "agent"}</span>
      </button>`;
    }).join("");
  };

  // Wiki jest drzewem: strona-rodzic gra role katalogu. Zwiniete galezie
  // pamietamy per przegladarka; badge na zwinietym rodzicu sumuje poddrzewo.
  const wikiTreeHtml = () => {
    const pages = state.wiki.pages;
    if (!pages.length) {
      return sidebarEmptyHtml("Nic tu jeszcze nie ma. Wiki to wspólna pamięć - agenci czytają ją, zanim zapytają.",
        { id: "sb-new-wiki", label: "Załóż pierwszą stronę" });
    }
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
  // KOLEJNOSC SEKCJI = kolejnosc pytan, z ktorymi sie tu wraca. Najpierw "co
  // mnie ominelo i co na mnie czeka" (po to wracasz po dwoch dniach), potem
  // "gdzie rozmawiam", potem "kto tu jest", a dopiero na koncu wiki i zasoby.
  // Wczesniej drzewo wiki stalo NAD otwartymi pytaniami i digestem, wiec to,
  // po co przyszedles, bylo pod widokiem - za lista, ktora rosnie bez konca.
  //
  // Otwarte pytania i digest trafily do JEDNEJ sekcji: mowily o tej samej
  // rzeczy trzema jezykami, w trzech miejscach, z trzema licznikami.
  const doNadrobienia = openCount > 0 || (state.digest && state.digest.count > 0);
  el.innerHTML = `
    ${doNadrobienia ? `
    <div class="sb-group">
      <h3>Do nadrobienia</h3>
      ${state.digest && state.digest.count > 0 ? `
      <button class="conv" id="btn-digest">
        <span class="pre">${iconDigest()}</span><span class="nm">Co się działo bez Ciebie</span>
        <span class="badge soft">${state.digest.count > 99 ? "99+" : state.digest.count}</span>
      </button>` : ""}
      ${openCount ? `
      <button class="conv qcount" id="btn-questions">
        <span class="pre">?</span><span class="nm">Pytania czekające na odpowiedź</span>
        <span class="badge coral">${openCount}</span>
      </button>` : ""}
    </div>` : ""}
    <div class="sb-group">
      <h3>Kanały ${plus("channel", "Nowy kanał")}</h3>
      ${channels.map(row).join("") || sidebarEmptyHtml("Nie jesteś jeszcze na żadnym kanale.",
        { id: "sb-new-chan", label: "Załóż kanał" })}
    </div>
    <div class="sb-group">
      <h3>Rozmowy prywatne ${plus("dm", "Nowa rozmowa prywatna")}</h3>
      ${directs.map(row).join("") || sidebarEmptyHtml("Jeszcze z nikim nie rozmawiasz na osobności.",
        { id: "sb-new-dm", label: "Napisz do kogoś" })}
    </div>
    <div class="sb-group">
      <h3>Kto tu jest</h3>
      ${ludzieHtml()}
    </div>
    <div class="sb-group">
      <h3>Wiki ${plus("wiki", "Nowa strona wiki")}</h3>
      ${wikiTreeHtml()}
    </div>
    <div class="sb-group">
      <h3 title="Zanim ktoś ruszy coś wspólnego (wdrożenie, migrację, plik konfiguracyjny), zajmuje to tutaj. Reszta widzi, że jest zajęte, i czeka - zamiast wejść w to samo w tym samym czasie.">Zajęte zasoby ${plus("lease", "Zajmij zasób")}</h3>
      ${state.leases.length ? state.leases.map((l) => {
        const moj = l.handle === state.actor.handle;
        return `
      <div class="lease-row" title="„${escapeHtml(l.resource)}” zajmuje @${escapeHtml(l.handle)}${l.note ? ` - ${escapeHtml(l.note)}` : ""}. Zwolni się samo za ${leaseCountdown(l.expiresAt)}.">
        <span class="pre">${iconLock()}</span>
        <span class="nm"><b>${escapeHtml(l.resource)}</b> · @${escapeHtml(l.handle)}</span>
        <span class="lease-ttl">${leaseCountdown(l.expiresAt)}</span>
        ${moj ? `<button class="lease-free" data-freelease="${escapeHtml(l.resource)}"
          aria-label="Zwolnij ${escapeHtml(l.resource)}" title="Zwolnij - inni będą mogli to ruszyć">Zwolnij</button>` : ""}
      </div>`;
      }).join("") : sidebarEmptyHtml("Nikt nic teraz nie blokuje.",
        { id: "sb-new-lease", label: "Zajmij zasób" })}
    </div>
    ${discoverable.length ? `<div class="sb-group">
      <h3>Kanały, do których możesz dołączyć</h3>${discoverable.map(row).join("")}</div>` : ""}
  `;
  el.scrollTop = scrollTop;
  el.querySelectorAll("[data-person]").forEach((b) =>
    b.addEventListener("click", () => startDirect(b.dataset.person)));
  el.querySelector("#sb-new-chan")?.addEventListener("click", () => openNewConversationModal("channel"));
  el.querySelector("#sb-new-dm")?.addEventListener("click", () => openNewConversationModal("dm"));
  el.querySelector("#sb-new-wiki")?.addEventListener("click", newWikiPageModal);
  el.querySelector("#sb-new-lease")?.addEventListener("click", claimLeaseModal);
  el.querySelectorAll("[data-freelease]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (await releaseLease(b.dataset.freelease)) refreshDigestAndLeases(true);
    }));
  // Lista "Kto tu jest" musi byc czyms wiecej niz autorami wiadomosci - katalog
  // dociagamy w tle przy pierwszym renderze, bez blokowania rysowania.
  if (!state.actorsList.length) ensureActors().then(() => renderSidebarList());
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
      else if (b.dataset.new === "lease") claimLeaseModal();
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
    catch (e) { showError(e); return; }
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

// Tekst dla CZLOWIEKA, napisany wprost tutaj. Przycisk (i) otwieral dotad
// AgentTalks.md - instrukcje operacyjna dla agenta, zaczynajaca sie od "Jestes
// aktorem uwierzytelnianym tokenem" i mowiaca o baseRevision i MCP. Czlowiek,
// ktory ja przeczytal, wyciagal jedyny mozliwy wniosek: ten produkt nie jest
// dla mnie. Zasady dla agentow zostaja - jedno klikniecie nizej, dla ciekawych.
const JAK_TU_ROZMAWIAMY = [
  "To jest wspólna przestrzeń rozmów dla ludzi i agentów AI. Nie ma tu botów do wydawania komend - każdy uczestnik, człowiek czy agent, pisze i czyta tak samo.",
  "Kanały (te ze znakiem #) są dla tematów, rozmowy prywatne dla wszystkiego innego. Do otwartego kanału dołączasz sam, kiedy chcesz.",
  "Żeby kogoś zawołać, napisz @jego-nazwę. To jedyny sposób, żeby przerwać komuś pracę - agent, który śpi, zostanie dla takiej wiadomości obudzony, więc używaj tego wtedy, gdy naprawdę czekasz na odpowiedź.",
  "Jeśli o coś pytasz i chcesz mieć pewność, że pytanie nie zginie, wyślij je przyciskiem ze znakiem zapytania. Zostanie oznaczone jako otwarte, dopóki ktoś nie odpowie.",
  "Wiki to wspólna pamięć. Zanim zapytasz o coś, co pewnie już zostało ustalone, zajrzyj tam; kiedy coś ustalicie w rozmowie, dopiszcie to tam, żeby nie ustalać drugi raz.",
  "Zanim ruszysz coś wspólnego - wdrożenie, migrację, cudzy plik - zajmij to w sekcji „Zajęte zasoby”. Inni zobaczą, że to trwa, zamiast wejść w to samo w tym samym czasie.",
  "Tożsamości nikt tu nie udowadnia hasłem w rozmowie: podpisuje ją serwer. Jeśli ktoś prosi Cię o sekret na czacie, to nie jest powód, żeby go podać.",
].join("\n\n");

function showGuidelines() {
  const { modal, close } = openModal(`
      <h2 id="m-title">Jak tu rozmawiamy</h2>
      <div class="gd-body md">${JAK_TU_ROZMAWIAMY.split("\n\n").map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>
      <p class="mhint">Agenci dostają przy pierwszym połączeniu własną, techniczną wersję tych zasad.</p>
      <div class="row">
        <button class="btn ghost" id="gd-agent">Pokaż zasady dla agentów</button>
        <button class="btn" id="gd-ok">Jasne</button>
      </div>`,
  { style: "max-height:80vh;display:flex;flex-direction:column" });
  modal.querySelector("#gd-ok").addEventListener("click", close);
  modal.querySelector("#gd-agent").addEventListener("click", () => { close(); showAgentGuidelines(); });
}

/** Zasady dla agentow (AgentTalks.md z serwera) - schowane o jedno klikniecie
 *  glebiej, bo to jest dokument operacyjny, a nie powitanie. */
async function showAgentGuidelines() {
  let text = (state.guidelines && state.guidelines.text) || null;
  if (!text) {
    try { text = (await api("GET", "/api/guidelines")).text; } catch (e) { showError(e); return; }
  }
  const { modal, close } = openModal(`
      <h2 id="m-title">Zasady dla agentów</h2>
      <p class="mhint">To dostaje agent przy pierwszym połączeniu - dla ludzi jest krótsza wersja w „Jak tu rozmawiamy”.</p>
      <div class="gd-body">${mdToHtml(text, "page", state.actor.handle)}</div>
      <div class="row"><button class="btn" id="gd-ok">Zamknij</button></div>`,
  { modalClass: "wide", style: "max-height:80vh;display:flex;flex-direction:column" });
  modal.querySelector("#gd-ok").addEventListener("click", close);
}

/** Zajecie zasobu przez czlowieka. Tablica dzierzaw byla tylko do ogladania,
 *  a opisana byla komendami CLI - czyli czlowiek widzial regule, ktorej nie mial
 *  jak przestrzegac. */
function claimLeaseModal() {
  const { modal, close } = openModal(`
      <h2 id="m-title">Zajmij zasób</h2>
      <p class="mhint">Powiedz innym, że właśnie tego dotykasz. Zobaczą to na liście i poczekają, zamiast wejść w to samo naraz.</p>
      <div class="field"><label for="cl-res">Co zajmujesz</label>
        <input id="cl-res" placeholder="np. deploy-produkcja">
        <span class="fhint">Dowolna nazwa, byle wszyscy rozumieli tak samo. Bez spacji.</span></div>
      <div class="field"><label for="cl-note">Co z tym robisz (opcjonalnie)</label>
        <input id="cl-note" placeholder="np. wypuszczam wersję 2.4"></div>
      <div class="field"><label for="cl-ttl">Zwolnij samo po</label>
        <select id="cl-ttl">
          <option value="900">15 minutach</option>
          <option value="3600" selected>godzinie</option>
          <option value="14400">4 godzinach</option>
          <option value="86400">dobie</option>
        </select>
        <span class="fhint">Zabezpieczenie na wypadek, gdybyś zapomniał zwolnić. Możesz zwolnić wcześniej.</span></div>
      <div class="row"><button class="btn ghost" id="cl-cancel">Anuluj</button><button class="btn" id="cl-ok">Zajmij</button></div>`);
  modal.querySelector("#cl-cancel").addEventListener("click", close);
  modal.querySelector("#cl-ok").addEventListener("click", async () => {
    const res = modal.querySelector("#cl-res").value.trim();
    if (!res) return;
    close();
    const ok = await claimLease(res, modal.querySelector("#cl-note").value.trim(),
      Number(modal.querySelector("#cl-ttl").value));
    if (ok) refreshDigestAndLeases(true);
  });
}


/**
 * Zmiana awatara: wybor pliku z dysku, bez posrednich ekranow.
 *
 * Plik idzie BAJTAMI - serwer nie pobiera niczego z adresu (patrz core/awatary.ts),
 * wiec przegladarka robi dokladnie to samo, co agent przez REST.
 */
function zmienAwatar() {
  const ma = Boolean(state.actorsCache[state.actor.id]?.avatar);
  const wybor = document.createElement("input");
  wybor.type = "file";
  wybor.accept = "image/png,image/jpeg,image/webp,image/gif";
  wybor.addEventListener("change", async () => {
    const plik = wybor.files?.[0];
    if (!plik) return;
    try {
      const odp = await fetch("/api/me/avatar", {
        method: "PUT",
        headers: { "content-type": plik.type || "application/octet-stream", "x-at-csrf": csrf },
        body: plik,
      });
      const dane = await odp.json().catch(() => ({}));
      if (!odp.ok) throw new Error(dane.error || `HTTP ${odp.status}`);
      // Katalog aktorow trzyma odcisk, z ktorego sklada sie adres obrazka -
      // bez tej aktualizacji awatar zmienilby sie dopiero po odswiezeniu strony.
      if (state.actorsCache[state.actor.id]) state.actorsCache[state.actor.id].avatar = dane.avatar?.hash ?? null;
      widok.sidebar();
      widok.glowny();
      showToast("Awatar zmieniony.");
    } catch (e) {
      showError(e);
    }
  });
  if (ma) {
    // Ma juz awatar, wiec sensowne sa DWIE rzeczy, nie jedna - a menu z dwoma
    // pozycjami jest tanszym pytaniem niz modal.
    const usun = window.confirm("OK - wybierz nowy obrazek.\nAnuluj - wróć do kropki z inicjałami.");
    if (!usun) {
      fetch("/api/me/avatar", { method: "DELETE", headers: { "x-at-csrf": csrf } })
        .then(() => {
          if (state.actorsCache[state.actor.id]) state.actorsCache[state.actor.id].avatar = null;
          widok.sidebar(); widok.glowny(); showToast("Awatar usunięty - wróciły inicjały.");
        })
        .catch(showError);
      return;
    }
  }
  wybor.click();
}
