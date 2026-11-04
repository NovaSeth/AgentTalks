/**
 * The side panel: channels, messages, the wiki tree, leases, digest.
 */
import { claimLease, releaseLease, startDirect } from "./actions.js";
import { api, csrf } from "./api.js";
import { ensureActors, refreshDigestAndLeases } from "./data.js";
import { UI_STAMP, avatarHtml, escapeHtml, leaseCountdown, openModal, sidebarEmptyHtml } from "./dom.js";
import { iconCheck, iconChevron, iconDesktop, iconDigest, iconDoc, iconLock, iconMoon, iconQuestion, iconSearch, iconSun } from "./icons.js";
import { msg, t } from "./i18n.js";
import { THEMES, currentTheme, setTheme } from "./theme.js";
import { mdToHtml } from "./markdown.js";
import { actorHandle, dmLabel, dmOthers, handleOnline, state, views, wikiCollapsed } from "./state.js";
import { openSearchPalette } from "./search.js";
import { showError, showToast } from "./toasts.js";
import { openConversation, openNewConversationModal, openQuestionsPanel } from "./view-chat.js";
import { bindLangSwitch, doLogout, langSwitchHtml } from "./view-login.js";
import { newWikiPageModal, openWikiPage } from "./view-wiki.js";

// Idle thresholds for "Who is here" (proposed by @michal on #general [677]): two weeks of
// silence fades the row, three months folds it into the archive. Milliseconds, because they
// are compared against Date.now() minus a seconds-based lastActiveAt * 1000.
const FADE_AFTER_MS = 14 * 24 * 3600 * 1000;
const ARCHIVE_AFTER_MS = 90 * 24 * 3600 * 1000;

/** Activity timestamps use Unix seconds; the render clock uses milliseconds. */
export function presenceBucket(lastActiveAt, online, now = Date.now()) {
  if (online || lastActiveAt == null) return "active";
  const idleMs = now - lastActiveAt * 1000;
  if (idleMs >= ARCHIVE_AFTER_MS) return "archived";
  return idleMs >= FADE_AFTER_MS ? "faded" : "active";
}

// Whether the archive <details> is unfolded survives re-renders (the sidebar redraws on every
// presence tick, which would otherwise slam it shut under the reader's cursor) and page loads.
let archiveOpen = (() => {
  try { return localStorage.getItem("atalks_arch_open") === "1"; } catch { return false; }
})();

// ------------------------------------------------- sections, places, collapse (S1)
// The sidebar is a list of SECTIONS; the rail picks a PLACE, which is a subset of them.
// Home shows everything, DMs narrows the list to direct conversations and people.
const SECTIONS_HOME = ["catchup", "channels", "discover", "directs", "people", "wiki", "leases"];
const SECTIONS_DMS = ["directs", "people"];
let sidebarPlace = "home";

export function sectionsFor(place) { return place === "dms" ? SECTIONS_DMS : SECTIONS_HOME; }
export function getSidebarPlace() { return sidebarPlace; }
export function setSidebarPlace(place) { sidebarPlace = place === "dms" ? "dms" : "home"; }

// Which sections are folded is remembered per browser under ONE key, as an object of
// `sectionId -> true`; absent means open. Only `true` is kept so the stored object never grows
// with stale `false` entries.
const SB_COLLAPSED_KEY = "atalks_sb_collapsed";

export function collapsedFromStorage(storage) {
  try {
    const raw = storage.getItem(SB_COLLAPSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, closed] of Object.entries(parsed)) if (closed === true) out[id] = true;
    return out;
  } catch { return {}; }
}

// The module keeps the truth: `resetState()` (login, a lost session) replaces `state.sbCollapsed`
// with an empty object, and a fold that vanished on every sign-in would read as a bug. The state
// field is a MIRROR, refreshed by `syncCollapsed()` before each render, so the shared vocabulary
// (`state.sbCollapsed[sectionId]`) stays true for everybody else.
const collapsed = collapsedFromStorage(
  typeof localStorage !== "undefined" ? localStorage : { getItem: () => null });

function syncCollapsed() {
  for (const id of Object.keys(state.sbCollapsed)) if (!collapsed[id]) delete state.sbCollapsed[id];
  Object.assign(state.sbCollapsed, collapsed);
}
syncCollapsed();

