/**
 * The conversation view: the message list, the composer, a thread, the details panel.
 */
import { answerQuestion, deleteMsg, dropPending, fixMsg, joinChannel, resolveMsg, retryPending, saveEditedMsg, sendMessage, togglePin, toggleReaction } from "./actions.js";
import { api, csrf, sessionGeneration } from "./api.js";
import { dividerAfter } from "./counters.js";
import { ensureActors, loadConversationsList, loadMessages, loadOlderMessages, loadPins, markReadDebounced, refreshQuestions, signalTyping } from "./data.js";
import { IMG_RE, avatarHtml, confirmModal, dayKey, dayLabel, emptyStateHtml, escapeHtml, fmtTime, formatBytes, hamburgerHtml, isScrolledToBottom, openModal, scrollToBottom, skeletonHtml, timeAgo, toggleDrawerClass, trackOverlay, updateJumpPill, scrollBehavior } from "./dom.js";
import { iconAddReaction, iconArrowDown, iconChat, iconCheck, iconCopy, iconDigest, iconEdit, iconFile, iconFlame, iconGear, iconInfo, iconLink, iconLock, iconMore, iconPin, iconQuestion, iconReply, iconSend, iconThread, iconTrash, iconUnpin, iconWrench } from "./icons.js";
import { renderBody } from "./markdown.js";
import { bindFormatting, composerCardHtml, createAutocomplete, insertAtCaret, openEmojiPicker } from "./composer.js";
import { openPlusMenu } from "./commands.js";
import { t } from "./i18n.js";
import { actorHandle, actorKind, actorOnline, animatedMsgs, canManageActive, isReport, isReportChannel, dmLabel, dmMembersCache, dmOthers, findMsgById, handleOnline, lastMessageId, loadDraft, mentionsMe, mergeActors, mergeReactions, trimConversationCache, pushRecent, saveDraft, state, upsertMessage, visibleMessages, views, reports } from "./state.js";
import { showError, showToast } from "./toasts.js";
import { openWikiPage, renderWikiMain } from "./view-wiki.js";
import { conversationRoute, permalink, syncRoute, unreadFrom } from "./router.js";
import { bindProfileClicks, closeProfile, ensureHeaderMembers, headerFacesHtml, mountPeoplePicker, profileFacts, renderProfile, visibleMembers } from "./view-people.js";

// A popular set for the "add a reaction" popover - every value goes through the same API as
// any other reaction, so the palette is only a UI convenience.
const EMOJI_PALETTE = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "🚀", "👏", "✅", "🤔", "😢", "💯", "🙏", "👋", "⭐", "🙌"];

