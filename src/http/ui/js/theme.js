/**
 * Color mode: Auto (follows the operating system), Light or Dark.
 *
 * The page carries Primer's three attributes on <html>: data-color-mode selects the mode,
 * data-light-theme and data-dark-theme name the palettes used in each half of "auto". The
 * vendored primitives (vendor/primer/primitives/light.css, dark.css) key every color token on
 * these attributes, so switching the mode is the one attribute write below - no class juggling.
 *
 * This module is a leaf (no imports from the views) and guards every browser global: the
 * tests load it under Node, where there is neither localStorage nor a document.
 */

export const THEMES = ["auto", "light", "dark"];
const STORAGE_KEY = "atalks_theme";

/** The persisted mode, or "auto" when nothing was chosen (or storage is unavailable). */
export function currentTheme() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved && THEMES.includes(saved)) return saved;
  } catch { /* private mode: fall through */ }
  return "auto";
}

/** Writes the Primer attributes for `mode` onto `root` (the <html> element by default). An
 *  unknown mode is treated as "auto" rather than thrown: a stale value in storage must never
 *  leave the page without a palette. */
export function applyTheme(mode = currentTheme(), root = globalThis.document?.documentElement) {
  const m = THEMES.includes(mode) ? mode : "auto";
  if (!root || typeof root.setAttribute !== "function") return m;
  root.setAttribute("data-color-mode", m);
  root.setAttribute("data-light-theme", "light");
  root.setAttribute("data-dark-theme", "dark");
  return m;
}

/** Persists and applies a mode. Returns the mode that took effect. */
export function setTheme(mode) {
  const m = applyTheme(mode);
  try { globalThis.localStorage?.setItem(STORAGE_KEY, m); } catch { /* not fatal */ }
  return m;
}

// Applied at import so that the first paint already uses the saved mode; the shell markup
// carries the same attributes as a default for the moment before this module runs.
applyTheme();
