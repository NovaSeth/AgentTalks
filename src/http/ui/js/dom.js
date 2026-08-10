/**
 * DOM helpers: HTML escaping, avatars, time formats, modal window, drawer.
 */
import { iconMenu } from "./ikony.js";
import { locale, t } from "./i18n.js";
import { avatarUrl, state } from "./stan.js";

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

export const zachowanieScrolla = (smooth) => (smooth && !REDUCED_MOTION.matches ? "smooth" : "auto");

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
  const conversations = Object.values(state.unread).reduce((n, v) => n + (v || 0), 0);
  const wiki = (state.notifications || []).filter((n) => !n.readAt && n.wikiSlug).length;
  const total = conversations + wiki;
  document.title = total > 0 ? `(${total > 99 ? "99+" : total}) AgentTalks` : "AgentTalks";
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
  const cls = size && size <= 28 ? "av sm" : "av";
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

// -------------------------------------------------------------------- modals
// ONE modal implementation for the whole UI. Reason: a window without a focus
// trap looks like a modal but is not one - Tab walks out onto the page
// underneath, Escape does nothing, and after closing, focus lands on <body>,
// so a keyboard user restarts navigation from the top of the document.
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** @param html modal content; the heading should carry id="m-title" (aria-labelledby).
 *  @param opts.trwaly a window that CANNOT be dismissed with Escape or a backdrop
 *         click. Reserved for content shown once and unrecoverable (an invite
 *         code): a reflexive Escape cost the whole operation there. */
export function openModal(html, opts = {}) {
  const returnTo = document.activeElement;
  const ov = document.createElement("div");
  ov.className = `overlay ${opts.overlayClass ?? ""}`.trim();
  ov.innerHTML = `<div class="modal ${opts.modalClass ?? ""}" role="dialog" aria-modal="true"
    aria-labelledby="m-title" ${opts.style ? `style="${opts.style}"` : ""}>${html}</div>`;
  document.body.appendChild(ov);

  const onKey = (e) => {
    if (e.key === "Escape" && !ov.dataset.trwaly) { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...ov.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  function close() {
    document.removeEventListener("keydown", onKey, true);
    ov.remove();
    // Focus returns where it came from - otherwise, after the window closes, a
    // screen reader starts from the top of the page instead of from the button
    // that opened it.
    if (returnTo && document.contains(returnTo)) returnTo.focus();
  }
  document.addEventListener("keydown", onKey, true);
  ov.addEventListener("click", (e) => { if (e.target === ov && !ov.dataset.trwaly) close(); });
  const modal = ov.querySelector(".modal");
  if (opts.trwaly) ov.dataset.trwaly = "1";
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
    zablokujZamykanie: () => { ov.dataset.trwaly = "1"; },
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
      </div>`);
    let answered = false;
    const finish = (v) => { if (answered) return; answered = true; resolve(v); };
    // Escape and a backdrop click mean "no" - without that the promise would
    // never settle and the caller would wait forever.
    modal.closest(".overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) finish(false); });
    document.addEventListener("keydown", function esc(e) {
      if (e.key !== "Escape") return;
      document.removeEventListener("keydown", esc, true);
      finish(false);
    }, true);
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
export function emptyStateHtml(iconHtml, title, sub, akcja) {
  return `<div class="empty"><div class="big">${iconHtml}</div><h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(sub)}</p>
    ${akcja ? `<button class="btn slim" id="${akcja.id}">${escapeHtml(akcja.label)}</button>` : ""}</div>`;
}

/** An empty sidebar section: one sentence and, when there is something to do, a button. */
export function sidebarEmptyHtml(text, akcja) {
  return `<div class="sb-empty">${escapeHtml(text)}
    ${akcja ? `<button class="sb-cta" id="${akcja.id}">${escapeHtml(akcja.label)}</button>` : ""}</div>`;
}

export function skeletonHtml() {
  return Array.from({ length: 5 }).map(() => `
    <div class="skeleton"><div class="sk-line w40"></div><div class="sk-line w80"></div></div>`).join("");
}

// ------------------------------------------------------- reading position
export function isScrolledToBottom() {
  const el = document.getElementById("messages");
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

export function scrollToBottom(smooth) {
  const el = document.getElementById("messages");
  if (!el) return;
  // The "reduced motion" preference has to be honoured here too: scrollTo is not
  // a CSS animation, so no @media rule would stop it.
  el.scrollTo({ top: el.scrollHeight, behavior: zachowanieScrolla(smooth) });
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