// ------------------------------------------------- entering a conversation
export async function openConversation(id, focusMessageId) {
  // F1: an open that resumes after the account changed must not draw, fetch or mark read.
  const gen = sessionGeneration();
  saveDraft();                       // the PREVIOUS conversation's draft, before we redraw anything
  const previousConversation = state.activeId;
  // The "new messages" line disappears only on LEAVING a conversation - otherwise the one place
  // that said "this is where you stopped" gets lost while you are still reading.
  if (previousConversation && previousConversation !== id) delete state.readMark[previousConversation];
  // W4-S6-C: the details and the pinned list describe ONE conversation; carried into the next one
  // they showed the wrong members and pins. A profile is a person's, so it may stay.
  if (previousConversation !== id) { state.detailsOpen = false; state.pinnedOpen = false; }
  // U6: the header faces belong to ONE conversation too. Kept across a route change they drew
  // the other channel's members (or its count) until the new fetch landed; dropped, the header
  // re-fetches them for this conversation and shows nothing in the meantime.
  if (previousConversation !== id) { state.convMembersFor = null; state.convMembers = []; }
  state.view = "chat";
  state.activeId = id;
  try { localStorage.setItem("atalks_last_conv", String(id)); } catch { /* private browsing */ }
  pushRecent(id);
  // S3: the address bar follows the view, so F5 restores it and Back walks the conversations
  // you opened in reverse. A jump to one message carries `/m/<id>`.
  const routeConv = state.conversations.find((c) => c.id === id);
  if (routeConv) syncRoute(conversationRoute(routeConv, dmOthers(routeConv), { messageId: focusMessageId }));
  trimConversationCache();
  state.drawerOpen = false;
  state.threadOpen = null;
  const draft = loadDraft(id);
  state.pendingFiles = draft?.files ?? [];
  state.replyTo = draft?.replyTo ?? null;
  // The "read up to here" marker is frozen ONCE, BEFORE marking anything read: after 500 ms the
  // server moves it to the end and the information "from which point this is new" stops
  // existing, including after a refresh.
  if (state.readMark[id] === undefined) {
    state.readMark[id] = state.memberships[id]?.lastReadMessageId ?? 0;
  }
  views.render();
  let drawn = false;                 // the message list is on screen with what the state holds
  let fresh = false;                 // the newest batch was fetched in THIS open
  if (!state.loaded[id]) {
    // W2-S2-B: the flag names the conversation being loaded. A boolean was shared by every open in
    // flight: a slow load of one conversation kept the skeleton over another, already loaded one
    // (a channel previewed from "Channels you can join" showed the loader, not its messages), and
    // whichever load finished last switched it off for all.
    state.loadingConv = id;
    renderMain();
    try { await loadMessages(id); } catch (e) { showError(e); }
    // U14/U6: the skeleton flag goes BEFORE the abandoned-open return below: left on, a later
    // redraw of this conversation (an SSE event, a theme switch) painted the skeleton again.
    if (state.loadingConv === id) state.loadingConv = false;
    if (gen !== sessionGeneration()) return;
    // U14 (boot): the newest batch is on screen the moment it lands. Drawing it only after the
    // focus fetch below left the skeleton up for as long as that fetch waited in the browser's
    // per-host connection queue (a torn-down page's requests hold the sockets up to the server's
    // headers timeout) although the messages were already in the state.
    renderMain();
    drawn = true;
    fresh = state.loaded[id];
  }
  // U14 (boot): an id above the newest message of a batch fetched just now cannot exist in this
  // conversation - that batch holds the newest messages - so no fetch is needed to know the
  // link is dead, and the toast and the address rewrite happen at once instead of after a
  // queued request. A cache from an earlier open proves nothing (a link to a message newer
  // than it is the normal case), so only a fresh batch decides.
  if (focusMessageId && fresh && focusMessageId > (lastMessageId(id) ?? 0)) {
    focusMessageId = undefined;
    if (routeConv) syncRoute(conversationRoute(routeConv, dmOthers(routeConv)));
    showToast(t("That message is gone or you cannot see it."), { alert: true });
  }
  if (focusMessageId && !(state.msgs[id] || []).some((m) => m.id === focusMessageId)) {
    try {
      const data = await api("GET", `/api/conversations/${id}/messages?before=${focusMessageId + 1}&limit=100`);
      for (const m of data.messages) { upsertMessage(id, m); animatedMsgs.add(m.id); }
      mergeActors(data.actors);
      mergeReactions(data.messages, data.reactions);
      drawn = false;
    } catch { /* best effort */ }
    if (gen !== sessionGeneration()) return;
    // U14: a link to a message that is deleted, out of reach or never existed. The conversation
    // opens as usual (the newest at the bottom, the address without `/m/<id>`) and one toast
    // says why the link did not land anywhere - a skeleton or a silent channel left the human
    // guessing.
    if (!(state.msgs[id] || []).some((m) => m.id === focusMessageId)) {
      focusMessageId = undefined;
      if (routeConv) syncRoute(conversationRoute(routeConv, dmOthers(routeConv)));
      showToast(t("That message is gone or you cannot see it."), { alert: true });
    }
  }
  if (!drawn) renderMain();
  const questionsReady = refreshQuestions(id);
  // Pins are needed straight away: without them the message menu does not know whether to offer
  // "Pin" or "Unpin". Previously only the details panel fetched them.
  state.convPins = [];
  const pinsReady = loadPins(id);
  if (focusMessageId) {
    // These refreshes can redraw the list, so highlight only after they finish.
    await Promise.all([questionsReady, pinsReady]);
    if (gen !== sessionGeneration() || state.view !== "chat" || state.activeId !== id) return;
    const target = (state.msgs[id] || []).find((m) => m.id === focusMessageId);
    if (target?.threadId) {
      await openThread(target.threadId);
      if (state.view !== "chat" || state.activeId !== id || state.threadOpen !== target.threadId) return;
    }
    const list = target?.threadId ? "#th-msgs" : "#messages";
    const el = document.querySelector(`${list} [data-msg="${focusMessageId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: scrollBehavior(false) });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
      // A deep link lands the KEYBOARD on the message too (inside the thread panel when it opened
      // one): a screen reader announces it, Tab continues from it, Escape closes the panel.
      if (el.getAttribute?.("tabindex") == null) el.setAttribute?.("tabindex", "-1");
      el.focus?.({ preventScroll: true });
    }
  } else {
    // Entering positions itself on the unread LINE when there is one - "catching up on the
    // backlog" is meant to be a finite action, not scrolling upwards by feel.
    const unreadLine = document.querySelector("#messages .newline");
    if (unreadLine) unreadLine.scrollIntoView({ block: "start", behavior: scrollBehavior(false) });
    else scrollToBottom(false);
  }
  // Two reasons why this is NOT unconditional:
  // 1) the server's markRead joins the channel, so previewing a channel from the "Discoverable"
  //    section would quietly enrol us in it (and wake us on @all);
  // 2) a jump to a particular message is a look at one place, not a statement of "I read all
  //    the rest" - reaching the bottom is what does that.
  if (state.memberships[id] && !focusMessageId) markReadDebounced(id, lastMessageId(id));
}

// U8: the root whose replies are being fetched. The panel says "Loading replies..." while this
// names the open thread and nothing has arrived yet; once the fetch returns (or fails) an empty
// thread says "No replies yet" instead of showing the root alone.
let threadLoadingFor = null;

export async function openThread(rootId) {
  const conversationId = state.activeId;
  state.threadOpen = rootId;
  // U8: what the cache already holds (the root, replies seen on an earlier open or from the
  // stream) is on screen at once; the fetch only completes and refreshes it.
  state.threadMsgs = (state.msgs[conversationId] || []).filter((m) => m.id === rootId || m.threadId === rootId);
  threadLoadingFor = rootId;
  const gen = sessionGeneration();
  const isCurrent = () => gen === sessionGeneration() && state.view === "chat" && state.activeId === conversationId && state.threadOpen === rootId;
  // Opening the panel must not replace the main composer while a send is completing.
  if (!document.getElementById("thread-slot")) {
    const host = document.createElement("div");
    host.id = "thread-slot";
    document.getElementById("main")?.appendChild(host);
  }
  renderThread();
  try {
    const data = await api("GET", `/api/messages/${rootId}/thread`);
    if (!isCurrent()) return;
    state.threadMsgs = data.messages;
    for (const m of data.messages) {
      upsertMessage(conversationId, m);
      animatedMsgs.add(m.id);
    }
    mergeActors(data.actors);
    mergeReactions(data.messages, data.reactions);
  } catch (e) { if (isCurrent()) showError(e); }
  if (threadLoadingFor === rootId) threadLoadingFor = null;
  if (isCurrent()) renderThread();
}

/** A broken event stream as a BAR ABOVE THE CONVERSATION, not as fine print under the whole
/**  channel list. "You are not seeing new messages" is not information of the same weight as
/**  the interface version number - and that is exactly where it used to stand. */
export function offlineBarHtml() {
  if (state.online) return "";
  return `<div class="offbar" role="status" id="offbar">
    <span class="offdot" aria-hidden="true"></span>
    ${t("No connection to the server - new messages are not arriving. Trying to reconnect...")}
  </div>`;
}

/** The offline bar appears and disappears outside a full render (the event stream breaks
 *  at any moment), so it has its own pointwise update. */
export function updateOfflineBar() {
  const main = document.getElementById("main");
  if (!main) return;
  const existing = document.getElementById("offbar");
  if (state.online) { existing?.remove(); return; }
  if (existing) return;
  const topbar = main.querySelector(".topbar");
  if (topbar) topbar.insertAdjacentHTML("afterend", offlineBarHtml());
}

// ------------------------------------------------- the side panel (S2)
/** What the side panel shows, derived from the open flags: `null`, `{ kind: "thread", id }`,
 *  `{ kind: "details", id }`, `{ kind: "pinned", id }` (S10) or `{ kind: "profile", id: handle }`
 *  (S6). A profile is the top-most layer, pinned (opened from details or the header pill) wins
 *  over details, details win over the thread - the panel hosts one thing. */
export function sidePanelOf(s) {
  if (s.profileHandle) return { kind: "profile", id: s.profileHandle };
  if (s.pinnedOpen) return { kind: "pinned", id: s.activeId };
  if (s.detailsOpen) return { kind: "details", id: s.activeId };
  if (s.threadOpen) return { kind: "thread", id: s.threadOpen };
  return null;
}

// The panel last shown, so Mod+. can bring it back after closing it.
let lastSidePanel = null;

/** Mod+. : close the open panel, or reopen the one closed last. The key itself is matched by the
 *  shortcut table and run from app.js (W5-S8-C: one owner); this is only the action. */
export async function toggleSidePanel() {
  const open = sidePanelOf(state);
  if (open) {
    lastSidePanel = open;
    if (open.kind === "profile") closeProfile();
    else if (open.kind === "pinned") closePinnedPanel();
    else if (open.kind === "details") { state.detailsOpen = false; renderMain(); document.getElementById("btn-details")?.focus(); }
    else closeThread();
    return;
  }
  if (!lastSidePanel || state.view !== "chat" || !state.activeId) return;
  if (lastSidePanel.kind === "profile") { state.profileHandle = lastSidePanel.id; renderMain(); return; }
  if (lastSidePanel.kind === "pinned") { await openPinnedPanel(); return; }
  if (lastSidePanel.kind === "details") { state.detailsOpen = true; await refreshDetailsData(); renderMain(); return; }
  if (findMsgById(lastSidePanel.id)) await openThread(lastSidePanel.id);
}

/** The main column of the current view. Every view that is not the conversation goes through the
 *  `views` registry (W5-S11-A): a direct renderMain() after a language switch or an SSE event
 *  must not redraw the chat column over the search, threads or unreads view. */
export function renderMain() {
  const el = document.getElementById("main");
  if (!el) return;
  if (state.view === "users") { views.users(); return; }
  if (state.view === "notifications") { views.notifications(); return; }
  if (state.view === "threads") { views.threads(); return; }
  if (state.view === "unreads") { views.unreads(); return; }
  if (state.view === "search") { views.search(); return; }
  if (state.view === "wiki") { renderWikiMain(); return; }
  if (!state.activeId) {
    // An empty state says what to do and gives a button for it - "choose a conversation" with
    // nothing more left a human at an empty screen and a list that is often empty on day one.
    el.innerHTML = emptyStateHtml(iconChat(2.6), t("You have no conversation open yet"),
      t("Enter a channel from the list on the left, or write to somebody privately."),
      { id: "empty-new", label: t("Start a conversation") });
    document.getElementById("empty-new")?.addEventListener("click", () => openNewConversationModal("dm"));
    return;
  }
  const c = state.conversations.find((x) => x.id === state.activeId);
  const isMember = !!state.memberships[state.activeId];
  // S2: the side panel is ONE slot that is always in the markup. The message column is wrapped
  // in .main-col so the panel can stand next to it as a grid column from 1280 px (D3) and
  // overlay it below. The thread/details hosts exist only while open (openThread appends its
  // own host to #main when it is missing; the S2 CSS lays that host out like the panel).
  state.sidePanel = sidePanelOf(state);
  if (state.sidePanel) lastSidePanel = state.sidePanel;
  el.innerHTML = `
    <div class="main-col" id="main-col">
    <div class="topbar">
      ${hamburgerHtml()}
      <button class="iconbtn topbar-back" id="btn-back" aria-label="${t("Back to the list")}" title="${t("Back to the list")}">${iconArrowDown()}</button>
      <div class="title">
        <div class="t" id="topbar-title"></div>
        ${c && c.topic ? `<div class="topic">${escapeHtml(c.topic)}</div>` : ""}
      </div>
      <div class="topbar-meta" id="topbar-meta"></div>
      <button class="iconbtn ${state.detailsOpen ? "on" : ""}" id="btn-details" aria-label="${t("Conversation details")}"
        aria-expanded="${state.detailsOpen}" aria-controls="details-slot" title="${t("Conversation details")}">${iconInfo()}</button>
    </div>
    ${offlineBarHtml()}
    <div class="messages viewfade" id="messages" role="log" aria-label="${t("Messages")}"></div>
    <div class="dock">
      <button class="jump-newest" id="jump-newest" aria-label="${t("Scroll to the newest message")}" title="${t("Scroll to the newest")}">
        <span class="jn-label">${t("Latest")}</span>${iconArrowDown()}
      </button>
      <div class="presence-bar" id="presence-bar"></div>
      ${isMember
        ? `<div class="composer" id="composer"></div>`
        : `<div class="joinbar" id="joinbar">
             <span>${t("You are previewing <b>#{slug}</b> - join to write.", { slug: escapeHtml(c?.slug ?? "") })}</span>
             <button class="joinbtn" id="btn-join">${t("Join")}</button>
           </div>`}
    </div>
    </div>
    <aside class="side-panel" id="side-panel" aria-label="${t("Side panel")}"
      data-kind="${state.sidePanel ? state.sidePanel.kind : ""}">
      ${state.threadOpen ? `<div id="thread-slot"></div>` : ""}
      ${state.detailsOpen ? `<div id="details-slot"></div>` : ""}
      ${state.pinnedOpen ? `<div id="pinned-slot"></div>` : ""}
      ${state.profileHandle ? `<div id="profile-slot"></div>` : ""}
    </aside>
  `;
  bindProfileClicks();
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  // S9: on a phone the conversation is a pushed screen; the arrow pops it back to the list.
  document.getElementById("btn-back").addEventListener("click", () => {
    state.drawerOpen = true; toggleDrawerClass();
  });
  document.getElementById("btn-details").addEventListener("click", toggleDetails);
  const joinBtn = document.getElementById("btn-join");
  if (joinBtn) joinBtn.addEventListener("click", () => joinChannel(state.activeId, joinBtn));
  const jump = document.getElementById("jump-newest");
  if (jump) jump.addEventListener("click", () => {
    state.newBelow = 0;
    scrollToBottom(true);
    updateJumpPill();
    if (state.activeId && state.memberships[state.activeId]) {
      markReadDebounced(state.activeId, lastMessageId(state.activeId));
    }
  });
  renderTopbar();
  bindScrollWatch(document.getElementById("messages"));
  if (state.loadingConv === state.activeId) document.getElementById("messages").innerHTML = skeletonHtml();
  else renderMessages();
  renderPresenceBar();
  if (isMember) { renderComposer(); bindDropZone(el); }
  if (state.threadOpen) renderThread();
  if (state.detailsOpen) renderDetails();
  if (state.pinnedOpen) renderPinned();
  if (state.profileHandle) renderProfile();
}

// ----------------------------------------------- the conversation details panel
async function toggleDetails() {
  state.detailsOpen = !state.detailsOpen;
  if (state.detailsOpen) await refreshDetailsData();
  renderMain();
}

export async function refreshDetailsData() {
  const id = state.activeId;
  if (!id) return;
  try {
    const [convData, pinsData] = await Promise.all([
      api("GET", `/api/conversations/${id}`),
      api("GET", `/api/conversations/${id}/pins`).catch(() => ({ pins: [] })),
    ]);
    state.convMembers = convData.members || [];
    state.convMembersFor = id; // the header (S6) shares this fetch, see ensureHeaderMembers
    state.convPins = pinsData.pins || [];
    // The actor cache knows only the authors of messages - a member who has written nothing
    // would show as "@?"; we fetch the directory once.
    const missing = state.convMembers.some((m) => !state.actorsCache[m.actorId]);
    if (missing) await ensureActors({ force: true });
  } catch (e) { showError(e); }
}

export function renderDetails() {
  const host = document.getElementById("details-slot");
  if (!host) return;
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (!c) return;
  const isChannel = c.kind === "public" || c.kind === "private";
  const manage = canManageActive();
  const my = state.memberships[c.id];
  const notify = my?.notify ?? "all";
  const memberRow = (m) => {
    const a = state.actorsCache[m.actorId] || {};
    const handle = a.handle || "?";
    const online = actorOnline(m.actorId);
    const removable = isChannel && (manage || m.actorId === state.actor.id);
    return `
      <div class="dm-row">
        <button type="button" class="dm-who" data-profile="${escapeHtml(handle)}" aria-label="${t("Open the profile of @{handle}", { handle: escapeHtml(handle) })}">
          ${avatarHtml(handle, 26)}
          <span class="dm-name">@${escapeHtml(handle)}</span>
        </button>
        <span class="kindtag ${a.kind || "agent"}">${a.kind === "human" ? t("human") : t("agent")}</span>
        ${m.role === "admin" ? `<span class="roletag">admin</span>` : ""}
        <span class="ppresence ${online ? "on" : ""}"></span>
        ${removable ? `<button class="dm-kick" data-kick="${escapeHtml(handle)}"
          aria-label="${m.actorId === state.actor.id ? t("Leave the conversation") : t("Remove @{handle} from the conversation", { handle: escapeHtml(handle) })}"
          title="${m.actorId === state.actor.id ? t("Leave") : t("Remove from the conversation")}"><span aria-hidden="true">&times;</span></button>` : ""}
      </div>`;
  };
  const pinRow = (p) => {
    const msg = findMsgById(p.messageId);
    const who = msg ? actorHandle(msg.actorId) : p.by;
    const excerpt = msg ? String(msg.body || "").slice(0, 80) : t("message #{id}", { id: p.messageId });
    return `
      <button class="pin-row" data-jump="${p.messageId}">
        ${iconPin()}<span class="pin-txt"><b>@${escapeHtml(who)}</b> ${escapeHtml(excerpt)}</span>
      </button>`;
  };
  host.innerHTML = `
    <div class="thread details">
      <div class="th-head">${iconInfo()} ${t("Details")}
        <button class="iconbtn close" id="dt-close" aria-label="${t("Close conversation details")}" title="${t("Close")}"><span aria-hidden="true">&times;</span></button></div>
      <div class="dt-body">
        ${isChannel ? `
        <div class="dt-sec">
          <h4>${t("Channel")}</h4>
          <div class="dt-chan">
            <span class="dm-name">${c.kind === "private" ? iconLock(true) : "#"} ${escapeHtml(c.slug ?? "")}</span>
            ${manage ? `<button class="pillbtn slim" id="dt-edit">${iconEdit()} ${t("Edit")}</button>` : ""}
          </div>
          ${c.topic ? `<p class="dt-topic">${escapeHtml(c.topic)}</p>` : ""}
        </div>` : ""}
        <div class="dt-sec" id="dt-members">
          <h4 tabindex="-1" id="dt-members-h">${t("Members")} (${visibleMembers(state.convMembers, state.actorsCache).length})</h4>
          ${visibleMembers(state.convMembers, state.actorsCache).map(memberRow).join("") || `<p class="sb-empty">${t("none")}</p>`}
          ${c.kind === "private" ? `
          <div class="dt-add">
            <label class="sr-only" for="dt-add-input">${t("Who to add to the conversation")}</label>
            <input id="dt-add-input" placeholder="${t("@handle to add")}">
            <button class="pillbtn slim" id="dt-add-btn">${t("Add")}</button>
          </div>` : ""}
        </div>
        ${my ? `
        <div class="dt-sec">
          <h4 id="dt-notify-label">${t("Notifications")}</h4>
          <div class="seg small" id="dt-notify" role="radiogroup" aria-labelledby="dt-notify-label">
            <button role="radio" aria-checked="${notify === "all"}" data-notify="all" class="${notify === "all" ? "on" : ""}">${t("Every message")}</button>
            <button role="radio" aria-checked="${notify === "mentions"}" data-notify="mentions" class="${notify === "mentions" ? "on" : ""}">${t("Mentions")}</button>
            <button role="radio" aria-checked="${notify === "none"}" data-notify="none" class="${notify === "none" ? "on" : ""}">${t("Nothing")}</button>
          </div>
          <p class="dt-hint">${t("When this conversation may call you (push / waking an agent): every message, mentions and DMs only, or never.")}</p>
        </div>` : ""}
        ${state.convPins.length ? `
        <div class="dt-sec" id="dt-pins">
          <h4 tabindex="-1" id="dt-pins-h">${t("Pinned")} (${state.convPins.length})</h4>
          ${state.convPins.slice(0, 3).map(pinRow).join("")}
          <button type="button" class="pillbtn slim" id="dt-pins-all">${iconPin()} ${t("Show all pinned in the panel")}</button>
        </div>` : ""}
        ${isChannel && my ? `
        <div class="dt-sec dt-danger">
          <h4>${t("Actions")}</h4>
          <button class="dt-action" id="dt-leave">${t("Leave the channel")}</button>
          ${manage ? `<button class="dt-action danger" id="dt-archive">${t("Archive the channel (disappears from lists, history stays)")}</button>` : ""}
        </div>` : ""}
      </div>
    </div>`;
  document.getElementById("dt-close").addEventListener("click", () => { state.detailsOpen = false; renderMain(); });
  document.getElementById("dt-pins-all")?.addEventListener("click", () => openPinnedPanel());
  const edit = document.getElementById("dt-edit");
  if (edit) edit.addEventListener("click", () => editChannelModal(c));
  host.querySelectorAll("[data-kick]").forEach((b) =>
    b.addEventListener("click", async () => {
      const h = b.dataset.kick;
      const self = h === state.actor.handle;
      const confirmed = await confirmModal(self
        ? { title: t("Leave this conversation?"), body: t("You stop receiving messages from it. The history stays."), ok: t("Leave the conversation"), danger: true }
        : { title: t("Remove @{handle} from the conversation?", { handle: h }), body: t("This person stops seeing new messages. What they have already read stays with them."), ok: t("Remove @{handle}", { handle: h }), danger: true });
      if (!confirmed) return;
      try {
        await api("DELETE", `/api/conversations/${c.id}/members/${encodeURIComponent(h)}`);
        if (self) { state.detailsOpen = false; await loadConversationsList(); views.sidebar(); renderMain(); return; }
        await refreshDetailsData(); renderDetails();
      } catch (e) { showError(e); }
    }));
  const addBtn = document.getElementById("dt-add-btn");
  if (addBtn) addBtn.addEventListener("click", async () => {
    const input = document.getElementById("dt-add-input");
    const h = input.value.trim().replace(/^@/, "");
    if (!h) return;
    try {
      await api("POST", `/api/conversations/${c.id}/members`, { handle: h });
      input.value = "";
      await refreshDetailsData(); renderDetails();
    } catch (e) { showError(e); }
  });
  host.querySelectorAll("[data-notify]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api("POST", `/api/conversations/${c.id}/notify`, { notify: b.dataset.notify });
        if (state.memberships[c.id]) state.memberships[c.id].notify = b.dataset.notify;
        renderDetails();
      } catch (e) { showError(e); }
    }));
  host.querySelectorAll("[data-jump]").forEach((b) =>
    b.addEventListener("click", () => {
      state.detailsOpen = false;
      openConversation(c.id, Number(b.dataset.jump));
    }));
  const leaveBtn = document.getElementById("dt-leave");
  if (leaveBtn) leaveBtn.addEventListener("click", async () => {
    if (!await confirmModal({
      title: t("Leave #{slug}?", { slug: c.slug ?? "" }),
      body: t("The channel disappears from your list and you stop getting notifications from it. You can join again."),
      ok: t("Leave the channel"), danger: true,
    })) return;
    try {
      await api("POST", `/api/conversations/${c.id}/leave`, {});
      state.detailsOpen = false;
      await loadConversationsList(); views.sidebar(); renderMain();
    } catch (e) { showError(e); }
  });
  const arch = document.getElementById("dt-archive");
  if (arch) arch.addEventListener("click", async () => {
    if (!await confirmModal({
      title: t("Archive #{slug}?", { slug: c.slug ?? "" }),
      body: t("The channel disappears from everybody's lists and stops accepting messages. The history stays and can be read."),
      ok: t("Archive the channel"), danger: true,
    })) return;
    try {
      await api("DELETE", `/api/conversations/${c.id}`);
      state.detailsOpen = false;
      showToast(t("Channel archived"));
      await loadConversationsList();
      const next = state.conversations.find((x) => state.memberships[x.id]);
      state.activeId = null;
      views.sidebar();
      if (next) openConversation(next.id); else renderMain();
    } catch (e) { showError(e); }
  });
}

// ------------------------------------------------------- the pinned panel (S10)
/** Opens the pinned list in the side panel (from the header pill, Details or Mod+.). The pins are
 *  re-fetched so a pin made on another device is here too; Details stays where it was so closing
 *  the panel returns to it. */
export async function openPinnedPanel() {
  if (state.view !== "chat" || !state.activeId) return;
  state.profileHandle = null;
  state.pinnedOpen = true;
  await refreshDetailsData();
  renderMain();
  document.getElementById("pn-h")?.focus();
}

export function closePinnedPanel() {
  state.pinnedOpen = false;
  renderMain();
  (document.querySelector('[data-details="pins"]') || document.getElementById("dt-pins-h") || document.getElementById("btn-details"))?.focus();
}

/** The pinned panel: every pin of the open conversation, newest first, each a button that jumps
 *  to the message (and flashes it). Hosted by #pinned-slot inside the side panel. */
export function renderPinned() {
  const host = document.getElementById("pinned-slot");
  if (!host) return;
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (!c) return;
  const pins = [...state.convPins].sort((a, b) => b.messageId - a.messageId);
  const row = (p) => {
    const msg = findMsgById(p.messageId);
    const who = msg ? actorHandle(msg.actorId) : (p.by || "?");
    const excerpt = msg ? String(msg.body || "").replace(/\s+/g, " ").slice(0, 200) : t("message #{id}", { id: p.messageId });
    const when = msg ? timeAgo(msg.ts) : "";
    return `
      <button type="button" class="pin-row pn-row" data-jump="${p.messageId}"
        aria-label="${escapeHtml(t("Jump to the pinned message by @{handle}", { handle: who }))}">
        ${avatarHtml(who, 24)}
        <span class="pin-txt"><span class="pn-meta"><b>@${escapeHtml(who)}</b> <span class="pn-when">${escapeHtml(when)}</span></span>
          <span class="pn-body">${escapeHtml(excerpt)}</span></span>
      </button>`;
  };
  host.innerHTML = `
    <div class="thread details pinned" role="region" aria-label="${t("Pinned")}">
      <div class="th-head">${iconPin()} <span tabindex="-1" id="pn-h">${t("Pinned")} (${pins.length})</span>
        <button class="iconbtn close" id="pn-close" aria-label="${t("Close the pinned list")}" title="${t("Close")}"><span aria-hidden="true">&times;</span></button></div>
      <div class="dt-body pn-body-list" id="pn-list">
        ${pins.length ? pins.map(row).join("") : `<p class="sb-empty">${t("Nothing is pinned here yet. Pin a message from its More menu and it stays within reach for everybody.")}</p>`}
      </div>
    </div>`;
  document.getElementById("pn-close").addEventListener("click", closePinnedPanel);
  host.querySelectorAll("[data-jump]").forEach((b) =>
    b.addEventListener("click", () => {
      state.pinnedOpen = false;
      openConversation(c.id, Number(b.dataset.jump));
    }));
}

/** The channel edit modal: topic + slug (name). */
function editChannelModal(c) {
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("Edit the channel")}</h2>
      <div class="field"><label for="ec-slug">${t("Channel name")}</label><input id="ec-slug" value="${escapeHtml(c.slug ?? "")}">
        <span class="fhint">${t("Lower-case letters, digits and hyphens - this is what appears after the # on the list.")}</span></div>
      <div class="field"><label for="ec-topic">${t("Topic")}</label><input id="ec-topic" value="${escapeHtml(c.topic ?? "")}">
        <span class="fhint">${t("One sentence about why this channel exists.")}</span></div>
      <div class="row"><button class="btn ghost" id="ec-cancel">${t("Cancel")}</button><button class="btn" id="ec-save">${t("Save")}</button></div>`);
  modal.querySelector("#ec-cancel").addEventListener("click", close);
  modal.querySelector("#ec-save").addEventListener("click", async () => {
    const slug = modal.querySelector("#ec-slug").value.trim().replace(/^#/, "");
    const topic = modal.querySelector("#ec-topic").value.trim();
    try {
      await api("PATCH", `/api/conversations/${c.id}`, { slug: slug || undefined, topic });
      close();
      await loadConversationsList();
      views.sidebar(); renderMain();
      showToast(t("Channel updated"));
    } catch (e) { showError(e); }
  });
}

export function renderTopbar() {
  const bar = document.getElementById("topbar-title");
  if (!bar) return;
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (!c || state.view !== "chat") return;
  const isDirect = c.kind === "dm" || c.kind === "group";
  const meta = document.getElementById("topbar-meta");
  if (isDirect) {
    // The participants from the server (`others`) are available from the first frame, so the
    // header has a name and a presence dot before the first message arrives.
    const others = dmOthers(c);
    const online = others.length > 0 && others.some((o) => handleOnline(o.handle));
    bar.innerHTML = `<span class="ppresence big ${online ? "on" : ""}"></span> ${escapeHtml(dmLabel(c))}`;
    // S6: the other side's face, kind, presence and "doing" line; the face opens the profile.
    if (meta) meta.innerHTML = dmHeaderMetaHtml(others);
  } else {
    const pre = c.kind === "private" ? `${iconLock(true)} ` : "# ";
    bar.innerHTML = `${pre}${escapeHtml(c.slug || t("unnamed"))}`;
    // S6: stacked faces + member count (opens Details at Members) and a pins pill. The members
    // arrive once per conversation; the first paint shows the pill alone, the fetch redraws.
    if (meta) {
      meta.innerHTML = channelHeaderMetaHtml(c);
      ensureHeaderMembers(c.id, renderTopbar);
    }
  }
  meta?.querySelectorAll("[data-details]").forEach((b) =>
    b.addEventListener("click", () => openDetailsAt(b.dataset.details)));
}

function channelHeaderMetaHtml(c) {
  const haveMembers = state.convMembersFor === c.id;
  const faces = haveMembers
    ? `<button type="button" class="hdr-members" data-details="members"
        aria-label="${t("{n} members - open the member list", { n: visibleMembers(state.convMembers, state.actorsCache).length })}"
        title="${t("Members")}">${headerFacesHtml(state.convMembers, state.actorsCache)}</button>`
    : "";
  const pins = state.convPins.length
    ? `<button type="button" class="hdr-pill" data-details="pins" aria-label="${t("{n} pinned - show them", { n: state.convPins.length })}"
        title="${t("Pinned")}">${iconPin()} ${state.convPins.length}</button>`
    : "";
  return `${faces}${pins}`;
}

function dmHeaderMetaHtml(others) {
  if (!others.length) return "";
  const o = others[0];
  const online = handleOnline(o.handle);
  const row = state.presence.find((p) => String(p.handle).toLowerCase() === String(o.handle).toLowerCase() && p.doing)
    || null;
  const facts = profileFacts({ id: -1, handle: o.handle, kind: o.kind }, row ? [row] : []);
  return `
    <button type="button" class="hdr-dm" data-profile="${escapeHtml(o.handle)}" aria-label="${t("Open the profile of @{handle}", { handle: escapeHtml(o.handle) })}">
      ${avatarHtml(o.handle, 24)}
      <span class="kindtag ${o.kind || "agent"}">${o.kind === "human" ? t("human") : t("agent")}</span>
      <span class="hdr-dm-state">${online ? t("online now") : t("offline")}</span>
      ${facts.doing ? `<span class="hdr-dm-doing">${iconGear()} <i>${escapeHtml(facts.doing)}</i></span>` : ""}
    </button>${others.length > 1 ? `<span class="hdr-count">+${others.length - 1}</span>` : ""}`;
}

/** Opens Details and moves focus to one of its headings ("members"); "pins" opens the pinned
 *  panel instead (S10: the pins live in their own panel, Details only points at them). */
async function openDetailsAt(section) {
  if (section === "pins") { await openPinnedPanel(); return; }
  state.profileHandle = null;
  state.detailsOpen = true;
  await refreshDetailsData();
  renderMain();
  document.getElementById(section === "pins" ? "dt-pins-h" : "dt-members-h")?.focus();
}

// -------------------------------------------------------- the presence bar
// "typing..." (a human, dots as in iMessage) versus "working" (an agent, a cog) - two
// DIFFERENT signals, deliberately in different shapes.
/** Who is writing in a given place ("c:<id>" / "w:<slug>"), one per actor.
/**  A signal with no place (older clients) counts everywhere. */
function typersAt(loc) {
  const seen = new Set();
  const out = [];
  for (const p of state.presence) {
    if (!p.typing || p.actorId === state.actor.id || seen.has(p.actorId)) continue;
    if (p.typingIn && p.typingIn !== loc) continue;
    seen.add(p.actorId);
    out.push(p);
  }
  return out;
}

/** The typing bubbles: EXACTLY the same look as the mini-avatars on the thread bar (size,
/**  initials, actor colour) - one bubble per actor, bouncing with a phase offset. */
export function typingFacesHtml(loc) {
  const typers = typersAt(loc);
  if (!typers.length) return "";
  return `<span class="typing-faces" title="${t("{who} is typing...", { who: escapeHtml(typers.map((p) => "@" + p.handle).join(", ")) })}">
    ${typers.slice(0, 6).map((p, i) =>
      `<span class="tf" style="animation-delay:${i * 0.14}s">${avatarHtml(p.handle, 20)}</span>`).join("")}
    <span class="tf-label">${t("typing", { n: typers.length })}...</span>
  </span>`;
}

export function renderPresenceBar() {
  const el = document.getElementById("presence-bar");
  if (!el) return;
  const parts = [];
  const faces = state.activeId ? typingFacesHtml(`c:${state.activeId}`) : "";
  if (faces) parts.push(faces);
  const seen = new Set();
  for (const p of state.presence) {
    if (p.actorId === state.actor.id || seen.has(p.actorId)) continue;
    if (p.busy && !p.typing) {
      seen.add(p.actorId);
      parts.push(`<span class="pres busy">${iconGear()} ${t("@{handle} is working", { handle: escapeHtml(p.handle) })}${p.doing ? `: <i>${escapeHtml(p.doing)}</i>` : ""}</span>`);
    }
    if (parts.length >= 4) break;
  }
  el.innerHTML = parts.join("");
  el.classList.toggle("on", parts.length > 0);
}

/** Attached once per list render: tracks the scroll position and drives the pill. */
function bindScrollWatch(el) {
  el.addEventListener("scroll", () => {
    updateJumpPill();
    // Marking as read belongs to THIS condition: you reached the bottom, so you really do see the
    // newest. Previewing a channel you do not belong to must not enrol you in it by scrolling
    // alone.
    if (isScrolledToBottom() && state.activeId && state.memberships[state.activeId]) {
      markReadDebounced(state.activeId, lastMessageId(state.activeId));
    }
    // Loading older ones: without clicking, as you approach the top of the list. A 300 px
    // threshold, so the batch has time to arrive before you hit the ceiling.
    if (el.scrollTop < 300 && state.activeId && state.hasMore[state.activeId]) {
      loadOlderMessages(state.activeId);
    }
  }, { passive: true });
}

/** An open inline edit lives ONLY in the DOM - it has to be remembered before a
 *  redraw, otherwise any SSE event erases a half-written sentence. */
function saveOpenEdit(el) {
  const ta = el.querySelector(".inline-edit textarea");
  if (!ta) return null;
  const holder = ta.closest("[data-text],[data-answer-cta]");
  if (!holder) return null;
  return {
    sel: holder.dataset.text ? `[data-text="${holder.dataset.text}"]` : `[data-answer-cta="${holder.dataset.answerCta}"]`,
    answer: !holder.dataset.text,
    value: ta.value,
    start: ta.selectionStart,
    end: ta.selectionEnd,
  };
}

function restoreOpenEdit(el, snap) {
  if (!snap) return;
  const holder = el.querySelector(snap.sel);
  if (!holder) return;
  const id = Number(snap.answer ? holder.dataset.answerCta : holder.dataset.text);
  if (snap.answer) startInlineAnswer(state.openQuestions[id], id, el);
  else startInlineEdit(id, el);
  const ta = el.querySelector(`${snap.sel} textarea`);
  if (!ta) return;
  ta.value = snap.value;
  ta.setSelectionRange(snap.start, snap.end);
}

export function renderMessages() {
  const el = document.getElementById("messages");
  if (!el) return;
  if (closeEmojiPopover) closeEmojiPopover();
  if (closeMsgMenu) closeMsgMenu();
  const openEdit = saveOpenEdit(el);
  const keepAtBottom = isScrolledToBottom();
  const scrollTop = el.scrollTop;
  const all = visibleMessages(state.activeId);
  const c = state.conversations.find((x) => x.id === state.activeId);
  // S5: the "N open" pill in the header and, when it is pressed, the list narrowed to the open
  // reports of this channel (client-side; "Show all" is the way back).
  renderReportPill(c, all);
  const list = state.reportFilter && isReportChannel(c) ? all.filter((m) => openReport(m, c)) : all;
  if (!all.length) {
    el.innerHTML = emptyStateHtml(iconChat(2.2), t("Quiet so far"),
      t("Nobody has written anything here yet. Start with the first sentence - agents and humans will see it the same way."));
    return;
  }
  if (c && (c.kind === "dm" || c.kind === "group") && !dmMembersCache[c.id]) {
    const others = [...new Set((state.msgs[c.id] || []).map((m) => m.actorId))].filter((id) => id !== state.actor.id);
    if (others.length) dmMembersCache[c.id] = others;
  }

  // Older messages load themselves as you scroll up; the button stays as an escape route (say,
  // when a batch did not fill the screen and there is nothing to scroll).
  let html = state.reportFilter && list !== all
    ? `<div class="report-filter" role="status">${t("Showing only the open reports of this channel.")}
        <button type="button" class="linkbtn" data-report-showall>${t("Show all")}</button></div>`
      + (list.length ? "" : `<p class="report-none">${t("No open reports here - everything has been confirmed.")}</p>`)
    : "";
  if (state.hasMore[state.activeId] && !state.reportFilter) html += `<button class="loadmore" id="btn-loadmore">${t("Older messages")}</button>`;
  const idx = threadIndex(state.activeId);
  // The divider position comes from counters.js: with a read mark it is the mark; on a first
  // visit (mark 0) the server's unread count says where the new part begins (S7); the newest unread
  // id (W2-S7-A) keeps the line in place when the unread include thread replies the list does not show.
  const mark = dividerAfter(list, state.readMark[state.activeId] || 0, state.unread[state.activeId], state.actor.id,
    state.lastUnread[state.activeId]);
  let unreadLineShown = false;
  let lastDay = null, lastAuthor = null, lastTs = 0;
  for (const m of list) {
    const day = dayKey(m.ts);
    if (day !== lastDay) { html += `<div class="day">${dayLabel(m.ts)}</div>`; lastDay = day; lastAuthor = null; }
    // The "new messages" line: the one place that says "this is where you stopped reading". The
    // server has supplied lastReadMessageId all along, and the UI never used it once.
    if (!unreadLineShown && mark !== null && typeof m.id === "number" && m.id > mark && m.actorId !== state.actor.id) {
      html += `<div class="newline"><span>${t("New messages")}</span></div>`;
      unreadLineShown = true;
      lastAuthor = null;
    }
    const cont = m.actorId === lastAuthor && (m.ts - lastTs) < 300 && !m.deletedAt && m.kind !== "ask";
    html += messageHtml(m, cont, { threads: idx });
    // A question has its own, distinct frame - nothing merges with it (neither it with the
    // previous message, nor the next message with it), otherwise the author gets lost.
    lastAuthor = m.kind === "ask" ? null : m.actorId;
    lastTs = m.ts;
  }
  el.innerHTML = html;
  bindMessageEvents(el);
  const lm = el.querySelector("#btn-loadmore");
  if (lm) lm.addEventListener("click", () => { lm.disabled = true; loadOlderMessages(state.activeId); });
  // Reading position: replacing the children resets scrollTop, so we either hold the bottom
  // (because that is where we were) or return to where the user was actually looking.
  el.scrollTop = keepAtBottom ? el.scrollHeight : scrollTop;
  restoreOpenEdit(el, openEdit);
}

/** A pointwise replacement of ONE bubble - the default path for live events.
/**  A full list render on every message, reaction and question refresh erased all the state
/**  living in the DOM and cost as much as the whole conversation. */
export function upsertMessageNode(msg) {
  if (!msg || state.view !== "chat") return;
  const el = document.getElementById("messages");
  if (!el) return;
  if (msg.threadId) { if (state.threadOpen) renderThread(); return; }
  const existingNode = el.querySelector(`[data-msg="${msg.id}"]`);
  const idx = threadIndex(state.activeId);
  if (existingNode) {
    // The bubble the user is writing in right now is untouchable.
    if (existingNode.querySelector(".inline-edit")) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = messageHtml(msg, existingNode.classList.contains("cont"), { threads: idx });
    existingNode.replaceWith(tmp.firstElementChild);
    return;
  }
  // We append ONLY at the end, and only when the list really is on screen. An insertion in the
  // middle (a replay after a break) goes through a normal render, so as not to break the order
  // or the day separators.
  const list = visibleMessages(state.activeId);
  const i = list.findIndex((x) => x.id === msg.id);
  if (i !== list.length - 1 || !el.querySelector("[data-msg]")) { renderMessages(); return; }
  const previousMessage = list[i - 1] || null;
  const newDay = !previousMessage || dayKey(previousMessage.ts) !== dayKey(msg.ts);
  if (newDay) el.insertAdjacentHTML("beforeend", `<div class="day">${dayLabel(msg.ts)}</div>`);
  const cont = !newDay && !!previousMessage && previousMessage.actorId === msg.actorId
    && (msg.ts - previousMessage.ts) < 300 && !msg.deletedAt && msg.kind !== "ask" && previousMessage.kind !== "ask";
  el.insertAdjacentHTML("beforeend", messageHtml(msg, cont, { threads: idx }));
}

/** The tooltip of a reaction chip (S12): a sentence with the names, me first as "You". */
export function reactionTooltip(emoji, handles, me) {
  const others = handles.filter((h) => h !== me).map((h) => `@${h}`);
  const mine = handles.includes(me);
  let who;
  if (mine && !others.length) who = t("You");
  else if (mine) who = t("You and {who}", { who: others.join(", ") });
  else if (others.length === 1) who = others[0];
  else who = t("{list} and {last}", { list: others.slice(0, -1).join(", "), last: others[others.length - 1] });
  return t("{who} reacted with {emoji}", { who, emoji });
}

/** The quick-react row (S12): the `n` most used emoji of the conversation, by count and then
 *  first-seen order; the head of the palette fills what is missing. */
export function topReactions(convId, n = 4) {
  const counts = new Map();
  for (const m of state.msgs[convId] || []) {
    const r = state.reactions[m.id];
    if (!r) continue;
    for (const [emoji, handles] of Object.entries(r)) counts.set(emoji, (counts.get(emoji) || 0) + handles.length);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  for (const e of EMOJI_PALETTE) { if (top.length >= n) break; if (!top.includes(e)) top.push(e); }
  return top.slice(0, n);
}

/** Only MY handle (W1-C): `mentionsMe` in state.js also answers true for @all / @channel, which
 *  must not tint a whole row - everybody got it, nobody was singled out. */
export function mentionsMeDirectly(text) {
  const handle = state.actor?.handle;
  if (!handle) return false;
  const re = new RegExp(`(^|[\\s(>])@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(String(text ?? ""));
}

function reactionChipsHtml(m) {
  const r = state.reactions[m.id];
  if (!r) return "";
  // A reaction's value is untrusted input from another actor (normalizeEmoji admits any short
  // token) - it MUST be escaped when displayed as well.
  return Object.entries(r).map(([emoji, handles]) => {
    const mine = handles.includes(state.actor.handle);
    const safeEmoji = escapeHtml(emoji);
    const tip = escapeHtml(reactionTooltip(emoji, handles, state.actor.handle));
    return `<button class="react ${mine ? "mine" : ""}" data-react="${m.id}" data-emoji="${safeEmoji}" aria-pressed="${mine}"
      title="${tip}" aria-label="${tip}">${safeEmoji}<span class="n">${handles.length}</span></button>`;
  }).join("");
}

/** The quick-react buttons of the hover bar (S12): the same `data-react` contract as a chip, so
 *  one delegated handler serves both. */
function quickReactHtml(m) {
  return topReactions(m.conversationId).map((emoji) => {
    const safe = escapeHtml(emoji);
    const label = t("React with {emoji}", { emoji: safe });
    return `<button class="qr tooltipped tooltipped-n" data-react="${m.id}" data-emoji="${safe}" aria-label="${label}">${safe}</button>`;
  }).join("");
}

/** A thread bar as in other chat tools: the participants' avatars + the number of replies + the time of
/**  the last one. Always visible when a thread exists - it is what makes threads discoverable
/**  (the icon in the hover menu only CREATES one). */
/** A "thread root -> replies" map, computed ONCE per render. Previously every message filtered
/**  the whole conversation array for this, so the cost grew with the square of the number of
/**  messages - on every SSE event. */
function threadIndex(convId) {
  const map = new Map();
  for (const m of state.msgs[convId] || []) {
    if (!m.threadId) continue;
    const arr = map.get(m.threadId);
    if (arr) arr.push(m); else map.set(m.threadId, [m]);
  }
  return map;
}

function threadLinkHtml(m, index) {
  const replies = index
    ? (index.get(m.id) || [])
    : (state.msgs[m.conversationId] || []).filter((x) => x.threadId === m.id);
  if (!replies.length) return "";
  const last = replies[replies.length - 1];
  const seen = new Set();
  const faces = [];
  for (const r of replies) {
    if (seen.has(r.actorId)) continue;
    seen.add(r.actorId);
    faces.push(avatarHtml(actorHandle(r.actorId), 20));
    if (faces.length >= 4) break;
  }
  const more = seen.size > 4 ? `<span class="tl-more">+${seen.size - 4}</span>` : "";
  return `<button class="thread-link" data-thread="${m.id}">
    <span class="tl-faces">${faces.join("")}${more}</span>
    <span class="tl-count">${t("{n} replies", { n: replies.length })}</span>
    <span class="tl-when">${t("last {when}", { when: timeAgo(last.ts) })}</span>
  </button>`;
}

function attachmentHtml(m) {
  const meta = m.meta || {};
  const name = escapeHtml(meta.name ?? t("file"));
  const size = formatBytes(meta.size);
  const fileUrl = `/api/files/${encodeURIComponent(meta.fileId ?? "")}`;
  if (IMG_RE.test(meta.name ?? "")) {
    return `<button class="msg-img-wrap" data-lightbox="${fileUrl}" title="${name}">
      <img class="msg-img" src="${fileUrl}" alt="${name}" loading="lazy">
    </button>`;
  }
  return `<a class="attachment" href="${fileUrl}" download="${name}">
    <span class="fic">${iconFile()}</span>
    <span><span class="fname">${name}</span>${size ? `<br><span class="fsize">${size}</span>` : ""}</span>
  </a>`;
}

/** Delivery status in human terms. This is one of the best things in the product - nowhere
/**  else do you know whether the person you are writing to has any chance of reading it - and
/**  it spoke like an engineer ("silent 47 min - wakeable", "unreachable"). Now every line is a
/**  sentence: what is true now and what follows from it. */
const DELIVERY_COLLAPSE_MS = 10_000;
let deliveryTimer = null;

export function deliveryHtml(m) {
  const d = state.lastDelivery;
  if (!d || d.conversationId !== m.conversationId || d.messageId !== m.id) return "";
  const parts = d.delivery.map((r) => {
    const who = `@${escapeHtml(r.handle)}`;
    if (r.online) return { cls: "ok", text: t("{who} is online now - will read it right away", { who: who }) };
    if (r.wakeable) {
      const elapsed = timeAgo(r.lastSeenAt).replace(/ (ago|temu)$/, "");
      return { cls: "warn", text: t("{who} has been asleep for {how_long} - the server will wake them with this message", { who: who, how_long: escapeHtml(elapsed) }) };
    }
    return { cls: "off", text: t("{who} is offline - will see it when they are back", { who: who }) };
  });
  // S12: the sentence has its moment right after the send; ten seconds later it folds into a
  // small icon that still tells the whole story on hover. `shownAt` is remembered on the delivery
  // record itself the first time it is drawn, and one timer redraws this bubble when it is due.
  if (!d.shownAt) d.shownAt = Date.now();
  const age = Date.now() - d.shownAt;
  if (age < DELIVERY_COLLAPSE_MS) {
    clearTimeout(deliveryTimer);
    deliveryTimer = setTimeout(() => {
      if (state.lastDelivery === d) upsertMessageNode(findMsgById(d.messageId));
    }, DELIVERY_COLLAPSE_MS - age + 50);
    return `<div class="delivery">${parts.map((p) => `<span class="${p.cls}">${p.text}</span>`).join(" · ")}</div>`;
  }
  const plain = parts.map((p) => p.text.replace(/<[^>]+>/g, "")).join(" · ");
  const worst = parts.some((p) => p.cls === "off") ? "off" : parts.some((p) => p.cls === "warn") ? "warn" : "ok";
  return `<div class="delivery compact"><span class="${worst}" tabindex="0" role="img" title="${plain}" aria-label="${t("Delivery: {status}", { status: plain })}">${iconSend()}</span></div>`;
}

/* The entry animation only on a message's FIRST render. Every re-render (a reaction,
   an edit, a read) redraws the whole list, and without this memory every bubble
   replayed its "slide in" from scratch. */

/** Which report controls a message carries (S5, A5). `report`: the message is in the report
 *  cycle - the trace (fixedAt/resolvedAt), the explicit "Treat as a report", or the channel rule
 *  (a bug/issue/incident channel treats every top-level text as a report, G19). "Mark fixed" is
 *  for everybody but the author; "Confirm fixed" for the author, the instance admin or a channel
 *  admin, and only once somebody has marked it fixed (or to take a confirmation back). Before
 *  the channel rule the wrench and the check hung next to EVERY message from somebody else,
 *  including in a private conversation about lunch; the rule puts them where reports live. */
/** An open report: in the report cycle and not confirmed yet (in-flight entries do not count). */
function openReport(m, c) {
  return isReport(m, c) && !m.resolvedAt && !m.pending && !m.failed;
}

/** The "N open" pill next to the title (S5, A5): only in a bug/issue/incident channel, counting
 *  the LOADED top-level reports without resolvedAt. Pressing it narrows the list; the element is
 *  created once per header and found by id afterwards. */
function renderReportPill(c, all) {
  const inChannel = isReportChannel(c);
  if (!inChannel && state.reportFilter) state.reportFilter = false;   // the filter is per report channel
  let pill = document.getElementById("report-pill");
  if (!pill) {
    const host = document.getElementById("topbar-title")?.closest(".title");
    if (!host?.insertAdjacentElement) return;
    pill = document.createElement("button");
    pill.id = "report-pill"; pill.type = "button"; pill.className = "pillbtn report-pill";
    pill.addEventListener("click", () => { state.reportFilter = !state.reportFilter; renderMessages(); });
    host.insertAdjacentElement("afterend", pill);
  }
  const open = inChannel ? all.filter((m) => openReport(m, c)).length : 0;
  const show = inChannel && (open > 0 || state.reportFilter);
  pill.hidden = !show;
  if (!show) return;
  pill.innerHTML = `${iconWrench()} ${t("{n} open", { n: open })}`;
  pill.setAttribute("aria-pressed", String(state.reportFilter));
  pill.classList.toggle("on", state.reportFilter);
  const tip = state.reportFilter ? t("Showing only the open reports. Click to show everything.") : t("Reports nobody has confirmed as fixed yet. Click to show only those.");
  pill.title = tip; pill.setAttribute("aria-label", `${t("{n} open", { n: open })} - ${tip}`);
}

function reportControls(m, mine) {
  const myMem = state.memberships[m.conversationId];
  const report = isReport(m);
  const canResolve = report && !m.deletedAt && m.kind !== "answer" && !!(m.fixedAt || m.resolvedAt)
    && (mine || state.actor.isAdmin || (myMem && myMem.role === "admin"));
  const canFix = report && !mine && m.kind === "text" && !m.deletedAt;
  return { report, canFix, canResolve };
}

export function messageHtml(m, cont, opts = {}) {
  const handle = actorHandle(m.actorId);
  const kind = actorKind(m.actorId);
  const mine = m.actorId === state.actor.id;
  // An in-flight entry: the same bubble shape, but greyed out and without the actions the server
  // does not know about yet. On an error the content STAYS on screen with a retry - at that
  // moment it is the only copy of what the user wrote.
  if (m.pending || m.failed) {
    return `
    <div class="msg ${cont ? "cont" : ""} ${m.failed ? "failed" : "sending"}" data-msg="${m.id}">
      ${avatarHtml(handle)}
      <div class="body">
        <div class="head">
          <span class="author">@${escapeHtml(handle)}</span>
          <span class="time">${m.failed ? t("not sent") : t("sending...")}</span>
        </div>
        <div class="text">${renderBody(m.body, state.actor.handle)}</div>
        ${m.failed ? `
        <div class="failbar">
          <span class="failwhy">${escapeHtml(m.error || t("Could not send"))}</span>
          <button data-retry="${escapeHtml(m.clientMsgId)}">${t("Send again")}</button>
          <button data-copytext="${escapeHtml(m.clientMsgId)}">${t("Copy the text")}</button>
          <button data-droppending="${escapeHtml(m.clientMsgId)}"
            title="${t("The text goes back to the writing field - from there you can fix it or delete it")}">${t("Move it back to the field")}</button>
        </div>` : ""}
      </div>
    </div>`;
  }
  const mentionsCurrentActor = mentionsMeDirectly(m.body);
  const isAsk = m.kind === "ask";
  const qid = state.openQuestions[m.id];
  const askOpen = isAsk && qid !== undefined;
  const chips = m.deletedAt ? "" : reactionChipsHtml(m);
  const resolved = !!m.resolvedAt;
  // Two DIFFERENT claims, so two different badges: "fixed" is said by whoever changed the code,
  // "confirmed" by whoever reported it (or an admin). One badge for both would read as a
  // verification while meaning "somebody claims they did it".
  const fixed = !!m.fixedAt && !resolved;
  const { report, canFix, canResolve } = reportControls(m, mine);
  const pinned = state.convPins.some((p) => p.messageId === m.id);
  const fresh = !animatedMsgs.has(m.id);
  // The set grew for the whole life of the tab. A reset past a threshold costs one unnecessary
  // entry animation and gives the memory back.
  if (animatedMsgs.size > 5000) animatedMsgs.clear();
  if (fresh) animatedMsgs.add(m.id);
  return `
    <div class="msg ${fresh ? "enter" : ""} ${cont ? "cont" : ""} ${m.deletedAt ? "deleted" : ""} ${mentionsCurrentActor ? "mine-mention" : ""} ${isAsk ? "ask" : ""} ${m.kind === "answer" ? "answer" : ""} ${resolved ? "resolved" : ""}" data-msg="${m.id}">
      <button type="button" class="av-btn" data-profile="${escapeHtml(handle)}" aria-label="${t("Open the profile of @{handle}", { handle: escapeHtml(handle) })}" ${cont ? "tabindex=\"-1\"" : ""}>${avatarHtml(handle)}</button>
      <div class="body">
        <div class="head">
          <button type="button" class="author" data-profile="${escapeHtml(handle)}" title="${t("Open the profile of @{handle}", { handle: escapeHtml(handle) })}">@${escapeHtml(handle)}</button>
          <span class="kindtag ${kind}">${kind === "human" ? t("human") : t("agent")}</span>
          <span class="time">${fmtTime(m.ts)}</span>
          ${m.editedAt ? `<span class="edited">${t("(edited)")}</span>` : ""}
          ${resolved ? `<span class="qbadge done" title="${t("Confirmed by @{who}", { who: escapeHtml(actorHandle(m.resolvedBy)) })}${m.fixedAt ? t(", fixed by @{who}", { who: escapeHtml(actorHandle(m.fixedBy)) }) : ""}">${iconCheck(true)} ${t("Confirmed")}</span>` : ""}
          ${fixed ? `<span class="qbadge fixed" title="${t("@{who} changed the code. Waiting for the reporter to confirm the symptom is gone.", { who: escapeHtml(actorHandle(m.fixedBy)) })}">${iconWrench()} ${t("Fixed · waiting for confirmation")}</span>` : ""}
          ${isAsk ? (askOpen
            ? `<span class="qbadge open"><span class="qdot"></span>${t("Open question")}</span>`
            : `<span class="qbadge done">${iconCheck(true)} ${t("Answered")}</span>`) : ""}
          ${m.kind === "answer" ? `<span class="qbadge done">${iconCheck(true)} ${t("answer")}</span>` : ""}
        </div>
        ${m.deletedAt ? `<div class="text">${t("message deleted")}</div>`
          : m.kind === "file" ? attachmentHtml(m)
          : `<div class="text" data-text="${m.id}">${renderBody(m.body, state.actor.handle)}</div>`}
        ${askOpen && !m.deletedAt ? `
        <div class="answer-cta" data-answer-cta="${m.id}">
          <button class="answerbtn" data-answer="${qid}" data-msg-ref="${m.id}">${iconReply()} ${t("Answer")}</button>
        </div>` : ""}
        ${(() => {
          // One fixed row under an entry, as in other chat tools: the reaction chips, an "add a reaction"
          // chip next to them ONLY when there already are some (S12: otherwise the hover bar carries it),
          // and the thread replies on the right.
          if (m.deletedAt) return "";
          const tlink = !m.threadId && !opts.noThreadLink ? threadLinkHtml(m, opts.threads) : "";
          if (!chips && !tlink) return "";
          return `<div class="reacts">${chips}
            ${chips ? `<button class="react addreact" data-addreact="${m.id}" aria-label="${t("Add a reaction")}" title="${t("Add a reaction")}">${iconAddReaction()}</button>` : ""}
            ${tlink}</div>`;
        })()}
        ${mine ? deliveryHtml(m) : ""}
      </div>
      ${!m.deletedAt ? `
      <div class="actions" role="group" aria-label="${t("Actions for the message from @{handle}", { handle: escapeHtml(handle) })}">
        ${quickReactHtml(m)}
        <button data-addreact="${m.id}" class="tooltipped tooltipped-n" aria-label="${t("Add a reaction")}">${iconAddReaction()}</button>
        <button data-reply="${m.id}" class="tooltipped tooltipped-n" aria-label="${t("Reply in a thread")}">${iconThread()}</button>
        ${canResolve ? `<button data-resolve="${m.id}" data-on="${resolved ? "1" : ""}" class="tooltipped tooltipped-n ${resolved ? "on" : ""}" aria-pressed="${resolved}" aria-label="${resolved ? t("Take back the confirmation") : t("Confirm fixed")}">${iconCheck(true)}</button>` : ""}
        ${canFix ? `<button data-fix="${m.id}" data-on="${m.fixedAt ? "1" : ""}" class="tooltipped tooltipped-n ${m.fixedAt ? "on" : ""}" aria-pressed="${!!m.fixedAt}" aria-label="${m.fixedAt ? t("Take back the “fixed” mark") : t("Mark fixed")}">${iconWrench()}</button>` : ""}
        ${mine && m.kind === "text" ? `<button data-edit="${m.id}" class="tooltipped tooltipped-n" aria-label="${t("Edit the message")}">${iconEdit()}</button>` : ""}
        <button data-more="${m.id}" data-pinned="${pinned ? "1" : ""}" data-report="${report ? "1" : ""}"
          class="tooltipped tooltipped-n" aria-label="${t("More actions")}" aria-haspopup="menu">${iconMore()}</button>
      </div>` : ""}
    </div>`;
}

// ONE delegated listener on the container instead of a dozen querySelectorAll passes after
// every render. Thanks to that, replacing a single bubble requires re-attaching nothing - and
// the message list does not have to be redrawn just to make the buttons work again.
const BOUND_SCOPES = new WeakSet();

export function bindMessageEvents(scope) {
  if (!scope || BOUND_SCOPES.has(scope)) return;
  BOUND_SCOPES.add(scope);
  scope.addEventListener("click", async (e) => {
    const closest = (sel) => e.target.closest(sel);
    let b;
    if ((b = closest("[data-react]"))) { toggleReaction(Number(b.dataset.react), b.dataset.emoji); return; }
    if ((b = closest("[data-addreact]"))) { openEmojiPopover(Number(b.dataset.addreact), b); return; }
    if ((b = closest("[data-reply]"))) { state.replyTo = Number(b.dataset.reply); renderComposer(); focusComposer(); return; }
    if ((b = closest("[data-thread]"))) { openThread(Number(b.dataset.thread)); return; }
    if ((b = closest("[data-resolve]"))) { resolveMsg(Number(b.dataset.resolve), !b.dataset.on); return; }
    if ((b = closest("[data-fix]"))) { fixMsg(Number(b.dataset.fix), !b.dataset.on); return; }
    if ((b = closest("[data-more]"))) { openMessageMenu(Number(b.dataset.more), b); return; }
    if ((b = closest("[data-report-showall]"))) { state.reportFilter = false; renderMessages(); return; }
    if ((b = closest("[data-eph-close]"))) { b.closest(".msg")?.remove(); return; }
    if ((b = closest("[data-delete]"))) {
      const id = Number(b.dataset.delete);
      if (await confirmModal({
        title: t("Delete this message?"),
        body: t("The content disappears from the conversation for everybody. A “message deleted” trace stays in its place."),
        ok: t("Delete the message"), danger: true,
      })) deleteMsg(id);
      return;
    }
    if ((b = closest("[data-edit]"))) { startInlineEdit(Number(b.dataset.edit), scope); return; }
    if ((b = closest("[data-answer]"))) { startInlineAnswer(Number(b.dataset.answer), Number(b.dataset.msgRef), scope); return; }
    if ((b = closest("[data-retry]"))) { retryPending(state.activeId, b.dataset.retry); return; }
    if ((b = closest("[data-droppending]"))) { dropPending(state.activeId, b.dataset.droppending); return; }
    if ((b = closest("[data-copytext]"))) {
      const rec = (state.pending[state.activeId] || []).find((p) => p.clientMsgId === b.dataset.copytext);
      try { await navigator.clipboard.writeText(rec?.body ?? ""); showToast(t("Copied to the clipboard")); }
      catch { showToast(t("Could not copy"), { alert: true }); }
      return;
    }
    if ((b = closest("[data-lightbox]"))) { openLightbox(b.dataset.lightbox); return; }
    if ((b = closest("[data-copy]"))) {
      const code = b.parentElement.querySelector("code");
      try {
        await navigator.clipboard.writeText(code.textContent);
        b.classList.add("copied"); b.innerHTML = iconCheck(true);
        setTimeout(() => { b.classList.remove("copied"); b.innerHTML = iconCopy(); }, 1400);
      } catch { showToast(t("Could not copy"), { alert: true }); }
      return;
    }
    if ((b = closest("[data-wikilink]"))) {
      e.preventDefault();
      const slug = b.dataset.wikilink;
      if (state.wiki.pages.some((p) => p.slug === slug)) { openWikiPage(slug); return; }
      // A red link: the page does not exist - we open the editor for a new one under that slug.
      state.view = "wiki";
      state.wiki.slug = slug;
      state.wiki.page = null;
      state.wiki.files = [];
      state.wiki.history = [];
      state.wiki.revision = null;
      state.wiki.editing = true;
      state.wiki.draft = { title: slug, body: "" };
      views.sidebar();
      renderWikiMain();
    }
  });
  // Touch has no hover, and the action bar lived only on hover. A long press on a message
  // (500 ms) reveals it, the convention of touch chat clients.
  let holdTimer = null;
  scope.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const msg = e.target.closest(".msg");
    if (!msg) return;
    holdTimer = setTimeout(() => {
      scope.querySelectorAll(".msg.touch-actions").forEach((n) => n.classList.remove("touch-actions"));
      msg.classList.add("touch-actions");
    }, 500);
  }, { passive: true });
  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  scope.addEventListener("pointerup", cancelHold, { passive: true });
  scope.addEventListener("pointercancel", cancelHold, { passive: true });
  scope.addEventListener("pointermove", cancelHold, { passive: true });
}

// --------------------------------------------------- the message "more" menu
// Rare, non-obvious or irreversible actions get a FULL NAME and one place. The hover bar stays
// for the three most frequent ones; the rest - pinning (the API existed, the button did not),
// entering the report cycle, deleting - lives here, where every item is a sentence rather than
// a pictogram.
let closeMsgMenu = null;

function openMessageMenu(messageId, anchor) {
  if (closeMsgMenu) { closeMsgMenu(); return; }
  const m = findMsgById(messageId);
  if (!m) return;
  const mine = m.actorId === state.actor.id;
  const pinned = state.convPins.some((p) => p.messageId === messageId);
  const { report, canFix, canResolve } = reportControls(m, mine);
  // U15: every item carries an Octicon (the same one as its hover-bar twin where it has one), the
  // own-message group (Edit, Delete) sits below a separator with Delete in the danger colour, and
  // the report entry says what it does in plain words.
  const canEdit = mine && m.kind === "text" && !m.deletedAt;
  const menuItems = [
    // The report cycle in words (S5): the same two actions as the hover bar, with the consequence.
    ...(canFix ? [{ action: "fix", icon: iconWrench(), label: m.fixedAt ? t("Take back “fixed”") : t("Mark fixed"),
      description: m.fixedAt ? "" : t("Say you changed the code. Whoever reported it is asked to confirm the symptom is gone.") }] : []),
    ...(canResolve ? [{ action: "resolve", icon: iconCheck(true), label: m.resolvedAt ? t("Take back the confirmation") : t("Confirm fixed"),
      description: m.resolvedAt ? "" : t("Close the report: the symptom is gone.") }] : []),
    { action: "pin", icon: pinned ? iconUnpin() : iconPin(), label: pinned ? t("Unpin from the conversation") : t("Pin in the conversation"),
      description: pinned ? t("It disappears from the pinned list.") : t("It goes to “Pinned” in the conversation details - for everybody.") },
    ...(!report && m.kind === "text" && !m.deletedAt
      ? [{ action: "report", icon: iconFlame(), label: t("Mark as a problem"),
        description: t("Adds the Fixed and Confirmed buttons, so whoever fixes it and whoever reported it can close it.") }]
      : []),
    { action: "copy", icon: iconCopy(), label: t("Copy the text"), description: "" },
    { action: "copylink", icon: iconLink(), label: t("Copy link"), description: t("A link that opens this message, inside its thread when it has one.") },
    ...(state.memberships[m.conversationId] && !m.deletedAt
      ? [{ action: "unread", icon: iconDigest(), label: t("Mark unread"), description: t("The conversation goes bold again from this message on.") }]
      : []),
    ...(canEdit || mine ? [{ separator: true }] : []),
    ...(canEdit ? [{ action: "edit", icon: iconEdit(), label: t("Edit the message"), description: "" }] : []),
    ...(mine ? [{ action: "delete", icon: iconTrash(), label: t("Delete the message"), description: t("Irreversible for everybody."), danger: true }] : []),
  ];
  const pop = document.createElement("div");
  pop.className = "msg-menu";
  pop.setAttribute("role", "menu");
  pop.innerHTML = menuItems.map((p) => p.separator ? `<hr class="mm-sep" role="separator">` : `
    <button role="menuitem" data-mact="${p.action}" class="${p.danger ? "danger" : ""}">
      <span class="mm-i" aria-hidden="true">${p.icon}</span>
      <span class="mm-body">
        <span class="mm-l">${escapeHtml(p.label)}</span>
        ${p.description ? `<span class="mm-o">${escapeHtml(p.description)}</span>` : ""}
      </span>
    </button>`).join("");
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 8)}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;

  let armed = null;
  function close(how) {
    clearTimeout(armed);
    untrack();
    pop.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    closeMsgMenu = null;
    if (!how?.forced && document.contains(anchor)) anchor.focus();
  }
  const untrack = trackOverlay(pop, close);
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  pop.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mact]");
    if (!b) return;
    const action = b.dataset.mact;
    close();
    if (action === "fix") { fixMsg(messageId, !m.fixedAt); return; }
    if (action === "resolve") { resolveMsg(messageId, !m.resolvedAt); return; }
    if (action === "pin") { togglePin(messageId, !pinned); return; }
    if (action === "report") {
      reports.add(messageId);
      views.message(findMsgById(messageId));
      showToast(t("Marked as a problem. The message now carries the Fixed and Confirmed buttons."));
      return;
    }
    if (action === "edit") {
      // The same message can stand in both lists (thread root): edit the copy the menu came from.
      const scope = anchor.closest?.("#th-msgs") || anchor.closest?.("#messages") || document.getElementById("messages");
      if (scope) startInlineEdit(messageId, scope);
      return;
    }
    if (action === "copy") {
      try { await navigator.clipboard.writeText(m.body ?? ""); showToast(t("Copied to the clipboard.")); }
      catch { showToast(t("Could not copy."), { alert: true }); }
      return;
    }
    if (action === "copylink") {
      const c = state.conversations.find((x) => x.id === m.conversationId);
      const hash = c ? conversationRoute(c, dmOthers(c), { messageId }) : `#/c/${m.conversationId}/m/${messageId}`;
      try { await navigator.clipboard.writeText(permalink(hash, location.origin)); showToast(t("Link copied to the clipboard.")); }
      catch { showToast(t("Could not copy."), { alert: true }); }
      return;
    }
    if (action === "unread") { markUnreadFrom(messageId); return; }
    if (action === "delete") {
      if (await confirmModal({
        title: t("Delete this message?"),
        body: t("The content disappears from the conversation for everybody. A “message deleted” trace stays in its place."),
        ok: t("Delete the message"), danger: true,
      })) deleteMsg(messageId);
    }
  });
  armed = setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey, true);
  closeMsgMenu = close;
  pop.querySelector("button")?.focus();
}

