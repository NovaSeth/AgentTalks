/**
 * All unreads (S8): one main-column view listing every unread message, grouped by conversation,
 * newest activity first. Built client-side from `state.unread` and the messages already loaded;
 * a conversation whose history was never fetched is loaded lazily when the view opens.
 * Opened with Mod+Shift+A (shortcuts.js); a row jumps to the message in its conversation.
 */
import { loadMessages } from "./data.js";
import { avatarHtml, emptyStateHtml, escapeHtml, fmtTime, hamburgerHtml, toggleDrawerClass } from "./dom.js";
import { iconCheck, iconChat } from "./icons.js";
import { t } from "./i18n.js";
import { mdToHtml } from "./markdown.js";
import { syncRoute } from "./router.js";
import { actorHandle, dmLabel, state, views } from "./state.js";

const MAX_LAZY_LOADS = 8;

/** What a conversation is called in a group header: "#slug" or the DM's "@a, @b". */
function convName(c) {
  return (c.kind === "dm" || c.kind === "group") ? dmLabel(c) : `#${c.slug || c.id}`;
}

/** The unread groups, derived from state alone: conversations I belong to with unread > 0.
 *  Messages are the ones above the membership's read mark written by somebody else (thread
 *  replies included, the server counts them too); without a mark, the last `unread` ones.
 *  `pending` says the history is not loaded yet (the view fetches it, then re-renders).
 *  Newest activity first, by the highest unread message id (an unloaded group sorts by id). */
export function unreadGroups(s) {
  const me = s.actor?.id;
  const out = [];
  for (const c of s.conversations || []) {
    const count = s.unread?.[c.id] || 0;
    if (!count || !s.memberships?.[c.id]) continue;
    const mark = s.memberships[c.id].lastReadMessageId ?? 0;
    const others = (s.msgs?.[c.id] || []).filter((m) => m && typeof m.id === "number" && m.actorId !== me);
    const messages = mark > 0 ? others.filter((m) => m.id > mark) : others.slice(-count);
    const pending = !s.loaded?.[c.id];
    out.push({ conv: c, count, messages, pending, last: messages.length ? messages[messages.length - 1].id : -c.id });
  }
  out.sort((a, b) => b.last - a.last);
  return out;
}

/** Unread messages in direct and group conversations I belong to. The body lives in counters.js
 *  (W5-S8-B: one badge source, `railBadges(state).dms`); re-exported here for the S8 callers. */
export { unreadDmCount } from "./counters.js";

/** Screen reader name of one row: "@who in #where: excerpt". */
function rowLabel(m, c) {
  const excerpt = String(m.body || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return `@${actorHandle(m.actorId)} ${t("in {where}", { where: convName(c) })}${excerpt ? `: ${excerpt}` : ""}`;
}

function rowHtml(m, c) {
  const handle = actorHandle(m.actorId);
  return `
        <button class="unread-row" data-goto="${c.id}" data-mid="${m.id}" aria-label="${escapeHtml(rowLabel(m, c))}">
          ${avatarHtml(handle, 28)}
          <span class="unread-main">
            <span class="unread-top"><b>@${escapeHtml(handle)}</b>${m.threadId ? ` <span class="unread-where">${t("in a thread")}</span>` : ""} <span class="unread-time">${fmtTime(m.ts)}</span></span>
            <span class="unread-body md">${mdToHtml(m.body, "message", state.actor?.handle)}</span>
          </span>
        </button>`;
}

function groupHtml(g) {
  const name = convName(g.conv);
  return `
      <section class="unread-group" aria-label="${escapeHtml(name)}">
        <h3 class="unread-head">
          <button class="unread-open" data-open="${g.conv.id}" aria-label="${escapeHtml(t("Open {where}", { where: name }))}">${escapeHtml(name)}</button>
          <span class="unread-count">${t("{n} unread", { n: g.count })}</span>
        </h3>
        ${g.pending ? `<p class="unread-loading">${t("Loading...")}</p>` : g.messages.map((m) => rowHtml(m, g.conv)).join("")}
        ${!g.pending && g.messages.length < g.count ? `<p class="unread-more"><button class="btn slim" data-open="${g.conv.id}">${t("Open the conversation for the rest")}</button></p>` : ""}
      </section>`;
}

export function renderUnreadsMain() {
  const el = document.getElementById("main");
  if (!el) return;
  const groups = unreadGroups(state);
  const total = groups.reduce((n, g) => n + g.count, 0);
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title"><div class="t">${iconChat()} ${t("All unreads")}</div>
        <div class="topic">${total ? t("{n} unread", { n: total }) : t("nothing unread")}</div></div>
    </div>
    <div class="unreads-list viewfade" id="unreads-list">
      ${groups.length
        ? groups.map(groupHtml).join("")
        : emptyStateHtml(iconCheck(), t("You are all caught up"),
          t("Every conversation you belong to has been read. New messages will show up here."),
          { id: "unreads-go-chat", label: t("Back to conversations") })}
    </div>`;
  document.getElementById("btn-menu")?.addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  el.querySelector("#unreads-go-chat")?.addEventListener("click", () => { state.view = "chat"; views.shell(); });
  el.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => views.openConversation(Number(b.dataset.goto), Number(b.dataset.mid))));
  el.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => views.openConversation(Number(b.dataset.open))));
}

/** Mod+Shift+A and `#/unreads` (W5-S8-A: the view has a URL, so F5 and Back keep it): show the
 *  view, then fetch the histories it is missing (a few at a time). */
export async function openUnreadsView() {
  state.view = "unreads";
  state.drawerOpen = false;
  syncRoute("#/unreads");
  views.shell();
  toggleDrawerClass();
  const pending = unreadGroups(state).filter((g) => g.pending).slice(0, MAX_LAZY_LOADS);
  if (!pending.length) return;
  await Promise.all(pending.map((g) => loadMessages(g.conv.id).catch(() => { state.loaded[g.conv.id] = true; })));
  if (state.view === "unreads") renderUnreadsMain();
}
