/**
 * The conversation view: the message list, the composer, a thread, the details panel.
 */
import { answerQuestion, askChannel, deleteMsg, dropPending, fixMsg, joinChannel, resolveMsg, retryPending, saveEditedMsg, sendMessage, togglePin, toggleReaction } from "./akcje.js";
import { api, csrf } from "./api.js";
import { ensureActors, loadConversationsList, loadMessages, loadOlderMessages, loadPins, markReadDebounced, refreshQuestions, signalTyping } from "./dane.js";
import { IMG_RE, avatarHtml, confirmModal, dayKey, dayLabel, emptyStateHtml, escapeHtml, fmtTime, formatBytes, hamburgerHtml, isScrolledToBottom, openModal, scrollToBottom, skeletonHtml, timeAgo, toggleDrawerClass, updateJumpPill, zachowanieScrolla } from "./dom.js";
import { iconAddReaction, iconArrowDown, iconChat, iconCheck, iconCopy, iconEdit, iconFile, iconGear, iconInfo, iconLock, iconMore, iconPin, iconPlus, iconQuestion, iconReply, iconSend, iconThread, iconWrench } from "./ikony.js";
import { renderBody } from "./markdown.js";
import { t } from "./i18n.js";
import { actorHandle, actorKind, actorOnline, animatedMsgs, canManageActive, czyZgloszenie, dmLabel, dmMembersCache, dmOthers, findMsgById, handleOnline, lastMessageId, loadDraft, mentionsMe, mergeActors, mergeReactions, przytnijCache, pushRecent, saveDraft, state, upsertMessage, widoczneWiadomosci, widok, zgloszenia } from "./stan.js";
import { showError, showToast } from "./toasty.js";
import { openWikiPage, renderWikiMain } from "./widok-wiki.js";

// A popular set for the "add a reaction" popover - every value goes through the same API as
// any other reaction, so the palette is only a UI convenience.
const EMOJI_PALETTE = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "🚀", "👏", "✅", "🤔", "😢", "💯", "🙏", "👋", "⭐", "🙌"];

