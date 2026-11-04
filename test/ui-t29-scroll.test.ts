/**
 * T-MG-29: any click that redraws the chat column (closing the side panel, the details toggle,
 * a profile, the pinned panel, a thread) rebuilt `#messages` and lost the reading position: the
 * fresh list read scrollTop 0 / "at bottom" from itself, and `.messages{scroll-behavior:smooth}`
 * animated the plain `scrollTop = scrollHeight` assignment from the very top to the bottom.
 *
 * The production modules (renderMain, renderMessages, dom.js) run unchanged over a small stubbed
 * DOM: `#main` replaces its children on every innerHTML write (fresh elements under the ids the
 * markup names, as a browser does), the message list models scrollTop / scrollHeight /
 * clientHeight and records every scrollTo call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

type El = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function el(extra: El = {}): El {
  const e: El = {
    innerHTML: "", textContent: "", value: "", className: "", style: {}, dataset: {}, hidden: false, isConnected: true,
    scrollHeight: 0, scrollTop: 0, clientHeight: 0, offsetHeight: 0, selectionStart: 0, selectionEnd: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    listeners: {} as Record<string, ((ev: Any) => unknown)[]>,
    addEventListener(type: string, fn: (ev: Any) => unknown) { (e.listeners[type] ||= []).push(fn); },
    removeEventListener() {}, appendChild() {}, remove() { e.isConnected = false; }, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {},
    setSelectionRange() {}, dispatchEvent() {}, insertAdjacentHTML() {}, scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    ...extra,
  };
  return e;
}

const els = new Map<string, El>();
const observers: { cb: () => void; target: El | null }[] = [];
const g = globalThis as Record<string, Any>;
g.document = {
  documentElement: el(), body: el(), head: el(), title: "", visibilityState: "visible",
  getElementById: (id: string) => els.get(id) ?? null,
  createElement: () => el(), createTextNode: () => el(),
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  activeElement: null, contains: () => true,
};
g.window = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {}, innerWidth: 1440, innerHeight: 900, visualViewport: null,
  location: { origin: "https://test.local" },
};
g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
g.history = { pushState() {}, replaceState() {} };
g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
g.localStorage = { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {} };
g.HTMLImageElement = class {};
g.Event = class { type: string; constructor(type: string) { this.type = type; } };
g.EventSource = class { static CLOSED = 2; close() {} addEventListener() {} };
g.requestAnimationFrame = (fn: () => void) => { fn(); return 1; };
g.ResizeObserver = class {
  entry: { cb: () => void; target: El | null };
  constructor(cb: () => void) { this.entry = { cb, target: null }; observers.push(this.entry); }
  observe(target: El) { this.entry.target = target; }
  disconnect() {}
};
g.fetch = () => new Promise(() => {});   // nothing in these tests waits for the network

const i18n = await import(UI + "i18n.js");
i18n.setLang("en");
const store = await import(UI + "state.js");
const dom = await import(UI + "dom.js");
const chat = await import(UI + "view-chat.js");
const state = store.state as Record<string, Any>;
store.registerViews({ message: chat.upsertMessageNode, repin: dom.repinIfPinned, scrollToBottom: dom.scrollToBottom, thread: () => {} });

/** The message list: a 600 px box; the content is 2000 px tall once rows were written into it.
 *  scrollTo records its calls and moves scrollTop like a browser. */
function messageList(extra: El = {}): El {
  const list = el({
    clientHeight: 600, scrolledTo: [] as { top: number; behavior: string }[],
    scrollTo(opts: { top: number; behavior: string }) { list.scrolledTo.push(opts); list.scrollTop = opts.top; },
  });
  let html = "";
  Object.defineProperty(list, "innerHTML", {
    get: () => html,
    set(v: string) { html = String(v); list.scrollHeight = html ? 2000 : 0; list.scrollTop = 0; },
  });
  return Object.assign(list, extra);
}

/** `#main` as a browser treats innerHTML: every write drops the old children and creates fresh
 *  elements for the ids in the markup. `#messages` is a message list; the rest are plain stubs. */
function hostify(host: El): El {
  const owned = new Set<string>();
  let html = "";
  host.dropAll = () => {
    for (const id of owned) { const old = els.get(id); if (old) { old.isConnected = false; old.dropAll?.(); } els.delete(id); }
    owned.clear();
  };
  Object.defineProperty(host, "innerHTML", {
    get: () => html,
    set(v: string) {
      html = String(v);
      host.dropAll();
      for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
        const id = m[1];
        const fresh = id === "messages" ? messageList({ id }) : hostify(el({ id }));
        els.set(id, fresh); owned.add(id);
      }
    },
  });
  return host;
}
const mainHost = () => hostify(el({ id: "main" }));

const msgs = (conv: number) => Array.from({ length: 30 }, (_, i) => ({ id: conv * 100 + i + 1, conversationId: conv, actorId: 1 + (i % 2), body: `m${i}`, ts: 1_700_000_000 + i * 1000, kind: "text" }));

