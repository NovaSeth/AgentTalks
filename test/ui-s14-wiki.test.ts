/**
 * S14 (T-MG-3 wave 6): wiki polish.
 *
 *  1. The editor's Save/Cancel pair never splits (M16): the two buttons sit in one `.we-actions`
 *     group that does not wrap and keeps to the right; the note field is the part that shrinks.
 *  2. The wiki tree in the sidebar is navigable with the keyboard like a Primer TreeView:
 *     Up/Down walk the visible rows, Home/End jump, Left collapses a branch or climbs to the
 *     parent, Right expands a branch or steps into its first child. `view-wiki.js` exports the
 *     pure decision `wikiTreeKeyAction(key, row)` and binds one delegated keydown listener on the
 *     document (the tree markup belongs to view-sidebar.js and is re-rendered often, so a
 *     per-row listener would be lost).
 *  3. The S14 CSS block uses Primer tokens, not literal rem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

/** The minimal browser from test/ui-s10-threads.test.ts. */
function stubBrowser(): void {
  const el = (): Record<string, unknown> => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {},
  });
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: () => el(), createElement: () => el(), createTextNode: () => el(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1728, innerHeight: 900, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local", hash: "" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.HTMLImageElement = class {};
  g.EventSource = class { close() {} addEventListener() {} };
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
}

function s14Block(): string {
  const css = readFileSync(CSS, "utf8");
  const start = css.indexOf("/* === S14 === */");
  assert.ok(start >= 0, "app.css has the S14 marker");
  const rest = css.slice(start + "/* === S14 === */".length);
  const next = rest.search(/\/\* === [A-Z]\d+ === \*\//);
  return next >= 0 ? rest.slice(0, next) : rest;
}

test("M16: Save and Cancel sit in one .we-actions group that never wraps", () => {
  const src = readFileSync(UI + "view-wiki.js", "utf8");
  const foot = src.slice(src.indexOf('class="we-foot"'), src.indexOf("</div>", src.indexOf('id="we-save"')));
  assert.ok(foot.length > 0, "the editor footer is rendered");
  const actions = foot.indexOf('class="we-actions"');
  assert.ok(actions >= 0, "the footer has a .we-actions group");
  assert.ok(foot.indexOf('id="we-cancel"') > actions && foot.indexOf('id="we-save"') > actions,
    "Cancel and Save are inside .we-actions");
  const block = s14Block();
  const rule = block.match(/\.we-actions\{([^}]*)\}/);
  assert.ok(rule, "the S14 block styles .we-actions");
  assert.match(rule![1], /flex-wrap:nowrap|white-space:nowrap/, "the pair does not wrap");
  assert.match(rule![1], /flex:0 0 auto/, "the pair does not shrink");
  assert.match(rule![1], /margin-left:auto/, "the pair keeps to the right");
  const note = block.match(/\.we-note\{([^}]*)\}/);
  assert.ok(note && /min-width:0/.test(note[1]), "the note field is the part that shrinks");
});

test("the S14 CSS block uses Primer tokens, not literal rem", () => {
  const block = s14Block();
  assert.ok(block.trim().length > 0, "the S14 block is not empty");
  assert.doesNotMatch(block, /[\d.]+rem\b/, "no literal rem in the S14 block");
});

test("wikiTreeKeyAction: Up/Down/Home/End walk the rows", async () => {
  stubBrowser();
  const { wikiTreeKeyAction } = await import(UI + "view-wiki.js");
  const leaf = { hasKids: false, expanded: false, hasParent: true };
  assert.equal(wikiTreeKeyAction("ArrowDown", leaf), "next");
  assert.equal(wikiTreeKeyAction("ArrowUp", leaf), "prev");
  assert.equal(wikiTreeKeyAction("Home", leaf), "first");
  assert.equal(wikiTreeKeyAction("End", leaf), "last");
  assert.equal(wikiTreeKeyAction("a", leaf), null, "letters are left to the browser");
  assert.equal(wikiTreeKeyAction("Enter", leaf), null, "Enter stays native on the button");
});

test("wikiTreeKeyAction: Left collapses or climbs, Right expands or steps in", async () => {
  stubBrowser();
  const { wikiTreeKeyAction } = await import(UI + "view-wiki.js");
  assert.equal(wikiTreeKeyAction("ArrowLeft", { hasKids: true, expanded: true, hasParent: true }), "collapse");
  assert.equal(wikiTreeKeyAction("ArrowLeft", { hasKids: true, expanded: false, hasParent: true }), "parent");
  assert.equal(wikiTreeKeyAction("ArrowLeft", { hasKids: false, expanded: false, hasParent: true }), "parent");
  assert.equal(wikiTreeKeyAction("ArrowLeft", { hasKids: false, expanded: false, hasParent: false }), null, "a root leaf has nowhere to go");
  assert.equal(wikiTreeKeyAction("ArrowRight", { hasKids: true, expanded: false, hasParent: false }), "expand");
  assert.equal(wikiTreeKeyAction("ArrowRight", { hasKids: true, expanded: true, hasParent: false }), "firstChild");
  assert.equal(wikiTreeKeyAction("ArrowRight", { hasKids: false, expanded: false, hasParent: true }), null, "a leaf has nothing to open");
});

test("the tree listener is delegated on the document and targets the sidebar rows", () => {
  const src = readFileSync(UI + "view-wiki.js", "utf8");
  assert.match(src, /document\.addEventListener\("keydown",\s*onWikiTreeKeydown/, "one delegated keydown listener");
  assert.match(src, /\[data-wikipage\]/, "it walks the page rows");
  assert.match(src, /\[data-wikitwist\]/, "it toggles the branch through the twist button");
});
