/**
 * Wiki: page, editor, history, revision tree.
 */
import { api } from "./api.js";
import { loadWikiList, signalTyping } from "./dane.js";
import { avatarHtml, confirmModal, escapeHtml, fmtDateTime, formatBytes, hamburgerHtml, openModal, skeletonHtml, timeAgo, toggleDrawerClass } from "./dom.js";
import { iconDoc, iconEdit, iconFile, iconHistory, iconTrash } from "./ikony.js";
import { locale, t } from "./i18n.js";
import { mdToHtml } from "./markdown.js";
import { state, widok } from "./stan.js";
import { showError, showToast } from "./toasty.js";

// ------------------------------------------------ wersja robocza edytora wiki
// Czat od dawna trzyma szkic wiadomosci przezywajacy F5 i wdrozenie; edytor wiki
// nie trzymal nic, a to w nim pisze sie najdluzsze teksty. Wyjscie z edytora
// (Anuluj, klik w inna strone, zamkniecie karty) kasowalo je bez pytania.
const WIKI_DRAFT_KEY = (slug) => `atalks_wiki_draft_${slug}`;

function zapiszWersjeRobocza(slug, draft) {
  if (!slug || !draft) return;
  try { localStorage.setItem(WIKI_DRAFT_KEY(slug), JSON.stringify(draft)); } catch { /* prywatny tryb */ }
}

