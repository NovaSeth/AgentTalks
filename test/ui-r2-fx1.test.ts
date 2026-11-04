/**
 * T-MG-3 fix round 2, agent FX1 (composer, layout and design-system surface): the UX review
 * findings U1, U2, U3, U12, U13, U17, U18 (claim icon) and the follow-ups W6-C2-A, W6-S14-B.
 *
 * Checked here (node, document stub + stylesheet reading):
 *  U2  the formatting bar is Octicons (bold, italic, strikethrough, code, code-square, link,
 *      list-unordered, quote) in 32 px targets, not text glyphs.
 *  U18 the "+" menu's "Claim a resource" row carries the tag Octicon, not the plus of its trigger.
 *  U1  the message list keeps a bottom padding equal to the measured dock height (--dock-h set by
 *      a ResizeObserver from dom.js), so the last message and its "Send again" row stay visible.
 *  U3  .empty centres its content as one block (align-content), not one row per child.
 *  U12 the disabled primary button has a visible disabled look in BOTH colour modes.
 *  U13 modals sit above every pane (z-index 100+) and the app behind them is inert.
 *  U17 at <=760 px the header shows three faces, and tables / code blocks scroll sideways with
 *      a fade edge.
 *  W6-C2-A Primer Counter/Label look for the rail badge, the kind tags, the picker chips and the
 *      soft sidebar counts.
 *  W6-S14-B on a phone the wiki editor's Save/Cancel stay reachable (textarea capped).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

type El = Record<string, any>;
function makeEl(): El {
  const listeners = new Map<string, Array<(e: any) => void>>();
  return {
    innerHTML: "", textContent: "", value: "", style: { setProperty() {} }, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    disabled: false, className: "", isConnected: true,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener(type: string, fn: (e: any) => void) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, setSelectionRange() {}, dispatchEvent() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
  };
}
function stubBrowser(): { els: Map<string, El>; body: El } {
  const els = new Map<string, El>();
  const byId = (id: string) => { if (!els.has(id)) els.set(id, makeEl()); return els.get(id)!; };
  const body = makeEl();
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body, head: makeEl(), title: "",
    // A created element answers querySelector with a child: openModal reads its .modal.
    getElementById: byId, createElement: () => ({ ...makeEl(), querySelector: () => makeEl() }), createTextNode: () => makeEl(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1440, innerHeight: 900, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem(k: string, v: string) { store.set(k, v); }, removeItem(k: string) { store.delete(k); } };
  g.HTMLImageElement = class {};
  g.Event = class { type: string; constructor(type: string) { this.type = type; } };
  g.EventSource = class { close() {} addEventListener() {} };
  g.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
  return { els, body };
}

const css = () => readFileSync(CSS, "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
/** The part of app.css before the slice markers: the base rules. */
const baseRules = () => stripComments(css().split("/* === S1 === */")[0]);
const block = (n: number) => stripComments(css().split(`/* === S${n} === */`)[1]?.split(`/* === S${n + 1} === */`)[0] ?? "");