// ------------------------------------------------- entering a conversation
export async function openConversation(id, focusMessageId) {
  saveDraft();                       // the PREVIOUS conversation's draft, before we redraw anything
  const poprzednia = state.activeId;
  // The "new messages" line disappears only on LEAVING a conversation - otherwise the one place
  // that said "this is where you stopped" gets lost while you are still reading.
  if (poprzednia && poprzednia !== id) delete state.readMark[poprzednia];
  state.view = "chat";
  state.activeId = id;
  try { localStorage.setItem("atalks_last_conv", String(id)); } catch { /* prywatny tryb */ }
  pushRecent(id);
  przytnijCache();
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
  widok.render();
  if (!state.loaded[id]) {
    state.loadingConv = true;
    renderMain();
    try { await loadMessages(id); } catch (e) { showError(e); }
    state.loadingConv = false;
  }
  if (focusMessageId && !(state.msgs[id] || []).some((m) => m.id === focusMessageId)) {
    try {
      const data = await api("GET", `/api/conversations/${id}/messages?before=${focusMessageId + 1}&limit=100`);
      for (const m of data.messages) { upsertMessage(id, m); animatedMsgs.add(m.id); }
      mergeActors(data.actors);
      mergeReactions(data.messages, data.reactions);
    } catch { /* best effort */ }
  }
  renderMain();
  refreshQuestions(id);
  // Pins are needed straight away: without them the message menu does not know whether to offer
  // "Pin" or "Unpin". Previously only the details panel fetched them.
  // "Przypnij" czy "Odepnij". Wczesniej pobieral je wylacznie panel szczegolow.
  state.convPins = [];
  loadPins(id);
  if (focusMessageId) {
    const el = document.querySelector(`#messages [data-msg="${focusMessageId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: zachowanieScrolla(false) });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }
  } else {
    // Entering positions itself on the unread LINE when there is one - "catching up on the
    // backlog" is meant to be a finite action, not scrolling upwards by feel.
    const linia = document.querySelector("#messages .newline");
    if (linia) linia.scrollIntoView({ block: "start", behavior: zachowanieScrolla(false) });
    else scrollToBottom(false);
  }
  // Two reasons why this is NOT unconditional:
  // 1) the server's markRead joins the channel, so previewing a channel from the "Discoverable"
  //    section would quietly enrol us in it (and wake us on @all);
  // 2) a jump to a particular message is a look at one place, not a statement of "I read all
  //    the rest" - reaching the bottom is what does that.
  if (state.memberships[id] && !focusMessageId) markReadDebounced(id, lastMessageId(id));
}

export async function openThread(rootId) {
  state.threadOpen = rootId;
  renderMain();
  try {
    const data = await api("GET", `/api/messages/${rootId}/thread`);
    state.threadMsgs = data.messages;
    for (const m of data.messages) animatedMsgs.add(m.id);
    mergeActors(data.actors);
    mergeReactions(data.messages, data.reactions);
  } catch (e) { showError(e); }
  renderThread();
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
  const istnieje = document.getElementById("offbar");
  if (state.online) { istnieje?.remove(); return; }
  if (istnieje) return;
  const topbar = main.querySelector(".topbar");
  if (topbar) topbar.insertAdjacentHTML("afterend", offlineBarHtml());
}

export function renderMain() {
  const el = document.getElementById("main");
  if (!el) return;
  if (state.view === "users") { widok.uzytkownicy(); return; }
  if (state.view === "notifications") { widok.powiadomienia(); return; }
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
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title">
        <div class="t" id="topbar-title"></div>
        ${c && c.topic ? `<div class="topic">${escapeHtml(c.topic)}</div>` : ""}
      </div>
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
    ${state.threadOpen ? `<div id="thread-slot"></div>` : ""}
    ${state.detailsOpen ? `<div id="details-slot"></div>` : ""}
  `;
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
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
  if (state.loadingConv) document.getElementById("messages").innerHTML = skeletonHtml();
  else renderMessages();
  renderPresenceBar();
  if (isMember) { renderComposer(); bindDropZone(el); }
  if (state.threadOpen) renderThread();
  if (state.detailsOpen) renderDetails();
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
        ${avatarHtml(handle, 26)}
        <span class="dm-name">@${escapeHtml(handle)}</span>
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
        <div class="dt-sec">
          <h4>${t("Members")} (${state.convMembers.length})</h4>
          ${state.convMembers.map(memberRow).join("") || `<p class="sb-empty">${t("none")}</p>`}
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
        <div class="dt-sec">
          <h4>${t("Pinned")} (${state.convPins.length})</h4>
          ${state.convPins.map(pinRow).join("")}
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
  const edit = document.getElementById("dt-edit");
  if (edit) edit.addEventListener("click", () => editChannelModal(c));
  host.querySelectorAll("[data-kick]").forEach((b) =>
    b.addEventListener("click", async () => {
      const h = b.dataset.kick;
      const self = h === state.actor.handle;
      const zgoda = await confirmModal(self
        ? { title: t("Leave this conversation?"), body: t("You stop receiving messages from it. The history stays."), ok: t("Leave the conversation"), danger: true }
        : { title: t("Remove @{handle} from the conversation?", { handle: h }), body: t("This person stops seeing new messages. What they have already read stays with them."), ok: t("Remove @{handle}", { handle: h }), danger: true });
      if (!zgoda) return;
      try {
        await api("DELETE", `/api/conversations/${c.id}/members/${encodeURIComponent(h)}`);
        if (self) { state.detailsOpen = false; await loadConversationsList(); widok.sidebar(); renderMain(); return; }
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
      await loadConversationsList(); widok.sidebar(); renderMain();
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
      widok.sidebar();
      if (next) openConversation(next.id); else renderMain();
    } catch (e) { showError(e); }
  });
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
      widok.sidebar(); renderMain();
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
  if (isDirect) {
    // The participants from the server (`others`) are available from the first frame, so the
    // header has a name and a presence dot before the first message arrives.
    const inni = dmOthers(c);
    const online = inni.length > 0 && inni.some((o) => handleOnline(o.handle));
    bar.innerHTML = `<span class="ppresence big ${online ? "on" : ""}"></span> ${escapeHtml(dmLabel(c))}`;
  } else {
    const pre = c.kind === "private" ? `${iconLock(true)} ` : "# ";
    bar.innerHTML = `${pre}${escapeHtml(c.slug || t("unnamed"))}`;
  }
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
function zapiszOtwartaEdycje(el) {
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

function odtworzOtwartaEdycje(el, snap) {
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
  const edycja = zapiszOtwartaEdycje(el);
  const trzymajDol = isScrolledToBottom();
  const scrollTop = el.scrollTop;
  const list = widoczneWiadomosci(state.activeId);
  if (!list.length) {
    el.innerHTML = emptyStateHtml(iconChat(2.2), t("Quiet so far"),
      t("Nobody has written anything here yet. Start with the first sentence - agents and humans will see it the same way."));
    return;
  }

  const c = state.conversations.find((x) => x.id === state.activeId);
  if (c && (c.kind === "dm" || c.kind === "group") && !dmMembersCache[c.id]) {
    const others = [...new Set((state.msgs[c.id] || []).map((m) => m.actorId))].filter((id) => id !== state.actor.id);
    if (others.length) dmMembersCache[c.id] = others;
  }

  // Older messages load themselves as you scroll up; the button stays as an escape route (say,
  // when a batch did not fill the screen and there is nothing to scroll).
  let html = state.hasMore[state.activeId]
    ? `<button class="loadmore" id="btn-loadmore">${t("Older messages")}</button>` : "";
  const idx = threadIndex(state.activeId);
  const mark = state.readMark[state.activeId] || 0;
  let kreska = false;
  let lastDay = null, lastAuthor = null, lastTs = 0;
  for (const m of list) {
    const day = dayKey(m.ts);
    if (day !== lastDay) { html += `<div class="day">${dayLabel(m.ts)}</div>`; lastDay = day; lastAuthor = null; }
    // The "new messages" line: the one place that says "this is where you stopped reading". The
    // server has supplied lastReadMessageId all along, and the UI never used it once.
    if (!kreska && mark && typeof m.id === "number" && m.id > mark && m.actorId !== state.actor.id) {
      html += `<div class="newline"><span>${t("New messages")}</span></div>`;
      kreska = true;
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
  el.scrollTop = trzymajDol ? el.scrollHeight : scrollTop;
  odtworzOtwartaEdycje(el, edycja);
}

/** A pointwise replacement of ONE bubble - the default path for live events.
/**  A full list render on every message, reaction and question refresh erased all the state
/**  living in the DOM and cost as much as the whole conversation. */
export function upsertMessageNode(msg) {
  if (!msg || state.view !== "chat") return;
  const el = document.getElementById("messages");
  if (!el) return;
  if (msg.threadId) { if (state.threadOpen) renderThread(); return; }
  const stary = el.querySelector(`[data-msg="${msg.id}"]`);
  const idx = threadIndex(state.activeId);
  if (stary) {
    // The bubble the user is writing in right now is untouchable.
    if (stary.querySelector(".inline-edit")) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = messageHtml(msg, stary.classList.contains("cont"), { threads: idx });
    stary.replaceWith(tmp.firstElementChild);
    return;
  }
  // We append ONLY at the end, and only when the list really is on screen. An insertion in the
  // middle (a replay after a break) goes through a normal render, so as not to break the order
  // or the day separators.
  const lista = widoczneWiadomosci(state.activeId);
  const i = lista.findIndex((x) => x.id === msg.id);
  if (i !== lista.length - 1 || !el.querySelector("[data-msg]")) { renderMessages(); return; }
  const poprz = lista[i - 1] || null;
  const nowyDzien = !poprz || dayKey(poprz.ts) !== dayKey(msg.ts);
  if (nowyDzien) el.insertAdjacentHTML("beforeend", `<div class="day">${dayLabel(msg.ts)}</div>`);
  const cont = !nowyDzien && !!poprz && poprz.actorId === msg.actorId
    && (msg.ts - poprz.ts) < 300 && !msg.deletedAt && msg.kind !== "ask" && poprz.kind !== "ask";
  el.insertAdjacentHTML("beforeend", messageHtml(msg, cont, { threads: idx }));
}

function reactionChipsHtml(m) {
  const r = state.reactions[m.id];
  if (!r) return "";
  // A reaction's value is untrusted input from another actor (normalizeEmoji admits any short
  // token) - it MUST be escaped when displayed as well.
  return Object.entries(r).map(([emoji, handles]) => {
    const mine = handles.includes(state.actor.handle);
    const safeEmoji = escapeHtml(emoji);
    return `<button class="react ${mine ? "mine" : ""}" data-react="${m.id}" data-emoji="${safeEmoji}"
      title="${escapeHtml(handles.join(", "))}">${safeEmoji}<span class="n">${handles.length}</span></button>`;
  }).join("");
}

/** A thread bar as in Slack: the participants' avatars + the number of replies + the time of
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
function deliveryHtml(m) {
  const d = state.lastDelivery;
  if (!d || d.conversationId !== m.conversationId || d.messageId !== m.id) return "";
  const parts = d.delivery.map((r) => {
    const kto = `@${escapeHtml(r.handle)}`;
    if (r.online) return `<span class="ok">${t("{who} is online now - will read it right away", { who: kto })}</span>`;
    if (r.wakeable) {
      const ile = timeAgo(r.lastSeenAt).replace(/ (ago|temu)$/, "");
      return `<span class="warn">${t("{who} has been asleep for {how_long} - the server will wake them with this message", { who: kto, how_long: escapeHtml(ile) })}</span>`;
    }
    return `<span class="off">${t("{who} is offline - will see it when they are back", { who: kto })}</span>`;
  });
  return `<div class="delivery">${parts.join(" · ")}</div>`;
}

/* The entry animation only on a message's FIRST render. Every re-render (a reaction,
   an edit, a read) redraws the whole list, and without this memory every bubble
   replayed its "slide in" from scratch. */

function messageHtml(m, cont, opts = {}) {
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
  const wolaMnie = mentionsMe(m.body);
  const isAsk = m.kind === "ask";
  const qid = state.openQuestions[m.id];
  const askOpen = isAsk && qid !== undefined;
  const chips = m.deletedAt ? "" : reactionChipsHtml(m);
  const resolved = !!m.resolvedAt;
  // Two DIFFERENT claims, so two different badges: "fixed" is said by whoever changed the code,
  // "confirmed" by whoever reported it (or an admin). One badge for both would read as a
  // verification while meaning "somebody claims they did it".
  const fixed = !!m.fixedAt && !resolved;
  // Resolving is for the author, the instance admin, or a channel admin (as on the server).
  const myMem = state.memberships[m.conversationId];
  // ...but we SHOW it only next to a message that is a report: either it is already circulating
  // in that cycle (it has fixedAt/resolvedAt), or somebody explicitly said "treat as a report".
  // Previously the wrench and the check hung next to EVERY message from somebody else, including
  // in a private conversation about lunch - and an accidental click sent somebody a request to
  // confirm something they had never reported.
  const zgloszenie = czyZgloszenie(m);
  const canResolve = zgloszenie && !m.deletedAt && m.kind !== "answer"
    && (mine || state.actor.isAdmin || (myMem && myMem.role === "admin"));
  const canFix = zgloszenie && !mine && m.kind === "text" && !m.deletedAt;
  const przypieta = state.convPins.some((p) => p.messageId === m.id);
  const fresh = !animatedMsgs.has(m.id);
  // The set grew for the whole life of the tab. A reset past a threshold costs one unnecessary
  // entry animation and gives the memory back.
  if (animatedMsgs.size > 5000) animatedMsgs.clear();
  if (fresh) animatedMsgs.add(m.id);
  return `
    <div class="msg ${fresh ? "enter" : ""} ${cont ? "cont" : ""} ${m.deletedAt ? "deleted" : ""} ${wolaMnie ? "mine-mention" : ""} ${isAsk ? "ask" : ""} ${m.kind === "answer" ? "answer" : ""} ${resolved ? "resolved" : ""}" data-msg="${m.id}">
      ${avatarHtml(handle)}
      <div class="body">
        <div class="head">
          <span class="author">@${escapeHtml(handle)}</span>
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
          // One fixed row under an entry, as in Slack: the reaction chips, then a visible "add a
          // reaction" button, and the thread replies on the right.
          if (m.deletedAt) return "";
          const tlink = !m.threadId && !opts.noThreadLink ? threadLinkHtml(m, opts.threads) : "";
          return `<div class="reacts">${chips}
            <button class="react addreact" data-addreact="${m.id}" aria-label="${t("Add a reaction")}" title="${t("Add a reaction")}">${iconAddReaction()}</button>
            ${tlink}</div>`;
        })()}
        ${mine ? deliveryHtml(m) : ""}
      </div>
      ${!m.deletedAt ? `
      <div class="actions" role="group" aria-label="${t("Actions for the message from @{handle}", { handle: escapeHtml(handle) })}">
        ${canResolve ? `<button data-resolve="${m.id}" data-on="${resolved ? "1" : ""}" class="${resolved ? "on" : ""}" aria-pressed="${resolved}" aria-label="${resolved ? t("Take back the confirmation") : t("Confirm: the symptom is gone")}" title="${resolved ? t("Take back the confirmation") : t("Confirm: the symptom is gone")}">${iconCheck(true)}</button>` : ""}
        ${canFix ? `<button data-fix="${m.id}" data-on="${m.fixedAt ? "1" : ""}" class="${m.fixedAt ? "on" : ""}" aria-pressed="${!!m.fixedAt}" aria-label="${m.fixedAt ? t("Take back the “fixed” mark") : t("Mark as fixed")}" title="${m.fixedAt ? t("Take back “fixed”") : t("Mark: I fixed it, waiting for confirmation")}">${iconWrench()}</button>` : ""}
        <button data-reply="${m.id}" aria-label="${t("Reply in a thread")}" title="${t("Reply in a thread")}">${iconThread()}</button>
        ${mine && m.kind === "text" ? `<button data-edit="${m.id}" aria-label="${t("Edit the message")}" title="${t("Edit")}">${iconEdit()}</button>` : ""}
        <button data-more="${m.id}" data-pinned="${przypieta ? "1" : ""}" data-zgl="${zgloszenie ? "1" : ""}"
          aria-label="${t("More actions")}" aria-haspopup="menu" title="${t("More")}">${iconMore()}</button>
      </div>` : ""}
    </div>`;
}

// ONE delegated listener on the container instead of a dozen querySelectorAll passes after
// every render. Thanks to that, replacing a single bubble requires re-attaching nothing - and
// the message list does not have to be redrawn just to make the buttons work again.
const PODPIETE = new WeakSet();

export function bindMessageEvents(scope) {
  if (!scope || PODPIETE.has(scope)) return;
  PODPIETE.add(scope);
  scope.addEventListener("click", async (e) => {
    const wez = (sel) => e.target.closest(sel);
    let b;
    if ((b = wez("[data-react]"))) { toggleReaction(Number(b.dataset.react), b.dataset.emoji); return; }
    if ((b = wez("[data-addreact]"))) { openEmojiPopover(Number(b.dataset.addreact), b); return; }
    if ((b = wez("[data-reply]"))) { state.replyTo = Number(b.dataset.reply); renderComposer(); focusComposer(); return; }
    if ((b = wez("[data-thread]"))) { openThread(Number(b.dataset.thread)); return; }
    if ((b = wez("[data-resolve]"))) { resolveMsg(Number(b.dataset.resolve), !b.dataset.on); return; }
    if ((b = wez("[data-fix]"))) { fixMsg(Number(b.dataset.fix), !b.dataset.on); return; }
    if ((b = wez("[data-more]"))) { openMessageMenu(Number(b.dataset.more), b); return; }
    if ((b = wez("[data-delete]"))) {
      const id = Number(b.dataset.delete);
      if (await confirmModal({
        title: t("Delete this message?"),
        body: t("The content disappears from the conversation for everybody. A “message deleted” trace stays in its place."),
        ok: t("Delete the message"), danger: true,
      })) deleteMsg(id);
      return;
    }
    if ((b = wez("[data-edit]"))) { startInlineEdit(Number(b.dataset.edit), scope); return; }
    if ((b = wez("[data-answer]"))) { startInlineAnswer(Number(b.dataset.answer), Number(b.dataset.msgRef), scope); return; }
    if ((b = wez("[data-retry]"))) { retryPending(state.activeId, b.dataset.retry); return; }
    if ((b = wez("[data-droppending]"))) { dropPending(state.activeId, b.dataset.droppending); return; }
    if ((b = wez("[data-copytext]"))) {
      const rec = (state.pending[state.activeId] || []).find((p) => p.clientMsgId === b.dataset.copytext);
      try { await navigator.clipboard.writeText(rec?.body ?? ""); showToast(t("Copied to the clipboard")); }
      catch { showToast(t("Could not copy"), { alert: true }); }
      return;
    }
    if ((b = wez("[data-lightbox]"))) { openLightbox(b.dataset.lightbox); return; }
    if ((b = wez("[data-copy]"))) {
      const code = b.parentElement.querySelector("code");
      try {
        await navigator.clipboard.writeText(code.textContent);
        b.classList.add("copied"); b.innerHTML = iconCheck(true);
        setTimeout(() => { b.classList.remove("copied"); b.innerHTML = iconCopy(); }, 1400);
      } catch { showToast(t("Could not copy"), { alert: true }); }
      return;
    }
    if ((b = wez("[data-wikilink]"))) {
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
      widok.sidebar();
      renderWikiMain();
    }
  });
  // Touch has no hover, and the action bar lived only on hover. A long press on a message
  // (500 ms) reveals it exactly as in Slack.
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
  const anuluj = () => { clearTimeout(holdTimer); holdTimer = null; };
  scope.addEventListener("pointerup", anuluj, { passive: true });
  scope.addEventListener("pointercancel", anuluj, { passive: true });
  scope.addEventListener("pointermove", anuluj, { passive: true });
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
  const przypieta = state.convPins.some((p) => p.messageId === messageId);
  const zgloszenie = czyZgloszenie(m);
  const pozycje = [
    { akcja: "pin", label: przypieta ? t("Unpin from the conversation") : t("Pin in the conversation"),
      opis: przypieta ? t("It disappears from the pinned list.") : t("It goes to “Pinned” in the conversation details - for everybody.") },
    ...(!zgloszenie && m.kind === "text" && !m.deletedAt
      ? [{ akcja: "zgloszenie", label: t("Treat as a report"),
        opis: t("Only then do the “I fixed it” and “I confirm it is gone” buttons appear.") }]
      : []),
    { akcja: "kopiuj", label: t("Copy the text"), opis: "" },
    ...(mine ? [{ akcja: "usun", label: t("Delete the message"), opis: t("Irreversible for everybody."), danger: true }] : []),
  ];
  const pop = document.createElement("div");
  pop.className = "msg-menu";
  pop.setAttribute("role", "menu");
  pop.innerHTML = pozycje.map((p) => `
    <button role="menuitem" data-mact="${p.akcja}" class="${p.danger ? "danger" : ""}">
      <span class="mm-l">${escapeHtml(p.label)}</span>
      ${p.opis ? `<span class="mm-o">${escapeHtml(p.opis)}</span>` : ""}
    </button>`).join("");
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 8)}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;

  function close() {
    pop.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    closeMsgMenu = null;
    if (document.contains(anchor)) anchor.focus();
  }
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  pop.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-mact]");
    if (!b) return;
    const akcja = b.dataset.mact;
    close();
    if (akcja === "pin") { togglePin(messageId, !przypieta); return; }
    if (akcja === "zgloszenie") {
      zgloszenia.add(messageId);
      widok.wiadomosc(findMsgById(messageId));
      showToast(t("Treating this as a report. The message now carries “I fixed it” and “I confirm”."));
      return;
    }
    if (akcja === "kopiuj") {
      try { await navigator.clipboard.writeText(m.body ?? ""); showToast(t("Copied to the clipboard.")); }
      catch { showToast(t("Could not copy."), { alert: true }); }
      return;
    }
    if (akcja === "usun") {
      if (await confirmModal({
        title: t("Delete this message?"),
        body: t("The content disappears from the conversation for everybody. A “message deleted” trace stays in its place."),
        ok: t("Delete the message"), danger: true,
      })) deleteMsg(messageId);
    }
  });
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey, true);
  closeMsgMenu = close;
  pop.querySelector("button")?.focus();
}

// ------------------------------------------------------- edycja inline
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
  const autos = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 300) + "px"; };
  ta.addEventListener("input", autos);
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = ta.value.trim();
      if (!v || v === msg.body) { renderMessages(); return; }
      try { await saveEditedMsg(messageId, v); } catch (err) { showError(err); }
    }
    if (e.key === "Escape") renderMessages();
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
  const wrocDo = document.activeElement;
  // The listener is removed in ONE place: previously only the Escape branch exited, so closing
  // by a click left a live close handler holding a reference to a removed element.
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (wrocDo && document.contains(wrocDo)) wrocDo.focus();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
}