function wczytajWersjeRobocza(slug) {
  try {
    const raw = localStorage.getItem(WIKI_DRAFT_KEY(slug));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function skasujWersjeRobocza(slug) {
  try { localStorage.removeItem(WIKI_DRAFT_KEY(slug)); } catch { /* prywatny tryb */ }
}

/** Czy w edytorze jest cos, czego nie ma na serwerze. */
function saNiezapisaneZmiany() {
  const w = state.wiki;
  if (!w.editing || !w.draft) return false;
  const tytul = document.getElementById("we-title")?.value ?? w.draft.title;
  const tresc = document.getElementById("we-body")?.value ?? w.draft.body;
  return tytul !== (w.page?.title ?? w.slug) || tresc !== (w.page?.body ?? "");
}

/** Wyjscie z edytora pyta, zamiast kasowac. Zwraca false, gdy uzytkownik zostaje. */
export async function mozeszOpuscicEdytorWiki() {
  if (!saNiezapisaneZmiany()) return true;
  const zapamietaj = () => {
    zapiszWersjeRobocza(state.wiki.slug, {
      title: document.getElementById("we-title")?.value ?? "",
      body: document.getElementById("we-body")?.value ?? "",
      parentSlug: document.getElementById("we-parent")?.value || null,
    });
  };
  zapamietaj();   // najpierw ratujemy tekst, potem pytamy - w tej kolejnosci
  return await confirmModal({
    title: t("You have unsaved changes on this page"),
    body: t("I saved them as a draft in this browser - they come back when you open the editor again. Leave without saving to the server?"),
    ok: t("Leave, I will come back to it"), cancel: t("Stay and save"),
  });
}

// Strony wlasnie przez nas kasowane. Serwer roztrasa zdarzenie `wiki` takze dla
// skasowanej strony, a obsluga tego zdarzenia otwiera strone na nowo, gdy wlasnie
// sie na nia patrzy. Zdarzenie potrafi wyprzedzic odpowiedz na DELETE, wiec
// interfejs probowal wczytac strone, ktorej sam przed chwila kazal zniknac - i
// pokazywal "Nie ma takiej strony wiki" obok wlasnego "Skasowano".
const kasowaneStrony = new Set();

// ============================================================= WIKI
export async function openWikiPage(slug) {
  if (kasowaneStrony.has(slug)) return;
  // Przejscie na inna strone w trakcie pisania to najczestsza droga do utraty
  // tekstu - wiec pytamy tu, a nie dopiero przy Anuluj.
  if (state.wiki.editing && state.wiki.slug !== slug && !(await mozeszOpuscicEdytorWiki())) return;
  state.view = "wiki";
  state.drawerOpen = false;
  state.wiki.slug = slug;
  state.wiki.revision = null;
  state.wiki.editing = false;
  state.wiki.draft = null;
  toggleDrawerClass();   // na mobile: zamknij szuflade, inaczej zaslania strone
  widok.sidebar();
  renderWikiMain(true);
  try {
    const [pageData, histData] = await Promise.all([
      api("GET", `/api/wiki/${encodeURIComponent(slug)}`),
      api("GET", `/api/wiki/${encodeURIComponent(slug)}/history`),
    ]);
    state.wiki.page = pageData.page;
    state.wiki.files = pageData.files || [];
    state.wiki.history = histData.revisions;
    // Wejscie na strone zeruje wskaznik "N zmian" - najpierw lokalnie (badge
    // znika od razu), potem znacznik na serwerze (best effort).
    const item = state.wiki.pages.find((p) => p.slug === slug);
    if (item && item.unseen) { item.unseen = 0; widok.sidebar(); }
    api("POST", `/api/wiki/${encodeURIComponent(slug)}/seen`, {}).catch(() => {});
  } catch (e) {
    if (state.wiki.draft === null) { showError(e); state.view = "chat"; widok.glowny(); return; }
  }
  renderWikiMain();
}

export function newWikiPageModal() {
  // Domyslne polozenie: strona, na ktora wlasnie patrzysz - "dopisuje podstrone
  // do tego, co czytam" to najczestszy przypadek przy rosnacym drzewie.
  const defaultParent = state.view === "wiki" && state.wiki.page ? state.wiki.page.slug : "";
  const options = state.wiki.pages
    .slice()
    .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug, locale()))
    .map((p) => `<option value="${escapeHtml(p.slug)}" ${p.slug === defaultParent ? "selected" : ""}>${escapeHtml(p.title || p.slug)}</option>`)
    .join("");
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("New wiki page")}</h2>
      <div class="field"><label for="nw-slug">${t("Page address")}</label><input id="nw-slug" placeholder="${t("e.g. how-to-deploy")}">
        <span class="fhint">${t("A short name in the address: lower-case letters, digits and hyphens, no spaces and no accented characters.")}</span></div>
      <div class="field"><label for="nw-title">${t("Title")}</label><input id="nw-title" placeholder="${t("e.g. How to deploy")}"></div>
      <div class="field"><label for="nw-parent">${t("Placement")}</label><select id="nw-parent">
        <option value="" ${defaultParent ? "" : "selected"}>${t("(wiki root)")}</option>${options}
      </select></div>
      <p class="mhint">${t("The wiki is shared - anybody signed in can read and edit. The history records who changed what.")}</p>
      <div class="row"><button class="btn ghost" id="nw-cancel">${t("Cancel")}</button><button class="btn" id="nw-create">${t("Create")}</button></div>`);
  modal.querySelector("#nw-cancel").addEventListener("click", close);
  modal.querySelector("#nw-create").addEventListener("click", () => {
    const slug = modal.querySelector("#nw-slug").value.trim().toLowerCase();
    const title = modal.querySelector("#nw-title").value.trim() || slug;
    const parentSlug = modal.querySelector("#nw-parent").value || null;
    if (!slug) return;
    close();
    state.view = "wiki";
    state.wiki.slug = slug;
    state.wiki.page = null;
    state.wiki.files = [];
    state.wiki.history = [];
    state.wiki.revision = null;
    state.wiki.editing = true;
    state.wiki.draft = { title, body: "", parentSlug };
    widok.sidebar();
    renderWikiMain();
  });
}

async function saveWikiEdit(title, body, note, parentSlug) {
  const slug = state.wiki.slug;
  try {
    // baseRevision = wersja, ktora widzielismy otwierajac strone. Gdy ktos zapisal
    // w miedzyczasie, serwer odmawia (409) zamiast po cichu skasowac jego zmiane;
    // dla nowej strony 0 znaczy "zaloz, jesli takiej nie ma".
    const data = await api("PUT", `/api/wiki/${encodeURIComponent(slug)}`, {
      title, body, note: note || undefined, parentSlug,
      baseRevision: state.wiki.page ? state.wiki.page.lastRevisionId : 0,
    });
    state.wiki.page = data.page;
    state.wiki.editing = false;
    state.wiki.draft = null;
    skasujWersjeRobocza(slug);
    const hist = await api("GET", `/api/wiki/${encodeURIComponent(slug)}/history`);
    state.wiki.history = hist.revisions;
    loadWikiList();
    renderWikiMain();
    showToast(t("Page saved."));
  } catch (e) {
    // Konflikt to nie awaria zapisu tylko cudza zmiana - i wymaga DECYZJI, a nie
    // komunikatu znikajacego po czterech sekundach.
    //
    // Warunek testowal dotad slowo "konflikt" w TRESCI bledu, a ono jest wylacznie
    // w jego KODZIE - wiec przyjazna sciezka nie odpalala sie ani razu i czlowiek
    // dostawal w toascie instrukcje z curl-em, napisana dla agenta.
    if (e.code === "konflikt_wiki") { pokazKonfliktWiki(title, body, note, parentSlug); return; }
    showError(e, {
      slug: t("Invalid page address. Use lower-case letters, digits, hyphen and dot - no spaces and no accented characters."),
      slug_zarezerwowany: t("This address is reserved by the system. Pick another one."),
    });
  }
}

/** Okno konfliktu: co sie stalo i trzy wyjscia, z ktorych kazde ratuje tekst.
 *  Wersja robocza laduje w localStorage ZANIM cokolwiek pokazemy - inaczej
 *  odswiezenie strony w panice kasowaloby prace, o ktora wlasnie sie bijemy. */
function pokazKonfliktWiki(title, body, note, parentSlug) {
  const slug = state.wiki.slug;
  zapiszWersjeRobocza(slug, { title, body, parentSlug });
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("Somebody saved this page before you")}</h2>
      <p class="mhint">${t("Since you started writing, somebody else changed this page. Your text is safe - it stayed in the editor and in this browser. Choose what happens next.")}</p>
      <div class="kw-opcje">
        <button class="kw-opt" id="kw-porownaj">
          <b>${t("Show what changed")}</b>
          <span>${t("Opens the current version in a new tab. Yours stays here so you can weave it in.")}</span>
        </button>
        <button class="kw-opt" id="kw-nadpisz">
          <b>${t("Save my version anyway")}</b>
          <span>${t("Your text becomes the current one. That other change does not disappear - it stays in the page history.")}</span>
        </button>
        <button class="kw-opt" id="kw-wroc">
          <b>${t("Back to the editor")}</b>
          <span>${t("I save nothing. You fix the text and try again.")}</span>
        </button>
      </div>`, { modalClass: "wide" });
  modal.querySelector("#kw-porownaj").addEventListener("click", () => {
    window.open(`/api/wiki/${encodeURIComponent(slug)}`, "_blank", "noopener");
  });
  modal.querySelector("#kw-wroc").addEventListener("click", close);
  modal.querySelector("#kw-nadpisz").addEventListener("click", async () => {
    close();
    try {
      // Dociagamy AKTUALNY numer wersji i zapisujemy na jego podstawie: to jest
      // swiadome "wiem, ze ktos zmienil, i tak chce swoje", a nie wyscig.
      const swieza = await api("GET", `/api/wiki/${encodeURIComponent(slug)}`);
      state.wiki.page = swieza.page;
      await saveWikiEdit(title, body, note, parentSlug);
    } catch (e) { showError(e); }
  });
}

