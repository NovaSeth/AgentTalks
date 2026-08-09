/**
 * Wiki: strona, edytor, historia, drzewo rewizji.
 */
import { api } from "./api.js";
import { loadWikiList, signalTyping } from "./dane.js";
import { avatarHtml, escapeHtml, fmtDateTime, formatBytes, hamburgerHtml, openModal, skeletonHtml, timeAgo, toggleDrawerClass } from "./dom.js";
import { iconDoc, iconEdit, iconFile, iconHistory, iconTrash } from "./ikony.js";
import { mdToHtml } from "./markdown.js";
import { state, widok } from "./stan.js";
import { showToast } from "./toasty.js";

// ============================================================= WIKI
export async function openWikiPage(slug) {
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
    if (state.wiki.draft === null) { showToast(e.message, { alert: true }); state.view = "chat"; widok.glowny(); return; }
  }
  renderWikiMain();
}

export function newWikiPageModal() {
  // Domyslne polozenie: strona, na ktora wlasnie patrzysz - "dopisuje podstrone
  // do tego, co czytam" to najczestszy przypadek przy rosnacym drzewie.
  const defaultParent = state.view === "wiki" && state.wiki.page ? state.wiki.page.slug : "";
  const options = state.wiki.pages
    .slice()
    .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug, "pl"))
    .map((p) => `<option value="${escapeHtml(p.slug)}" ${p.slug === defaultParent ? "selected" : ""}>${escapeHtml(p.title || p.slug)}</option>`)
    .join("");
  const { modal, close } = openModal(`
      <h2 id="m-title">Nowa strona wiki</h2>
      <div class="field"><label for="nw-slug">Adres (slug)</label><input id="nw-slug" placeholder="np. jak-wdrazac"></div>
      <div class="field"><label for="nw-title">Tytuł</label><input id="nw-title" placeholder="np. Jak wdrażać"></div>
      <div class="field"><label for="nw-parent">Umiejscowienie</label><select id="nw-parent">
        <option value="" ${defaultParent ? "" : "selected"}>(korzeń wiki)</option>${options}
      </select></div>
      <p class="mhint">Wiki jest wspólna - każdy zalogowany może czytać i edytować. Historia zapisze, kto co zmienił.</p>
      <div class="row"><button class="btn ghost" id="nw-cancel">Anuluj</button><button class="btn" id="nw-create">Utwórz</button></div>`);
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
    const hist = await api("GET", `/api/wiki/${encodeURIComponent(slug)}/history`);
    state.wiki.history = hist.revisions;
    loadWikiList();
    renderWikiMain();
    showToast("Zapisano stronę wiki");
  } catch (e) {
    // Konflikt to nie awaria zapisu tylko cudza zmiana - pokazujemy ja, zamiast
    // kazac uzytkownikowi zgadywac, co poszlo nie tak. Wersja robocza zostaje
    // w edytorze, wiec nic z jego pracy nie ginie.
    if (/konflikt/i.test(e.message || "")) {
      showToast("Ktoś zapisał tę stronę w międzyczasie. Otwórz ją na nowo w drugiej karcie, " +
        "wkomponuj swoją zmianę i zapisz jeszcze raz - Twój tekst zostaje w edytorze.");
    } else {
      showToast(e.message);
    }
  }
}

async function viewWikiRevision(revId) {
  try {
    const data = await api("GET", `/api/wiki/${encodeURIComponent(state.wiki.slug)}/revisions/${revId}`);
    state.wiki.revision = data.revision;
    state.wiki.editing = false;
    renderWikiMain();
  } catch (e) { showToast(e.message); }
}

