/**
 * The Threads view (S10): every thread I started or replied to, newest activity first, with a
 * dot on the ones somebody else wrote in since I last opened them.
 *
 * The list is computed from the messages this tab has loaded (`state.msgs`); a thread in a
 * conversation never opened in this session is not known here - server need N3
 * (`GET /api/threads?mine=1`) will fill that gap. "Seen" marks live in this browser only: the
 * server has no per-thread read mark, so opening a thread from this view records the id of its
 * last reply and a newer reply switches the dot back on.
 *
 * The view imports no other view: it opens threads through the `views` registry (app.js wires
 * it), the same way the notification centre does, so no import cycle with view-chat.js.
 */
import { avatarHtml, emptyStateHtml, escapeHtml, hamburgerHtml, timeAgo, toggleDrawerClass } from "./dom.js";
import { iconThread } from "./icons.js";
import { t } from "./i18n.js";
import { conversationRoute, parseRoute, syncRoute } from "./router.js";
import { actorHandle, dmLabel, dmOthers, state, views } from "./state.js";

const SEEN_KEY = "atalks_threads_seen";

/** The threads of `me` in a flat message list: `{ root, replies, last, conversationId, unread }`,
 *  newest activity first. A thread is mine when I wrote the root or one of the replies; it is
 *  unread when its last reply is by somebody else and newer than `seen[root.id]`. Pure. */
export function threadsFor(msgs, me, seen = {}) {
  const list = Array.isArray(msgs) ? msgs.filter((m) => m && !m.deletedAt) : [];
  const byId = new Map(list.map((m) => [m.id, m]));
  const replies = new Map();
  for (const m of list) {
    if (!m.threadId) continue;
    const arr = replies.get(m.threadId);
    if (arr) arr.push(m); else replies.set(m.threadId, [m]);
  }
  const out = [];
  for (const [rootId, arr] of replies) {
    const root = byId.get(rootId);
    if (!root) continue;
    arr.sort((a, b) => a.id - b.id);
    const mine = root.actorId === me || arr.some((r) => r.actorId === me);
    if (!mine) continue;
    const last = arr[arr.length - 1];
    const seenUpTo = Number((seen && seen[rootId]) || 0);
    out.push({
      root, replies: arr, last, conversationId: root.conversationId,
      unread: last.actorId !== me && last.id > seenUpTo,
    });
  }
  out.sort((a, b) => b.last.id - a.last.id);
  return out;
}

// ------------------------------------------------------------- seen marks
function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch { return {}; }
}

function markSeen(rootId, lastId) {
  const seen = loadSeen();
  if (Number(seen[rootId] || 0) >= lastId) return;
  seen[rootId] = lastId;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* storage full or blocked: the dot stays */ }
}

/** All loaded messages, every conversation, one flat list. */
function allMessages() {
  const all = [];
  for (const arr of Object.values(state.msgs || {})) all.push(...arr);
  return all;
}

function placeLabel(c) {
  if (!c) return "";
  if (c.kind === "dm" || c.kind === "group") return dmLabel(c);
  return `#${c.slug || c.id}`;
}

// ------------------------------------------------------------------ the view
export async function openThreadsView() {
  state.view = "threads";
  state.drawerOpen = false;
  syncRoute("#/threads");
  views.shell();
  views.main();
  toggleDrawerClass();
}

/** The main column for `state.view === "threads"`. */
export function renderThreadsMain() {
  const el = document.getElementById("main");
  if (!el || !state.actor) return;
  const me = state.actor.id;
  const seen = loadSeen();
  // A thread open right now in the chat view has been read up to its last reply.
  const threads = threadsFor(allMessages(), me, seen);
  const row = (th) => {
    const c = state.conversations.find((x) => x.id === th.conversationId);
    const who = actorHandle(th.root.actorId);
    const faces = [];
    const seenActors = new Set();
    for (const r of th.replies) {
      if (seenActors.has(r.actorId)) continue;
      seenActors.add(r.actorId);
      faces.push(avatarHtml(actorHandle(r.actorId), 20));
      if (faces.length >= 4) break;
    }
    const excerpt = String(th.root.body || "").replace(/\s+/g, " ").slice(0, 140);
    const lastBy = actorHandle(th.last.actorId);
    const lastText = String(th.last.body || "").replace(/\s+/g, " ").slice(0, 120);
    return `
      <button type="button" class="th-row ${th.unread ? "unread" : ""}" data-thread-root="${th.root.id}" data-conv="${th.conversationId}"
        aria-label="${escapeHtml(t("Thread in {place} started by @{handle}, {n} replies, last by @{last}", {
          place: placeLabel(c), handle: who, n: th.replies.length, last: lastBy }))}${th.unread ? `, ${escapeHtml(t("new replies"))}` : ""}">
        <span class="th-dot ${th.unread ? "th-unread" : ""}" aria-hidden="true"></span>
        <span class="th-main">
          <span class="th-where">${escapeHtml(placeLabel(c))} <span class="th-when">${escapeHtml(timeAgo(th.last.ts))}</span></span>
          <span class="th-root">${avatarHtml(who, 22)} <b>@${escapeHtml(who)}</b> <span class="th-excerpt">${escapeHtml(excerpt)}</span></span>
          <span class="th-last"><span class="tl-faces">${faces.join("")}</span>
            <span class="th-count">${t("{n} replies", { n: th.replies.length })}</span>
            <span class="th-last-text"><b>@${escapeHtml(lastBy)}</b> ${escapeHtml(lastText)}</span></span>
        </span>
      </button>`;
  };
  const unreadCount = threads.filter((x) => x.unread).length;
  el.innerHTML = `
    <div class="main-col threads-view">
      <div class="topbar">
        ${hamburgerHtml()}
        <div class="title"><div class="t">${iconThread()} ${t("Threads")}</div>
          <div class="topic">${unreadCount ? t("{n} with new replies", { n: unreadCount }) : t("Threads you started or replied to")}</div></div>
      </div>
      <div class="threads-list viewfade" id="threads-list" role="list" aria-label="${t("Threads")}">
        ${threads.length ? threads.map(row).join("") : emptyStateHtml(iconThread(), t("No threads yet"),
          t("Reply to a message to start a thread. Threads you start or reply to gather here, newest first."))}
      </div>
    </div>`;
  document.getElementById("btn-menu")?.addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  el.querySelectorAll("[data-thread-root]").forEach((b) => b.addEventListener("click", () => openOne(b)));
}

async function openOne(btn) {
  const rootId = Number(btn.dataset.threadRoot);
  const convId = Number(btn.dataset.conv);
  const th = threadsFor(allMessages(), state.actor.id).find((x) => x.root.id === rootId);
  if (th) markSeen(rootId, th.last.id);
  const c = state.conversations.find((x) => x.id === convId);
  if (!c) return;
  // The thread route (S3) does the opening: conversation first, then the thread panel - the same
  // path a bell row or a permalink takes, so Back from the thread returns to this list.
  const hash = conversationRoute(c, dmOthers(c), { threadId: rootId });
  if (location.hash === hash) {
    await views.openConversation(convId);
    if (state.view === "chat" && state.activeId === convId) await views.openThread(rootId);
    return;
  }
  location.hash = hash;
}

// `#/threads` typed, pasted or walked to with Back: app.js leaves unknown views alone, so this
// view listens for its own route. An echo of our own push is a no-op (the view is already up).
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("hashchange", () => {
    if (!state.actor || parseRoute(location.hash).view !== "threads") return;
    if (state.view === "threads") return;
    openThreadsView();
  });
}
