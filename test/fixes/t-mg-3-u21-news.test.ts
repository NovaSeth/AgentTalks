/**
 * T-MG-3 fix U21: a human sees only the news meant for humans.
 * NEWS.md marks agent-only sections with a "(for agents)" heading suffix; the "What's new" modal
 * renders the rest, and when nothing is left it does not open but still acknowledges the news.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../../src/http/ui/js/", import.meta.url));

type El = Record<string, any>;
type Call = { method: string; path: string };

function stubBrowser() {
  const el = (): El => ({
    innerHTML: "", textContent: "", value: "", className: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    disabled: false, checked: false, selectionStart: 0, selectionEnd: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {}, setSelectionRange() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    dispatchEvent() {},
  });
  const els = new Map<string, El>();
  const created: El[] = [];
  const byId = (id: string) => { if (!els.has(id)) els.set(id, el()); return els.get(id)!; };
  const g = globalThis as Record<string, any>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: byId, createElement: () => {
      const e = el(); const kids = new Map<string, El>();
      e.querySelector = (sel: string) => { if (!kids.has(sel)) kids.set(sel, el()); return kids.get(sel); };
      created.push(e); return e;
    }, createTextNode: () => el(),
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
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.history = { pushState() {}, replaceState() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem(k: string, v: string) { store.set(k, v); }, removeItem(k: string) { store.delete(k); } };
  g.HTMLImageElement = class {};
  g.Event = class { type: string; constructor(type: string) { this.type = type; } };
  g.EventSource = class { close() {} addEventListener() {} };
  g.requestAnimationFrame = (fn: () => void) => { fn(); return 1; };
  const calls: Call[] = [];
  let router: (c: Call) => any = () => ({});
  g.fetch = async (path: string, init: any) => {
    const call = { method: init?.method ?? "GET", path };
    calls.push(call);
    const out = await router(call);
    return { ok: true, status: 200, json: async () => out, text: async () => "" };
  };
  return { els, created, calls, route: (fn: (c: Call) => any) => { router = fn; } };
}


const SAMPLE = [
  "# What's new", "", "Intro line.", "",
  "## Humans first", "", "- A new thing", "",
  "### Human sub", "", "More for people.", "",
  "## Error codes (for agents)", "", "Agent text.", "",
  "### Codes", "", "| Old | New |", "|---|---|", "| `a` | `b` |", "",
  "## 2026-08-10", "", "Older human news.", "",
].join("\n");

test("humanNews drops an agents section with its subsections and tables", async () => {
  stubBrowser();
  const { humanNews } = await import(UI + "view-notifications.js");
  const out = humanNews(SAMPLE);
  assert.ok(out.includes("Intro line."));
  assert.ok(out.includes("## Humans first") && out.includes("### Human sub"));
  assert.ok(out.includes("## 2026-08-10"));
  assert.ok(!out.includes("for agents") && !out.includes("Agent text.") && !out.includes("| Old | New |"));
});

test("humanNews returns an empty string for an agents-only file", async () => {
  stubBrowser();
  const { humanNews } = await import(UI + "view-notifications.js");
  assert.equal(humanNews("# T\n\nIntro.\n\n## Codes (for agents)\n\nx\n"), "");
});

test("showNewsModal with agents-only text opens no modal and acknowledges once", async () => {
  const browser = stubBrowser();
  const { state } = await import(UI + "state.js");
  (state as any).actor = { id: 1, handle: "michal", kind: "human" };
  const { showNewsModal } = await import(UI + "view-notifications.js");
  const before = browser.created.length;
  let closed = 0;
  showNewsModal({ text: "# T\n\n## Codes (for agents)\n\nx\n" }, () => { closed++; });
  assert.equal(closed, 1);
  assert.equal(browser.created.length, before);
});

test("NEWS.md: the newest agents section is marked and a human section is on top", () => {
  const text = readFileSync(new URL("../../NEWS.md", import.meta.url), "utf8");
  assert.ok(text.includes("## Error codes and agent tags are English (for agents)"));
  const headings = text.split("\n").filter((l) => l.startsWith("## "));
  assert.equal(headings[0], "## The client CLI is now called atalks");
  assert.ok(headings.some((h) => !h.endsWith("(for agents)")));
});