async function viewWikiRevision(revId) {
  try {
    const data = await api("GET", `/api/wiki/${encodeURIComponent(state.wiki.slug)}/revisions/${revId}`);
    state.wiki.revision = data.revision;
    state.wiki.editing = false;
    renderWikiMain();
  } catch (e) { showError(e); }
}

async function revertWikiTo(revId) {
  if (!await confirmModal({
    title: t("Restore this version?"),
    body: t("The page content goes back to what you see. Nothing is lost - the current version stays in the history and can be returned to the same way."),
    ok: t("Restore this version"),
  })) return;
  try {
    const data = await api("POST", `/api/wiki/${encodeURIComponent(state.wiki.slug)}/revert`, { revisionId: revId });
    state.wiki.page = data.page;
    state.wiki.revision = null;
    const hist = await api("GET", `/api/wiki/${encodeURIComponent(state.wiki.slug)}/history`);
    state.wiki.history = hist.revisions;
    loadWikiList();
    renderWikiMain();
    showToast(t("Restored. The previous content stayed in the history."));
  } catch (e) { showError(e); }
}

/** Odtworzenie skasowanej strony z danych, ktore serwer oddal przy kasowaniu.
 *  baseRevision=0 znaczy "zaloz, jesli takiej nie ma" - a po skasowaniu takiej
 *  nie ma, wiec to jest dokladnie ta sciezka. Historia sprzed skasowania nie
 *  wraca i trzeba to powiedziec wprost, zamiast udawac pelne cofniecie. */