async function revertWikiTo(revId) {
  if (!confirm("Przywrócić tę wersję? Zostanie zapisana jako nowa rewizja (nic nie ginie).")) return;
  try {
    const data = await api("POST", `/api/wiki/${encodeURIComponent(state.wiki.slug)}/revert`, { revisionId: revId });
    state.wiki.page = data.page;
    state.wiki.revision = null;
    const hist = await api("GET", `/api/wiki/${encodeURIComponent(state.wiki.slug)}/history`);
    state.wiki.history = hist.revisions;
    loadWikiList();
    renderWikiMain();
    showToast("Przywrócono wersję (dopisana jako nowa rewizja)");
  } catch (e) { showToast(e.message); }
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
        <div class="topic">${page ? `rew. ${page.revisions} · @${escapeHtml(page.updatedBy ?? "?")} · ${timeAgo(page.updatedAt)}` : "nowa strona"}</div>
      </div>
      ${!w.editing && !w.revision && (page || w.draft) ? `<button class="pillbtn" id="wiki-edit">${iconEdit()} Edytuj</button>` : ""}
      ${!w.editing && !w.revision && page && (page.createdBy === state.actor.handle || state.actor.isAdmin)
        ? `<button class="iconbtn" id="wiki-delete" aria-label="Skasuj stronę" title="Skasuj stronę">${iconTrash()}</button>` : ""}
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
    // Kasowanie jest nieodwracalne (razem z historia), wiec pytamy nazwa strony,
    // a nie samym "na pewno?" - zeby klik w zly wiersz nie kosztowal dzialu wiki.
    if (!confirm(`Skasować stronę "${page.title}" wraz z jej historią? Podstrony przejdą wyżej, nie znikną.`)) return;
    try {
      await api("DELETE", `/api/wiki/${encodeURIComponent(w.slug)}`);
      showToast(`Skasowano stronę "${page.title}"`);
      state.wiki.page = null; state.wiki.slug = null; state.view = "chat";
      loadWikiList(); widok.render();
    } catch (e) { showToast(e.message); }
  });
  const editBtn = document.getElementById("wiki-edit");
  if (editBtn) editBtn.addEventListener("click", () => {
    w.editing = true;
    w.draft = { title: page?.title ?? w.slug, body: page?.body ?? "" };
    renderWikiMain();
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
      .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug, "pl"))
      .map((p) => `<option value="${escapeHtml(p.slug)}" ${p.slug === currentParent ? "selected" : ""}>${escapeHtml(p.title || p.slug)}</option>`)
      .join("");
    el.innerHTML = `
      <div class="wiki-editor">
        <label class="sr-only" for="we-title">Tytuł strony</label>
        <input id="we-title" class="we-title" placeholder="Tytuł strony">
        <label class="sr-only" for="we-body">Treść strony (markdown)</label>
        <textarea id="we-body" class="we-body" placeholder="Treść w markdown... # naglowek, **pogrubienie**, - lista, \`\`\`kod\`\`\`"></textarea>
        <div class="we-foot">
          <label class="we-where" for="we-parent">w: </label>
          <select id="we-parent" class="we-parent">
            <option value="">(korzeń wiki)</option>${options}
          </select>
          <label class="sr-only" for="we-note">Opis zmiany</label>
          <input id="we-note" class="we-note" placeholder="Opis zmiany (opcjonalnie)">
          <button class="btn ghost" id="we-cancel">Anuluj</button>
          <button class="btn slim" id="we-save">Zapisz</button>
        </div>
      </div>`;
    const t = el.querySelector("#we-title"), b = el.querySelector("#we-body"), n = el.querySelector("#we-note");
    const par = el.querySelector("#we-parent");
    t.value = d.title; b.value = d.body;
    // Edycja wiki tez sygnalizuje pisanie - kuleczka przy stronie u innych.
    b.addEventListener("input", () => signalTyping(`w:${w.slug}`));
    el.querySelector("#we-cancel").addEventListener("click", () => {
      w.editing = false; w.draft = null;
      if (!w.page) { state.view = "chat"; widok.sidebar(); widok.glowny(); return; }
      renderWikiMain();
    });
    el.querySelector("#we-save").addEventListener("click", () =>
      saveWikiEdit(t.value.trim() || w.slug, b.value, n.value.trim(), par.value || null));
    b.focus();
    return;
  }

  const rev = w.revision;
  const body = rev ? rev.body : (w.page?.body ?? "");
  el.innerHTML = `
    ${rev ? `
    <div class="rev-banner">
      ${iconHistory()} Przeglądasz wersję z <b>${fmtDateTime(rev.createdAt)}</b> (@${escapeHtml(rev.actor ?? "?")})
      <span class="rb-actions">
        <button id="rb-back">Wróć do najnowszej</button>
        <button id="rb-revert" class="accent">Przywróć tę wersję</button>
      </span>
    </div>` : ""}
    <article class="md ${rev ? "dimmed" : ""}">${mdToHtml(body, "page", state.actor.handle) || `<p class="mdempty">Ta strona jest jeszcze pusta - kliknij Edytuj i dopisz pierwszą treść.</p>`}</article>`;
  const back = el.querySelector("#rb-back");
  if (back) back.addEventListener("click", () => { w.revision = null; renderWikiMain(); });
  const rvt = el.querySelector("#rb-revert");
  if (rvt) rvt.addEventListener("click", () => revertWikiTo(rev.id));
  widok.podepnijTresc(el);   // copybtn, wikilinki i lightbox w tresci strony
}