/** "Mark unread" from a message on: the row goes bold with a count, the "New messages" divider
 *  moves above the message, and the read marker on the server is asked to follow. The local
 *  state is painted first - a counter that waits for the network reads as a broken click. */
function markUnreadFrom(messageId) {
  const m = findMsgById(messageId);
  if (!m) return;
  const convId = m.conversationId;
  const marker = messageId - 1;
  state.readMark[convId] = marker;
  if (state.memberships[convId]) state.memberships[convId].lastReadMessageId = marker;
  state.unread[convId] = unreadFrom(state.msgs[convId], messageId, state.actor.id);
  const c = state.conversations.find((x) => x.id === convId);
  state.unreadBadge[convId] = (c && (c.kind === "dm" || c.kind === "group"))
    ? state.unread[convId]
    : (state.msgs[convId] || []).filter((x) => x.id >= messageId && x.actorId !== state.actor.id && !x.deletedAt && mentionsMe(x.body)).length;
  views.conversationRow(convId);
  if (state.activeId === convId) renderMessages();
  api("POST", `/api/conversations/${convId}/unread`, { messageId }).catch(() => { /* best effort */ });
  showToast(t("Marked unread from here."));
}

// ------------------------------------------------------- inline editing
/** @param scope the container the click came from. The same message is sometimes in the
/**  document TWICE (the main list + the thread root), so searching the whole document always
/**  hit the first occurrence - that is, it opened the edit field in the copy the user cannot
/**  see at that moment. */
function startInlineEdit(messageId, scope) {
  const holder = (scope || document).querySelector(`[data-text="${messageId}"]`);
  if (!holder) return;
  const msg = findMsgById(messageId);
  if (!msg) return;
  holder.innerHTML = `
    <div class="inline-edit">
      <textarea rows="1"></textarea>
      <div class="hint">${t("Enter to save · Escape to cancel")}</div>
    </div>`;
  const ta = holder.querySelector("textarea");
  ta.value = msg.body;
  const finishEdit = () => {
    // A list redraw may have restored this editor in a new holder while saving.
    const current = (scope || document).querySelector(`[data-text="${messageId}"]`);
    if (current) current.innerHTML = renderBody((findMsgById(messageId) || msg).body, state.actor.handle);
  };
  const autos = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 300) + "px"; };
  ta.addEventListener("input", autos);
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = ta.value.trim();
      if (!v || v === msg.body) { finishEdit(); return; }
      try { await saveEditedMsg(messageId, v, finishEdit); } catch (err) { showError(err); }
    }
    if (e.key === "Escape") { e.preventDefault(); finishEdit(); }
  });
  autos(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ------------------------------------------------------ answering a question
function startInlineAnswer(questionId, messageId, scope) {
  const cta = (scope || document).querySelector(`[data-answer-cta="${messageId}"]`);
  if (!cta) return;
  cta.innerHTML = `
    <div class="inline-edit answerbox">
      <textarea rows="1" placeholder="${t("Your answer...")}"></textarea>
      <div class="hint">${t("Enter to send · Escape to cancel")}</div>
    </div>`;
  const ta = cta.querySelector("textarea");
  const autos = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 300) + "px"; };
  ta.addEventListener("input", autos);
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = ta.value.trim();
      if (!v) return;
      try { await answerQuestion(questionId, v); showToast(t("Question closed - thank you!")); }
      catch (err) { showError(err); renderMessages(); }
    }
    if (e.key === "Escape") renderMessages();
  });
  autos(); ta.focus();
}

