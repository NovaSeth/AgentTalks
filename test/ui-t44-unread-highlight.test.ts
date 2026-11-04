/**
 * T-MG-44: Slack-like unread highlights. A message by somebody else that the user did NOT see
 * arrive (it was there when they came back to the conversation, or it landed while the tab was
 * hidden) gets a soft tint on its bubble row, next to the "New messages" divider; a message that
 * arrives while they are present is not tinted; once the read mark is posted the tint fades out
 * (CSS transition) and never comes back for that message; own messages are never tinted.
 *
 * The production modules (view-chat.js, counters.js) run unchanged over a small stubbed DOM: the
 * message list parses every `.msg` row it is given (innerHTML or insertAdjacentHTML) into a node
 * with a classList and a dataset, as a browser does, so the classes the code assigns and later
 * swaps can be read back.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

type El = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function classListOf(node: El) {
  const set = () => new Set(String(node.className).split(/\s+/).filter(Boolean));
  return {
    add(...names: string[]) { const s = set(); for (const n of names) s.add(n); node.className = [...s].join(" "); },
    remove(...names: string[]) { const s = set(); for (const n of names) s.delete(n); node.className = [...s].join(" "); },
    toggle(name: string, on?: boolean) { const s = set(); if (on ?? !s.has(name)) s.add(name); else s.delete(name); node.className = [...s].join(" "); },
    contains: (name: string) => set().has(name),
  };
}

function el(extra: El = {}): El {
  const e: El = {
    innerHTML: "", textContent: "", value: "", className: "", style: {}, dataset: {}, hidden: false, isConnected: true,
    scrollHeight: 0, scrollTop: 0, clientHeight: 0, offsetHeight: 0, selectionStart: 0, selectionEnd: 0,
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
  e.classList = classListOf(e);
  return e;
}

const els = new Map<string, El>();
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
g.ResizeObserver = class { observe() {} disconnect() {} };
g.fetch = () => new Promise(() => {});   // nothing in these tests waits for the network

const i18n = await import(UI + "i18n.js");
i18n.setLang("en");
const store = await import(UI + "state.js");
const dom = await import(UI + "dom.js");
const counters = await import(UI + "counters.js");
const chat = await import(UI + "view-chat.js");
const state = store.state as Record<string, Any>;
store.registerViews({ message: chat.upsertMessageNode, repin: dom.repinIfPinned, scrollToBottom: dom.scrollToBottom, thread: () => {} });

/** The message list: every `.msg` row in the markup becomes a node (class + data-msg), as in a
 *  browser; `[data-msg="N"]` and `[data-msg]` queries find them. */
function messageList(): El {
  const rows: El[] = [];
  const parse = (html: string) => {
    for (const tag of html.matchAll(/<div class="msg([^"]*)"[^>]*data-msg="(\d+)"/g)) {
      rows.push(el({ className: ("msg" + tag[1]).trim().replace(/\s+/g, " "), dataset: { msg: tag[2] } }));
    }
  };
  const list = el({
    clientHeight: 600, scrollTo(opts: { top: number }) { list.scrollTop = opts.top; },
    insertAdjacentHTML(_where: string, html: string) { parse(html); },
    querySelector(sel: string) {
      const one = /^\[data-msg="(\d+)"\]$/.exec(sel);
      if (one) return rows.find((r) => r.dataset.msg === one[1]) ?? null;
      if (sel === "[data-msg]") return rows[0] ?? null;
      return null;
    },
    querySelectorAll(sel: string) { return sel === "[data-msg]" ? [...rows] : []; },
  });
  let html = "";
  Object.defineProperty(list, "innerHTML", {
    get: () => html,
    set(v: string) { html = String(v); rows.length = 0; parse(html); list.scrollHeight = html ? 2000 : 0; list.scrollTop = 0; },
  });
  list.rows = rows;
  return list;
}

const ME = 1, OTHER = 2;
const msg = (conv: number, id: number, actorId = OTHER) =>
  ({ id, conversationId: conv, actorId, body: `m${id}`, ts: 1_700_000_000 + id * 1000, kind: "text" });

/** Conversation 5: ten messages, mine and theirs alternating (even ids are theirs); the server's
 *  read mark for me is `lastRead`. */
