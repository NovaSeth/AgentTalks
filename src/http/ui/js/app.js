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
  ensureActors, loadConversationsList, loadWikiList, markReadDebounced, refreshDigestAndLeases,
  refreshNotifications, refreshPresence, registerPresenceSession, startDigestTimer,
} from "./data.js";
import { $app, isScrolledToBottom, scrollToBottom, toggleDrawerClass, updateTitleBadge } from "./dom.js";
import { onLangChange, t } from "./i18n.js";
import { iconBell, iconChat, iconUsers } from "./icons.js";
import { lastMessageId, rebuildMentionRe, saveDraft, state, registerViews } from "./state.js";
import { showToast } from "./toasts.js";
import { openSearchPalette } from "./search.js";
import { openUsersView, renderUsersMain, resetUsersError } from "./view-admin.js";
import {
  bindMessageEvents, closeThread, openConversation, openThread, refreshDetailsData, renderComposer,
  renderDetails, renderMain, renderMessages, renderPresenceBar, renderThread, renderTopbar,
  typingFacesHtml, updateOfflineBar, upsertMessageNode,
} from "./view-chat.js";
import { maybeOfferPasskey, renderLogin, tryRestoreSession } from "./view-login.js";
import { openNotificationsView, renderNotificationsMain, showNewsModal } from "./view-notifications.js";
import { renderSidebar, renderSidebarList, updateConvRow, updatePresenceDots } from "./view-sidebar.js";
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
  // The side panel belongs to CONVERSATIONS, not to the whole application: it
  // holds channels, DMs and the wiki tree. In notifications and in accounts there
  // is nothing to pick from it - it stood there only because the shell rendered it
  // unconditionally, and it took a third of the screen width for a list that leads
  // nowhere in that view (reported by @michal).
  const withSidebar = state.view === "chat" || state.view === "wiki";
  $app.innerHTML = `
    <div class="shell with-rail ${withSidebar ? "" : "without-sidebar"} ${state.drawerOpen ? "drawer" : ""}" id="shell">
      <div class="scrim" id="scrim"></div>
      <nav class="rail" id="rail" aria-label="${t("Main navigation")}">
        <button class="rail-btn ${state.view === "notifications" ? "on" : ""}" id="rail-notif"
          ${state.view === "notifications" ? `aria-current="page"` : ""}
          aria-label="${t("Notifications")}${state.notifUnread ? `, ${t("{n} new", { n: state.notifUnread })}` : ""}"
          title="${t("Notifications: mentions, direct messages, reactions, changes to your wiki pages")}">
          ${iconBell()}
          <span class="rail-badge ${state.notifUnread ? "" : "off"}" id="rail-badge" aria-hidden="true">${state.notifUnread > 99 ? "99+" : state.notifUnread}</span>
        </button>
        <button class="rail-btn ${state.view === "chat" || state.view === "wiki" ? "on" : ""}" id="rail-chats"
          ${state.view === "chat" || state.view === "wiki" ? `aria-current="page"` : ""}
          aria-label="${t("Conversations and wiki")}" title="${t("Conversations and wiki")}">${iconChat()}</button>
        ${adminHuman ? `
        <button class="rail-btn ${state.view === "users" ? "on" : ""}" id="rail-users"
          ${state.view === "users" ? `aria-current="page"` : ""}
          aria-label="${t("Accounts and access")}" title="${t("Accounts and access")}">${iconUsers()}</button>` : ""}
      </nav>
      ${withSidebar ? `<aside class="sidebar" id="sidebar" aria-label="${t("Channels, messages and wiki")}"></aside>` : ""}
      <main class="main" id="main"></main>
    </div>`;
  document.getElementById("scrim").addEventListener("click", () => { state.drawerOpen = false; toggleDrawerClass(); });
  document.getElementById("rail-notif").addEventListener("click", openNotificationsView);
  document.getElementById("rail-chats").addEventListener("click", () => {
    resetUsersError();
    if (state.view === "chat") {
      // On a phone the drawer is the only route to the list, so a click toggles it.
      // On the desktop the list is always visible and the click did NOTHING - while
      // the icon looked clickable. We scroll the list to the top: that is the
      // equivalent of "back to the beginning", which is what people look for here.
      if (window.matchMedia("(max-width:760px)").matches) {
        state.drawerOpen = !state.drawerOpen;
        toggleDrawerClass();
      } else {
        document.getElementById("sb-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    state.view = "chat";
    renderShell();
  });
  const ru = document.getElementById("rail-users");
  if (ru) ru.addEventListener("click", openUsersView);
  if (withSidebar) renderSidebar();
  renderMain();
}

// ----------------------------------------------------------- view registration
// The only place where the data and action layers "learn about" the views. Any
// other route (importing a view inside actions.js) would close a cycle: the view
// calls the action, the action redraws the view.
registerViews({
  render,
  shell: renderShell,
  main: renderMain,
  sidebar: renderSidebarList,
  conversationRow: updateConvRow,
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
  thread: renderThread,
  openThread: openThread,
  offlineBar: updateOfflineBar,
  composer: renderComposer,
  details: renderDetails,
  wiki: renderWikiMain,
  notifications: renderNotificationsMain,
  users: renderUsersMain,
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
  // The last viewed conversation, not the first unread one: auto-opening an unread
  // conversation marked it as read before the user saw the counter.
  const lastId = Number(localStorage.getItem("atalks_last_conv"));
  const last = state.conversations.find((c) => c.id === lastId && state.memberships[c.id]);
  const first = last || state.conversations.find((c) => state.memberships[c.id]) || state.conversations[0];
  if (first) await openConversation(first.id);
  // Only now - the user already sees the product rather than windows about the product.
  queueWelcome(loginCount);
}

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

document.addEventListener("keydown", (e) => {
  if (!state.actor) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearchPalette();
    return;
  }
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
