/**
 * The notification centre and the permission prompt for system notifications.
 */
import { api } from "./api.js";
import { refreshNotifications } from "./data.js";
import { emptyStateHtml, escapeHtml, fmtDateTime, hamburgerHtml, openModal, toggleDrawerClass } from "./dom.js";
import { iconBell, iconChat, iconDoc, iconWrench } from "./icons.js";
import { msg, t } from "./i18n.js";
import { mdToHtml } from "./markdown.js";
import { dmLabel, state, views } from "./state.js";
import { showError, showToast } from "./toasts.js";
import { openWikiPage } from "./view-wiki.js";

/** The permission request for notifications. Called from the notification centre
 *  - that is, from the place where the user is already thinking about how they
 *  want to be called. */
// One place for "what concerns me": mentions by name, direct messages, reactions
// to my posts and changes to pages I co-author. Every row has a DESTINATION -
// a click leads to where the thing happened, not to its neighbourhood.
async function askNotificationPermission() {
  if (!("Notification" in window)) { showToast(t("This browser cannot do system notifications.")); return; }
  if (Notification.permission === "granted") { showToast(t("Notifications are already on.")); return; }
  if (Notification.permission === "denied") {
    showToast(t("Notifications are blocked in the browser settings for this site."), { alert: true });
    return;
  }
  const perm = await Notification.requestPermission();
  showToast(perm === "granted" ? t("Notifications are on.") : t("No notifications - the counter stays in the tab title."));
  renderNotificationsMain();
}

/** The "What's new" modal: a list of fresh capabilities, shown once after a
 *  change. The content comes from the server (NEWS.md) and is already marked as
 *  delivered.
 *  @param onClose called when the window disappears - the greetings are a
 *         queue, so the next one can only start once this one frees the screen. */
export function showNewsModal(news, onClose) {
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("What's new")}</h2>
      <div class="md news-body">${mdToHtml(news.text, "page", state.actor.handle)}</div>
      <div class="row"><button class="btn" id="news-ok">${t("Got it, thanks")}</button></div>`,
  {
    modalClass: "wide news-modal",
    // A teardown (sign-out, lost session) drops the window and its Escape listener, and does NOT
    // advance the greeting queue onto the sign-in screen (F2).
    onClose: ({ forced }) => {
      if (!forced) return;
      closed = true;
      document.removeEventListener("keydown", onEscape, true);
    },
  });
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onEscape, true);
    onClose?.();
  };
  const onEscape = (e) => { if (e.key === "Escape") finish(); };
  modal.querySelector("#news-ok").addEventListener("click", () => { close(); finish(); });
  // Escape and a backdrop click close the window without going through our
  // button - without this the greeting queue would stall forever.
  modal.closest(".overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) finish(); });
  document.addEventListener("keydown", onEscape, true);
}

export async function openNotificationsView() {
  state.view = "notifications";
  state.drawerOpen = false;
  views.shell();
  views.main();
  toggleDrawerClass();
  await refreshNotifications();
  renderNotificationsMain();
}

// Every kind gets its OWN sentence. A report closed by somebody else used to
// arrive as a `mention` and said "mentioned you" - so the notification lied about
// what had happened and sent you looking for a mention that was not there. The
// server now sends those as `fix`.
const NOTIF_TEXT = {
  mention: msg("mentioned you"),
  dm: msg("wrote to you privately"),
  reaction: msg("reacted to your post"),
  wiki: msg("changed a page you co-author"),
  fix: msg("fixed what you reported - confirm the symptom is gone"),
};

/** The row as one sentence (S8, M15): "@nestor mentioned you in #general", "... in a thread in
 *  #bugs", "@nestor wrote to you privately". A DM names no place twice: "privately" is the place.
 *  A wiki change names the page. Exported for the test and for the row's aria-label. */
export function notifSentence(n) {
  const who = `@${n.from ?? "?"}`;
  const what = t(NOTIF_TEXT[n.kind] || msg("did something that concerns you - open it to see"));
  const where = notifPlace(n);
  return where ? `${who} ${what} ${where}` : `${who} ${what}`;
}

/** Sentence plus excerpt: the name a screen reader reads for the row button. */
export function notifLabel(n) {
  return n.excerpt ? `${notifSentence(n)}: ${n.excerpt}` : notifSentence(n);
}

/** "in #general", "in a thread in #bugs"; "" for a DM (the verb already says privately) and for
 *  a wiki change (the page name is shown as the target instead). */
function notifPlace(n) {
  if (n.wikiSlug) return "";
  const c = state.conversations.find((x) => x.id === n.conversationId);
  if (!c || c.kind === "dm" || c.kind === "group") return "";
  const where = `#${c.slug || c.id}`;
  const m = n.messageId ? (state.msgs[c.id] || []).find((x) => x.id === n.messageId) : null;
  return m?.threadId ? t("in a thread in {where}", { where }) : t("in {where}", { where });
}