function setup(lastRead: number, { unread = 0 }: { unread?: number } = {}) {
  els.clear();
  const list = messageList();
  list.id = "messages";
  els.set("messages", list);
  g.document.visibilityState = "visible";
  Object.assign(state, {
    actor: { id: ME, handle: "michal", kind: "human" }, view: "chat", activeId: 5, loadingConv: false,
    conversations: [{ id: 5, slug: "general", kind: "public" }, { id: 6, slug: "random", kind: "public" }],
    memberships: { 5: { lastReadMessageId: lastRead }, 6: { lastReadMessageId: 0 } },
    actorsCache: { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" } },
    msgs: { 5: Array.from({ length: 10 }, (_, i) => msg(5, 501 + i, i % 2 ? OTHER : ME)), 6: [] },
    loaded: { 5: true, 6: true }, pending: {}, drafts: {}, online: true,
    threadOpen: null, threadMsgs: [], openQuestions: {}, hasMore: {}, readMark: {}, unread: { 5: unread }, lastUnread: {},
    detailsOpen: false, pinnedOpen: false, profileHandle: null, sidePanel: null, reportFilter: false, convPins: [],
    pendingFiles: [], replyTo: null, newBelow: 0, reactions: {},
  });
  store.rebuildMentionRe();
  chat.resetUnreadHighlights();
  return list;
}

const highlighted = (list: El) => list.rows.filter((r: El) => r.classList.contains("unread-hl")).map((r: El) => Number(r.dataset.msg));
const fading = (list: El) => list.rows.filter((r: El) => r.classList.contains("unread-hl-fade")).map((r: El) => Number(r.dataset.msg));

/** Entering conversation 5 from elsewhere: what openConversation does before it draws. */
function enter(list: El) {
  state.readMark[5] = state.memberships[5].lastReadMessageId ?? 0;
  chat.noteConversationEntered(5);
  chat.renderMessages();
  return list;
}

// ------------------------------------------------------------------ the pure helper (counters.js)
test("T-MG-44: highlightUnreadIds names the others' messages above the mark, never mine or deleted ones", () => {
  const list = [msg(5, 1, ME), msg(5, 2), msg(5, 3, ME), msg(5, 4), { ...msg(5, 5), deletedAt: 1 }, msg(5, 6)];
  assert.deepEqual(counters.highlightUnreadIds(list, 2, ME), [4, 6]);
  assert.deepEqual(counters.highlightUnreadIds(list, 0, ME), [2, 4, 6]);
  assert.deepEqual(counters.highlightUnreadIds(list, 6, ME), [], "nothing above the mark");
  assert.deepEqual(counters.highlightUnreadIds(list, null, ME), [], "no mark (no divider): nothing");
  assert.deepEqual(counters.highlightUnreadIds(undefined, 0, ME), []);
});

// ------------------------------------------------------------------ 1: open after absence
test("T-MG-44: opening a conversation with others' messages above the read mark tints exactly those rows", () => {
  const list = enter(setup(504));
  assert.deepEqual(highlighted(list), [506, 508, 510], "theirs above 504; mine (505, 507, 509) are not tinted");
  assert.match(list.innerHTML, /class="newline"/, "the divider is still there");
});

test("T-MG-44: a conversation read to the end gets no tint", () => {
  const list = enter(setup(510));
  assert.deepEqual(highlighted(list), []);
});

test("T-MG-44: a first visit (mark 0) follows the divider's estimate from the unread count", () => {
  const list = enter(setup(0, { unread: 2 }));
  assert.deepEqual(highlighted(list), [508, 510]);
});

// ------------------------------------------------------------------ 2: live while present, not tinted
test("T-MG-44: a message that arrives while the tab is visible and the conversation open is not tinted", () => {
  const list = enter(setup(510));
  const m = msg(5, 511);
  state.msgs[5].push(m);
  chat.upsertMessageNode(m);
  assert.deepEqual(highlighted(list), []);
  chat.renderMessages();                            // a re-render does not change its mind
  assert.deepEqual(highlighted(list), []);
});

// ------------------------------------------------------------------ 2b: live while hidden, tinted
test("T-MG-44: a message that arrives while the tab is hidden is tinted, and stays so on a re-render", () => {
  const list = enter(setup(510));
  g.document.visibilityState = "hidden";
  const theirs = msg(5, 511), mine = msg(5, 512, ME);
  state.msgs[5].push(theirs); chat.upsertMessageNode(theirs);
  state.msgs[5].push(mine); chat.upsertMessageNode(mine);
  assert.deepEqual(highlighted(list), [511], "theirs is tinted; my own message is not");
  g.document.visibilityState = "visible";
  chat.noteTabVisible();
  chat.renderMessages();                            // a panel toggle redraws the list (T-MG-29)
  assert.deepEqual(highlighted(list), [511]);
});

test("T-MG-44: coming back to the tab tints what landed meanwhile even when it was drawn in a full render", () => {
  const list = enter(setup(510));
  g.document.visibilityState = "hidden";
  state.msgs[5].push(msg(5, 511), msg(5, 512));
  chat.renderMessages();                            // a replay after a break goes through a full render
  assert.deepEqual(highlighted(list), [511, 512]);
  g.document.visibilityState = "visible";
  chat.noteTabVisible();
  chat.renderMessages();
  assert.deepEqual(highlighted(list), [511, 512]);
});

// ------------------------------------------------------------------ 3 + 4: the fade after the read mark
test("T-MG-44: the read mark swaps the tint for the fade class, which leaves after the transition and never returns", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const list = enter(setup(504));
    assert.deepEqual(highlighted(list), [506, 508, 510]);
    chat.fadeUnreadHighlights(5, 510);               // markReadDebounced(5, 510) was asked for
    assert.deepEqual(highlighted(list), [506, 508, 510], "nothing changes before the mark is posted");
    mock.timers.tick(500);                           // the debounce: the read is posted now
    assert.deepEqual(highlighted(list), [], "the tint is gone");
    assert.deepEqual(fading(list), [506, 508, 510], "the fade class carries the transition");
    chat.renderMessages();                           // a redraw mid-fade keeps fading, not tinting
    assert.deepEqual(highlighted(list), []);
    assert.deepEqual(fading(list), [506, 508, 510]);
    mock.timers.tick(3000);
    assert.deepEqual(fading(list), [], "the fade class is removed after the transition");
    chat.renderMessages();
    assert.deepEqual(highlighted(list), [], "a re-render never tints a read message again");
    assert.deepEqual(fading(list), []);
  } finally { mock.timers.reset(); }
});