// ------------------------------------------------------------- lightbox
function openLightbox(url) {
  const overlay = document.createElement("div");
  overlay.className = "overlay lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("Image preview - Escape closes it"));
  overlay.innerHTML = `<img src="${url}" alt="${t("Enlarged attachment")}">`;
  document.body.appendChild(overlay);
  const returnFocus = document.activeElement;
  // The listener is removed in ONE place: previously only the Escape branch exited, so closing
  // by a click left a live close handler holding a reference to a removed element.
  const close = (how) => {
    untrack();
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (!how?.forced && returnFocus && document.contains(returnFocus)) returnFocus.focus();
  };
  const untrack = trackOverlay(overlay, close);
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.addEventListener("click", () => close());
  document.addEventListener("keydown", onKey);
}

// ------------------------------------------------------------- reactions: popover
let closeEmojiPopover = null;

let emojiPopoverAnchor = null;

function openEmojiPopover(messageId, anchor) {
  const reopeningSame = emojiPopoverAnchor === anchor;
  if (closeEmojiPopover) closeEmojiPopover();
  if (reopeningSame) return;
  emojiPopoverAnchor = anchor;
  const rect = anchor.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "emoji-pop";
  pop.innerHTML = EMOJI_PALETTE.map((e) => `<button data-pick="${e}">${e}</button>`).join("");
  document.body.appendChild(pop);
  const top = rect.top - pop.offsetHeight - 8;
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.left = `${Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)}px`;
  const onPick = (e) => {
    const btn = e.target.closest("[data-pick]");
    if (!btn) return;
    toggleReaction(messageId, btn.dataset.pick);
    close();
  };
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  let armed = null;
  function close() {
    clearTimeout(armed);
    untrack();
    pop.removeEventListener("click", onPick);
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey);
    pop.remove();
    closeEmojiPopover = null;
    emojiPopoverAnchor = null;
  }
  const untrack = trackOverlay(pop, close);
  pop.addEventListener("click", onPick);
  armed = setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey);
  closeEmojiPopover = close;
}

