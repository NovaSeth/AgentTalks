/**
 * AgentTalks - the interface glue. Vanilla ES modules, no bundler, no dependencies.
 *
 * This file is the ROOT: it alone knows every view at once. That is what lets the
 * lower layers (state, data, actions, event stream) avoid importing anything that
 * draws - they receive the drawing functions through the `views` registry, and the
 * import graph stays acyclic.
 *
 * Apart from registering the views, only what is global by nature lives here: the
 * application shell, the boot sequence, and window-wide keyboard shortcuts.
 */
import {
  conversationBySlug, ensureActors, loadConversationsList, loadWikiList, markReadDebounced, refreshDigestAndLeases,
  refreshNotifications, refreshPresence, registerPresenceSession, startDigestTimer,
} from "./data.js";
import { sessionGeneration } from "./api.js";
import { $app, emptyStateHtml, escapeHtml, isScrolledToBottom, repinIfPinned, scrollToBottom, toggleDrawerClass, updateTitleBadge } from "./dom.js";
import { onLangChange, t } from "./i18n.js";
import { iconBell, iconChat, iconDoc, iconLock, iconSearch, iconSend, iconUsers } from "./icons.js";
import { dmOthers, lastConvId, lastMessageId, rebuildMentionRe, saveDraft, state, registerViews } from "./state.js";
import { startDirect } from "./actions.js";
import { buildRoute, consumeOwnPush, hashOfEvent, parseRoute, syncRoute } from "./router.js";
import { showToast } from "./toasts.js";
import { openSearchPalette, openSearchRoute } from "./search.js";
import { matchShortcut, openShortcutHelp, stepConversation, stepUnread } from "./shortcuts.js";
import { railBadges } from "./counters.js";
import { openUnreadsView, renderUnreadsMain } from "./view-unreads.js";
import { openThreadsView, renderThreadsMain } from "./view-threads.js";
import { findInConversation, renderSearchMain } from "./view-search.js";
import { openUsersView, renderUsersMain, resetUsersError } from "./view-admin.js";
import {
  bindMessageEvents, closeThread, openConversation, openThread, refreshDetailsData, renderComposer,
  renderDetails, renderMain, renderMessages, renderPresenceBar, renderThread, renderTopbar,
  toggleSidePanel, typingFacesHtml, updateOfflineBar, upsertMessageNode,
} from "./view-chat.js";
import { maybeOfferPasskey, renderLogin, tryRestoreSession } from "./view-login.js";
import { openNotificationsView, renderNotificationsMain, showNewsModal } from "./view-notifications.js";
import { followPlace, getSidebarPlace, renderSidebar, renderSidebarList, setSectionCollapsed, setSidebarPlace, updateConvRow, updatePresenceDots } from "./view-sidebar.js";
import { openWikiPage, renderWikiMain } from "./view-wiki.js";
import { connectSSE, ensureSSE } from "./sse-events.js";

// -------------------------------------------------------------------- shell
function render() {
  if (!state.actor) { renderLogin(); return; }
  renderShell();
}