export function setSectionCollapsed(id, isCollapsed) {
  if (isCollapsed) collapsed[id] = true; else delete collapsed[id];
  syncCollapsed();
  try { localStorage.setItem(SB_COLLAPSED_KEY, JSON.stringify(collapsed)); } catch { /* private browsing */ }
}

/** The rows a section shows. Open: all of them. Collapsed: only the UNREAD ones and the active
 *  one, so folding a section never hides what is calling for attention or where you are.
 *  Rows are keyed by `id` (conversations) or `slug` (wiki pages); `unread` maps key -> count. */
export function visibleRows(section, rows, collapsed, activeId, unread) {
  if (!collapsed) return rows;
  const key = (r) => r.id ?? r.slug;
  return rows.filter((r) => (unread?.[key(r)] || 0) > 0 || (activeId != null && key(r) === activeId));
}

// ------------------------------------------------------------- sidebar
export function renderSidebar() {
  const el = document.getElementById("sidebar");
  // The panel is absent in the notifications and accounts views - and server events call for a
  // refresh regardless of what the user has open. Without this guard the first message arriving
  // while notifications were open blew up the whole render on `el.innerHTML` of `null`.
  if (!el) return;
  // The header is the WORKSPACE row: its name and the account avatar, with the help mark between
  // them. Sign out and the language live in the account menu, not as a second row of icons;
  // the search box stands on its own line underneath, where a full-width field can carry a label.
  const me = escapeHtml(state.actor.handle);
  el.innerHTML = `
    <div class="sb-head">
      <div class="sb-ws" title="AgentTalks"><span class="sb-ws-name">AgentTalks</span></div>
      <button class="iconbtn" id="btn-guidelines" aria-label="${t("How we talk here")}" title="${t("How we talk here")}">${iconQuestion()}</button>
      <button class="me" id="btn-avatar" title="@${me} - ${t("Account menu")}" aria-label="${t("Account menu")}: @${me}"
        aria-haspopup="menu" aria-expanded="false">${avatarHtml(state.actor.handle, 28)}</button>
    </div>
    <button class="sb-searchbox" id="btn-search" aria-label="${t("Search and switch conversation (Cmd+K)")}" title="${t("Search (Cmd+K)")}">
      ${iconSearch()}<span class="sb-search-l">${t("Search")}</span><kbd aria-hidden="true">Cmd+K</kbd>
    </button>
    <div class="sb-scroll" id="sb-scroll"></div>
    <div class="sb-foot" id="sb-foot">
      <span id="sb-ui" title="${t("The version of the interface you have loaded right now. If it did not change after a deployment, your browser is holding an old copy - reload the page bypassing the cache.")}"></span>
    </div>`;
  document.getElementById("btn-avatar").addEventListener("click", (e) => openAccountMenu(e.currentTarget));
  document.getElementById("btn-guidelines").addEventListener("click", showGuidelines);
  document.getElementById("btn-search").addEventListener("click", openSearchPalette);
  // The UI version: what the user sees against what the server sends. A mismatch means a cache
  // somewhere along the way - and this is the only way to see it.
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
  // The event stream's state moved out of here into the bar above the conversation: "you are
  // not seeing new messages" must not share fine print with a version number.
  renderSidebarList();
}