// ------------------------------------------------------------- composer
let draftTimer = null;

function scheduleDraftSave() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); }

/** A shared entry point for files from the dialog, from the clipboard and from a drag. */
function addFiles(files) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  for (const file of files) {
    // A screenshot from the clipboard arrives with no sensible name ("image.png"), and it has to
    // be recognisable later in the attachment list.
    const namedFile = file.name && file.name !== "image.png"
      ? file
      : new File([file], t("pasted-{stamp}.{extension}", { stamp, extension: file.type.split("/")[1] || "png" }), { type: file.type });
    state.pendingFiles.push({
      file: namedFile, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: namedFile.type.startsWith("image/") ? URL.createObjectURL(namedFile) : null,
      sensitive: false, burn: false, ttlSec: 0,
    });
  }
  renderPreviews();
  updateSendButton();
  saveDraft();
}

function updateSendButton() {
  const send = document.getElementById("composer-send");
  const ta = document.getElementById("composer-input");
  if (!send || !ta) return;
  const can = !!ta.value.trim() || state.pendingFiles.length > 0;
  send.disabled = !can;
  send.classList.toggle("ready", can);
}

/** Dropping a file onto the WHOLE conversation area, as in other chat tools - three steps (save to disk,
/**  open the dialog, find the file) turn into one. */
function bindDropZone(el) {
  el.dataset.dropLabel = t("Drop to attach");
  if (el.dataset.dropbound) return;
  el.dataset.dropbound = "1";
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  el.addEventListener("dragover", (e) => { stop(e); el.classList.add("dropping"); });
  el.addEventListener("dragleave", (e) => { if (e.target === el) el.classList.remove("dropping"); });
  el.addEventListener("drop", (e) => {
    stop(e);
    el.classList.remove("dropping");
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
  });
}