/** The chat of conversation 5, loaded and drawn, its list scrolled to `scrollTop`. */
function openChat(scrollTop: number): El {
  els.clear(); observers.length = 0;
  els.set("main", mainHost());
  Object.assign(state, {
    actor: { id: 1, handle: "michal", kind: "human" }, view: "chat", activeId: 5, loadingConv: false,
    conversations: [{ id: 5, slug: "general", kind: "public" }, { id: 6, slug: "random", kind: "public" }],
    memberships: { 5: { lastReadMessageId: 530 }, 6: { lastReadMessageId: 630 } },
    actorsCache: { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" } },
    msgs: { 5: msgs(5), 6: msgs(6) }, loaded: { 5: true, 6: true }, pending: {}, drafts: {}, online: true,
    threadOpen: null, threadMsgs: [], openQuestions: {}, hasMore: {}, readMark: {}, unread: {}, lastUnread: {},
    detailsOpen: false, pinnedOpen: false, profileHandle: null, sidePanel: null, reportFilter: false, convPins: [],
    pendingFiles: [], replyTo: null, newBelow: 0,
  });
  store.rebuildMentionRe();
  chat.renderMain();
  const list = els.get("messages")!;
  assert.equal(list.scrollHeight, 2000, "the list was drawn");
  list.scrollTop = scrollTop;                      // the user scrolled; the browser fires a scroll event
  for (const fn of list.listeners.scroll ?? []) fn({});
  return list;
}
const atBottom = (list: El) => list.scrollHeight - list.scrollTop - list.clientHeight < 80;

// ------------------------------------------------------------------ acceptance 1 (scrolled up)
test("T-MG-29: a re-render of the same conversation keeps a scrolled-up list at its scrollTop", () => {
  const old = openChat(400);
  assert.ok(!atBottom(old), "the user is reading older messages");
  state.detailsOpen = true;                        // the details toggle: renderMain() rebuilds the column
  chat.renderMain();
  const list = els.get("messages")!;
  assert.notEqual(list, old, "the column was rebuilt: a fresh #messages");
  assert.equal(list.scrollTop, 400, "the reading position was captured from the OLD list and restored");
  // The ResizeObserver on the fresh list fires once it is laid out; a user who scrolled up must
  // not be re-pinned to the bottom by it.
  for (const o of observers) if (o.target === list) o.cb();
  assert.equal(list.scrollTop, 400, "the list observer does not yank a scrolled-up user to the bottom");
  assert.equal(list.scrolledTo.length, 0, "no scrollTo at all on a restore");
});

test("T-MG-29: closing the side panel afterwards keeps the position too", () => {
  openChat(400);
  state.detailsOpen = true; chat.renderMain();
  state.detailsOpen = false; chat.renderMain();    // the X of the panel / Mod+.
  const list = els.get("messages")!;
  assert.equal(list.scrollTop, 400);
});

// ------------------------------------------------------------------ acceptance 2 (at bottom, no animation)
test("T-MG-29: an at-bottom list ends at the bottom after the re-render, with no smooth path involved", () => {
  const old = openChat(1400);
  assert.ok(atBottom(old));
  state.profileHandle = "nestor";
  chat.renderMain();
  const list = els.get("messages")!;
  assert.notEqual(list, old);
  assert.ok(atBottom(list), `the list stays at the bottom (scrollTop ${list.scrollTop})`);
  assert.ok(list.scrolledTo.every((s) => s.behavior !== "smooth"), "nothing asked for a smooth scroll");
  // The contract that a plain `scrollTop = ...` is instant: the list has no CSS scroll-behavior,
  // and a non-smooth request says "instant" instead of deferring to CSS with "auto".
  const css = readFileSync(CSS, "utf8");
  const messagesRule = /\.messages\{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.ok(messagesRule, "the .messages rule exists");
  assert.doesNotMatch(messagesRule, /scroll-behavior\s*:\s*smooth/, ".messages carries no scroll-behavior:smooth");
  assert.equal(dom.scrollBehavior(false), "instant");
});

// ------------------------------------------------------------------ acceptance 3 (smooth where intended)
test("T-MG-29: scrollToBottom(true) still asks for behavior smooth when reduced motion is off", () => {
  const list = openChat(400);
  dom.scrollToBottom(true);
  assert.deepEqual(list.scrolledTo.at(-1), { top: 2000, behavior: "smooth" });
  assert.equal(dom.scrollBehavior(true), "smooth");
});

// ------------------------------------------------------------------ acceptance 4 (another conversation)
test("T-MG-29: a DIFFERENT conversation does not inherit the old list's position", () => {
  openChat(400);
  state.activeId = 6;                              // what openConversation sets before its renderMain
  chat.renderMain();
  const list = els.get("messages")!;
  assert.notEqual(list.scrollTop, 400, "the other conversation starts where it always did (bottom / unread line)");
  assert.ok(atBottom(list));
});
