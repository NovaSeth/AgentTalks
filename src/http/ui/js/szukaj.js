/**
 * The Cmd+K palette: conversations and people first (no network), content after.
 */
import { startDirect } from "./akcje.js";
import { api } from "./api.js";
import { ensureActors } from "./dane.js";
import { avatarHtml, escapeHtml, timeAgo } from "./dom.js";
import { iconDoc, iconSearch } from "./ikony.js";
import { t } from "./i18n.js";
import { actorHandle, dmLabel, mergeActors, ostatnieRozmowy, state } from "./stan.js";
import { openConversation } from "./widok-czat.js";
import { openWikiPage } from "./widok-wiki.js";

// ============================================================= SEARCH (Cmd+K)
let searchOverlay = null;

export function openSearchPalette() {
  if (searchOverlay) return;
  searchOverlay = document.createElement("div");
  searchOverlay.className = "overlay palette-overlay";
  searchOverlay.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="${t("Jump to a conversation or search")}">
      <div class="pal-head">${iconSearch()}
        <label class="sr-only" for="pal-input">${t("Jump to a conversation, or search messages and the wiki")}</label>
        <input id="pal-input" placeholder="${t("Jump to a conversation or search...")}" autocomplete="off"></div>
      <div class="pal-results" id="pal-results"></div>
    </div>`;
  document.body.appendChild(searchOverlay);
  const wrocDo = document.activeElement;
  const input = searchOverlay.querySelector("#pal-input");
  const results = searchOverlay.querySelector("#pal-results");
  let items = [], remote = [], sel = 0, debounce = null, seq = 0;
  // The list of people can be stale, and the palette has to be able to start a
  // conversation - so we fetch it in the background without blocking the window.
  ensureActors().then(() => przebuduj());

  const close = () => {
    searchOverlay.remove();
    searchOverlay = null;
    document.removeEventListener("keydown", onKey, true);
    if (wrocDo && document.contains(wrocDo)) wrocDo.focus();
  };
  searchOverlay.addEventListener("click", (e) => { if (e.target === searchOverlay) close(); });

  // Conversations and people are ALREADY in the client's memory, so this section
  // does not wait for the network and sits on top: "jump to #bugs" happens dozens
  // of times a day, "find a message containing bugs" - a few times a week.
  const nazwaRozmowy = (c) => (c.kind === "dm" || c.kind === "group") ? dmLabel(c) : `#${c.slug || c.topic || c.id}`;
  const lokalne = (q) => {
    const norm = q.trim().toLowerCase();
    const moje = state.conversations.filter((c) => state.memberships[c.id]);
    const wybrane = norm
      ? moje.filter((c) => nazwaRozmowy(c).toLowerCase().includes(norm))
      : ostatnieRozmowy(moje);
    const out = wybrane.slice(0, 6).map((c) => ({
      section: t("Conversations"),
      html: `<span class="pal-title">${escapeHtml(nazwaRozmowy(c))}</span>
             <span class="pal-where">${c.topic ? escapeHtml(c.topic) : ""}</span>`,
      go: () => openConversation(c.id),
    }));
    if (!norm) return out;
    for (const a of state.actorsList) {
      if (out.length >= 10) break;
      if (a.handle === state.actor.handle) continue;
      const pasuje = a.handle.toLowerCase().includes(norm) || (a.displayName || "").toLowerCase().includes(norm);
      if (!pasuje) continue;
      out.push({
        section: t("People"),
        html: `${avatarHtml(a.handle, 22)}<span class="pal-title">@${escapeHtml(a.handle)}</span>
               <span class="pal-where">${a.kind === "human" ? t("human") : t("agent")} · ${t("direct conversation")}</span>`,
        go: () => startDirect(a.handle),
      });
    }
    return out;
  };

  const przebuduj = () => {
    if (!searchOverlay) return;
    items = [...lokalne(input.value), ...remote];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    renderResults();
  };

  const renderResults = () => {
    if (!items.length) {
      results.innerHTML = input.value.trim()
        ? `<div class="pal-hint">${t("Nothing found.")}</div>`
        : `<div class="pal-hint">${t("Type a channel or person - or a word you are looking for in the content.")}</div>`;
      return;
    }
    let html = "", lastSection = null;
    items.forEach((it, i) => {
      if (it.section !== lastSection) { html += `<div class="pal-section">${it.section}</div>`; lastSection = it.section; }
      html += `<button class="pal-row ${i === sel ? "sel" : ""}" data-pi="${i}">${it.html}</button>`;
    });
    results.innerHTML = html;
    results.querySelectorAll("[data-pi]").forEach((b) =>
      b.addEventListener("click", () => activate(Number(b.dataset.pi))));
    const selEl = results.querySelector(".pal-row.sel");
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  };

  const activate = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    it.go();
  };

  const doSearch = async (q) => {
    const my = ++seq;
    if (!q.trim()) { remote = []; przebuduj(); return; }
    try {
      const [wiki, msgs] = await Promise.all([
        api("GET", `/api/wiki/search?q=${encodeURIComponent(q)}&limit=5`).catch(() => ({ hits: [] })),
        api("GET", `/api/search?q=${encodeURIComponent(q)}&limit=12`).catch(() => ({ messages: [], actors: {} })),
      ]);
      if (my !== seq) return;
      mergeActors(msgs.actors);
      remote = [];
      for (const h of wiki.hits) {
        remote.push({
          section: t("Wiki"),
          html: `${iconDoc()} <span class="pal-title">${escapeHtml(h.title)}</span>
                 <span class="pal-snip">${escapeHtml(h.snippet).replace(/\[/g, "<mark>").replace(/\]/g, "</mark>")}</span>`,
          go: () => openWikiPage(h.slug),
        });
      }
      for (const m of msgs.messages) {
        const conv = state.conversations.find((c) => c.id === m.conversationId);
        const where = conv ? (conv.slug ? "#" + conv.slug : dmLabel(conv)) : "";
        remote.push({
          section: t("Messages"),
          html: `${avatarHtml(actorHandle(m.actorId), 22)}
                 <span class="pal-title">@${escapeHtml(actorHandle(m.actorId))} <span class="pal-where">${escapeHtml(where)} · ${timeAgo(m.ts)}</span></span>
                 <span class="pal-snip">${escapeHtml(m.body.slice(0, 140))}</span>`,
          go: () => openConversation(m.conversationId, m.id),
        });
      }
      sel = 0;
      przebuduj();
    } catch { if (my === seq) { remote = []; przebuduj(); } }
  };

  input.addEventListener("input", () => {
    // The local section reacts IMMEDIATELY; the network only after 250 ms of stillness.
    przebuduj();
    clearTimeout(debounce);
    debounce = setTimeout(() => doSearch(input.value), 250);
  });
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      renderResults();
    }
    if (e.key === "Enter") { e.preventDefault(); activate(sel); }
  };
  document.addEventListener("keydown", onKey, true);
  input.focus();
  przebuduj();   // with an empty field: the most recently opened conversations
}