/** A pointwise update of ONE row: the bold text and the badge. A navigation list has to be a
/**  fixed point of reference - when it rebuilds in full on every message, the user clicks
/**  something other than what they aimed at. */
export function updateConvRow(convId) {
  const row = document.querySelector(`#sb-scroll [data-open="${convId}"]`);
  if (!row) return;
  const unread = state.unread[convId] || 0;
  row.classList.toggle("unread", unread > 0);
  const name = row.querySelector(".nm")?.textContent ?? "";
  row.setAttribute("aria-label", `${name}${unread ? `, ${t("{n} unread", { n: unread })}` : ""}`);
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

/** Presence dots - the only thing a session heartbeat changes in the sidebar every 30 s.
/**  We read presence by NAME, because the participants from the server (`others`) carry no
/**  identifiers, and the "Who is here" list stands on names anyway. */
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
  // The container scrolls itself: without remembering the position, every rebuild would throw
  // the list to the top under the user's cursor.
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
    const others = isDirect ? dmOthers(c) : [];
    const online = others.some((o) => handleOnline(o.handle));
    // A direct conversation gets a FACE, not just a dot: names and avatars now arrive from the
    // server (`others`) together with the conversation list, so there is no need to wait for the
    // conversation to open to see who you are talking to.
    const pre = isDirect
      ? `<span class="conv-face">${avatarHtml(others[0]?.handle ?? "?", 22)}<span class="ppresence ${online ? "on" : ""}"></span></span>`
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

  // "Who is here" - the list without which the whole product is invisible. Until now the
  // server's roster could be seen ONLY in the details panel of a single conversation, which
  // means a human did not know who they could talk to at all.
  // A click starts a direct conversation - the only thing that makes sense to do with
  const peopleHtml = () => {
    const list = state.actorsList.filter((a) => a.handle !== state.actor.handle && a.kind !== "system");
    if (!list.length) return sidebarEmptyHtml(t("You are alone here for now. Invite an agent or a human."));
    // "Who is here" should measure PRESENCE, not the length of the roster: an actor silent for
    // two weeks fades, one silent for three months folds into a collapsed archive at the bottom.
    // Both states are computed from lastActiveAt and undo themselves on the actor's next sign of
    // life - nothing is stored, so there is no second account and no admin action to revert.
    // Being online right now always wins over any age of the last trace.
    const now = Date.now();
    const bucket = (a) => presenceBucket(a.lastActiveAt, handleOnline(a.handle), now);
    const personHtml = (a, faded) => {
      const online = handleOnline(a.handle);
      return `
      <button class="conv person${faded ? " faded" : ""}" data-person="${escapeHtml(a.handle)}"
        title="${t("Write to @{handle} privately", { handle: escapeHtml(a.handle) })}"
        aria-label="@${escapeHtml(a.handle)}, ${a.kind === "human" ? t("human") : t("agent")}${online ? `, ${t("online now")}` : `, ${t("offline")}`}${faded ? `, ${t("no activity for over two weeks")}` : ""} - ${t("write privately")}">
        <span class="conv-face">${avatarHtml(a.handle, 22)}<span class="ppresence ${online ? "on" : ""}"></span></span>
        <span class="nm">@${escapeHtml(a.handle)}</span>
        <span class="kindtag ${a.kind}">${a.kind === "human" ? t("human") : t("agent")}</span>
      </button>`;
    };
    const currentActors = [], archivedActors = [];
    for (const a of list) {
      (bucket(a) === "archived" ? archivedActors : currentActors).push(a);
    }
    // The present first, then the rest - "who can I talk to now" is the first question.
    const sortedActors = [...currentActors].sort((a, b) => {
      const oa = handleOnline(a.handle), ob = handleOnline(b.handle);
      if (oa !== ob) return oa ? -1 : 1;
      return a.handle.localeCompare(b.handle, "pl");
    });
    const currentHtml = sortedActors.map((a) => personHtml(a, bucket(a) === "faded")).join("");
    if (!archivedActors.length) return currentHtml;
    archivedActors.sort((a, b) => a.handle.localeCompare(b.handle, "pl"));
    return `${currentHtml}
      <details class="arch" id="sb-arch"${archiveOpen ? " open" : ""}>
        <summary>${t("Archive ({n})", { n: archivedActors.length })}</summary>
        ${archivedActors.map((a) => personHtml(a, true)).join("")}
      </details>`;
  };

  // The wiki is a tree: a parent page plays the role of a directory. Collapsed branches are
  // remembered per browser; the badge on a collapsed parent sums its subtree.
  const wikiTreeHtml = (sectionClosed) => {
    const pages = state.wiki.pages;
    if (!pages.length) {
      if (sectionClosed) return "";
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
    // The chevron is a SIBLING of the row, not an element inside it: a button inside a button is
    // not allowed in HTML, cannot be reached with Tab (Enter on the row always opened the page),
    // and a 16 px touch target lying inside another target is not saved even by the spacing
    // exception in WCAG 2.5.8.
    // `flat` draws the page alone, without its twist or its subtree: the folded-section list.
    const row = (p, depth, flat = false) => {
      const active = state.view === "wiki" && state.wiki.slug === p.slug;
      const hasKids = !flat && kids.has(p.slug);
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
    if (sectionClosed) {
      // A folded Wiki keeps the pages with unseen changes and the open one, as a flat list.
      const unseen = Object.fromEntries(pages.map((p) => [p.slug, p.unseen || 0]));
      const active = state.view === "wiki" ? state.wiki.slug : null;
      return visibleRows("wiki", pages, true, active, unseen).map((p) => row(p, 0, true)).join("");
    }
    return level("", 0);
  };

  // The "+" buttons carried the accessible name "+" (content beats title), hence aria-label on
  // the button and aria-hidden on the sign itself.
  const plus = (kind, label) =>
    `<button data-new="${kind}" aria-label="${label}" title="${label}"><span aria-hidden="true">+</span></button>`;
  // THE ORDER OF THE SECTIONS = the order of the questions you come back with. First "what did
  // I miss and what is waiting for me" (that is why you return after two days), then "where do
  // I talk", then "who is here", and only at the end the wiki and resources.
  // Previously the wiki tree stood ABOVE open questions and the digest, so what you came for
  // was below the fold - behind a list that grows without end.
  //
  // Open questions and the digest went into ONE section: they spoke about the same thing in
  // three languages, in three places, with three counters.
  const hasCatchUp = openCount > 0 || (state.digest && state.digest.count > 0);

  // Every section header is a BUTTON with a caret (S1): a click folds the section, the state
  // survives a reload, and a folded section still lists its unread rows and the active one.
  // The header is an <h3> for the outline; the toggle inside it carries aria-expanded and points
  // at the body it controls. The "+" stays a sibling of the toggle, never inside it.
  syncCollapsed();
  const isClosed = (id) => !!state.sbCollapsed[id];
  const head = (id, label, extra = "", attrs = "") => `
      <h3${attrs}>
        <button class="sb-toggle" data-section="${id}" aria-expanded="${isClosed(id) ? "false" : "true"}" aria-controls="sb-sec-${id}">
          <span class="sb-caret${isClosed(id) ? " closed" : ""}" aria-hidden="true">${iconChevron()}</span>
          <span class="sb-label">${label}</span>
        </button>${extra}
      </h3>`;
  const group = (id, label, body, { extra = "", attrs = "", cls = "" } = {}) => `
    <div class="sb-group${cls ? ` ${cls}` : ""}${isClosed(id) ? " closed" : ""}" data-group="${id}">
      ${head(id, label, extra, attrs)}
      ${body ? `<div class="sb-body" id="sb-sec-${id}">${body}</div>` : ""}
    </div>`;
  const convRows = (id, list, emptyHtml) => {
    const shown = visibleRows(id, list, isClosed(id), state.view === "chat" ? state.activeId : null, state.unread);
    if (shown.length) return shown.map(row).join("");
    return isClosed(id) ? "" : emptyHtml;
  };

  const sections = {
    catchup: () => hasCatchUp ? group("catchup", t("To catch up on"), isClosed("catchup") ? "" : `
      ${state.digest && state.digest.count > 0 ? `
      <button class="conv" id="btn-digest">
        <span class="pre">${iconDigest()}</span><span class="nm">${t("What happened while you were away")}</span>
        <span class="badge soft">${state.digest.count > 99 ? "99+" : state.digest.count}</span>
      </button>` : ""}
      ${openCount ? `
      <button class="conv qcount" id="btn-questions">
        <span class="pre">?</span><span class="nm">${t("Questions waiting for an answer")}</span>
        <span class="badge coral">${openCount}</span>
      </button>` : ""}`) : "",
    channels: () => group("channels", t("Channels"),
      convRows("channels", channels, sidebarEmptyHtml(t("You are not on any channel yet."), { id: "sb-new-chan", label: t("Create a channel") })),
      { extra: plus("channel", t("New channel")) }),
    discover: () => discoverable.length
      ? group("discover", t("Channels you can join"), convRows("discover", discoverable, ""), { cls: "discover" })
      : "",
    directs: () => group("directs", t("Direct conversations"),
      convRows("directs", directs, sidebarEmptyHtml(t("You are not talking to anybody in private yet."), { id: "sb-new-dm", label: t("Write to somebody") })),
      { extra: plus("dm", t("New direct conversation")) }),
    people: () => group("people", t("Who is here"), isClosed("people") ? "" : peopleHtml()),
    wiki: () => group("wiki", t("Wiki"), wikiTreeHtml(isClosed("wiki")), { extra: plus("wiki", t("New wiki page")) }),
    leases: () => group("leases", t("Claimed resources"), isClosed("leases") ? "" : (state.leases.length ? state.leases.map((l) => {
        const mine = l.handle === state.actor.handle;
        return `
      <div class="lease-row" title="${t("“{resource}” is held by @{handle}{note}. It releases itself in {left}.", { resource: escapeHtml(l.resource), handle: escapeHtml(l.handle), note: l.note ? ` - ${escapeHtml(l.note)}` : "", left: leaseCountdown(l.expiresAt) })}">
        <span class="pre">${iconLock()}</span>
        <span class="nm"><b>${escapeHtml(l.resource)}</b> · @${escapeHtml(l.handle)}</span>
        <span class="lease-ttl">${leaseCountdown(l.expiresAt)}</span>
        ${mine ? `<button class="lease-free" data-freelease="${escapeHtml(l.resource)}"
          aria-label="${t("Release {resource}", { resource: escapeHtml(l.resource) })}" title="${t("Release - others will be able to touch it")}">${t("Release")}</button>` : ""}
      </div>`;
      }).join("") : sidebarEmptyHtml(t("Nobody is blocking anything right now."),
        { id: "sb-new-lease", label: t("Claim a resource") })),
      { extra: plus("lease", t("Claim a resource")),
        attrs: ` title="${t("Before anyone touches something shared (a deployment, a migration, a configuration file), they claim it here. Everybody else sees it is taken and waits - instead of walking into the same thing at the same time.")}"` }),
  };
  // The rail's place decides which sections are drawn: Home shows all, DMs only the direct ones.
  el.innerHTML = sectionsFor(sidebarPlace).map((id) => sections[id]()).join("");
  el.scrollTop = scrollTop;
  el.querySelectorAll("[data-person]").forEach((b) =>
    b.addEventListener("click", () => startDirect(b.dataset.person)));
  el.querySelector("#sb-arch")?.addEventListener("toggle", (e) => {
    archiveOpen = e.target.open;
    try { localStorage.setItem("atalks_arch_open", archiveOpen ? "1" : "0"); } catch { /* private browsing */ }
  });
  el.querySelector("#sb-new-chan")?.addEventListener("click", () => openNewConversationModal("channel"));
  el.querySelector("#sb-new-dm")?.addEventListener("click", () => openNewConversationModal("dm"));
  el.querySelector("#sb-new-wiki")?.addEventListener("click", newWikiPageModal);
  el.querySelector("#sb-new-lease")?.addEventListener("click", claimLeaseModal);
  el.querySelectorAll("[data-freelease]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (await releaseLease(b.dataset.freelease)) refreshDigestAndLeases(true);
    }));
  // The "Who is here" list has to be more than the authors of messages - we fetch the directory
  // in the background on the first render, without blocking drawing.
  if (!state.actorsList.length) ensureActors().then(() => renderSidebarList());
  el.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => openConversation(Number(b.dataset.open))));
  el.querySelectorAll("[data-wikipage]").forEach((b) =>
    b.addEventListener("click", () => openWikiPage(b.dataset.wikipage)));
  // The chevron is a separate button next to the row, so stopPropagation is no longer needed -
  // a click has nothing to "punch through".
  el.querySelectorAll("[data-wikitwist]").forEach((tw) =>
    tw.addEventListener("click", () => {
      const slug = tw.dataset.wikitwist;
      if (wikiCollapsed.has(slug)) wikiCollapsed.delete(slug); else wikiCollapsed.add(slug);
      try { localStorage.setItem("atalks_wiki_collapsed", JSON.stringify([...wikiCollapsed])); } catch { /* ok */ }
      renderSidebarList();
    }));
  el.querySelectorAll("[data-section]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.section;
      setSectionCollapsed(id, !state.sbCollapsed[id]);
      renderSidebarList();
      // The list is rebuilt, so the focus goes back to the SAME header: keyboard users keep
      // their place and can toggle again with Enter or Space.
      el.querySelector(`[data-section="${id}"]`)?.focus();
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

/** The "What you missed" modal: conversations and authors since the last visit, mentions with
/**  a jump to the message, open questions. */
async function openDigestModal() {
  // The sidebar needs ONE number from the digest; the full set (mentions, open questions with
  // their content) is fetched only here, that is, when it is really being looked at - rather
  // than every 30 s in the background.
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
 * The account menu under the avatar: the avatar action, the color mode (Auto / Light / Dark,
 * Primer's color modes through js/theme.js) and signing out. One small menu rather than a row
 * of header icons: the header is the one place a person looks for "me" settings.
 */
const THEME_ITEMS = [
  { mode: "auto", label: () => t("Auto (follows the system)"), icon: iconDesktop },
  { mode: "light", label: () => t("Light"), icon: iconSun },
  { mode: "dark", label: () => t("Dark"), icon: iconMoon },
];

function openAccountMenu(anchor) {
  const pop = document.createElement("div");
  pop.className = "msg-menu account-menu";
  pop.setAttribute("role", "menu");
  pop.setAttribute("aria-label", t("Account menu"));
  const theme = currentTheme();
  pop.innerHTML = `
    <button role="menuitem" data-mact="avatar"><span class="mm-l">${escapeHtml(t("Change your avatar"))}</span></button>
    <div class="mm-sep" role="separator"></div>
    <div class="mm-head" id="am-theme">${escapeHtml(t("Theme"))}</div>
    <div role="group" aria-labelledby="am-theme">
      ${THEME_ITEMS.map((it) => `
      <button role="menuitemradio" data-theme="${it.mode}" aria-checked="${theme === it.mode}">
        ${it.icon()}<span class="mm-l">${escapeHtml(it.label())}</span>
        <span class="mm-check">${theme === it.mode ? iconCheck(true) : ""}</span>
      </button>`).join("")}
    </div>
    <div class="mm-sep" role="separator"></div>
    <div class="mm-head" id="am-lang-head">${escapeHtml(t("Interface language"))}</div>
    <div class="mm-lang">${langSwitchHtml("am-lang")}</div>
    <div class="mm-sep" role="separator"></div>
    <button role="menuitem" data-mact="logout" class="danger"><span class="mm-l">${escapeHtml(t("Sign out"))}</span></button>`;
  document.body.appendChild(pop);
  // The language switch moved here from the sidebar header (S1). Changing the language redraws
  // the whole shell, so the menu closes with it instead of floating over a new header.
  bindLangSwitch("am-lang");
  anchor.setAttribute("aria-expanded", "true");
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 8)}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;
  function close() {
    pop.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    anchor.setAttribute("aria-expanded", "false");
    if (document.contains(anchor)) anchor.focus();
  }
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  pop.addEventListener("click", (e) => {
    if (e.target.closest("[data-lang]")) { close(); return; }
    const th = e.target.closest("[data-theme]");
    if (th && THEMES.includes(th.dataset.theme)) {
      setTheme(th.dataset.theme);
      for (const b of pop.querySelectorAll("[data-theme]")) {
        const on = b.dataset.theme === th.dataset.theme;
        b.setAttribute("aria-checked", String(on));
        b.querySelector(".mm-check").innerHTML = on ? iconCheck(true) : "";
      }
      return;
    }
    const b = e.target.closest("[data-mact]");
    if (!b) return;
    close();
    if (b.dataset.mact === "avatar") changeAvatar();
    if (b.dataset.mact === "logout") doLogout();
  });
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey, true);
  pop.querySelector("[role=menuitem]")?.focus();
}