export function renderComposer() {
  const el = document.getElementById("composer");
  if (!el) return;
  const replyMsg = state.replyTo ? findMsgById(state.replyTo) : null;
  // The composer used to carry a second pictogram next to the attach "+": a bare question
  // mark that switched it into "ask the channel" mode. It is gone, and the reason is a
  // measurement rather than taste. @michal - who owns this product - asked what that icon
  // was and said it should not be there; and the database answered the rest: in the whole
  // life of this instance the number of questions asked through it, by anybody, human or
  // agent, was ZERO. An unlabelled pictogram in the most valuable place of the interface,
  // for an action nobody had ever performed, next to the one control people press all day.
  //
  // The primitive itself stays whole: agents ask through `talk_ask` / POST /ask, the open
  // questions are listed in the side panel, and a human still ANSWERS them inline - which is
  // the half that was actually being used.
  el.innerHTML = `
    ${replyMsg ? `<div class="replying">${t("Replying in the thread of <b>@{handle}</b>", { handle: escapeHtml(actorHandle(replyMsg.actorId)) })}
      <button id="cancel-reply" aria-label="${t("Cancel replying in the thread")}" title="${t("Cancel")}"><span aria-hidden="true">&times;</span></button></div>` : ""}
    ${composerCardHtml({ prefix: "composer", label: t("Your message"), placeholder: t("Your message..."), files: true })}`;
  const ta = document.getElementById("composer-input");
  const send = document.getElementById("composer-send");
  const cancel = document.getElementById("cancel-reply");
  const attachBtn = document.getElementById("composer-attach");
  const fileInput = document.getElementById("composer-file");
  const card = document.getElementById("composer-card");
  if (cancel) cancel.addEventListener("click", () => { state.replyTo = null; renderComposer(); focusComposer(); });
  // The shared parts (composer.js): formatting bar, emoji picker, one autocomplete for @ and #.
  const formatKey = bindFormatting(ta, card);
  const ac = mountAutocomplete(ta);
  document.getElementById("composer-emoji")?.addEventListener("click", (e) => openEmojiPicker(e.currentTarget, (ch) => insertAtCaret(ta, ch)));
  const autosize = () => {
    ta.style.height = "auto";
    const maxH = window.innerHeight * 0.4;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
    const can = !!ta.value.trim() || state.pendingFiles.length > 0;
    send.disabled = !can;
    send.classList.toggle("ready", can);
  };
  // The draft returns to the field with the conversation (and survives F5 - the text is in localStorage).
  const draft = state.drafts[state.activeId];
  if (draft?.text) ta.value = draft.text;
  ta.addEventListener("input", () => { autosize(); signalTyping(); ac.refresh(); scheduleDraftSave(); });
  ta.addEventListener("keydown", (e) => {
    if (ac.keydown(e)) return;
    if (formatKey(e)) return;
    // The chat convention of ArrowUp on an EMPTY field: edit your own last message. Without it a typo can be
    // fixed only by hitting a 1.8rem icon that is visible only on hover.
    if (e.key === "ArrowUp" && !ta.value.trim() && !state.pendingFiles.length) {
      const mine = [...visibleMessages(state.activeId)].reverse()
        .find((m) => m.actorId === state.actor.id && m.kind === "text" && !m.deletedAt && !m.pending && !m.failed);
      if (mine) { e.preventDefault(); startInlineEdit(mine.id, document.getElementById("messages")); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  // Pasting a screenshot straight into the conversation - the most common form of attachment in
  // a tool for programmers and agents; previously Ctrl+V did nothing.
  ta.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
    autosize();
  });
  send.addEventListener("click", submit);
  // S5: the "+" is a menu (attach, ask a tracked question, claim a resource); commands.js owns it.
  attachBtn.addEventListener("click", (e) => openPlusMenu(e.currentTarget, { attach: () => fileInput.click() }));
  fileInput.addEventListener("change", () => {
    addFiles([...fileInput.files]);
    fileInput.value = "";
    autosize();
  });
  async function submit() {
    const v = ta.value.trim();
    if (!v && !state.pendingFiles.length) return;
    ac.close();
    // The draft is written NOW, with the text about to be sent, and cleared only once the server
    // confirms (actions.js does that on success). A failed send therefore survives F5: the fail
    // bar holds the bubble, localStorage holds the words (M14).
    clearTimeout(draftTimer);
    saveDraft();
    const files = state.pendingFiles; state.pendingFiles = [];
    ta.value = ""; renderPreviews(); autosize();
    // A file that failed to send RETURNS to the previews - otherwise it would disappear together
    // with the only copy of the choice the user made.
    const failedFiles = [];
    for (const p of files) {
      const ok = await uploadAttachment(p);
      if (ok) { if (p.url) URL.revokeObjectURL(p.url); } else failedFiles.push(p);
    }
    if (failedFiles.length) { state.pendingFiles = [...failedFiles, ...state.pendingFiles]; renderPreviews(); updateSendButton(); }
    if (v) {
      const sent = await sendMessage(v);
      if (!sent) return;   // keep the draft: the text is still the user's only copy besides the fail bar
    }
    saveDraft();
  }
  renderPreviews();
  autosize();
}

/** File options under the preview. They travel as the x-sensitive / x-burn / x-ttl headers.
 *
 *  They were three unlabelled pictograms (a shield, a flame, a list) - including
 *  "burn after reading", an IRREVERSIBLE action triggered by one click on a picture. Now it is
 *  a collapsed menu with full labels and a sentence about the consequence; closed by default,
 *  so sending a file normally does not get harder, but nobody burns an attachment without
 *  having read what it does. */
function selectedFileOptions(p) {
  return [
    p.sensitive ? t("sensitive") : null,
    p.burn ? t("disappears after reading") : null,
    p.ttlSec === 3600 ? t("disappears after an hour")
      : p.ttlSec === 86400 ? t("disappears after a day")
      : p.ttlSec === 604800 ? t("disappears after a week") : null,
  ].filter(Boolean);
}

function fileOptsHtml(p) {
  const selected = selectedFileOptions(p);
  return `<details class="pv-opts" data-pvopts="${p.id}">
    <summary>${selected.length ? escapeHtml(selected.join(" · ")) : t("Who can open it, and for how long")}</summary>
    <div class="pv-menu">
      <label class="pv-check">
        <input type="checkbox" data-pvsens="${p.id}" ${p.sensitive ? "checked" : ""}>
        <span><b>${t("Mark as sensitive")}</b><br>
          <span class="pv-why">${t("No preview in the message list; by default it disappears after a day.")}</span></span>
      </label>
      <label class="pv-check">
        <input type="checkbox" data-pvburn="${p.id}" ${p.burn ? "checked" : ""}>
        <span><b>${t("Delete after the first download")}</b><br>
          <span class="pv-why">${t("The first person to open it will be the last. This cannot be undone - not even by you.")}</span></span>
      </label>
      <label class="pv-field">
        <span class="pv-why">${t("When the file should disappear by itself")}</span>
        <select data-pvttl="${p.id}">
          <option value="0" ${!p.ttlSec ? "selected" : ""}>${t("never - it stays in the conversation")}</option>
          <option value="3600" ${p.ttlSec === 3600 ? "selected" : ""}>${t("after an hour")}</option>
          <option value="86400" ${p.ttlSec === 86400 ? "selected" : ""}>${t("after a day")}</option>
          <option value="604800" ${p.ttlSec === 604800 ? "selected" : ""}>${t("after a week")}</option>
        </select>
      </label>
    </div>
  </details>`;
}

function renderPreviews() {
  const box = document.getElementById("composer-previews");
  if (!box) return;
  const remove = (p) => `<button data-rmpv="${p.id}" aria-label="${t("Remove the attachment {name}", { name: escapeHtml(p.file.name) })}"
    title="${t("Remove")}"><span aria-hidden="true">&times;</span></button>`;
  box.innerHTML = state.pendingFiles.map((p) => p.url
    ? `<div class="preview img" data-pv="${p.id}"><img src="${p.url}" alt="${escapeHtml(p.file.name)}">${remove(p)}${fileOptsHtml(p)}</div>`
    : `<div class="preview file" data-pv="${p.id}"><div class="pv-main">${iconFile()}<span class="pn">${escapeHtml(p.file.name)}</span>${remove(p)}</div>${fileOptsHtml(p)}</div>`
  ).join("");
  box.querySelectorAll("[data-rmpv]").forEach((b) => b.addEventListener("click", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.rmpv);
    if (p?.url) URL.revokeObjectURL(p.url);
    state.pendingFiles = state.pendingFiles.filter((x) => x.id !== b.dataset.rmpv);
    renderPreviews();
    updateSendButton();
    saveDraft();
  }));
  // We refresh the summary in the header POINTWISE rather than redrawing the previews: a full
  // render would close the menu that was just opened, on every click on an option.
  const updateFileSummary = (id) => {
    const p = state.pendingFiles.find((x) => x.id === id);
    const sum = box.querySelector(`[data-pvopts="${id}"] > summary`);
    if (!p || !sum) return;
    const selected = selectedFileOptions(p);
    sum.textContent = selected.length ? selected.join(" · ") : t("Who can open it, and for how long");
  };
  box.querySelectorAll("[data-pvsens]").forEach((b) => b.addEventListener("change", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.pvsens);
    if (p) { p.sensitive = b.checked; updateFileSummary(p.id); }
  }));
  box.querySelectorAll("[data-pvburn]").forEach((b) => b.addEventListener("change", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.pvburn);
    if (p) { p.burn = b.checked; updateFileSummary(p.id); }
  }));
  box.querySelectorAll("[data-pvttl]").forEach((s) => s.addEventListener("change", () => {
    const p = state.pendingFiles.find((x) => x.id === s.dataset.pvttl);
    if (p) { p.ttlSec = Number(s.value) || 0; updateFileSummary(p.id); }
  }));
}

