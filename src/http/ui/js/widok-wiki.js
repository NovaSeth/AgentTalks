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

// --------------------------------------------------- the wiki editor's draft
// The chat has long kept a message draft that survives F5 and a deployment; the wiki editor
// kept nothing, and it is where the longest texts are written. Leaving the editor (Cancel, a
// click on another page, closing the tab) erased them without asking.
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

/** Whether the editor holds anything the server does not have. */
function saNiezapisaneZmiany() {
  const w = state.wiki;
  if (!w.editing || !w.draft) return false;
  const tytul = document.getElementById("we-title")?.value ?? w.draft.title;
  const tresc = document.getElementById("we-body")?.value ?? w.draft.body;
  return tytul !== (w.page?.title ?? w.slug) || tresc !== (w.page?.body ?? "");
}

/** Leaving the editor asks instead of erasing. Returns false when the user stays. */
export async function mozeszOpuscicEdytorWiki() {
  if (!saNiezapisaneZmiany()) return true;
  const zapamietaj = () => {
    zapiszWersjeRobocza(state.wiki.slug, {
      title: document.getElementById("we-title")?.value ?? "",
      body: document.getElementById("we-body")?.value ?? "",
      parentSlug: document.getElementById("we-parent")?.value || null,
    });
  };
  zapamietaj();   // save the text first, ask afterwards - in that order
  return await confirmModal({
    title: t("You have unsaved changes on this page"),
    body: t("I saved them as a draft in this browser - they come back when you open the editor again. Leave without saving to the server?"),
    ok: t("Leave, I will come back to it"), cancel: t("Stay and save"),
  });
}

// Pages we are deleting right now. The server broadcasts a `wiki` event for a deleted page as
// well, and the handler for that event reopens the page when you are looking at it. The event
// can outrun the response to DELETE, so the interface tried to load a page it had just told
// to disappear - and showed "There is no such wiki page" next to its own "Deleted".
const kasowaneStrony = new Set();

// ============================================================= WIKI
export async function openWikiPage(slug) {
  if (kasowaneStrony.has(slug)) return;
  // Moving to another page while writing is the most common route to losing text - so we ask
  // here, not only at Cancel.
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
    // Entering a page clears the "N changes" indicator - locally first (the badge disappears at
    // once), then the marker on the server (best effort).
    const item = state.wiki.pages.find((p) => p.slug === slug);
    if (item && item.unseen) { item.unseen = 0; widok.sidebar(); }
    api("POST", `/api/wiki/${encodeURIComponent(slug)}/seen`, {}).catch(() => {});
  } catch (e) {
    if (state.wiki.draft === null) { showError(e); state.view = "chat"; widok.glowny(); return; }
  }
  renderWikiMain();
}

export function newWikiPageModal() {
  // The default placement: the page you are looking at - "I am adding a subpage to what I am
  // reading" is the most common case with a growing tree.
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
    // baseRevision = the revision we saw when opening the page. When somebody saved
    // in the meantime, the server refuses (409) rather than silently erasing their change;
    // for a new page 0 means "create it if it does not exist".
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
    // A conflict is not a save failure but somebody else's change - and it calls for a DECISION,
    // not for a message that vanishes after four seconds.
    //
    // The condition used to test for the word "konflikt" in the error's TEXT, while it lives only
    // in its CODE - so the friendly path never fired once and a human got, in a toast, an
    // instruction with curl in it, written for an agent.
    if (e.code === "konflikt_wiki") { pokazKonfliktWiki(title, body, note, parentSlug); return; }
    showError(e, {
      slug: t("Invalid page address. Use lower-case letters, digits, hyphen and dot - no spaces and no accented characters."),
      slug_zarezerwowany: t("This address is reserved by the system. Pick another one."),
    });
  }
}

/** The conflict window: what happened and three ways out, each of which saves the text.
/**  The draft lands in localStorage BEFORE we show anything - otherwise refreshing the page in
/**  a panic would erase the work we are fighting over. */
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
      // We fetch the CURRENT revision number and save against it: this is a deliberate "I know
      // somebody changed it and I want mine anyway", not a race.
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

/** Restoring a deleted page from the data the server returned when deleting it.
/**  baseRevision=0 means "create it if it does not exist" - and after a deletion it does not,
/**  so this is exactly that path. The history from before the deletion does not come back and
/**  that has to be said outright rather than pretending it is a full undo. */
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

/** The page's ancestor path ("Infra / VPS / ") - every part clickable. */
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
    // Deleting takes the history with it, so we ask with the page's NAME rather than a bare
    // "are you sure?" - so that a click on the wrong row does not cost a wiki section.
    if (!await confirmModal({
      title: t("Delete the page “{title}”?", { title: page.title }),
      body: t("It goes away together with its change history and attachments. Subpages do not disappear - they move one level up."),
      ok: t("Delete page"), danger: true,
    })) return;
    const kasowany = w.slug;
    kasowaneStrony.add(kasowany);
    try {
      // When deleting, the server returns the page's COMPLETE data (title, content, parent) - that
      // is, everything needed to restore it. Given that, "deleted" does not have to mean
      // "unrecoverable": it gives as much time to undo as it takes to realise you clicked the wrong
      // thing.
      const { deleted } = await api("DELETE", `/api/wiki/${encodeURIComponent(kasowany)}`);
      state.wiki.page = null; state.wiki.slug = null; state.view = "chat";
      loadWikiList(); widok.render();
      showToast(t("Deleted “{title}”.", { title: deleted?.title ?? page.title }), {
        action: { label: t("Undo"), onClick: () => { kasowaneStrony.delete(kasowany); odtworzStroneWiki(deleted); } },
      });
    } catch (e) { showError(e); }
    // The lock is lifted with a delay: an SSE replay can arrive after the response to DELETE, not
    // only before it.
    finally { setTimeout(() => kasowaneStrony.delete(kasowany), 3000); }
  });
  const editBtn = document.getElementById("wiki-edit");
  if (editBtn) editBtn.addEventListener("click", () => {
    // A draft from a previous attempt beats the content on the server: if something stayed here,
    // it means the user did not finish it.
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
    // Placement in the tree: any page except itself and its own subtree (the server rejects a
    // cycle anyway, but there is no point in offering one).
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
    // Autosaving the draft: after a second of stillness, into localStorage. It does not replace
    // saving to the server and says so outright - it exists only so that closing the tab, F5 or a
    // click on another page do not cost the whole text.
    let autoTimer = null;
    const autozapis = () => {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        zapiszWersjeRobocza(w.slug, { title: ti.value, body: b.value, parentSlug: par.value || null });
        if (znacznik) znacznik.textContent = t("draft kept in the browser");
      }, 1000);
    };
    // A wiki edit signals typing too - the bubble next to the page for everybody else.
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