function renderShell() {
  // Icon rail: a fixed navigation strip on the far left. Three PLACES, not three
  // shortcuts to the same one: notifications ("what called me"), conversations
  // ("where we talk"), users ("who has access"). The badge on the bell is the one
  // counter visible without entering anything.
  const adminHuman = state.actor?.isAdmin && state.actor?.kind === "human";
  const withSidebar = hasSidebar();
  const inConv = inConversations();
  // T-MG-38: a conversation or a wiki page opened through a full render (openConversation calls
  // views.render) settles the rail place BEFORE the rail is drawn from it.
  followPlace();
  // The DMs place counts every unread message in a direct or group conversation I belong to
  // (W2-S1-C: derived in one place, repainted by paintDmBadge when a row's unread changes;
  // W5-S8-B: that place is counters.railBadges, the one source of both rail badges).
  const dmUnread = railBadges(state).dms;
  $app.innerHTML = `
    <div class="shell with-rail ${withSidebar ? "" : "without-sidebar"} ${state.drawerOpen ? "drawer" : ""}" id="shell">
      <div class="scrim" id="scrim"></div>
      <nav class="rail" id="rail" aria-label="${t("Main navigation")}">
        ${railButton("rail-chats", t("Home"), t("Channels and conversations"), iconChat(), inConv && getSidebarPlace() === "home")}
        ${railButton("rail-dms", t("DMs"), t("Direct messages"), iconSend(), inConv && getSidebarPlace() === "dms",
          { id: "rail-dm-badge", count: dmUnread, label: t("{n} unread", { n: dmUnread }) }, t("Direct messages"))}
        ${railButton("rail-notif", t("Activity"), t("Notifications: mentions, direct messages, reactions, changes to your wiki pages"), iconBell(), state.view === "notifications",
          { id: "rail-badge", count: state.notifUnread, label: t("{n} new", { n: state.notifUnread }) })}
        ${railButton("rail-wiki", t("Wiki"), t("Wiki and claimed resources"), iconDoc(), inConv && getSidebarPlace() === "wiki")}
        ${adminHuman ? railButton("rail-users", t("Admin"), t("Accounts and access"), iconUsers(), state.view === "users") : ""}
        ${railButton("rail-search", t("Search"), t("Search conversations, people and messages"), iconSearch(), false, undefined, t("Search"), "rail-phone")}
      </nav>
      ${withSidebar ? `<aside class="sidebar" id="sidebar" aria-label="${t("Channels, messages and wiki")}"></aside>` : ""}
      <main class="main" id="main"></main>
    </div>`;
  document.getElementById("scrim").addEventListener("click", () => { state.drawerOpen = false; toggleDrawerClass(); });
  document.getElementById("rail-notif").addEventListener("click", () => { syncRoute("#/activity"); openNotificationsView(); });
  document.getElementById("rail-chats").addEventListener("click", () => goPlace("home"));
  document.getElementById("rail-dms").addEventListener("click", () => { syncRoute("#/dms"); goPlace("dms"); });
  document.getElementById("rail-wiki").addEventListener("click", () => { syncRoute("#/wiki"); goPlace("wiki"); });
  // W5-S10-A gave the Threads view two entries; U16 (decision) keeps ONE: the sidebar row under
  // the workspace header (view-sidebar.js), the top section of the list. No rail or tab button.
  const ru = document.getElementById("rail-users");
  if (ru) ru.addEventListener("click", () => { syncRoute("#/admin"); openUsersView(); });
  // S9: the fourth phone tab. On the desktop the switcher has Cmd+K and the sidebar box, so the
  // tab is CSS-hidden there (.rail-phone) and the rail keeps its three or four places.
  document.getElementById("rail-search").addEventListener("click", () => openSearchPalette());
  bindViewportKeyboard();
  if (withSidebar) renderSidebar();
  renderMain();
}

/** Whether the current view keeps the sidebar (W5-S11-B). The sidebar belongs to the places one
 *  navigates FROM: conversations and the wiki, and the views that list messages across them
 *  (search, threads, all unreads), where the next click is usually a sidebar row. Activity and
 *  the accounts view have none: there the channel list took a third of the screen for a list
 *  that leads nowhere in that view (reported by @michal), and Activity is its own list. */
function hasSidebar() {
  return state.view === "chat" || state.view === "wiki" || state.view === "search"
    || state.view === "threads" || state.view === "unreads";
}

/** Whether the Home/DMs rail places are the view on screen (their `on` state): the sidebar may be
 *  visible in the search or threads view, but those are places of their own. */
function inConversations() {
  return ["chat", "wiki"].includes(state.view);
}

/** The DMs rail badge without redrawing the shell (W2-S1-C): called from the conversationRow
 *  view, which is what the data layer repaints when a conversation's unread count changes. The
 *  number was unreadDmCount(state) from view-unreads.js; it is railBadges(state).dms now, the
 *  same function behind counters.js (W5-S8-B). */