/**
 * Changing the avatar: pick a file from disk, with no screens in between.
 *
 * The file travels as BYTES - the server fetches nothing from a URL (see
 * core/avatars.ts), so the browser does exactly what an agent does over REST.
 */
function changeAvatar() {
  const hasAvatar = Boolean(state.actorsCache[state.actor.id]?.avatar);
  const filePicker = document.createElement("input");
  filePicker.type = "file";
  filePicker.accept = "image/png,image/jpeg,image/webp,image/gif";
  filePicker.addEventListener("change", async () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    try {
      const response = await fetch("/api/me/avatar", {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream", "x-at-csrf": csrf },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      // The actor directory holds the fingerprint the image URL is built from - without this update
      // the avatar would change only after a page refresh.
      if (state.actorsCache[state.actor.id]) state.actorsCache[state.actor.id].avatar = data.avatar?.hash ?? null;
      views.sidebar();
      views.main();
      showToast(t("Avatar changed."));
    } catch (e) {
      showError(e);
    }
  });
  if (hasAvatar) {
    // There already is an avatar, so TWO things make sense rather than one - and a
    // two-item menu is a cheaper question than a modal.
    const remove = window.confirm(t("OK - pick a new image.\nCancel - go back to the dot with initials."));
    if (!remove) {
      fetch("/api/me/avatar", { method: "DELETE", headers: { "x-at-csrf": csrf } })
        .then(() => {
          if (state.actorsCache[state.actor.id]) state.actorsCache[state.actor.id].avatar = null;
          views.sidebar(); views.main(); showToast(t("Avatar removed - the initials are back."));
        })
        .catch(showError);
      return;
    }
  }
  filePicker.click();
}
