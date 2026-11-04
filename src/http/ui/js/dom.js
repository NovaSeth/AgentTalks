/**
 * DOM helpers: HTML escaping, avatars, time formats, modal window, drawer.
 */
import { badgeText, titleCount } from "./counters.js";
import { iconMenu } from "./icons.js";
import { locale, t } from "./i18n.js";
import { avatarUrl, handleKind, state } from "./state.js";

export const $app = document.getElementById("app");

// Version of the loaded UI - read from THIS module's own URL (?v=...), so it
// describes the file that is actually executing rather than what the server has
// on disk. Modules have no document.currentScript (it is null); they do have
// import.meta.url.
export const UI_STAMP = (() => {
  const m = import.meta.url.match(/[?&]v=([a-f0-9]+)/);
  return m ? m[1] : "";
})();

// ------------------------------------------------------------------- helpers
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// "Reduced motion" preference, read once: CSS alone will not stop
// scrollTo({behavior}) or scrollIntoView, because those are API calls rather
// than CSS animations.
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

// "auto" defers to the element's CSS scroll-behavior: since T-MG-29 `.messages` sets none (app.css),
// so a re-pin, a restore of the reading position or a deep-link scrollIntoView is instant, and only
// the jump pill and an own sent message ask for "smooth" (unless reduced motion).
export const scrollBehavior = (smooth) => (smooth && !REDUCED_MOTION.matches ? "smooth" : "auto");

/** The only live region in the application (#live). We announce what is NEW,
 *  not the whole re-rendered branch - hence the text is assembled by hand
 *  instead of wrapping aria-live around a container that is replaced wholesale
 *  on every render. */
export function announce(text) {
  const el = document.getElementById("live");
  if (el) el.textContent = String(text ?? "");
}

/** Unread counter in the tab title. Together with system notifications this is
 *  the only signal that works while the tab is in the background - which is
 *  where it spends most of its life.
 *
 *  We count MESSAGES, not notifications: every mention and every DM produces
 *  both an unread row and a notification, so a plain `unread + notifUnread`
 *  counted the same thing twice and the title contradicted the sidebar badges.
 *  Only notifications with no counterpart in the conversation counters are
 *  added - that is, wiki page changes. */
export function updateTitleBadge() {
  // One derivation (counters.js) for the title, the badges and the divider - S7.
  const total = titleCount(state);
  document.title = total > 0 ? `(${badgeText(total)}) AgentTalks` : "AgentTalks";
}

const PALETTE = ["#3b5ce0", "#ff6b3d", "#1fae7a", "#a45ee5", "#e0466b", "#0ea5c4", "#c98a1f", "#5c6bc0"];

function colorFor(handle) {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(nameOrHandle) {
  const s = String(nameOrHandle ?? "?").replace(/^@/, "");
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export function avatarHtml(handle, size) {
  const c = colorFor(handle || "?");
  // Small avatars: proportionally smaller initials and a lighter cut (class sm).
  const style = size ? `width:${size}px;height:${size}px;font-size:${Math.max(7, Math.round(size * 0.36))}px` : "";
  // Agent faces are square-cornered, human ones round (spec A8), in every list at once: the
  // class rides on the avatar itself instead of on each container (W4-S6-B).
  const cls = (size && size <= 28 ? "av sm" : "av") + (handleKind(handle) === "agent" ? " agent" : "");
  // An image when the actor has one; initials when they do not. A vanished file
  // must produce the dot, not an empty frame with a broken-image icon - same
  // place, same size, no layout jump.
  //
  // The substitution data travels in `data-` attributes rather than inside an
  // `onerror` handler. The first version glued JavaScript together there with
  // initials passed through escapeHtml - which does NOT protect in that
  // position: the browser decodes the attribute entities first and only then
  // reads the content as code, so `&#39;` comes back as an apostrophe and closes
  // the literal. Today the handle is validated down to [a-z0-9._-], so it cannot
  // be exploited - but a safeguard resting on validation in another file stops
  // existing at the first new call site. `data-` plus textContent does not have
  // this class of bug at all.
  const url = avatarUrl(handle);
  if (url) {
    return `<img class="${cls} avimg" src="${escapeHtml(url)}" alt="" loading="lazy"` +
      ` style="${style}" data-ini="${escapeHtml(initials(handle))}" data-bg="${escapeHtml(c)}">`;
  }
  return `<div class="${cls}" style="background:${c};${style}">${escapeHtml(initials(handle))}</div>`;
}

// An image `error` event does NOT bubble, so the listener has to run in the
// capture phase - and one per document is enough, because the lists re-render
// through innerHTML and re-attaching after every render would be lost at the
// first forgotten spot.
document.addEventListener("error", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLImageElement) || !el.classList.contains("avimg")) return;
  const dot = document.createElement("div");
  dot.className = el.className.replace(/\bavimg\b/, "").trim();
  dot.setAttribute("style", el.getAttribute("style") || "");
  dot.style.background = el.dataset.bg || "";
  dot.textContent = el.dataset.ini || "";
  el.replaceWith(dot);
}, true);