async function uploadAttachment(p) {
  const convId = state.activeId;
  const file = p.file;
  try {
    const res = await fetch(`/api/conversations/${convId}/files`, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        ...(p.sensitive ? { "x-sensitive": "1" } : {}),
        ...(p.burn ? { "x-burn": "1" } : {}),
        ...(p.ttlSec ? { "x-ttl": String(p.ttlSec) } : {}),
        ...(csrf ? { "x-at-csrf": csrf } : {}),
      },
      credentials: "same-origin",
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    upsertMessage(convId, data.message);
    upsertMessageNode(data.message);
    scrollToBottom(true);
    return true;
  } catch (e) {
    showToast(t("Could not send the file: {why}", { why: e.message }), { alert: true });
    return false;
  }
}

function focusComposer() { const ta = document.getElementById("composer-input"); if (ta) ta.focus(); }

// ---------------------------------------------- @ and # autocomplete (engine in composer.js)
/** The directory is refreshed on one TTL rule (ensureActors) - an agent that joined a minute ago
 *  must exist for the suggestions. The Polish alias of @all stays accepted (D-MG-16). */
function mountAutocomplete(ta) {
  return createAutocomplete(ta, {
    actors: async () => { await ensureActors(); return state.actorsList; },
    allAliases: ["wszyscy"],
  });
}