function paintDmBadge() {
  const badge = document.getElementById("rail-dm-badge");
  if (!badge) return;
  const n = railBadges(state).dms;
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.classList.toggle("off", !n);
  document.getElementById("rail-dms")?.setAttribute("aria-label", `${t("Direct messages")}${n ? `, ${t("{n} unread", { n })}` : ""}`);
}

// S9: the software keyboard. On a phone the layout viewport keeps its height while the keyboard
// is up; only `visualViewport` shrinks. The shell takes the visible height (`--vvh`, read by the
// S9 stylesheet block) so the composer sits on the keyboard instead of under it, and the tab bar
// steps aside (`.kb-open`) while a keyboard is open: typing is what the user is doing then.
let viewportKeyboardBound = false;
function bindViewportKeyboard() {
  const vv = window.visualViewport;
  if (viewportKeyboardBound || !vv) return;
  viewportKeyboardBound = true;
  const apply = () => {
    const shell = document.getElementById("shell");
    if (!shell) return;
    const inset = keyboardInset(vv, window.innerHeight);
    document.documentElement.style.setProperty("--vvh", inset > 0 ? `${Math.round(vv.height)}px` : "100%");
    shell.classList.toggle("kb-open", inset > 0);
    // iOS scrolls the page to keep the focused field in view; the shell is already that tall.
    if (inset > 0 && window.scrollY) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", apply);
  vv.addEventListener("scroll", apply);
  apply();
}

/** How many pixels of the window the keyboard covers; small differences (browser chrome
 *  collapsing while scrolling) are not a keyboard and count as zero. */
function keyboardInset(vv, innerHeight) {
  if (!window.matchMedia("(max-width:760px)").matches) return 0;
  const inset = innerHeight - vv.height - (vv.offsetTop || 0);
  return inset > 120 ? inset : 0;
}

/** One rail button: icon, a short label underneath, and (when given) a count badge on the icon.
 *  The badge hides at zero - an alarm that never stops teaches people to ignore it. */
function railButton(id, label, title, icon, on, badge, ariaName = label, extraClass = "") {
  const count = badge?.count || 0;
  return `
        <button class="rail-btn ${on ? "on" : ""} ${extraClass}" id="${id}" ${on ? `aria-current="page"` : ""}
          aria-label="${ariaName}${count ? `, ${badge.label}` : ""}" title="${title}">
          <span class="rail-ico">${icon}${badge ? `<span class="rail-badge ${count ? "" : "off"}" id="${badge.id}" aria-hidden="true">${count > 99 ? "99+" : count}</span>` : ""}</span>
          <span class="rail-l">${label}</span>
        </button>`;
}

/** Home, DMs and Wiki are three PLACES of the same sidebar: Home shows the conversations, DMs
 *  narrows it to direct conversations and people, Wiki holds the tree and the claimed resources
 *  (T-MG-38). Picking a place from another view returns to the chat. */
function goPlace(place) {
  resetUsersError();
  const samePlace = getSidebarPlace() === place;
  setSidebarPlace(place);
  if (!inConversations()) { state.view = "chat"; renderShell(); return; }
  if (window.matchMedia("(max-width:760px)").matches) {
    // On a phone the drawer is the only route to the list: the same place toggles it,
    // another place opens it with the new filter.
    state.drawerOpen = samePlace ? !state.drawerOpen : true;
    toggleDrawerClass();
    if (samePlace) return;
  } else if (samePlace) {
    // On the desktop the list is always visible and a click on the place you are already in
    // scrolls the list to the top: "back to the beginning", which is what people look for here.
    document.getElementById("sb-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  paintRail();
  renderSidebarList();
}

/** The `on` state of the three places without redrawing the whole shell. */
function paintRail() {
  const inConv = inConversations();
  for (const [id, place] of [["rail-chats", "home"], ["rail-dms", "dms"], ["rail-wiki", "wiki"]]) {
    const b = document.getElementById(id);
    if (!b) continue;
    const on = inConv && getSidebarPlace() === place;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
}

// ----------------------------------------------------------- view registration
// The only place where the data and action layers "learn about" the views. Any
// other route (importing a view inside actions.js) would close a cycle: the view
// calls the action, the action redraws the view.
registerViews({
  render,
  shell: renderShell,
  main: renderMain,
  // T-MG-38: a sidebar refresh may move the rail place (view-sidebar's followPlace: a wiki page
  // opened by any path lights Wiki, a conversation opened from Wiki returns to Home), so the
  // rail is repainted with it. paintRail is three class toggles; cheap on a presence tick.
  sidebar: () => { renderSidebarList(); paintRail(); },
  conversationRow: (id) => { updateConvRow(id); paintDmBadge(); },
  // Presence touches four places at once - they are glued together here so that
  // refreshPresence does not have to know where the dots, the bar, the topbar and
  // the typing bubbles in the wiki live.
  presence: () => {
    updatePresenceDots();
    renderPresenceBar();
    renderTopbar();
    const wt = document.getElementById("wiki-typing");
    if (wt && state.wiki.slug) wt.innerHTML = typingFacesHtml(`w:${state.wiki.slug}`);
  },
  messages: renderMessages,
  message: upsertMessageNode,
  scrollToBottom: scrollToBottom,
  repin: repinIfPinned,
  thread: renderThread,
  openThread: openThread,
  offlineBar: updateOfflineBar,
  composer: renderComposer,
  details: renderDetails,
  wiki: renderWikiMain,
  notifications: renderNotificationsMain,
  users: renderUsersMain,
  // W5-S11-A: the cross-conversation views go through the registry too, so view-chat's renderMain
  // can hand them their column instead of redrawing the chat over them.
  threads: renderThreadsMain,
  unreads: renderUnreadsMain,
  search: renderSearchMain,
  bindContent: bindMessageEvents,
  typing: typingFacesHtml,
  detailsData: refreshDetailsData,
  openConversation: openConversation,
  openWiki: openWikiPage,
  afterLogin: afterLogin,
});

// A language switch changes every rendered string, so the cheapest correct answer
// is to redraw from the root - and the root is the only place that can.
onLangChange(() => render());

// --------------------------------------------------------------------- boot
// The first entry used to greet a human with a toast and TWO modals at once - a
// deployment changelog and a passkey offer - before they saw a single message.
// Now everything that wants something from the user queues up BEHIND the opening
// of the first conversation, and the passkey waits for the second login: an offer
// to "sign in faster" only makes sense once it is clear you come back here.
// Keep the stored key compatible with existing browsers so the passkey offer keeps its timing.
const LOGIN_COUNT_KEY = "atalks_logowania";

function countLogin() {
  let n = 0;
  try {
    n = Number(localStorage.getItem(LOGIN_COUNT_KEY) || "0") + 1;
    localStorage.setItem(LOGIN_COUNT_KEY, String(n));
  } catch { n = 1; }
  return n;
}

/** Greetings and offers one after another, not in a heap. Each step waits for the
 *  previous one to leave the screen - two modals at once are, to the user, a
 *  single unreadable stack. */
async function queueWelcome(loginCount) {
  // Step 1: "What's new" - it is about what changed, so it comes first.
  if (state.news) {
    await new Promise((done) => showNewsModal(state.news, done));
    state.news = null;
  }
  // Step 2: the guidelines - only on the FIRST connection and only as a toast
  // pointing at them, not as a wall of text on arrival.
  if (state.guidelines) {
    showToast(t("Welcome. The short “How we talk here” lives under the question mark in the side panel."));
    state.guidelines = null;
  }
  // Step 3: passkey - from the second login onwards.
  if (loginCount >= 2) await maybeOfferPasskey();
}

async function afterLogin() {
  rebuildMentionRe();
  // When /api/me restored the session we already have the full set: conversations,
  // counters and memberships. Repeating GET /api/conversations is a second run of
  // the same, most expensive aggregate query on every entry.
  if (!Object.keys(state.memberships).length) await loadConversationsList();
  connectSSE();
  registerPresenceSession();
  refreshPresence();
  loadWikiList();
  // The first fetch skips the visibility condition: at login the user is certainly
  // at the tab, and if they switch elsewhere right afterwards, the lease board and
  // the digest would stay empty until an accidental clock tick with a visible tab.
  refreshDigestAndLeases(true);
  refreshNotifications();
  // The account directory is now part of the main view ("Who is here") rather than
  // an add-on to @-completion - so we fetch it straight away.
  ensureActors();
  startDigestTimer();
  render();
  updateTitleBadge();
  const loginCount = countLogin();
  // S3: the address bar wins - a permalink, F5 or a bookmark opens exactly that place. With an
  // empty hash, the last viewed conversation, not the first unread one: auto-opening an unread
  // conversation marked it as read before the user saw the counter.
  const route = parseRoute(location.hash);
  if (route.view !== "home") {
    await applyRoute(route);
  } else {
    const first = defaultConversation();
    if (first) await openConversation(first.id);
  }
  // Only now - the user already sees the product rather than windows about the product.
  queueWelcome(loginCount);
}

/** The conversation an empty hash opens: the last viewed one, else the first I belong to. */
function defaultConversation() {
  const lastId = lastConvId();   // per account (F2 r3)
  const last = state.conversations.find((c) => c.id === lastId && state.memberships[c.id]);
  return last || state.conversations.find((c) => state.memberships[c.id]) || state.conversations[0];
}

/** #/people (W6-C2-B): the directory is the sidebar's "Who is here" section, so the route lands
 *  in the conversations place with that section open, scrolled into view and focused. On a
 *  phone the list is the Home screen, so the drawer opens. */
async function openPeopleDirectory() {
  setSidebarPlace("home");
  if (!inConversations() || !state.activeId) {
    const first = defaultConversation();
    if (first) await openConversation(first.id);
    else { state.view = "chat"; renderShell(); }
  }
  setSectionCollapsed("people", false);
  renderSidebarList();
  paintRail();
  if (window.matchMedia("(max-width:760px)").matches) { state.drawerOpen = true; toggleDrawerClass(); }
  const head = document.querySelector('[data-section="people"]');
  head?.scrollIntoView({ block: "start" });
  head?.focus();
}

// ------------------------------------------------------------------- routes (S3)
/** T-MG-38 (fix round 2): a route that showed a page or a conversation settles the rail place
 *  itself, whatever the reader came from: a wiki page on screen -> Wiki; a conversation on
 *  screen while the place is Wiki -> Home (the Wiki place lists no conversations). The same
 *  rule as view-sidebar's followPlace, applied here without its transition memory, because a
 *  route is always a navigation. A no-op when the route did not land (no access, another
 *  route applied meanwhile). */
function settleRoutePlace() {
  const place = getSidebarPlace();
  const next = state.view === "wiki" ? "wiki" : state.view === "chat" && place === "wiki" ? "home" : place;
  if (next === place) return;
  setSidebarPlace(next);
  paintRail();
  renderSidebarList();
}

/** Open what a parsed route points at. Every branch ends on a screen: a place the user can read,
 *  or the in-column "no access" message with a way back - never a dead screen. */
async function applyRoute(route) {
  state.route = route;
  switch (route.view) {
    case "chat": {
      // U30 (r4): a slug this page has not seen yet (a channel created after it loaded, an
      // agent's link) is looked up on the server once before it counts as "no access".
      // F6 (r5): the lookup may wait on the server. Its answer opens a conversation (or the
      // no-access screen) only if, meanwhile, no other route was applied (state.route is this
      // one), the address did not change (a sidebar click writes the hash without a route) and
      // the session is the same (no sign-out, no other account).
      const known = state.conversations.length;
      const hash = location.hash;
      const gen = sessionGeneration();
      const current = () => state.route === route && gen === sessionGeneration();
      const c = await conversationBySlug(route.slug);
      if (gen !== sessionGeneration()) return;
      if (state.conversations.length !== known) renderSidebarList();
      if (!current() || location.hash !== hash) return;
      if (!c) { renderNoAccess(route); return; }
      await openConversation(c.id, route.messageId);
      settleRoutePlace();
      if (route.threadId && current() && state.view === "chat" && state.activeId === c.id) await openThread(route.threadId);
      return;
    }
    case "dm": {
      const want = [...route.handles].sort().join(",");
      const c = state.conversations.find((x) => (x.kind === "dm" || x.kind === "group")
        && dmOthers(x).map((o) => o.handle).sort().join(",") === want);
      if (c) {
        await openConversation(c.id, route.messageId);
        settleRoutePlace();
        if (route.threadId && state.view === "chat" && state.activeId === c.id) await openThread(route.threadId);
        return;
      }
      // A link to people I have not written to yet starts the conversation: one handle opens a DM,
      // several open a group (U19: nothing forbids it, so no lock screen; startDirect takes both).
      if (route.handles.length >= 1) { await startDirect(route.handles); settleRoutePlace(); return; }
      renderNoAccess(route);
      return;
    }
    case "wiki": await openWikiPage(route.slug); settleRoutePlace(); return;
    case "activity": await openNotificationsView(); return;
    case "dms": goPlace("dms"); return;
    case "wikiPlace": goPlace("wiki"); return;
    case "admin":
      if (state.actor?.isAdmin && state.actor?.kind === "human") await openUsersView();
      else renderNoAccess(route);
      return;
    // S11 (W3-S3-A): a query opens the results view with it applied; no query opens the palette.
    case "search": await openSearchRoute(route.q); return;
    // W5-S10-B, W5-S8-A: a page loaded at #/threads or #/unreads (F5, a bookmark, Back) shows it.
    case "threads": await openThreadsView(); return;
    case "unreads": await openUnreadsView(); return;
    case "people": await openPeopleDirectory(); return;
    default: return;
  }
}

/** The in-column message for a route I cannot read (a private channel, a wrong slug, a
 *  stranger's DM): the sidebar stays, so the next click is one of its rows. */
function renderNoAccess(route) {
  state.view = "chat";
  state.activeId = null;
  state.threadOpen = null;
  state.detailsOpen = false;
  renderShell();
  const main = document.getElementById("main");
  if (!main) return;
  const home = state.conversations.find((c) => c.slug === "general" && state.memberships[c.id])
    || state.conversations.find((c) => state.memberships[c.id] && c.slug);
  const where = route.view === "dm" ? `@${route.handles.join(", @")}` : `#${route.slug}`;
  main.innerHTML = `
    <div class="main-col no-access" id="main-col" role="status">
      ${emptyStateHtml(iconLock(), t("You do not have access to {where}", { where }),
        t("The link points at a conversation you cannot read, or one that does not exist."))}
      ${home ? `<p class="no-access-back"><a class="btn slim" id="no-access-back" href="${buildRoute({ view: "chat", slug: home.slug })}">${escapeHtml(t("Back to #{slug}", { slug: home.slug }))}</a></p>` : ""}
    </div>`;
  document.getElementById("no-access-back")?.focus();
}

// Back and Forward (and a link clicked in a message) change the hash; our own pushes echo here
// too and are skipped, so opening a conversation does not open it twice. The hash is read from
// the EVENT (W5-S10-D): with two pushes in one tick `location.hash` already holds the second
// when the first event arrives.
window.addEventListener("hashchange", (e) => {
  if (consumeOwnPush(e)) return;
  if (!state.actor) return;
  const route = parseRoute(hashOfEvent(e) || location.hash);
  if (route.view === "home") return;
  applyRoute(route);
});

(async function boot() {
  const restored = await tryRestoreSession();
  if (restored) { await afterLogin(); return; }
  render();
})();

// --------------------------------------------------------------- global events
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !state.actor) return;
  ensureSSE();
  // Returning to the tab = only now is what the user is looking at "read" (and
  // only when they really see the newest messages, i.e. are at the bottom).
  if (state.view === "chat" && state.activeId && state.memberships[state.activeId]
      && state.unread[state.activeId] > 0 && isScrolledToBottom()) {
    markReadDebounced(state.activeId, lastMessageId(state.activeId));
  }
});

// Dropping a file OUTSIDE a drop zone must not take the user to that file (the
// browser's default behaviour is to navigate to it).
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
// Closing the tab must not discard what the user has just written.
window.addEventListener("beforeunload", () => saveDraft());

// S8: every window-wide shortcut comes from the table in shortcuts.js (the Mod+/ sheet lists the
// same table) and is run by runShortcut below - Mod+. and Mod+F included (W5-S8-C, W5-S11-C: one
// owner per key). Escape stays below: it is a layer closer, not a shortcut.
document.addEventListener("keydown", (e) => {
  if (!state.actor) return;
  const name = matchShortcut(e);
  if (name) {
    const inModal = !!document.querySelector(".overlay");
    if (!inModal || name === "search" || name === "help") {
      if (runShortcut(name)) { e.preventDefault(); return; }
    }
  }
  if (e.key === "Tab" && !e.shiftKey && !e.defaultPrevented && composerTabToSend(e)) { e.preventDefault(); return; }
  if (e.key !== "Escape") return;
  // Modals, the lightbox and the palette handle Escape themselves - here we close
  // the layers that are not windows: the drawer, the thread and the details panel.
  if (document.querySelector(".overlay")) return;
  if (state.drawerOpen) {
    state.drawerOpen = false;
    toggleDrawerClass();
    document.getElementById("btn-menu")?.focus();
  } else if (state.threadOpen) {
    closeThread();
  } else if (state.detailsOpen) {
    state.detailsOpen = false;
    renderMain();
    document.getElementById("btn-details")?.focus();
  }
});

/** The conversations the Alt+arrow shortcuts walk, in sidebar order: channels first, then direct
 *  and group conversations, each in the order the server lists them. Members only. */
function navigableIds() {
  const mine = state.conversations.filter((c) => state.memberships[c.id]);
  const isDm = (c) => c.kind === "dm" || c.kind === "group";
  return [...mine.filter((c) => !isDm(c)), ...mine.filter(isDm)].map((c) => c.id);
}

/** Runs one named shortcut; false means "nothing to do here" and the key keeps its default. */
function runShortcut(name) {
  switch (name) {
    case "search": openSearchPalette(); return true;
    case "help": openShortcutHelp(); return true;
    case "allUnreads": openUnreadsView(); return true;
    case "dms": syncRoute("#/dms"); goPlace("dms"); return true;
    // Both need a conversation; outside one the key keeps its default (Mod+F: the browser's find).
    case "sidePanel": if (state.view !== "chat" || !state.activeId) return false; toggleSidePanel(); return true;
    case "findInConversation": return findInConversation();
    case "back": history.back(); return true;
    case "forward": history.forward(); return true;
    case "prevConversation":
    case "nextConversation": {
      const next = stepConversation(navigableIds(), state.activeId, name === "nextConversation" ? 1 : -1);
      if (next == null) return false;
      openConversation(next);
      return true;
    }
    case "prevUnread":
    case "nextUnread": {
      const next = stepUnread(navigableIds(), state.activeId, state.unread, name === "nextUnread" ? 1 : -1);
      if (next == null) { showToast(t("Nothing unread.")); return true; }
      openConversation(next);
      return true;
    }
    default: return false;
  }
}

/** Tab from the message box lands on the send button (S8): the formatting bar in between is
 *  reachable with a second Tab, but the first one goes where the hands expect. Only when there
 *  is something to send; an empty box keeps the normal order. The composer's own popovers
 *  consume Tab first (e.defaultPrevented), so this never steals their completion. */
function composerTabToSend(e) {
  const box = e.target;
  if (!box || box.tagName !== "TEXTAREA" || !String(box.id).endsWith("-input")) return false;
  const send = box.closest(".card")?.querySelector("button.send");
  if (!send || send.disabled) return false;
  send.focus();
  return true;
}
