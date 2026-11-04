/**
 * Keyboard shortcuts (S8).
 *
 * One table instead of key checks scattered over the views: the help sheet (Mod+/) and the key
 * handler in app.js read the same list, so they cannot drift apart. "Mod" is the command key on
 * a mac and Ctrl elsewhere; the matcher and the printed label both resolve it per platform.
 */
import { t } from "./i18n.js";

/** name -> combination. Modifiers in the order Mod, Alt, Shift; the key as `KeyboardEvent.key`
 *  reports it (letters are matched case-insensitively, so Shift does not change them). */
export const SHORTCUTS = {
  search: "Mod+K",
  help: "Mod+/",
  prevConversation: "Alt+ArrowUp",
  nextConversation: "Alt+ArrowDown",
  prevUnread: "Alt+Shift+ArrowUp",
  nextUnread: "Alt+Shift+ArrowDown",
  allUnreads: "Mod+Shift+A",
  sidePanel: "Mod+.",
  findInConversation: "Mod+F",
  dms: "Mod+Shift+K",
  back: "Mod+[",
  forward: "Mod+]",
};

/** The sheet, in reading order. Two lines have no entry in SHORTCUTS because other code owns the
 *  key (Escape closes layers in app.js, ArrowUp in an empty box edits the last message in the
 *  composer): they are listed so the sheet is the whole truth, with `keys` spelled by hand. */
export const SHORTCUT_HELP = [
  { name: "search", label: () => t("Open the quick switcher") },
  { name: "allUnreads", label: () => t("All unreads: everything unread, grouped by conversation") },
  { name: "dms", label: () => t("Go to direct messages") },
  { name: "prevConversation", label: () => t("Previous conversation") },
  { name: "nextConversation", label: () => t("Next conversation") },
  { name: "prevUnread", label: () => t("Previous unread conversation") },
  { name: "nextUnread", label: () => t("Next unread conversation") },
  { name: "sidePanel", label: () => t("Close the side panel, or reopen the last one") },
  { name: "findInConversation", label: () => t("Find in this conversation") },
  { name: "back", label: () => t("Back to the previous place") },
  { name: "forward", label: () => t("Forward again") },
  { name: "escape", keys: "Escape", label: () => t("Close the thread, details or drawer") },
  { name: "editLast", keys: "ArrowUp", label: () => t("Edit your last message (in an empty box)") },
  { name: "help", label: () => t("This sheet") },
];

export function detectPlatform() {
  const nav = typeof navigator === "undefined" ? null : navigator;
  const hint = nav ? `${nav.platform || ""} ${nav.userAgent || ""}` : "";
  return /Mac|iPhone|iPad/i.test(hint) ? "mac" : "win";
}

function parseCombo(combo) {
  const parts = String(combo).split("+");
  const key = parts.pop();
  return { key, mod: parts.includes("Mod"), alt: parts.includes("Alt"), shift: parts.includes("Shift") };
}

/** The shortcut a key event triggers, or null. On a mac both the command key and Ctrl count as
 *  Mod (Ctrl+K worked here before S8 and people have it in their fingers); on windows only Ctrl
 *  does, the Windows key belongs to the system. */
export function matchShortcut(e, platform = detectPlatform()) {
  if (!e || typeof e.key !== "string") return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mod = platform === "mac" ? !!(e.metaKey || e.ctrlKey) : !!e.ctrlKey && !e.metaKey;
  for (const [name, combo] of Object.entries(SHORTCUTS)) {
    const c = parseCombo(combo);
    const want = c.key.length === 1 ? c.key.toLowerCase() : c.key;
    if (key !== want) continue;
    if (c.mod !== mod || c.alt !== !!e.altKey || c.shift !== !!e.shiftKey) continue;
    if (!c.mod && (e.metaKey || e.ctrlKey)) continue;
    return name;
  }
  return null;
}

const MAC_GLYPH = { Mod: "⌘", Alt: "⌥", Shift: "⇧" };
const KEY_GLYPH = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc" };

/** "Mod+Shift+A" -> "⌘ ⇧ A" on a mac, "Ctrl+Shift+A" on windows. */
export function shortcutLabel(combo, platform = detectPlatform()) {
  const parts = String(combo).split("+");
  const key = parts.pop();
  const shown = KEY_GLYPH[key] || key.toUpperCase();
  if (platform === "mac") return [...parts.map((p) => MAC_GLYPH[p] || p), shown].join(" ");
  return [...parts.map((p) => (p === "Mod" ? "Ctrl" : p)), shown].join("+");
}

/** The id after (dir 1) or before (dir -1) `activeId` in `ids`, wrapping around; the first id
 *  when nothing is active; null for an empty list. */
export function stepConversation(ids, activeId, dir) {
  if (!ids || !ids.length) return null;
  const i = ids.indexOf(activeId);
  if (i < 0) return dir < 0 ? ids[ids.length - 1] : ids[0];
  return ids[(i + dir + ids.length) % ids.length];
}

/** Like stepConversation, but only conversations with unread > 0 count; null when none has. */
export function stepUnread(ids, activeId, unread, dir) {
  if (!ids || !ids.length) return null;
  const start = ids.indexOf(activeId);
  for (let k = 1; k <= ids.length; k++) {
    const id = ids[(start + dir * k + ids.length * k) % ids.length];
    if ((unread?.[id] || 0) > 0) return id;
  }
  return null;
}

/** The Mod+/ sheet: every shortcut with its keys for THIS platform. dom.js is imported here, not
 *  at the top: it touches `document` when loaded, and the table above is meant to be importable
 *  anywhere (tests, a future server-side list of shortcuts). */
export async function openShortcutHelp(platform = detectPlatform()) {
  const { openModal } = await import("./dom.js");
  const rows = SHORTCUT_HELP.map((h) => {
    const combo = h.keys || SHORTCUTS[h.name];
    return `<tr><td class="shortcut-keys"><kbd>${shortcutLabel(combo, platform)}</kbd></td><td>${h.label()}</td></tr>`;
  }).join("");
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("Keyboard shortcuts")}</h2>
      <table class="shortcut-sheet"><tbody>${rows}</tbody></table>
      <p class="hint">${t("Shortcuts that need a conversation (previous, next, side panel) do nothing elsewhere.")}</p>
      <div class="row"><button class="btn" id="shortcuts-ok">${t("Got it, thanks")}</button></div>`,
  { modalClass: "shortcuts-modal" });
  modal.querySelector("#shortcuts-ok")?.addEventListener("click", close);
  return { modal, close };
}
