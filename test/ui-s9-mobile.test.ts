/**
 * S9 (T-MG-3 wave 5): the phone is not a scaled-down desktop. Below 760 px the icon rail becomes a
 * bottom tab bar (Home / DMs / Activity / Search), the conversation is a pushed screen with a back
 * arrow in its topbar that returns to the list, the thread takes the full width, and the shell
 * follows `visualViewport` so the composer stays above the software keyboard.
 *
 * Checked here (node, markup and stylesheet reading): the tab bar markup and its Search tab, the
 * back button in the chat topbar, the S9 stylesheet block (bottom placement, 44 px hit targets,
 * safe area, keyboard-safe height, full-width thread) and the follow-up W2-S1-B (rail column 4rem,
 * caption no longer scaled down). The geometry itself is the live checklist at 390x844 (U6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

/** The S9 block of app.css: from its marker to the next slice marker. */
function s9Block(): string {
  const css = readFileSync(CSS, "utf8");
  const start = css.indexOf("/* === S9 === */");
  assert.ok(start >= 0, "app.css has the S9 marker");
  const end = css.indexOf("/* === S10 === */", start);
  return css.slice(start, end < 0 ? undefined : end);
}

test("S9: the rail carries a Search tab for the phone and it opens the switcher", () => {
  const app = readFileSync(UI + "app.js", "utf8");
  assert.ok(app.includes('"rail-search"'), "app.js rail has #rail-search");
  assert.match(app, /rail-search[\s\S]{0,400}openSearchPalette\(\)/, "the Search tab opens the quick switcher");
  assert.ok(app.includes('t("Search")'), "the tab is named Search through t()");
});

test("S9: the shell follows the visual viewport so the composer stays above the keyboard", () => {
  const app = readFileSync(UI + "app.js", "utf8");
  assert.ok(app.includes("visualViewport"), "app.js listens to visualViewport");
  assert.ok(app.includes("--vvh"), "app.js publishes the visible height as --vvh");
  assert.ok(app.includes("kb-open"), "app.js flags the shell while the keyboard is up");
  const s9 = s9Block();
  assert.match(s9, /\.shell\{[^}]*height:var\(--vvh/, "the S9 block sizes the shell from --vvh");
  assert.match(s9, /\.shell\.kb-open[^{]*\.rail\{[^}]*display:none/, "the tab bar yields to the keyboard");
});

test("S9: the chat topbar has a back arrow that returns to the list", () => {
  const chat = readFileSync(UI + "view-chat.js", "utf8");
  assert.ok(chat.includes('id="btn-back"'), "the topbar has #btn-back");
  assert.ok(chat.includes('t("Back to the list")'), "the back button is named through t()");
  assert.match(chat, /btn-back[\s\S]{0,300}state\.drawerOpen = true;\s*toggleDrawerClass\(\)/, "back opens the list screen");
  const pl = readFileSync(UI + "i18n-pl.js", "utf8");
  assert.ok(pl.includes('"Back to the list":'), "i18n-pl.js translates the back button");
});

test("S9: below 760 px the rail is a bottom tab bar with 44 px targets, labels and a safe area", () => {
  const s9 = s9Block();
  assert.ok(s9.includes("@media (max-width:760px)"), "the S9 block has a phone query");
  assert.match(s9, /\.shell[^{]*\{[^}]*grid-template-rows:minmax\(0,1fr\) auto/, "the shell stacks content over the tab bar");
  assert.match(s9, /\.rail\{[^}]*grid-row:2/, "the rail takes the bottom row");
  assert.match(s9, /\.rail\{[^}]*flex-direction:row/, "the tabs run horizontally");
  assert.match(s9, /\.rail\{[^}]*env\(safe-area-inset-bottom\)/, "the bar clears the home indicator");
  assert.match(s9, /\.rail-btn\{[^}]*min-height:var\(--base-size-44\)/, "tabs are at least 44 px tall");
  assert.match(s9, /\.rail \.rail-btn \.rail-l\{[^}]*display:block/, "tab labels are visible on the phone");
  assert.match(s9, /\.topbar \.hamburger\{[^}]*display:none/, "the hamburger gives way to the back arrow");
  assert.match(s9, /\.topbar-back\{[^}]*display:grid/, "the back arrow shows on the phone");
  assert.match(s9, /\.sidebar\{[^}]*left:0/, "the list screen starts at the left edge: no rail column");
  assert.match(s9, /\.thread\{[^}]*width:100vw/, "the thread takes the full width");
});

test("S9: the back arrow is hidden on the desktop", () => {
  const css = readFileSync(CSS, "utf8");
  const before = css.slice(0, css.indexOf("@media (max-width:760px)", css.indexOf("/* === S9 === */")));
  assert.match(before.slice(before.indexOf("/* === S9 === */")), /\.topbar-back\{display:none\}/, "desktop keeps the topbar as it was");
});

test("W2-S1-B: the rail column is 4rem and the caption is no longer scaled down", () => {
  const css = readFileSync(CSS, "utf8");
  assert.ok(css.includes(".shell.with-rail{grid-template-columns:4rem var(--sbw) 1fr}"), "three-column shell rail is 4rem");
  assert.ok(css.includes(".shell.with-rail.without-sidebar{grid-template-columns:4rem 1fr}"), "two-column shell rail is 4rem");
  assert.match(s9Block(), /\.rail-btn \.rail-l\{[^}]*font-size:var\(--text-caption-size\);/, "the S9 block restores the full caption size");
});