export function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short" }) + ", " +
    d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function dayKey(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function dayLabel(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return t("Today");
  if (sameDay(d, y)) return t("Yesterday");
  return d.toLocaleDateString(locale(), { day: "numeric", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}

export function timeAgo(ts) {
  if (!ts) return t("a long time ago");
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 90) return t("just now");
  if (s < 3600) return t("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n} h ago", { n: Math.floor(s / 3600) });
  return t("{n} days ago", { n: Math.floor(s / 86400) });
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const IMG_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

// ------------------------------------------------------- account-bound overlays
// Windows, menus, pickers and the toast stack are mounted on <body>, outside #app, so redrawing
// #app at sign-out or a lost session does not touch them (T-MG-3 F2: a freshly issued token
// stayed on the sign-in screen). Each one registers here with its own close function, which
// also removes its document listeners; closeAccountOverlays() runs them all at teardown.
const overlays = new Set();

/** @param el the mounted element; @param close its own close (removes listeners), called with
 *  `{ forced: true }` at teardown. @returns a function that unregisters it. */
export function trackOverlay(el, close) {
  for (const o of overlays) if (!o.el.isConnected) overlays.delete(o);
  const entry = { el, close };
  overlays.add(entry);
  return () => overlays.delete(entry);
}

/** Closes every registered overlay, including the persistent secret dialogs that refuse normal
 *  dismissal, and removes their DOM even when a close function fails. */
export function closeAccountOverlays() {
  const all = [...overlays];
  overlays.clear();
  for (const o of all) {
    if (o.el.isConnected) {
      try { o.close({ forced: true }); } catch { /* the element still goes below */ }
    }
    try { o.el.remove(); } catch { /* already gone */ }
  }
}

// -------------------------------------------------------------------- modals
// ONE modal implementation for the whole UI. Reason: a window without a focus
// trap looks like a modal but is not one - Tab walks out onto the page
// underneath, Escape does nothing, and after closing, focus lands on <body>,
// so a keyboard user restarts navigation from the top of the document.
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** @param html modal content; the heading should carry id="m-title" (aria-labelledby).
 *  @param opts.persistent a window that CANNOT be dismissed with Escape or a backdrop
 *         click. Reserved for content shown once and unrecoverable (an invite
 *         code): a reflexive Escape cost the whole operation there. */
// U13: while a modal is open the app behind it is inert - the backdrop dims it, and inert also
// takes it out of the Tab order and the accessibility tree (the composer stayed focusable behind
// the passkey offer). Counted, because a modal can open over another (confirm over a form).
let openModals = 0;
function setAppInert(open) {
  openModals = Math.max(0, openModals + (open ? 1 : -1));
  const app = document.getElementById("app");
  if (app) app.inert = openModals > 0;
}

export function openModal(html, opts = {}) {
  const returnTo = document.activeElement;
  const ov = document.createElement("div");
  ov.className = `overlay ${opts.overlayClass ?? ""}`.trim();
  ov.innerHTML = `<div class="modal ${opts.modalClass ?? ""}" role="dialog" aria-modal="true"
    aria-labelledby="m-title" ${opts.style ? `style="${opts.style}"` : ""}>${html}</div>`;
  document.body.appendChild(ov);
  setAppInert(true);

  const onKey = (e) => {
    if (e.key === "Escape" && !ov.dataset.persistent) { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...ov.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  let closed = false;
  function close(how) {
    if (closed) return;
    closed = true;
    untrack();
    document.removeEventListener("keydown", onKey, true);
    ov.remove();
    // The app is usable again before focus returns into it: an inert element refuses focus.
    setAppInert(false);
    // A caller with listeners of its own (confirmModal's Escape, the news queue) learns that the
    // window is gone; `forced` = the account teardown closed it, not the user.
    opts.onClose?.({ forced: !!how?.forced });
    if (how?.forced) return;
    // Focus returns where it came from - otherwise, after the window closes, a
    // screen reader starts from the top of the page instead of from the button
    // that opened it.
    if (returnTo && document.contains(returnTo)) returnTo.focus();
  }
  const untrack = trackOverlay(ov, close);
  document.addEventListener("keydown", onKey, true);
  ov.addEventListener("click", (e) => { if (e.target === ov && !ov.dataset.persistent) close(); });
  const modal = ov.querySelector(".modal");
  if (opts.persistent) ov.dataset.persistent = "1";
  // Focus on the first field, or - when the window is just a message - on the
  // window itself.
  const firstField = modal.querySelector('input:not([type="hidden"]),textarea,select,button');
  if (firstField) firstField.focus();
  else { modal.tabIndex = -1; modal.focus(); }
  // Turning a window into "cannot be lost" after it has opened: the invite code
  // only comes into existence after the "Create" click, i.e. inside an already
  // open window.
  return {
    overlay: ov,
    modal,
    close,
    preventDismiss: () => { ov.dataset.persistent = "1"; },
  };
}

/** Confirmation of an irreversible action. The system `confirm()` said "OK /
 *  Cancel" everywhere - the same words for deleting one message and for deleting
 *  a wiki section together with its history. Here the button NAMES the action,
 *  and the `danger` variant separates the weight by colour, so what you are
 *  agreeing to is readable without reading the whole sentence.
 *  @returns Promise<boolean> */
export function confirmModal({ title, body, ok, cancel, danger = false }) {
  const okLabel = ok ?? t("Yes, do it");
  const cancelLabel = cancel ?? t("Cancel");
  return new Promise((resolve) => {
    const { modal, close } = openModal(`
      <h2 id="m-title">${escapeHtml(title)}</h2>
      ${body ? `<p class="mhint">${escapeHtml(body)}</p>` : ""}
      <div class="row">
        <button class="btn ghost" id="cf-no">${escapeHtml(cancelLabel)}</button>
        <button class="btn ${danger ? "danger" : ""}" id="cf-yes">${escapeHtml(okLabel)}</button>
      </div>`, { onClose: ({ forced }) => { if (forced) finish(false); } });
    let answered = false;
    const finish = (v) => {
      if (answered) return;
      answered = true;
      document.removeEventListener("keydown", onEscape, true);
      resolve(v);
    };
    const onEscape = (e) => { if (e.key === "Escape") finish(false); };
    // Escape and a backdrop click mean "no" - without that the promise would
    // never settle and the caller would wait forever.
    modal.closest(".overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) finish(false); });
    document.addEventListener("keydown", onEscape, true);
    modal.querySelector("#cf-no").addEventListener("click", () => { close(); finish(false); });
    modal.querySelector("#cf-yes").addEventListener("click", () => { close(); finish(true); });
    // Focus on the way out, not on the action: an Enter pressed reflexively in a
    // warning window must not confirm a deletion.
    modal.querySelector("#cf-no").focus();
  });
}

export function toggleDrawerClass() {
  const shell = document.getElementById("shell");
  if (shell) shell.classList.toggle("drawer", state.drawerOpen);
  const sb = document.getElementById("sidebar");
  const mobile = window.matchMedia("(max-width:760px)").matches;
  // A transform pushes the drawer off screen, but does NOT remove it from the
  // Tab order or from the accessibility tree: without `inert` a keyboard user
  // fell into an invisible channel list with no way out.
  if (sb) sb.inert = mobile && !state.drawerOpen;
  const menu = document.getElementById("btn-menu");
  if (menu) menu.setAttribute("aria-expanded", String(!!state.drawerOpen));
  if (mobile && state.drawerOpen && sb) sb.querySelector("button")?.focus();
}

/** How much of a lease is left - text refreshed together with the sidebar (30 s poll). */
export function leaseCountdown(expiresAt) {
  const s = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  if (s >= 60) return `${Math.floor(s / 60)} min`;
  return `${s} s`;
}

// --------------------------------------------------------- shared view pieces
// The hamburger appears in four views and drives the same drawer everywhere -
// so both its accessible name and aria-expanded belong in one place.
export const hamburgerHtml = () => `<button class="iconbtn hamburger" id="btn-menu" aria-label="${t("Conversation list")}"
  aria-expanded="${state.drawerOpen}" aria-controls="sidebar" title="${t("Conversation list")}">${iconMenu()}</button>`;

/** An empty state says WHAT TO DO HERE, not merely "nothing". The third argument
 *  is an optional button {id, label} - wiring it up stays with the view, because
 *  the view is what knows what should happen. */
export function emptyStateHtml(iconHtml, title, sub, action) {
  return `<div class="empty"><div class="big">${iconHtml}</div><h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(sub)}</p>
    ${action ? `<button class="btn slim" id="${action.id}">${escapeHtml(action.label)}</button>` : ""}</div>`;
}

/** An empty sidebar section: one sentence and, when there is something to do, a button. */
export function sidebarEmptyHtml(text, action) {
  return `<div class="sb-empty">${escapeHtml(text)}
    ${action ? `<button class="sb-cta" id="${action.id}">${escapeHtml(action.label)}</button>` : ""}</div>`;
}

export function skeletonHtml() {
  return Array.from({ length: 5 }).map(() => `
    <div class="skeleton"><div class="sk-line w40"></div><div class="sk-line w80"></div></div>`).join("");
}

// ------------------------------------------------------- the floating dock
/** U1: the dock (composer, presence bar, jump pill) floats over the message list, so the list
 *  needs a bottom padding equal to the dock's height, whatever the composer grows to (a draft of
 *  five lines, a file preview, the reply bar). A ResizeObserver writes `--dock-h` on the dock's
 *  parent (.main); app.css reads it in .messages. One observer per dock element. */
export function watchDockHeight(dock) {
  if (!dock || dock.dataset.dockWatched || typeof ResizeObserver !== "function") return;
  dock.dataset.dockWatched = "1";
  const host = dock.parentElement;
  if (!host) return;
  const apply = () => {
    const h = Math.ceil(dock.getBoundingClientRect().height);
    host.style.setProperty("--dock-h", `${h}px`);
    // U36: the toast stack stands outside #app and sits above the dock, so it reads the same
    // height from the root element.
    document.documentElement?.style?.setProperty?.("--dock-h", `${h}px`);
    // U1 (r4): a taller dock means more bottom padding, so a list pinned to the bottom has to
    // follow - otherwise the last message slides under the composer.
    repinIfPinned();
  };
  new ResizeObserver(apply).observe(dock);
  apply();
}

// ------------------------------------------------------- reading position
export function isScrolledToBottom() {
  const el = document.getElementById("messages");
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

/** U1 (r4) "keep pinned": `pinned` remembers whether the list was at the bottom BEFORE a layout
 *  change (the thread panel opening or closing, the dock growing, a failed message gaining its
 *  "Send again" row). The list's scroll events update it (notePinned), every scrollToBottom sets
 *  it; repinIfPinned, called after such a change, scrolls to the bottom only when it is set - a
 *  user who scrolled up is never yanked. During a smooth scroll to the bottom the intermediate
 *  scroll events do not count: the intent was the bottom. */
let pinned = true;
let settleUntil = 0;

export function notePinned() {
  if (Date.now() < settleUntil) return;
  pinned = isScrolledToBottom();
}

export function repinIfPinned() {
  if (!pinned) return;
  const el = document.getElementById("messages");
  if (!el || el.scrollHeight - el.scrollTop - el.clientHeight <= 0) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
}

/** T-MG-29: the reading position of the list ON SCREEN, taken before the chat column is rebuilt
 *  (renderMain replaces #messages wholesale: the fresh element knows nothing of where the user
 *  was). `conv` names the conversation the list shows (data-conv), so the position is restored
 *  only for the same conversation; a skeleton or a missing list gives null. */
export function captureListPosition() {
  const el = document.getElementById("messages");
  if (!el || !el.dataset.conv) return null;
  return { conv: el.dataset.conv, atBottom: isScrolledToBottom(), scrollTop: el.scrollTop };
}

/** The list's own box changes when the side panel opens or closes (the column narrows and the
 *  content reflows taller) and when the viewport changes: one observer per list element re-pins.
 *  A fresh list starts pinned: a conversation opens at the bottom or at the unread line, and the
 *  scroll event of that first positioning sets the flag right. A list rebuilt for the SAME
 *  conversation (T-MG-29) passes the pin it had: a user who had scrolled up stays unpinned, so
 *  the observer's first call does not throw them to the bottom. */
export function watchListPin(list, atBottom = true) {
  pinned = atBottom;
  if (!list || list.dataset.pinWatched || typeof ResizeObserver !== "function") return;
  list.dataset.pinWatched = "1";
  new ResizeObserver(() => repinIfPinned()).observe(list);
}

export function scrollToBottom(smooth) {
  const el = document.getElementById("messages");
  if (!el) return;
  pinned = true;
  // The "reduced motion" preference has to be honoured here too: scrollTo is not
  // a CSS animation, so no @media rule would stop it.
  const behavior = scrollBehavior(smooth);
  if (behavior === "smooth") settleUntil = Date.now() + 600;
  el.scrollTo({ top: el.scrollHeight, behavior });
}

/** The "new below" pill: visible when you are not at the bottom; a click scrolls
 *  to the newest message. The counter grows from messages that arrived out of
 *  sight. */
export function updateJumpPill() {
  const pill = document.getElementById("jump-newest");
  if (!pill) return;
  const atBottom = isScrolledToBottom();
  if (atBottom) { state.newBelow = 0; pill.classList.remove("show"); return; }
  pill.classList.add("show");
  const label = pill.querySelector(".jn-label");
  if (label) {
    label.textContent = state.newBelow > 0
      ? t("{n} new messages", { n: state.newBelow })
      : t("Latest");
  }
  pill.classList.toggle("hascount", state.newBelow > 0);
}