function renderWikiSide() {
  const el = document.getElementById("wiki-side");
  if (!el) return;
  const w = state.wiki;
  const page = w.page;
  el.innerHTML = `
    <div class="seg small" role="tablist" aria-label="Informacje o stronie">
      <button role="tab" aria-selected="${w.tab === "info"}" aria-controls="wiki-side-body"
        data-wtab="info" class="${w.tab === "info" ? "on" : ""}">Info</button>
      <button role="tab" aria-selected="${w.tab === "history"}" aria-controls="wiki-side-body"
        data-wtab="history" class="${w.tab === "history" ? "on" : ""}">Historia${w.history.length ? ` (${w.history.length})` : ""}</button>
    </div>
    <div id="wiki-side-body" role="tabpanel"></div>`;
  el.querySelectorAll("[data-wtab]").forEach((b) =>
    b.addEventListener("click", () => { w.tab = b.dataset.wtab; renderWikiSide(); }));
  const body = el.querySelector("#wiki-side-body");
  if (w.tab === "info") {
    body.innerHTML = page ? `
      <dl class="winfo">
        <dt>Utworzył</dt><dd>@${escapeHtml(page.createdBy ?? "?")} · ${fmtDateTime(page.createdAt)}</dd>
        <dt>Ostatnia zmiana</dt><dd>@${escapeHtml(page.updatedBy ?? "?")} · ${fmtDateTime(page.updatedAt)}</dd>
        <dt>Wersji</dt><dd>${page.revisions}</dd>
        <dt>Rozmiar</dt><dd>${formatBytes(new Blob([page.body]).size)}</dd>
      </dl>
      ${w.files.length ? `
      <h4 class="wsub">Załączniki</h4>
      ${w.files.map((f) => `
        <a class="attachment slim" href="/api/files/${encodeURIComponent(f.id)}" download="${escapeHtml(f.name)}">
          <span class="fic">${iconFile()}</span>
          <span><span class="fname">${escapeHtml(f.name)}</span><br><span class="fsize">${formatBytes(f.size)}</span></span>
        </a>`).join("")}` : ""}
    ` : `<p class="sb-empty">Strona jeszcze nie zapisana.</p>`;
  } else {
    body.innerHTML = w.history.length ? `
      <div class="wh-list">
        ${w.history.map((r, i) => {
          const current = i === 0;
          const viewing = w.revision ? w.revision.id === r.id : current;
          return `
          <button class="wh-row ${viewing ? "sel" : ""}" data-rev="${r.id}" data-current="${current ? "1" : ""}"
            ${viewing ? `aria-current="true"` : ""} aria-label="Wersja z ${fmtDateTime(r.createdAt)}, @${escapeHtml(r.actor ?? "?")}">
            ${avatarHtml(r.actor ?? "?", 24)}
            <span class="wh-main">
              <span class="wh-actor">@${escapeHtml(r.actor ?? "?")}${current ? ` <span class="wh-tag">aktualna</span>` : ""}</span>
              <span class="wh-when">${fmtDateTime(r.createdAt)}</span>
              ${r.note ? `<span class="wh-note">${escapeHtml(r.note)}</span>` : ""}
            </span>
          </button>`;
        }).join("")}
      </div>` : `<p class="sb-empty">Brak historii.</p>`;
    body.querySelectorAll("[data-rev]").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.current) { w.revision = null; renderWikiMain(); }
        else viewWikiRevision(Number(b.dataset.rev));
      }));
  }
}