// ------------------------------------------------------------------- U2
test("U2: the formatting bar is eight Octicons in 32 px targets, no text glyphs", async () => {
  stubBrowser();
  const icons = await import(UI + "icons.js");
  for (const name of ["iconBold", "iconItalic", "iconStrikethrough", "iconCode", "iconCodeSquare", "iconLink", "iconListUnordered", "iconQuote", "iconTag"]) {
    assert.equal(typeof icons[name], "function", `icons.js exports ${name}`);
  }
  const { composerCardHtml } = await import(UI + "composer.js");
  const html: string = composerCardHtml({ prefix: "composer", placeholder: "p", label: "l", files: true });
  const buttons = [...html.matchAll(/<button[^>]*data-fmt="([a-z]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 8);
  for (const [, id, inner] of buttons) {
    assert.match(inner, /<svg class="octicon/, `formatting button ${id} shows an Octicon`);
    assert.doesNotMatch(inner, /<b>|<i>|<s>|&lt;|&#8801;|\[&nbsp;\]/, `formatting button ${id} still shows a text glyph`);
  }
  const s4 = block(4);
  assert.match(s4, /\.fmtbar \.fmt\{[^}]*width:var\(--control-small-size\)/, "a 32 px (control-small) target");
  assert.match(s4, /\.fmtbar \.fmt svg\{[^}]*width:var\(--base-size-16\)/, "a 16 px icon inside");
});

// ------------------------------------------------------------------- U18
test("U18: the '+' menu's claim row uses the tag Octicon, not the plus of its trigger", async () => {
  stubBrowser();
  const src = readFileSync(UI + "commands.js", "utf8");
  const claimRow = src.match(/action: "claim", icon: (icon[A-Za-z]+)\(\)/);
  assert.ok(claimRow, "the claim row of openPlusMenu names its icon");
  assert.equal(claimRow![1], "iconTag");
  assert.doesNotMatch(src, /action: "claim", icon: iconPlus\(\)/);
});

// ------------------------------------------------------------------- U1
test("U1: the message list pads its bottom by the measured dock height (--dock-h)", async () => {
  stubBrowser();
  const dom = await import(UI + "dom.js");
  assert.equal(typeof dom.watchDockHeight, "function", "dom.js exports watchDockHeight");
  // A ResizeObserver stub that fires once with the dock's height; the host receives --dock-h.
  let cb: any = null;
  (globalThis as any).ResizeObserver = class { constructor(f: any) { cb = f; } observe() {} disconnect() {} };
  const set: Array<[string, string]> = [];
  const host = { ...makeEl(), style: { setProperty(k: string, v: string) { set.push([k, v]); } } };
  let height = 123;
  const dock = { ...makeEl(), parentElement: host, dataset: {}, getBoundingClientRect: () => ({ height }) };
  dom.watchDockHeight(dock);
  assert.ok(cb, "the dock is observed");
  assert.deepEqual(set, [["--dock-h", "123px"]], "the first measure happens at once");
  height = 200.4;   // the composer grew: a five-line draft
  cb!([{ target: dock, contentRect: { height } }]);
  assert.deepEqual(set.at(-1), ["--dock-h", "201px"], "the observer writes the new height, rounded up");
  // Watching twice does not stack observers.
  cb = null;
  dom.watchDockHeight(dock);
  assert.equal(cb, null, "a second call is a no-op");
  const base = baseRules();
  assert.match(base, /\.messages\{[^}]*padding:[^;}]*var\(--dock-h/, ".messages bottom padding follows --dock-h");
  // The main composer binds the watcher (both boxes share bindFormatting; the thread has no dock).
  const composer = readFileSync(UI + "composer.js", "utf8");
  assert.match(composer, /watchDockHeight\(/, "composer.js calls watchDockHeight");
});

// ------------------------------------------------------------------- U3
test("U3: .empty centres its children as one block", () => {
  const rule = baseRules().match(/\.empty\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /align-content:center/, ".empty needs align-content:center");
  assert.match(baseRules(), /\.empty p\{[^}]*max-width:36rem/, "the text keeps a readable measure");
});

// ------------------------------------------------------------------- U12
test("U12: a disabled primary button is visibly disabled in dark mode too", () => {
  const base = baseRules();
  // The primary-disabled token is a pale green in light but a near-rest green in dark (Primer's
  // #105823 next to #238636): the neutral disabled tokens read as "off" in both schemes.
  const rule = base.match(/\.btn\[disabled\]\{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /background:var\(--button-default-bgColor-disabled\)/, "Primer's neutral disabled background");
  assert.match(rule, /color:var\(--fgColor-disabled\)/, "Primer's disabled text token");
  assert.doesNotMatch(rule, /button-primary-bgColor-disabled/, "not the primary green in a disabled state");
  assert.match(rule, /cursor:not-allowed/, "a disabled control is not 'in progress'");
  assert.match(rule, /box-shadow:none/, "no resting shadow on a disabled button");
});

// ------------------------------------------------------------------- U13
test("U13: modals sit above every pane and the app behind them is inert", async () => {
  const base = baseRules();
  const z = Number(base.match(/\.overlay\{[^}]*z-index:(\d+)/)?.[1] ?? 0);
  assert.ok(z >= 100, `.overlay z-index ${z} must be 100 or more`);
  const toast = Number(base.match(/\.toast-stack\{[^}]*z-index:(\d+)/)?.[1] ?? 0);
  assert.ok(toast > z, "toasts stay above the modal");
  const { els } = stubBrowser();
  const app = els.get("app") ?? (els.set("app", makeEl()), els.get("app")!);
  const dom = await import(UI + "dom.js");
  const a = dom.openModal("<h2 id=\"m-title\">a</h2>");
  assert.equal(app.inert, true, "the app is inert while a modal is open");
  const b = dom.openModal("<h2 id=\"m-title\">b</h2>");
  a.close();
  assert.equal(app.inert, true, "still inert: a second modal is open");
  b.close();
  assert.equal(app.inert, false, "the last modal closing frees the app");
  a.close();
  assert.equal(app.inert, false, "closing twice does not go negative");
});

// ------------------------------------------------------------------- U17
test("U17: on phones the header shows three faces and wide content scrolls with a fade", () => {
  const s9 = block(9);
  assert.match(s9, /\.hdr-faces \.av:nth-child\(n\+4\)\{display:none\}/, "faces 4+ hidden at <=760 px");
  assert.match(s9, /\.mdtable\{[^}]*overflow-x:auto/, "tables scroll sideways");
  assert.match(s9, /\.mdpre pre\{[^}]*overflow-x:auto/, "code blocks scroll sideways");
  assert.match(s9, /background-attachment:[^;}]*local/, "a scroll-edge fade (local background layers)");
});

// ------------------------------------------------------------------- W6-C2-A
test("W6-C2-A: Counter and Label tokens on the rail badge, kind tags, chips and soft counts", () => {
  const base = baseRules();
  const rule = (sel: string) => base.match(new RegExp(sel.replace(/[.\\[\]()*+?{}|^$]/g, "\\$&") + "\\{[^}]*\\}"))?.[0] ?? "";
  assert.match(rule(".rail-badge"), /--bgColor-accent-emphasis|--counter-|--bgColor-danger-emphasis/, "the rail badge is a Counter");
  assert.match(base, /\.kindtag\{[^}]*--borderColor-default/, "kind tags are Primer Labels (default border)");
  assert.match(base, /\.kindtag\.human\{[^}]*--fgColor-accent/, "the human tag is an accent Label");
  assert.match(base, /\.pp-chips \.pp-chip\{[^}]*--bgColor-neutral-muted/, "picker chips use the neutral-muted token");
  assert.match(base, /\.badge\.soft\{[^}]*--bgColor-neutral-muted/, "soft counts are secondary Counters");
});

// ------------------------------------------------------------------- W6-S14-B
test("W6-S14-B: on a phone the wiki editor caps its textarea so Save/Cancel stay on screen", () => {
  const s9 = block(9);
  assert.match(s9, /\.we-body\{[^}]*max-height:/, "the textarea is capped at <=760 px");
  assert.match(s9, /\.we-body\{[^}]*min-height:/, "and keeps a small minimum");
  assert.match(s9, /\.wiki-editor\{[^}]*height:auto/, "the editor no longer claims the full height");
});