async function odtworzStroneWiki(deleted) {
  if (!deleted) return;
  try {
    await api("PUT", `/api/wiki/${encodeURIComponent(deleted.slug)}`, {
      title: deleted.title,
      body: deleted.body,
      parentSlug: deleted.parentSlug ?? null,
      note: t("restoring a deleted page"),
      baseRevision: 0,
    });
    await loadWikiList();
    openWikiPage(deleted.slug);
    showToast(t("The page is back. The history from before the deletion is not - this version is the first one."));
  } catch (e) { showError(e); }
}

/** Sciezka przodkow strony ("Infra / VPS / ") - kazdy czlon klikalny. */
function wikiBreadcrumbHtml(page) {
  if (!page || !page.parentSlug) return "";
  const bySlug = new Map(state.wiki.pages.map((p) => [p.slug, p]));
  const path = [];
  let cur = page.parentSlug, hops = 0;
  while (cur && hops++ < 20) {
    const p = bySlug.get(cur);
    if (!p) break;
    path.unshift(p);
    cur = p.parentSlug;
  }
  if (!path.length) return "";
  return `<span class="crumbs">${path.map((p) =>
    `<a href="#" data-crumb="${escapeHtml(p.slug)}">${escapeHtml(p.title || p.slug)}</a>`,
  ).join(`<span class="sep">/</span>`)}<span class="sep">/</span></span>`;
}