// ------------------------------------------------------------- thread (drawer)
export function renderThread() {
  let host = document.getElementById("thread-slot");
  if (!host) return;
  const root = findMsgById(state.threadOpen);
  const replies = state.threadMsgs.filter((m) => m.id !== state.threadOpen);
  // The panel is redrawn when the replies arrive and on every echo; what the user already typed
  // into the box, and the "also send" tick, must survive that redraw.
  const keep = { text: document.getElementById("th-input")?.value ?? "", also: !!document.getElementById("th-also")?.checked };
  // U8: an empty reply list is one of two states and the panel says which one.
  const loading = threadLoadingFor === state.threadOpen && !replies.length;
  const repliesState = replies.length ? "" : loading
    ? `<div class="th-state th-loading" role="status">${skeletonHtml()}<span class="th-state-text">${t("Loading replies...")}</span></div>`
    : `<div class="th-state th-empty" role="status">${iconThread()}<span class="th-state-text">${t("No replies yet - be the first.")}</span></div>`;
  host.innerHTML = `
    <div class="thread" role="region" aria-label="${t("Thread")}">
      <div class="th-head">${iconThread()} ${t("Thread")}
        <button class="iconbtn close" id="th-close" aria-label="${t("Close the thread")}" title="${t("Close")}"><span aria-hidden="true">&times;</span></button></div>
      <div class="th-msgs" id="th-msgs">
        ${root ? messageHtml(root, false, { noThreadLink: true }) : ""}
        ${replies.map((m, i) => messageHtml(m, i > 0 && replies[i - 1].actorId === m.actorId)).join("")}
        ${repliesState}
      </div>
      <div class="composer" id="th-composer"></div>
    </div>`;
  document.getElementById("th-close").addEventListener("click", closeThread);
  bindMessageEvents(document.getElementById("th-msgs"));
  // The SAME composer as the main dock (composer.js): formatting, emoji, @ and # lists. Files stay
  // a main-dock feature: the upload route has no thread target yet.
  const conv = state.conversations.find((c) => c.id === state.activeId);
  const alsoLabel = conv?.slug ? t("Also send to #{channel}", { channel: escapeHtml(conv.slug) }) : t("Also send to the conversation");
  const tc = document.getElementById("th-composer");
  tc.innerHTML = composerCardHtml({
    prefix: "th", label: t("Reply in the thread"), placeholder: t("Reply in the thread..."), sendLabel: t("Send the reply"),
    footer: `<label class="th-also"><input id="th-also" type="checkbox"${keep.also ? " checked" : ""}> <span>${alsoLabel}</span></label>`,
  });
  const ta = document.getElementById("th-input"), send = document.getElementById("th-send");
  if (keep.text) ta.value = keep.text;
  const autosize = () => {
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    ta.style.overflowY = ta.scrollHeight > 200 ? "auto" : "hidden";
    send.disabled = !ta.value.trim();
    send.classList.toggle("ready", !!ta.value.trim());
  };
  const formatKey = bindFormatting(ta, tc);
  const ac = mountAutocomplete(ta);
  document.getElementById("th-emoji")?.addEventListener("click", (e) => openEmojiPicker(e.currentTarget, (ch) => insertAtCaret(ta, ch)));
  ta.addEventListener("input", () => { autosize(); signalTyping(); ac.refresh(); });
  ta.addEventListener("keydown", (e) => {
    if (ac.keydown(e)) return;
    if (formatKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  send.addEventListener("click", submit);
  async function submit() {
    const v = ta.value.trim(); if (!v) return;
    ac.close();
    const also = !!document.getElementById("th-also")?.checked;
    ta.value = ""; autosize();
    // Capture the target before awaiting: the user may switch threads or close the panel.
    const convId = state.activeId, rootId = state.threadOpen;
    const msg = await sendMessage(v, { threadId: rootId, conversationId: convId });
    const stillHere = state.view === "chat" && state.activeId === convId && state.threadOpen === rootId;
    // A failed send returns the text to the field - exactly as in the main composer.
    if (!msg) {
      if (stillHere && document.getElementById("th-input") === ta) { ta.value = v; autosize(); ta.focus(); }
      return;
    }
    // "Also send to the channel": a second POST without threadId, a copy in the main list.
    if (also) await sendMessage(v, { conversationId: convId, threadId: null });
    // sendMessage already stored the reply for its root; never insert it into another thread.
    if (!stillHere) return;
    const index = state.threadMsgs.findIndex((entry) => entry.id === msg.id);
    if (index >= 0) state.threadMsgs[index] = msg;
    else { state.threadMsgs.push(msg); state.threadMsgs.sort((a, b) => a.id - b.id); }
    renderThread();
    const root = findMsgById(rootId);
    if (root) upsertMessageNode(root);   // the thread bar on the main list
    const list = document.getElementById("th-msgs");
    if (list) list.scrollTop = 999999;
  }
  if (keep.text) autosize();
  document.getElementById("th-msgs").scrollTop = 999999;
}

/** Closing a thread, returning focus to the bar that opened it. */
export function closeThread() {
  const rootId = state.threadOpen;
  // W2-S2-A: the "x" and Escape close a thread too, not only Mod+.; remember it so Mod+. brings
  // it back (toggleSidePanel only records what IT closed).
  if (rootId) lastSidePanel = { kind: "thread", id: rootId };
  state.threadOpen = null;
  renderMain();
  document.querySelector(`#messages [data-thread="${rootId}"]`)?.focus();
}

// ============================================================= QUESTIONS panel
export async function openQuestionsPanel() {
  let data;
  try { data = await api("GET", "/api/questions/open"); } catch (e) { showError(e); return; }
  const { modal, close } = openModal(`
      <h2 id="m-title">${iconQuestion()} ${t("Open questions")}</h2>
      <div class="qlist">
        ${data.questions.length ? data.questions.map((q) => {
          const conv = state.conversations.find((c) => c.id === q.message.conversationId);
          const where = conv ? (conv.slug ? "#" + conv.slug : dmLabel(conv)) : "";
          return `
          <button class="qrow" data-goto="${q.message.conversationId}" data-mid="${q.message.id}">
            ${avatarHtml(actorHandle(q.message.actorId), 26)}
            <span class="qmain">
              <span class="qtop">@${escapeHtml(actorHandle(q.message.actorId))} <span class="pal-where">${escapeHtml(where)} · ${timeAgo(q.message.ts)}</span></span>
              <span class="qbody">${escapeHtml(q.message.body.slice(0, 160))}</span>
            </span>
          </button>`;
        }).join("") : `<p class="sb-empty">${t("There are no open questions - everything is closed.")}</p>`}
      </div>
      <div class="row"><button class="btn ghost" id="q-close">${t("Close")}</button></div>`,
  { modalClass: "wide" });
  modal.querySelector("#q-close").addEventListener("click", close);
  modal.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => {
      close();
      openConversation(Number(b.dataset.goto), Number(b.dataset.mid));
    }));
}

// ---------------------------------------------------------- a new conversation
export async function openNewConversationModal(initialTab) {
  await ensureActors();
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("New conversation")}</h2>
      <div class="seg" role="tablist" aria-label="${t("Kind of conversation")}">
        <button role="tab" aria-selected="${initialTab !== "dm"}" aria-controls="tab-body"
          data-tab="channel" class="${initialTab !== "dm" ? "on" : ""}">${t("Channel")}</button>
        <button role="tab" aria-selected="${initialTab === "dm"}" aria-controls="tab-body"
          data-tab="dm" class="${initialTab === "dm" ? "on" : ""}">${t("Direct conversation")}</button>
      </div>
      <div id="tab-body" role="tabpanel"></div>`);

  const tabs = modal.querySelectorAll("[data-tab]");
  const body = modal.querySelector("#tab-body");
  const showTab = (tab) => {
    tabs.forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.tab === tab);
      btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
    });
    if (tab === "channel") {
      body.innerHTML = `
        <div class="field"><label for="nc-slug">${t("Channel name")}</label><input id="nc-slug" placeholder="${t("e.g. announcements")}">
          <span class="fhint">${t("Lower-case letters, digits and hyphens - no spaces and no accented characters.")}</span></div>
        <div class="field"><label for="nc-topic">${t("Topic (optional)")}</label><input id="nc-topic" placeholder="${t("why this channel exists")}"></div>
        <div class="seg" style="margin-top:.2rem" role="radiogroup" aria-label="${t("Who can enter")}">
          <button role="radio" aria-checked="true" id="nc-public" class="on">${t("Open")}</button>
          <button role="radio" aria-checked="false" id="nc-private">${t("Closed")}</button></div>
        <div class="row"><button class="btn ghost" id="nc-cancel">${t("Cancel")}</button><button class="btn" id="nc-create">${t("Create")}</button></div>`;
      let kind = "public";
      const pub = body.querySelector("#nc-public"), priv = body.querySelector("#nc-private");
      const choose = (chosen) => {
        kind = chosen === pub ? "public" : "private";
        for (const b of [pub, priv]) {
          b.classList.toggle("on", b === chosen);
          b.setAttribute("aria-checked", String(b === chosen));
        }
      };
      pub.addEventListener("click", () => choose(pub));
      priv.addEventListener("click", () => choose(priv));
      body.querySelector("#nc-cancel").addEventListener("click", close);
      body.querySelector("#nc-create").addEventListener("click", async () => {
        const slug = body.querySelector("#nc-slug").value.trim();
        const topic = body.querySelector("#nc-topic").value.trim();
        if (!slug) return;
        try {
          const data = await api("POST", "/api/conversations", { kind, slug, topic });
          close();
          await loadConversationsList();
          views.sidebar();
          openConversation(data.conversation.id);
        } catch (e) { showError(e); }
      });
      body.querySelector("#nc-slug").focus();
    } else {
      // S6: a people picker (search, chips, faces, kind tag) instead of a <select multiple>;
      // @system is never offered (filterPeople's default).
      body.innerHTML = `
        <div class="field"><span class="flabel" id="nc-who-label">${t("To whom")}</span>
          <div id="nc-who" aria-labelledby="nc-who-label"></div>
        </div>
        <p class="mhint">${t("One person is a direct conversation, several is a group. You approach an agent exactly as you approach a human.")}</p>
        <div class="row"><button class="btn ghost" id="nc-cancel">${t("Cancel")}</button><button class="btn" id="nc-create" disabled>${t("Start")}</button></div>`;
      const startBtn = body.querySelector("#nc-create");
      const start = async (selHandles) => {
        if (!selHandles.length) return;
        try {
          const data = await api("POST", "/api/conversations", { kind: selHandles.length > 1 ? "group" : "dm", members: selHandles });
          close();
          await loadConversationsList();
          views.sidebar();
          openConversation(data.conversation.id);
        } catch (e) { showError(e); }
      };
      const picker = mountPeoplePicker(body.querySelector("#nc-who"), {
        id: "nc-pp",
        onChange: (chosen) => { startBtn.disabled = chosen.length === 0; },
        onSubmit: (chosen) => start(chosen.map((a) => a.handle)),
      });
      body.querySelector("#nc-cancel").addEventListener("click", close);
      startBtn.addEventListener("click", () => start(picker.selected()));
      picker.focus();
    }
  };
  tabs.forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
  showTab(initialTab === "dm" ? "dm" : "channel");
}