test("T-MG-44: a partial read mark fades only up to it; the rest stays tinted", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const list = enter(setup(504));
    chat.fadeUnreadHighlights(5, 507);           // 506 is read; 508 and 510 are not
    mock.timers.tick(500);
    assert.deepEqual(highlighted(list), [508, 510]);
    assert.deepEqual(fading(list), [506]);
  } finally { mock.timers.reset(); }
});

test("T-MG-44: the highlight is per conversation: a read in another one touches nothing here", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const list = enter(setup(504));
    chat.fadeUnreadHighlights(6, 999);
    mock.timers.tick(500);
    assert.deepEqual(highlighted(list), [506, 508, 510]);
  } finally { mock.timers.reset(); }
});

// ------------------------------------------------------------------ 6: CSS
test("T-MG-44: the tint and the fade use theme tokens; reduced motion disables the transition", () => {
  const css = readFileSync(CSS, "utf8");
  const tint = /\.msg\.unread-hl\{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.ok(tint, ".msg.unread-hl exists");
  assert.match(tint, /background:\s*var\(--/, "the tint is a theme token (light and dark)");
  const fade = /\.msg\.unread-hl-fade\{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.ok(fade, ".msg.unread-hl-fade exists");
  assert.match(fade, /transition:[^;]*background[^;]*\b(2(\.\d+)?|3)s/, "the background fades over 2-3 s");
  const reduced = /@media \(prefers-reduced-motion:reduce\)\{\s*\*,\*::before,\*::after\{[^}]*\}/.exec(css)?.[0] ?? "";
  assert.match(reduced, /transition-duration:\.001ms!important/, "the global reduced-motion rule covers the fade");
});