// ------------------------------------------------------------- reakcje: popover
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
  function close() {
    pop.removeEventListener("click", onPick);
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey);
    pop.remove();
    closeEmojiPopover = null;
    emojiPopoverAnchor = null;
  }
  pop.addEventListener("click", onPick);
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey);
  closeEmojiPopover = close;
}

// ------------------------------------------------------------- composer
let draftTimer = null;

function zapiszSzkicPozniej() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); }

/** A shared entry point for files from the dialog, from the clipboard and from a drag. */
function dodajPliki(files) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  for (const file of files) {
    // A screenshot from the clipboard arrives with no sensible name ("image.png"), and it has to
    // be recognisable later in the attachment list.
    const nazwany = file.name && file.name !== "image.png"
      ? file
      : new File([file], `wklejone-${stamp}.${file.type.split("/")[1] || "png"}`, { type: file.type });
    state.pendingFiles.push({
      file: nazwany, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: nazwany.type.startsWith("image/") ? URL.createObjectURL(nazwany) : null,
      sensitive: false, burn: false, ttlSec: 0,
    });
  }
  renderPreviews();
  odswiezPrzyciskWyslij();
  saveDraft();
}

function odswiezPrzyciskWyslij() {
  const send = document.getElementById("composer-send");
  const ta = document.getElementById("composer-input");
  if (!send || !ta) return;
  const can = !!ta.value.trim() || state.pendingFiles.length > 0;
  send.disabled = !can;
  send.classList.toggle("ready", can);
}

