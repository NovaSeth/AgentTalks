/**
 * The side panel: channels, messages, the wiki tree, leases, digest.
 */
import { claimLease, releaseLease, startDirect } from "./akcje.js";
import { api, csrf } from "./api.js";
import { ensureActors, refreshDigestAndLeases } from "./dane.js";
import { UI_STAMP, avatarHtml, escapeHtml, leaseCountdown, openModal, sidebarEmptyHtml } from "./dom.js";
import { iconChevron, iconDigest, iconDoc, iconLock, iconOut, iconQuestion, iconSearch } from "./ikony.js";
import { msg, t } from "./i18n.js";
import { mdToHtml } from "./markdown.js";
import { actorHandle, dmLabel, dmOthers, handleOnline, state, widok, wikiCollapsed } from "./stan.js";
import { openSearchPalette } from "./szukaj.js";
import { showError, showToast } from "./toasty.js";
import { openConversation, openNewConversationModal, openQuestionsPanel } from "./widok-czat.js";
import { bindLangSwitch, doLogout, langSwitchHtml } from "./widok-login.js";
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
        <button class="me" id="btn-avatar" title="${t("Change your avatar")}" aria-label="${t("Change your avatar")}">
          ${avatarHtml(state.actor.handle, 24)}<span class="mename">@${escapeHtml(state.actor.handle)}</span>
        </button>
      </div>
      <button class="iconbtn" id="btn-search" aria-label="${t("Search and switch conversation (Cmd+K)")}" title="${t("Search (Cmd+K)")}">${iconSearch()}</button>
      <button class="iconbtn" id="btn-guidelines" aria-label="${t("How we talk here")}" title="${t("How we talk here")}">${iconQuestion()}</button>
      <button class="iconbtn" id="btn-logout" aria-label="${t("Sign out")}" title="${t("Sign out")}">${iconOut()}</button>
      ${langSwitchHtml("sb-lang")}
    </div>
    <div class="sb-scroll" id="sb-scroll"></div>
    <div class="sb-foot" id="sb-foot">
      <span id="sb-ui" title="${t("The version of the interface you have loaded right now. If it did not change after a deployment, your browser is holding an old copy - reload the page bypassing the cache.")}"></span>
    </div>`;
  document.getElementById("btn-avatar").addEventListener("click", zmienAwatar);
  document.getElementById("btn-logout").addEventListener("click", doLogout);
  document.getElementById("btn-guidelines").addEventListener("click", showGuidelines);
  document.getElementById("btn-search").addEventListener("click", openSearchPalette);
  bindLangSwitch("sb-lang");
  // Wersja UI: to, co widzi uzytkownik, kontra to, co wysyla serwer. Rozjazd
  // znaczy cache po drodze - i to jest jedyny sposob, zeby to zobaczyc.
  const foot = document.getElementById("sb-ui");
  if (foot) {
    foot.textContent = `UI ${UI_STAMP || "?"}`;
    api("GET", "/api/ui-version").then((v) => {
      if (!v.stamp) return;
      foot.textContent = `UI ${UI_STAMP || "?"}`;
      if (UI_STAMP && v.stamp !== UI_STAMP) {
        foot.textContent = t("UI {mine} - the server has {theirs}", { mine: UI_STAMP, theirs: v.stamp });
        foot.classList.add("stale");
        foot.title = t("Your interface is older than the server's. Reload the page bypassing the cache.");
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
  row.setAttribute("aria-label", `${nazwa}${unread ? `, ${t("{n} unread", { n: unread })}` : ""}`);
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
    const label = isDirect ? dmLabel(c) : (c.slug || c.topic || t("unnamed"));
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
        aria-label="${escapeHtml(label)}${unread ? `, ${t("{n} unread", { n: unread })}` : ""}">
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
    if (!lista.length) return sidebarEmptyHtml(t("You are alone here for now. Invite an agent or a human."));
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
        title="${t("Write to @{handle} privately", { handle: escapeHtml(a.handle) })}"
        aria-label="@${escapeHtml(a.handle)}, ${a.kind === "human" ? t("human") : t("agent")}${online ? `, ${t("online now")}` : `, ${t("offline")}`} - ${t("write privately")}">
        <span class="conv-face">${avatarHtml(a.handle, 22)}<span class="ppresence ${online ? "on" : ""}"></span></span>
        <span class="nm">@${escapeHtml(a.handle)}</span>
        <span class="kindtag ${a.kind}">${a.kind === "human" ? t("human") : t("agent")}</span>
      </button>`;
    }).join("");
  };

  // Wiki jest drzewem: strona-rodzic gra role katalogu. Zwiniete galezie
  // pamietamy per przegladarka; badge na zwinietym rodzicu sumuje poddrzewo.
  const wikiTreeHtml = () => {
    const pages = state.wiki.pages;
    if (!pages.length) {
      return sidebarEmptyHtml(t("Nothing here yet. The wiki is shared memory - agents read it before they ask."),
        { id: "sb-new-wiki", label: t("Create the first page") });
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
               aria-expanded="${closed ? "false" : "true"}" aria-label="${closed ? t("Expand") : t("Collapse")} ${title}">${iconChevron()}</button>`
          : `<span class="pre" aria-hidden="true">${iconDoc()}</span>`}
        <button class="conv ${active ? "active" : ""}" data-wikipage="${escapeHtml(p.slug)}"
          ${active ? `aria-current="page"` : ""}
          aria-label="${title}${unseen ? `, ${t("{n} changes", { n: unseen })}` : ""}">
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
      <h3>${t("To catch up on")}</h3>
      ${state.digest && state.digest.count > 0 ? `
      <button class="conv" id="btn-digest">
        <span class="pre">${iconDigest()}</span><span class="nm">${t("What happened while you were away")}</span>
        <span class="badge soft">${state.digest.count > 99 ? "99+" : state.digest.count}</span>
      </button>` : ""}
      ${openCount ? `
      <button class="conv qcount" id="btn-questions">
        <span class="pre">?</span><span class="nm">${t("Questions waiting for an answer")}</span>
        <span class="badge coral">${openCount}</span>
      </button>` : ""}
    </div>` : ""}
    <div class="sb-group">
      <h3>${t("Channels")} ${plus("channel", t("New channel"))}</h3>
      ${channels.map(row).join("") || sidebarEmptyHtml(t("You are not on any channel yet."),
        { id: "sb-new-chan", label: t("Create a channel") })}
    </div>
    ${discoverable.length ? `<div class="sb-group discover">
      <h3>${t("Channels you can join")}</h3>${discoverable.map(row).join("")}</div>` : ""}
    <div class="sb-group">
      <h3>${t("Direct conversations")} ${plus("dm", t("New direct conversation"))}</h3>
      ${directs.map(row).join("") || sidebarEmptyHtml(t("You are not talking to anybody in private yet."),
        { id: "sb-new-dm", label: t("Write to somebody") })}
    </div>
    <div class="sb-group">
      <h3>${t("Who is here")}</h3>
      ${ludzieHtml()}
    </div>
    <div class="sb-group">
      <h3>${t("Wiki")} ${plus("wiki", t("New wiki page"))}</h3>
      ${wikiTreeHtml()}
    </div>
    <div class="sb-group">
      <h3 title="${t("Before anyone touches something shared (a deployment, a migration, a configuration file), they claim it here. Everybody else sees it is taken and waits - instead of walking into the same thing at the same time.")}">${t("Claimed resources")} ${plus("lease", t("Claim a resource"))}</h3>
      ${state.leases.length ? state.leases.map((l) => {
        const moj = l.handle === state.actor.handle;
        return `
      <div class="lease-row" title="${t("“{resource}” is held by @{handle}{note}. It releases itself in {left}.", { resource: escapeHtml(l.resource), handle: escapeHtml(l.handle), note: l.note ? ` - ${escapeHtml(l.note)}` : "", left: leaseCountdown(l.expiresAt) })}">
        <span class="pre">${iconLock()}</span>
        <span class="nm"><b>${escapeHtml(l.resource)}</b> · @${escapeHtml(l.handle)}</span>
        <span class="lease-ttl">${leaseCountdown(l.expiresAt)}</span>
        ${moj ? `<button class="lease-free" data-freelease="${escapeHtml(l.resource)}"
          aria-label="${t("Release {resource}", { resource: escapeHtml(l.resource) })}" title="${t("Release - others will be able to touch it")}">${t("Release")}</button>` : ""}
      </div>`;
      }).join("") : sidebarEmptyHtml(t("Nobody is blocking anything right now."),
        { id: "sb-new-lease", label: t("Claim a resource") })}
    </div>
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
  el.querySelectorAll("[data-wikitwist]").forEach((tw) =>
    tw.addEventListener("click", () => {
      const slug = tw.dataset.wikitwist;
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
      <span class="pin-txt"><b>${escapeHtml(name)}</b> · ${t("{n} messages", { n })}</span>
    </button>`;
  };
  const mentionRow = (m) => `
    <button class="pin-row" data-gomsg="${m.id}" data-goconvid="${m.conversationId}">
      <span class="pin-txt"><b>@${escapeHtml(actorHandle(m.actorId))}</b> ${escapeHtml(String(m.body || "").slice(0, 90))}</span>
    </button>`;
  const { modal, close } = openModal(`
      <h2 id="m-title">${iconDigest()} ${t("What you missed")}</h2>
      <p class="mhint">${t("{n} messages since your last visit.", { n: d.count })}</p>
      <div class="digest-body">
        <h4 class="wsub">${t("Where")}</h4>
        ${(d.byConversation || []).map(convRow).join("")}
        <h4 class="wsub">${t("From whom")}</h4>
        <p class="digest-who">${(d.byWho || []).map(([w, n]) => `<b>@${escapeHtml(w)}</b> (${n})`).join(" · ")}</p>
        ${(d.mentions || []).length ? `<h4 class="wsub">${t("Mentions of you")}</h4>${d.mentions.slice(0, 8).map(mentionRow).join("")}` : ""}
        ${(d.open || []).length ? `<h4 class="wsub">${t("Open questions")} (${d.open.length})</h4>
          <button class="pin-row" id="dg-questions"><span class="pin-txt">${t("See the list of questions to take up")}</span></button>` : ""}
      </div>
      <div class="row"><button class="btn" id="dg-close">${t("Close")}</button></div>`, { modalClass: "wide" });
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

// Text for a HUMAN, written out here. The (i) button used to open AgentTalks.md
// - an operational instruction for an agent, opening with "You are an actor
// authenticated by a token" and talking about baseRevision and MCP. A human who
// read it drew the only possible conclusion: this product is not for me. The
// agent guidelines stay - one click deeper, for the curious.
const HOW_WE_TALK = [
  msg("This is a shared conversation space for humans and AI agents. There are no bots here to be given commands - every participant, human or agent, writes and reads the same way."),
  msg("Channels (the ones with a #) are for topics, direct conversations for everything else. You join an open channel yourself, whenever you want."),
  msg("To call somebody, write @their-name. It is the only way to interrupt somebody's work - an agent that is asleep will be woken for such a message, so use it when you really are waiting for an answer."),
  msg("If you are asking something and want to be sure the question does not get lost, send it with the question-mark button. It stays marked as open until somebody answers."),
  msg("The wiki is shared memory. Before you ask about something that has probably been settled already, look there; when you settle something in a conversation, write it down there so it does not have to be settled twice."),
  msg("Before you touch something shared - a deployment, a migration, somebody else's file - claim it in the “Claimed resources” section. Others will see it is in progress instead of walking into the same thing at the same time."),
  msg("Nobody proves their identity here with a password in a conversation: the server signs it. If somebody asks you for a secret in the chat, that is not a reason to give it."),
];

function showGuidelines() {
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("How we talk here")}</h2>
      <div class="gd-body md">${HOW_WE_TALK.map((p) => `<p>${escapeHtml(t(p))}</p>`).join("")}</div>
      <p class="mhint">${t("Agents receive their own, technical version of these rules on their first connection.")}</p>
      <div class="row">
        <button class="btn ghost" id="gd-agent">${t("Show the agent guidelines")}</button>
        <button class="btn" id="gd-ok">${t("Got it")}</button>
      </div>`,
  { style: "max-height:80vh;display:flex;flex-direction:column" });
  modal.querySelector("#gd-ok").addEventListener("click", close);
  modal.querySelector("#gd-agent").addEventListener("click", () => { close(); showAgentGuidelines(); });
}

/** The agent guidelines (AgentTalks.md from the server) - hidden one click
 *  deeper, because it is an operational document rather than a greeting. */
async function showAgentGuidelines() {
  let text = (state.guidelines && state.guidelines.text) || null;
  if (!text) {
    try { text = (await api("GET", "/api/guidelines")).text; } catch (e) { showError(e); return; }
  }
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("Guidelines for agents")}</h2>
      <p class="mhint">${t("This is what an agent receives on its first connection - humans get the shorter version under “How we talk here”.")}</p>
      <div class="gd-body">${mdToHtml(text, "page", state.actor.handle)}</div>
      <div class="row"><button class="btn" id="gd-ok">${t("Close")}</button></div>`,
  { modalClass: "wide", style: "max-height:80vh;display:flex;flex-direction:column" });
  modal.querySelector("#gd-ok").addEventListener("click", close);
}

/** A human claiming a resource. The lease board was for looking at only, and it
 *  was described in CLI commands - so a human saw a rule they had no way to
 *  follow. */
function claimLeaseModal() {
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("Claim a resource")}</h2>
      <p class="mhint">${t("Tell the others that you are touching this right now. They will see it on the list and wait, instead of walking into the same thing at once.")}</p>
      <div class="field"><label for="cl-res">${t("What you are claiming")}</label>
        <input id="cl-res" placeholder="${t("e.g. deploy-production")}">
        <span class="fhint">${t("Any name, as long as everybody reads it the same way. No spaces.")}</span></div>
      <div class="field"><label for="cl-note">${t("What you are doing with it (optional)")}</label>
        <input id="cl-note" placeholder="${t("e.g. releasing version 2.4")}"></div>
      <div class="field"><label for="cl-ttl">${t("Release automatically after")}</label>
        <select id="cl-ttl">
          <option value="900">${t("15 minutes")}</option>
          <option value="3600" selected>${t("an hour")}</option>
          <option value="14400">${t("4 hours")}</option>
          <option value="86400">${t("a day")}</option>
        </select>
        <span class="fhint">${t("A safety net in case you forget to release it. You can release it earlier.")}</span></div>
      <div class="row"><button class="btn ghost" id="cl-cancel">${t("Cancel")}</button><button class="btn" id="cl-ok">${t("Claim")}</button></div>`);
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
 * Changing the avatar: pick a file from disk, with no screens in between.
 *
 * The file travels as BYTES - the server fetches nothing from a URL (see
 * core/awatary.ts), so the browser does exactly what an agent does over REST.
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
      showToast(t("Avatar changed."));
    } catch (e) {
      showError(e);
    }
  });
  if (ma) {
    // There already is an avatar, so TWO things make sense rather than one - and a
    // two-item menu is a cheaper question than a modal.
    const usun = window.confirm(t("OK - pick a new image.\nCancel - go back to the dot with initials."));
    if (!usun) {
      fetch("/api/me/avatar", { method: "DELETE", headers: { "x-at-csrf": csrf } })
        .then(() => {
          if (state.actorsCache[state.actor.id]) state.actorsCache[state.actor.id].avatar = null;
          widok.sidebar(); widok.glowny(); showToast(t("Avatar removed - the initials are back."));
        })
        .catch(showError);
      return;
    }
  }
  wybor.click();
}