export function renderWikiMain(loading) {
  const el = document.getElementById("main");
  if (!el) return;
  const w = state.wiki;
  const page = w.page;
  const title = w.editing && w.draft ? w.draft.title : (w.revision ? w.revision.title : page?.title ?? w.slug);
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title">
        <div class="t">${iconDoc()} ${wikiBreadcrumbHtml(page)}${escapeHtml(title ?? "")}
          <span id="wiki-typing">${widok.pisze(`w:${w.slug}`)}</span></div>
        <div class="topic">${page ? t("version {n} · last changed by @{who} {when}", { n: page.revisions, who: escapeHtml(page.updatedBy ?? "?"), when: timeAgo(page.updatedAt) }) : t("a new page, not saved yet")}</div>
      </div>
      ${!w.editing && !w.revision && (page || w.draft) ? `<button class="pillbtn" id="wiki-edit">${iconEdit()} ${t("Edit")}</button>` : ""}
      ${!w.editing && !w.revision && page && (page.createdBy === state.actor.handle || state.actor.isAdmin)
        ? `<button class="iconbtn" id="wiki-delete" aria-label="${t("Delete page")}" title="${t("Delete page")}">${iconTrash()}</button>` : ""}
    </div>
    <div class="wiki-body viewfade">
      <div class="wiki-content" id="wiki-content"></div>
      <aside class="wiki-side" id="wiki-side"></aside>
    </div>`;
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  el.querySelectorAll("[data-crumb]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); openWikiPage(a.dataset.crumb); }));
  const delBtn = document.getElementById("wiki-delete");
  if (delBtn) delBtn.addEventListener("click", async () => {
    // Kasowanie zabiera takze historie, wiec pytamy NAZWA strony, a nie samym
    // "na pewno?" - zeby klik w zly wiersz nie kosztowal dzialu wiki.
    if (!await confirmModal({
      title: t("Delete the page “{title}”?", { title: page.title }),
      body: t("It goes away together with its change history and attachments. Subpages do not disappear - they move one level up."),
      ok: t("Delete page"), danger: true,
    })) return;
    const kasowany = w.slug;
    kasowaneStrony.add(kasowany);
    try {
      // Serwer oddaje przy kasowaniu KOMPLET danych strony (tytul, tresc,
      // rodzica) - czyli wszystko, czego trzeba, zeby ja odtworzyc. Skoro tak,
      // "skasowane" nie musi znaczyc "nie do odzyskania": daje to na cofniecie
      // tyle czasu, ile trwa zrozumienie, ze kliknelo sie nie tam.
      const { deleted } = await api("DELETE", `/api/wiki/${encodeURIComponent(kasowany)}`);
      state.wiki.page = null; state.wiki.slug = null; state.view = "chat";
      loadWikiList(); widok.render();
      showToast(t("Deleted “{title}”.", { title: deleted?.title ?? page.title }), {
        action: { label: t("Undo"), onClick: () => { kasowaneStrony.delete(kasowany); odtworzStroneWiki(deleted); } },
      });
    } catch (e) { showError(e); }
    // Blokada zdejmowana z opoznieniem: dosylka SSE potrafi przyjsc po
    // odpowiedzi na DELETE, a nie tylko przed nia.
    finally { setTimeout(() => kasowaneStrony.delete(kasowany), 3000); }
  });
  const editBtn = document.getElementById("wiki-edit");
  if (editBtn) editBtn.addEventListener("click", () => {
    // Wersja robocza z poprzedniego podejscia wygrywa z trescia na serwerze:
    // jesli cos tu zostalo, to znaczy, ze uzytkownik tego nie dokonczyl.
    const robocza = wczytajWersjeRobocza(w.slug);
    w.editing = true;
    w.draft = robocza
      ? { title: robocza.title || page?.title || w.slug, body: robocza.body ?? "", parentSlug: robocza.parentSlug }
      : { title: page?.title ?? w.slug, body: page?.body ?? "" };
    renderWikiMain();
    if (robocza) showToast(t("I brought back your unsaved version from last time."));
  });
  renderWikiContent(loading);
  renderWikiSide();
}

function renderWikiContent(loading) {
  const el = document.getElementById("wiki-content");
  if (!el) return;
  const w = state.wiki;
  if (loading) { el.innerHTML = skeletonHtml(); return; }

  if (w.editing) {
    const d = w.draft || { title: w.page?.title ?? w.slug, body: w.page?.body ?? "" };
    // Umiejscowienie w drzewie: dowolna strona poza soba i wlasnym poddrzewem
    // (serwer i tak odrzuci cykl, ale nie ma co go proponowac).
    const descendants = new Set([w.slug]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of state.wiki.pages) {
        if (p.parentSlug && descendants.has(p.parentSlug) && !descendants.has(p.slug)) {
          descendants.add(p.slug); grew = true;
        }
      }
    }
    const currentParent = d.parentSlug !== undefined ? d.parentSlug : (w.page?.parentSlug ?? null);
    const options = state.wiki.pages
      .filter((p) => !descendants.has(p.slug))
      .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug, locale()))
      .map((p) => `<option value="${escapeHtml(p.slug)}" ${p.slug === currentParent ? "selected" : ""}>${escapeHtml(p.title || p.slug)}</option>`)
      .join("");
    el.innerHTML = `
      <div class="wiki-editor">
        <label class="sr-only" for="we-title">${t("Page title")}</label>
        <input id="we-title" class="we-title" placeholder="${t("Page title")}">
        <label class="sr-only" for="we-body">${t("Page content (markdown)")}</label>
        <textarea id="we-body" class="we-body" placeholder="${t("Content in markdown... # heading, **bold**, - list, \`\`\`code\`\`\`")}"></textarea>
        <div class="we-foot">
          <span class="we-zapis" id="we-zapis" aria-live="polite"></span>
          <label class="we-where" for="we-parent">${t("in:")} </label>
          <select id="we-parent" class="we-parent">
            <option value="">${t("(wiki root)")}</option>${options}
          </select>
          <label class="sr-only" for="we-note">${t("Change description")}</label>
          <input id="we-note" class="we-note" placeholder="${t("What you are changing (optional)")}">
          <button class="btn ghost" id="we-cancel">${t("Cancel")}</button>
          <button class="btn slim" id="we-save">${t("Save")}</button>
        </div>
      </div>`;
    const ti = el.querySelector("#we-title"), b = el.querySelector("#we-body"), n = el.querySelector("#we-note");
    const par = el.querySelector("#we-parent");
    const znacznik = el.querySelector("#we-zapis");
    ti.value = d.title; b.value = d.body;
    // Autozapis wersji roboczej: co sekunde bezruchu, do localStorage. Nie
    // zastepuje zapisu na serwer i mowi to wprost - ma tylko sprawic, zeby
    // zamkniecie karty, F5 albo klik w inna strone nie kosztowaly calego tekstu.
    let autoTimer = null;
    const autozapis = () => {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        zapiszWersjeRobocza(w.slug, { title: ti.value, body: b.value, parentSlug: par.value || null });
        if (znacznik) znacznik.textContent = t("draft kept in the browser");
      }, 1000);
    };
    // Edycja wiki tez sygnalizuje pisanie - kuleczka przy stronie u innych.
    b.addEventListener("input", () => { signalTyping(`w:${w.slug}`); autozapis(); });
    ti.addEventListener("input", autozapis);
    par.addEventListener("change", autozapis);
    el.querySelector("#we-cancel").addEventListener("click", async () => {
      if (!await mozeszOpuscicEdytorWiki()) return;
      clearTimeout(autoTimer);
      w.editing = false; w.draft = null;
      if (!w.page) { state.view = "chat"; widok.sidebar(); widok.glowny(); return; }
      renderWikiMain();
    });
    el.querySelector("#we-save").addEventListener("click", () =>
      saveWikiEdit(ti.value.trim() || w.slug, b.value, n.value.trim(), par.value || null));
    b.focus();
    return;
  }

  const rev = w.revision;
  const body = rev ? rev.body : (w.page?.body ?? "");
  el.innerHTML = `
    ${rev ? `
    <div class="rev-banner">
      ${iconHistory()} ${t("You are looking at the version from <b>{when}</b> (@{who})", { when: fmtDateTime(rev.createdAt), who: escapeHtml(rev.actor ?? "?") })}
      <span class="rb-actions">
        <button id="rb-back">${t("Back to the newest")}</button>
        <button id="rb-revert" class="accent">${t("Restore this version")}</button>
      </span>
    </div>` : ""}
    <article class="md ${rev ? "dimmed" : ""}">${mdToHtml(body, "page", state.actor.handle) || `<p class="mdempty">${t("This page is still empty - click Edit and write the first content.")}</p>`}</article>`;
  const back = el.querySelector("#rb-back");
  if (back) back.addEventListener("click", () => { w.revision = null; renderWikiMain(); });
  const rvt = el.querySelector("#rb-revert");
  if (rvt) rvt.addEventListener("click", () => revertWikiTo(rev.id));
  widok.podepnijTresc(el);   // copy button, wiki links and the lightbox inside the page
}

function renderWikiSide() {
  const el = document.getElementById("wiki-side");
  if (!el) return;
  const w = state.wiki;
  const page = w.page;
  el.innerHTML = `
    <div class="seg small" role="tablist" aria-label="${t("Page information")}">
      <button role="tab" aria-selected="${w.tab === "info"}" aria-controls="wiki-side-body"
        data-wtab="info" class="${w.tab === "info" ? "on" : ""}">${t("Info")}</button>
      <button role="tab" aria-selected="${w.tab === "history"}" aria-controls="wiki-side-body"
        data-wtab="history" class="${w.tab === "history" ? "on" : ""}">${t("History")}${w.history.length ? ` (${w.history.length})` : ""}</button>
    </div>
    <div id="wiki-side-body" role="tabpanel"></div>`;
  el.querySelectorAll("[data-wtab]").forEach((b) =>
    b.addEventListener("click", () => { w.tab = b.dataset.wtab; renderWikiSide(); }));
  const body = el.querySelector("#wiki-side-body");
  if (w.tab === "info") {
    body.innerHTML = page ? `
      <dl class="winfo">
        <dt>${t("Created by")}</dt><dd>@${escapeHtml(page.createdBy ?? "?")} · ${fmtDateTime(page.createdAt)}</dd>
        <dt>${t("Last change")}</dt><dd>@${escapeHtml(page.updatedBy ?? "?")} · ${fmtDateTime(page.updatedAt)}</dd>
        <dt>${t("Versions")}</dt><dd>${page.revisions}</dd>
        <dt>${t("Size")}</dt><dd>${formatBytes(new Blob([page.body]).size)}</dd>
      </dl>
      ${w.files.length ? `
      <h4 class="wsub">${t("Attachments")}</h4>
      ${w.files.map((f) => `
        <a class="attachment slim" href="/api/files/${encodeURIComponent(f.id)}" download="${escapeHtml(f.name)}">
          <span class="fic">${iconFile()}</span>
          <span><span class="fname">${escapeHtml(f.name)}</span><br><span class="fsize">${formatBytes(f.size)}</span></span>
        </a>`).join("")}` : ""}
    ` : `<p class="sb-empty">${t("This page has not been saved yet - the information appears after the first save.")}</p>`;
  } else {
    body.innerHTML = w.history.length ? `
      <div class="wh-list">
        ${w.history.map((r, i) => {
          const current = i === 0;
          const viewing = w.revision ? w.revision.id === r.id : current;
          return `
          <button class="wh-row ${viewing ? "sel" : ""}" data-rev="${r.id}" data-current="${current ? "1" : ""}"
            ${viewing ? `aria-current="true"` : ""} aria-label="${t("Version from {when}, @{who}", { when: fmtDateTime(r.createdAt), who: escapeHtml(r.actor ?? "?") })}">
            ${avatarHtml(r.actor ?? "?", 24)}
            <span class="wh-main">
              <span class="wh-actor">@${escapeHtml(r.actor ?? "?")}${current ? ` <span class="wh-tag">${t("current")}</span>` : ""}</span>
              <span class="wh-when">${fmtDateTime(r.createdAt)}</span>
              ${r.note ? `<span class="wh-note">${escapeHtml(r.note)}</span>` : ""}
            </span>
          </button>`;
        }).join("")}
      </div>` : `<p class="sb-empty">${t("The history appears after the first save. Every change stays here with a name and a date.")}</p>`;
    body.querySelectorAll("[data-rev]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.current) { w.revision = null; renderWikiMain(); }
        else viewWikiRevision(Number(b.dataset.rev));
      }));
  }
}