function notifIcon(kind) {
  if (kind === "wiki") return iconDoc();
  if (kind === "reaction") return "🙂";
  if (kind === "dm") return iconChat();
  if (kind === "fix") return iconWrench();
  return "@";
}

/** The name of the place a notification leads to - so a row can be understood
 *  without clicking ("#bugs" says more than "conversation 2"). */
function notifTarget(n) {
  if (n.wikiSlug) {
    const page = state.wiki.pages.find((p) => p.slug === n.wikiSlug);
    return page ? (page.title || page.slug) : n.wikiSlug;
  }
  const c = state.conversations.find((x) => x.id === n.conversationId);
  if (!c) return "";
  return (c.kind === "dm" || c.kind === "group") ? dmLabel(c) : `#${c.slug || c.id}`;
}

export function renderNotificationsMain() {
  const el = document.getElementById("main");
  if (!el) return;
  const list = state.notifications;
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title"><div class="t">${iconBell()} ${t("Activity")}</div>
        <div class="topic">${state.notifUnread ? t("{n} new", { n: state.notifUnread }) : t("nothing unread")}</div></div>
      ${("Notification" in window) && Notification.permission !== "granted"
        ? `<button class="pillbtn" id="btn-notif-perm">${t("Turn on system notifications")}</button>` : ""}
      <button class="btn ghost" id="btn-notif-read" ${state.notifUnread ? "" : "disabled"}>${t("Mark all as read")}</button>
    </div>
    <div class="notif-list viewfade" id="notif-list">
      ${list.length
        ? list.map((n) => `
        <button class="notif ${n.readAt ? "" : "fresh"}" data-notif="${n.id}" aria-label="${escapeHtml(notifLabel(n))}">
          <span class="ni">${notifIcon(n.kind)}</span>
          <span class="nb">
            <span class="nh"><b>@${escapeHtml(n.from ?? "?")}</b> ${t(NOTIF_TEXT[n.kind] || msg("did something that concerns you - open it to see"))}
              ${notifPlace(n) ? `<span class="nw">${escapeHtml(notifPlace(n))}</span>` : n.wikiSlug ? `<span class="nw">${escapeHtml(notifTarget(n))}</span>` : ""}</span>
            ${n.excerpt ? `<span class="nx">${escapeHtml(n.excerpt)}</span>` : ""}
          </span>
          <span class="nt">${fmtDateTime(n.createdAt)}</span>
        </button>`).join("")
        : emptyStateHtml(iconBell(2.4), t("Nothing new"),
          t("This is where what concerns you personally lands: mentions by name, direct conversations, reactions to your posts and changes to wiki pages you co-author."),
          { id: "notif-go-chat", label: t("Back to conversations") })}
    </div>`;
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  const perm = document.getElementById("btn-notif-perm");
  // We ask for permission HERE, in the place where the user is already thinking
  // about how they want to be called - not reflexively at startup, where a
  // refusal is permanent.
  if (perm) perm.addEventListener("click", askNotificationPermission);
  const rb = document.getElementById("btn-notif-read");
  if (rb) rb.addEventListener("click", async () => {
    rb.disabled = true;
    try {
      await api("POST", "/api/notifications/read", {});
      await refreshNotifications();
    } catch (e) { showError(e); }
  });
  el.querySelector("#notif-go-chat")?.addEventListener("click", () => {
    state.view = "chat"; views.shell();
  });
  el.querySelectorAll("[data-notif]").forEach((b) =>
    b.addEventListener("click", () => openNotification(Number(b.dataset.notif))));
}

/** A click: tick off THIS notification and go to where the event happened. */
async function openNotification(id) {
  const n = state.notifications.find((x) => x.id === id);
  if (!n) return;
  if (!n.readAt) {
    api("POST", "/api/notifications/read", { ids: [id] })
      .then(() => refreshNotifications())
      .catch(() => {});
  }
  if (n.wikiSlug) { openWikiPage(n.wikiSlug); return; }
  if (n.conversationId) views.openConversation(n.conversationId, n.messageId ?? undefined);
}
