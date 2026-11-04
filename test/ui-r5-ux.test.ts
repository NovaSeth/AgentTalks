/**
 * T-MG-3 fix round 5 (D-MG-27), UX review round 3 (review-r6.json), agent R5-UX:
 *  U40  a failed send whose "not sent" row is on screen raises no toast (the row carries the
 *       error and the retry buttons); the toast stack sits top-centre under the header, never
 *       over the dock, the last message row or the header's buttons;
 *  U41  the wiki page header's title and sub-line shrink with an ellipsis like the channel title;
 *  U42  the search query box keeps to the result column, so no gutter opens under it at 1440;
 *  U43  the main composer card is as wide as the message column; the thread box is unchanged.
 * Markup and source assertions under node (the S14 pattern): the production modules run unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The minimal browser from test/ui-s14-wiki.test.ts; `#main` is kept so its markup can be read. */
function stubBrowser(): Record<string, Any> {
  const el = (): Record<string, Any> => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector: () => el(), querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {},
  });
  const main = el();
  const g = globalThis as Record<string, Any>;
  g.document = {
    documentElement: { style: { setProperty() {} }, setAttribute() {}, getAttribute: () => "", classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
    body: el(), head: el(), title: "",
    getElementById: (id: string) => (id === "main" ? main : el()), createElement: () => el(), createTextNode: () => el(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 390, innerHeight: 844, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local", hash: "" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.HTMLImageElement = class {};
  g.EventSource = class { close() {} addEventListener() {} };
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
  return main;
}

/** The CSS of one `/* === Sn === *\/` block (up to the next block marker or the end). */
function cssBlock(css: string, marker: string): string {
  const start = css.indexOf(`/* === ${marker} === */`);
  assert.ok(start >= 0, `block ${marker} present`);
  const rest = css.slice(start + 8);
  const next = rest.search(/\/\* === /);
  return next >= 0 ? rest.slice(0, next) : rest;
}

/** Every declaration block of one selector, in source order. */
function rulesFor(css: string, selector: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(^|[}\\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  for (const m of css.matchAll(re)) out.push(m[2]);
  return out;
}

// ---------------------------------------------------------------- U40
test("U40: a failed send with its 'not sent' row on screen raises no toast; the toast stack sits under the header", () => {
  const src = readFileSync(UI + "actions.js", "utf8");
  const start = src.indexOf("rec.pending = false; rec.failed = true;");
  assert.ok(start > 0, "the failed-send branch is where the row is marked failed");
  const branch = src.slice(start, src.indexOf("return null;", start));
  // The row is drawn when the conversation is active and the message is in the main list: then the
  // row carries the error (its .failwhy) and the retry buttons, and a toast would only cover them.
  assert.match(branch, /const rowShown = state\.activeId === convId && inMainList;/);
  assert.match(branch, /if \(!rowShown && !connectionLost\) showError\(e\);/);
  assert.doesNotMatch(branch, /if \(!connectionLost\) showError\(e\);/);

  const css = readFileSync(CSS, "utf8");
  const rules = rulesFor(css, ".toast-stack");
  assert.ok(rules.length >= 2, "the base rule and the placement rule");
  const placed = rules[rules.length - 1];
  assert.match(placed, /top:calc\(var\(--base-size-64\) \+ var\(--base-size-8\)\)/, "16 px under the 56 px header");
  assert.match(placed, /bottom:auto/);
  assert.doesNotMatch(placed, /--dock-h/, "no longer tied to the dock");
  assert.match(placed, /left:50%/, "centred");
  // The phone override that lifted the stack above the tab bar is gone with the stack at the top.
  const block = cssBlock(css, "R4 (UX review round 2: U31-U36)");
  assert.doesNotMatch(block, /\.toast-stack\{bottom:calc\(var\(--dock-h/);
  // The enter/leave motion comes from above now.
  assert.match(css, /@keyframes toast-up\{from\{opacity:0;transform:translateY\(-12px\)/);
  assert.match(css, /@keyframes toast-down\{to\{opacity:0;transform:translateY\(-12px\)/);
});

// ---------------------------------------------------------------- U41
test("U41: the wiki page header title and sub-line shrink with an ellipsis", async () => {
  const main = stubBrowser();
  const store = await import(UI + "state.js");
  const view = await import(UI + "view-wiki.js");
  const { state, views } = store;
  views.typing = () => "";
  state.actor = { id: "a1", handle: "michal", isAdmin: false };
  state.wiki.pages = [
    { slug: "runbook", title: "Runbook", parentSlug: null },
    { slug: "deploy-checklist", title: "Deploy checklist", parentSlug: "runbook" },
  ];
  state.wiki.slug = "deploy-checklist";
  state.wiki.page = { slug: "deploy-checklist", title: "Deploy checklist", parentSlug: "runbook", body: "# x",
    revisions: 1, updatedBy: "nestor", updatedAt: Math.floor(Date.now() / 1000) - 300, createdBy: "nestor" };
  state.wiki.editing = false; state.wiki.revision = null; state.wiki.draft = null;
  view.renderWikiMain(false);
  const html = main.innerHTML as string;
  assert.ok(html.includes('class="topbar"'), "the wiki header rendered");
  // The title text is its own element (a flex container cannot ellipsize a bare text node).
  assert.match(html, /<span class="crumbs">[\s\S]*?<\/span><span class="wt">Deploy checklist<\/span>/);
  assert.match(html, /<div class="topic">[^<]*1[^<]*@nestor/, "the sub-line (whatever the language) stays a single .topic element");

  const css = readFileSync(CSS, "utf8");
  const block = cssBlock(css, "S14");
  const wt = rulesFor(block, ".topbar .title .t .wt");
  assert.equal(wt.length, 1, "one rule for the wiki title text");
  assert.match(wt[0], /min-width:0/);
  assert.match(wt[0], /overflow:hidden/);
  assert.match(wt[0], /text-overflow:ellipsis/);
  assert.match(wt[0], /white-space:nowrap/);
  const crumbs = rulesFor(block, ".topbar .title .t .crumbs");
  assert.equal(crumbs.length, 1, "the breadcrumb shrinks too");
  assert.match(crumbs[0], /flex:0 99 auto;min-width:5ch/, "the breadcrumb gives way first, down to a 5ch floor, so the title keeps its letters");
  assert.match(crumbs[0], /text-overflow:ellipsis/);
  const topic = rulesFor(block, ".topbar .title .topic");
  assert.equal(topic.length, 1, "the sub-line gets min-width:0 next to its ellipsis");
  assert.match(topic[0], /min-width:0/);
});

// ---------------------------------------------------------------- U42
test("U42: the search query box keeps to the result column", () => {
  const css = readFileSync(CSS, "utf8");
  const block = cssBlock(css, "S11");
  const view = rulesFor(block, ".search-view");
  assert.ok(view.some((r) => /--search-col:44rem/.test(r)), "one column width, named once");
  const results = rulesFor(block, ".search-results");
  assert.ok(results.some((r) => /max-width:var\(--search-col\)/.test(r)), "the list uses it");
  const bar = rulesFor(block, ".search-bar");
  const gutter = "max(var(--base-size-16),calc((100% - var(--search-col)) / 2))";
  assert.ok(bar.some((r) => r.includes(`padding-left:${gutter}`) && r.includes(`padding-right:${gutter}`)),
    "the bar's side padding grows with the column so its box is the column's width");
  assert.doesNotMatch(block, /\.search-results\{[^}]*44rem/, "no second copy of the width");
});

// ---------------------------------------------------------------- U43
test("U43: the main composer card is as wide as the message column; the thread box is unchanged", () => {
  const css = readFileSync(CSS, "utf8");
  const base = rulesFor(css, ".composer");
  assert.ok(base.some((r) => /max-width:44rem/.test(r)), "the base rule (the thread box's width cap) is unchanged");
  const block = cssBlock(css, "S4");
  const dock = rulesFor(block, ".dock > .composer");
  assert.equal(dock.length, 1, "one override for the dock's composer");
  assert.match(dock[0], /max-width:none/);
  // The card keeps the message rows' side gutter (20 px, 12 px on a phone) so its edges line up
  // with the text above it.
  assert.match(dock[0], /padding-left:var\(--base-size-20\);padding-right:var\(--base-size-20\)/);
  assert.match(block, /@media \(max-width:760px\)\{[^}]*\.dock > \.composer\{padding-left:var\(--base-size-12\);padding-right:var\(--base-size-12\)\}/);
  assert.doesNotMatch(block, /#th-composer|\.thread \.composer/, "nothing for the thread box");
});