/** Dropping a file onto the WHOLE conversation area, as in Slack - three steps (save to disk,
/**  open the dialog, find the file) turn into one. */
function bindDropZone(el) {
  if (el.dataset.dropbound) return;
  el.dataset.dropbound = "1";
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  el.addEventListener("dragover", (e) => { stop(e); el.classList.add("dropping"); });
  el.addEventListener("dragleave", (e) => { if (e.target === el) el.classList.remove("dropping"); });
  el.addEventListener("drop", (e) => {
    stop(e);
    el.classList.remove("dropping");
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) dodajPliki(files);
  });
}

export function renderComposer() {
  const el = document.getElementById("composer");
  if (!el) return;
  const replyMsg = state.replyTo ? findMsgById(state.replyTo) : null;
  const c = state.conversations.find((x) => x.id === state.activeId);
  // A question only makes sense on a channel: in a direct conversation an "open question" has
  // nobody's list to lie on.
  const kanal = !!c && (c.kind === "public" || c.kind === "private");
  const ask = kanal && state.askMode;
  el.innerHTML = `
    ${replyMsg ? `<div class="replying">${t("Replying in the thread of <b>@{handle}</b>", { handle: escapeHtml(actorHandle(replyMsg.actorId)) })}
      <button id="cancel-reply" aria-label="${t("Cancel replying in the thread")}" title="${t("Cancel")}"><span aria-hidden="true">&times;</span></button></div>` : ""}
    ${ask ? `<div class="asking">${iconQuestion()} ${t("This goes as a <b>question to the channel</b> - it stays open until somebody answers.")}
      <button id="cancel-ask" aria-label="${t("Back to a normal message")}" title="${t("Back to a normal message")}"><span aria-hidden="true">&times;</span></button></div>` : ""}
    <div class="card ${ask ? "asking-card" : ""}" id="composer-card">
      <div class="previews" id="composer-previews"></div>
      <div class="row">
        <button class="attach" id="composer-attach" type="button" aria-label="${t("Attach files")}" title="${t("Attach files")}">${iconPlus()}</button>
        <input type="file" id="composer-file" multiple style="display:none" aria-label="${t("Choose files to send")}">
        ${kanal ? `<button class="attach askbtn ${ask ? "on" : ""}" id="composer-ask" type="button"
          aria-pressed="${ask}" aria-label="${t("Ask the channel a question")}"
          title="${t("Ask the channel a question - it stays open until somebody answers")}">${iconQuestion()}</button>` : ""}
        <label class="sr-only" for="composer-input">${ask ? t("Your question to the channel") : t("Your message")}</label>
        <textarea id="composer-input" rows="1" placeholder="${ask ? t("What do you want to ask the channel?") : t("Your message...")}"></textarea>
        <button class="send" id="composer-send" disabled aria-label="${ask ? t("Send the question") : t("Send the message")}" title="${t("Send (Enter)")}">${iconSend()}</button>
      </div>
    </div>`;
  const ta = document.getElementById("composer-input");
  const send = document.getElementById("composer-send");
  const cancel = document.getElementById("cancel-reply");
  const attachBtn = document.getElementById("composer-attach");
  const fileInput = document.getElementById("composer-file");
  if (cancel) cancel.addEventListener("click", () => { state.replyTo = null; renderComposer(); focusComposer(); });
  const askBtn = document.getElementById("composer-ask");
  if (askBtn) askBtn.addEventListener("click", () => {
    // A question and a thread reply are mutually exclusive: a question goes to the channel, not
    // under somebody's utterance.
    state.askMode = !state.askMode;
    if (state.askMode) state.replyTo = null;
    renderComposer(); focusComposer();
  });
  const cancelAsk = document.getElementById("cancel-ask");
  if (cancelAsk) cancelAsk.addEventListener("click", () => { state.askMode = false; renderComposer(); focusComposer(); });
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
  ta.addEventListener("input", () => { autosize(); signalTyping(); mentionAutocomplete(ta); zapiszSzkicPozniej(); });
  ta.addEventListener("keydown", (e) => {
    if (mentionKeydown(e, ta)) return;
    // Slack's ArrowUp on an EMPTY field: edit your own last message. Without it a typo can be
    // fixed only by hitting a 1.8rem icon that is visible only on hover.
    if (e.key === "ArrowUp" && !ta.value.trim() && !state.pendingFiles.length) {
      const mine = [...widoczneWiadomosci(state.activeId)].reverse()
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
    dodajPliki(files);
    autosize();
  });
  send.addEventListener("click", submit);
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    dodajPliki([...fileInput.files]);
    fileInput.value = "";
    autosize();
  });
  async function submit() {
    const v = ta.value.trim();
    if (!v && !state.pendingFiles.length) return;
    closeMentionPopover();
    // A question to the channel goes by a separate route and carries no attachments.
    if (ask) {
      if (!v) return;
      ta.value = ""; autosize();
      const ok = await askChannel(v);
      if (!ok) { ta.value = v; autosize(); ta.focus(); }
      return;
    }
    const files = state.pendingFiles; state.pendingFiles = [];
    ta.value = ""; renderPreviews(); autosize();
    // A file that failed to send RETURNS to the previews - otherwise it would disappear together
    // with the only copy of the choice the user made.
    const nieudane = [];
    for (const p of files) {
      const ok = await uploadAttachment(p);
      if (ok) { if (p.url) URL.revokeObjectURL(p.url); } else nieudane.push(p);
    }
    if (nieudane.length) { state.pendingFiles = [...nieudane, ...state.pendingFiles]; renderPreviews(); odswiezPrzyciskWyslij(); }
    if (v) await sendMessage(v);
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
function wybraneOpcje(p) {
  return [
    p.sensitive ? t("sensitive") : null,
    p.burn ? t("disappears after reading") : null,
    p.ttlSec === 3600 ? t("disappears after an hour")
      : p.ttlSec === 86400 ? t("disappears after a day")
      : p.ttlSec === 604800 ? t("disappears after a week") : null,
  ].filter(Boolean);
}

function fileOptsHtml(p) {
  const wybrane = wybraneOpcje(p);
  return `<details class="pv-opts" data-pvopts="${p.id}">
    <summary>${wybrane.length ? escapeHtml(wybrane.join(" · ")) : t("Who can open it, and for how long")}</summary>
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
  const usun = (p) => `<button data-rmpv="${p.id}" aria-label="${t("Remove the attachment {name}", { name: escapeHtml(p.file.name) })}"
    title="${t("Remove")}"><span aria-hidden="true">&times;</span></button>`;
  box.innerHTML = state.pendingFiles.map((p) => p.url
    ? `<div class="preview img" data-pv="${p.id}"><img src="${p.url}" alt="${escapeHtml(p.file.name)}">${usun(p)}${fileOptsHtml(p)}</div>`
    : `<div class="preview file" data-pv="${p.id}"><div class="pv-main">${iconFile()}<span class="pn">${escapeHtml(p.file.name)}</span>${usun(p)}</div>${fileOptsHtml(p)}</div>`
  ).join("");
  box.querySelectorAll("[data-rmpv]").forEach((b) => b.addEventListener("click", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.rmpv);
    if (p?.url) URL.revokeObjectURL(p.url);
    state.pendingFiles = state.pendingFiles.filter((x) => x.id !== b.dataset.rmpv);
    renderPreviews();
    odswiezPrzyciskWyslij();
    saveDraft();
  }));
  // We refresh the summary in the header POINTWISE rather than redrawing the previews: a full
  // render would close the menu that was just opened, on every click on an option.
  const odswiezPodsumowanie = (id) => {
    const p = state.pendingFiles.find((x) => x.id === id);
    const sum = box.querySelector(`[data-pvopts="${id}"] > summary`);
    if (!p || !sum) return;
    const wybrane = wybraneOpcje(p);
    sum.textContent = wybrane.length ? wybrane.join(" · ") : t("Who can open it, and for how long");
  };
  box.querySelectorAll("[data-pvsens]").forEach((b) => b.addEventListener("change", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.pvsens);
    if (p) { p.sensitive = b.checked; odswiezPodsumowanie(p.id); }
  }));
  box.querySelectorAll("[data-pvburn]").forEach((b) => b.addEventListener("change", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.pvburn);
    if (p) { p.burn = b.checked; odswiezPodsumowanie(p.id); }
  }));
  box.querySelectorAll("[data-pvttl]").forEach((s) => s.addEventListener("change", () => {
    const p = state.pendingFiles.find((x) => x.id === s.dataset.pvttl);
    if (p) { p.ttlSec = Number(s.value) || 0; odswiezPodsumowanie(p.id); }
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

// ---------------------------------------------- autouzupelnianie @wzmianek
let mentionPop = null, mentionItems = [], mentionIndex = 0, mentionStart = -1;

function closeMentionPopover() {
  if (mentionPop) { mentionPop.remove(); mentionPop = null; mentionItems = []; }
}

async function mentionAutocomplete(ta) {
  const upto = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
  const m = upto.match(/(^|[\s(])@([a-z0-9._-]{0,24})$/i);
  if (!m) { closeMentionPopover(); return; }
  mentionStart = upto.length - m[2].length - 1;
  // One rule for refreshing the directory (a TTL) instead of three different ones - otherwise an
  // agent that joined a minute ago did not exist for the suggestions.
  await ensureActors();
  const q = m[2].toLowerCase();
  // @all at the top of the list when it matches - one announcement wakes the whole channel.
  const allItem = { handle: "all", displayName: t("everybody on the channel"), kind: "all" };
  const showAll = (!q || "all".startsWith(q) || "wszyscy".startsWith(q));
  mentionItems = [
    ...(showAll ? [allItem] : []),
    ...state.actorsList
      .filter((a) => a.handle !== state.actor.handle)
      .filter((a) => !q || a.handle.toLowerCase().includes(q) || (a.displayName || "").toLowerCase().includes(q)),
  ].slice(0, 6);
  if (!mentionItems.length) { closeMentionPopover(); return; }
  mentionIndex = 0;
  if (!mentionPop) {
    mentionPop = document.createElement("div");
    mentionPop.className = "mention-pop";
    document.body.appendChild(mentionPop);
  }
  const rect = ta.getBoundingClientRect();
  mentionPop.innerHTML = mentionItems.map((a, i) => `
    <button data-mi="${i}" class="${i === mentionIndex ? "sel" : ""}">
      ${a.kind === "all" ? `<span class="mention-all-ic">@</span>` : avatarHtml(a.handle, 22)}
      <span class="mh">@${escapeHtml(a.handle)}</span>
      <span class="kindtag ${a.kind === "all" ? "" : a.kind}">${a.kind === "all" ? t("the whole channel") : a.kind === "human" ? t("human") : t("agent")}</span>
    </button>`).join("");

  // Setting the POSITION, clamped to the visible area.
  //
  // On a phone the keyboard takes the bottom of the screen, and `position:fixed` is measured
  // against the whole window rather than what is visible - so a list computed as "above the
  // field" could land under the keyboard or past the edge. The symptom for the user: they type
  // @ and THERE ARE NO SUGGESTIONS (@michal's report). visualViewport gives the genuinely
  // visible rectangle; when the browser does not have it, the window remains.
  const vv = window.visualViewport;
  const obszar = { top: vv?.offsetTop ?? 0, left: vv?.offsetLeft ?? 0,
                   szer: vv?.width ?? window.innerWidth, wys: vv?.height ?? window.innerHeight };
  const margines = 8;
  const w = mentionPop.offsetWidth, h = mentionPop.offsetHeight;
  let left = Math.min(rect.left + margines, obszar.left + obszar.szer - w - margines);
  left = Math.max(obszar.left + margines, left);
  // By default ABOVE the field (where the writer is looking). When there is no room above -
  // below it. When there is nowhere - at the top edge of the visible area, because a list off
  // screen is the same thing as no list.
  let top = rect.top - h - 6;
  if (top < obszar.top + margines) {
    top = rect.bottom + 6 + h <= obszar.top + obszar.wys ? rect.bottom + 6 : obszar.top + margines;
  }
  mentionPop.style.left = `${Math.round(left)}px`;
  mentionPop.style.top = `${Math.round(top)}px`;

  // pointerdown, not mousedown: on touch the mouse is EMULATED and the event arrives later - and
  // by then the field has lost focus and the list is gone, so a tap selected... nothing.
  // pointerdown handles mouse, touch and stylus.
  mentionPop.querySelectorAll("[data-mi]").forEach((b) =>
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); pickMention(ta, Number(b.dataset.mi)); }));
}

function pickMention(ta, idx) {
  const a = mentionItems[idx];
  if (!a) return;
  const after = ta.value.slice(ta.selectionStart ?? ta.value.length);
  ta.value = ta.value.slice(0, mentionStart) + "@" + a.handle + " " + after;
  const pos = mentionStart + a.handle.length + 2;
  ta.setSelectionRange(pos, pos);
  closeMentionPopover();
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function mentionKeydown(e, ta) {
  if (!mentionPop) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    mentionIndex = (mentionIndex + (e.key === "ArrowDown" ? 1 : mentionItems.length - 1)) % mentionItems.length;
    mentionPop.querySelectorAll("[data-mi]").forEach((b, i) => b.classList.toggle("sel", i === mentionIndex));
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(ta, mentionIndex); return true; }
  if (e.key === "Escape") { closeMentionPopover(); return true; }
  return false;
}

// ------------------------------------------------------------- watek (drawer)
export function renderThread() {
  let host = document.getElementById("thread-slot");
  if (!host) return;
  const root = findMsgById(state.threadOpen);
  const replies = state.threadMsgs.filter((m) => m.id !== state.threadOpen);
  host.innerHTML = `
    <div class="thread" role="region" aria-label="${t("Thread")}">
      <div class="th-head">${iconThread()} ${t("Thread")}
        <button class="iconbtn close" id="th-close" aria-label="${t("Close the thread")}" title="${t("Close")}"><span aria-hidden="true">&times;</span></button></div>
      <div class="th-msgs" id="th-msgs">
        ${root ? messageHtml(root, false, { noThreadLink: true }) : ""}
        ${replies.map((m, i) => messageHtml(m, i > 0 && replies[i - 1].actorId === m.actorId)).join("")}
      </div>
      <div class="composer" id="th-composer"></div>
    </div>`;
  document.getElementById("th-close").addEventListener("click", closeThread);
  bindMessageEvents(document.getElementById("th-msgs"));
  const tc = document.getElementById("th-composer");
  tc.innerHTML = `<div class="card"><div class="row">
    <label class="sr-only" for="th-input">${t("Reply in the thread")}</label>
    <textarea id="th-input" rows="1" placeholder="${t("Reply in the thread...")}"></textarea>
    <button class="send" id="th-send" disabled aria-label="${t("Send the reply")}">${iconSend()}</button></div></div>`;
  const ta = document.getElementById("th-input"), send = document.getElementById("th-send");
  const autosize = () => {
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    ta.style.overflowY = ta.scrollHeight > 200 ? "auto" : "hidden";
    send.disabled = !ta.value.trim();
    send.classList.toggle("ready", !!ta.value.trim());
  };
  ta.addEventListener("input", () => { autosize(); signalTyping(); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  send.addEventListener("click", submit);
  async function submit() {
    const v = ta.value.trim(); if (!v) return;
    ta.value = ""; autosize();
    const msg = await sendMessage(v, { threadId: state.threadOpen });
    // A failed send returns the text to the field - exactly as in the main composer.
    if (!msg) { ta.value = v; autosize(); ta.focus(); return; }
    state.threadMsgs.push(msg);
    renderThread();
    upsertMessageNode(findMsgById(state.threadOpen));   // the thread bar on the main list
    document.getElementById("th-msgs").scrollTop = 999999;
  }
  document.getElementById("th-msgs").scrollTop = 999999;
}

/** Closing a thread, returning focus to the bar that opened it. */
export function closeThread() {
  const rootId = state.threadOpen;
  state.threadOpen = null;
  renderMain();
  document.querySelector(`#messages [data-thread="${rootId}"]`)?.focus();
}

// ============================================================= PYTANIA panel
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
      const wybierz = (ktory) => {
        kind = ktory === pub ? "public" : "private";
        for (const b of [pub, priv]) {
          b.classList.toggle("on", b === ktory);
          b.setAttribute("aria-checked", String(b === ktory));
        }
      };
      pub.addEventListener("click", () => wybierz(pub));
      priv.addEventListener("click", () => wybierz(priv));
      body.querySelector("#nc-cancel").addEventListener("click", close);
      body.querySelector("#nc-create").addEventListener("click", async () => {
        const slug = body.querySelector("#nc-slug").value.trim();
        const topic = body.querySelector("#nc-topic").value.trim();
        if (!slug) return;
        try {
          const data = await api("POST", "/api/conversations", { kind, slug, topic });
          close();
          await loadConversationsList();
          widok.sidebar();
          openConversation(data.conversation.id);
        } catch (e) { showError(e); }
      });
      body.querySelector("#nc-slug").focus();
    } else {
      const others = state.actorsList.filter((a) => a.handle !== state.actor.handle);
      body.innerHTML = `
        <div class="field"><label for="nc-who">${t("To whom")}</label>
          <select id="nc-who" multiple size="6" class="who-select">
            ${others.map((a) => `<option value="${escapeHtml(a.handle)}">@${escapeHtml(a.handle)} ${a.kind === "human" ? `- ${t("human")}` : `- ${t("agent")}`}</option>`).join("")}
          </select>
        </div>
        <p class="mhint">${t("One person is a direct conversation, several is a group. You approach an agent exactly as you approach a human.")}</p>
        <div class="row"><button class="btn ghost" id="nc-cancel">${t("Cancel")}</button><button class="btn" id="nc-create">${t("Start")}</button></div>`;
      body.querySelector("#nc-cancel").addEventListener("click", close);
      body.querySelector("#nc-create").addEventListener("click", async () => {
        const selHandles = [...body.querySelector("#nc-who").selectedOptions].map((o) => o.value);
        if (!selHandles.length) return;
        try {
          const data = await api("POST", "/api/conversations", { kind: selHandles.length > 1 ? "group" : "dm", members: selHandles });
          close();
          await loadConversationsList();
          widok.sidebar();
          openConversation(data.conversation.id);
        } catch (e) { showError(e); }
      });
      body.querySelector("#nc-who").focus();
    }
  };
  tabs.forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
  showTab(initialTab === "dm" ? "dm" : "channel");
}
