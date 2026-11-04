/**
 * T-MG-44: Slack-like unread highlights. A message by somebody else that the user did NOT see
 * arrive (it was there when they came back to the conversation, or it landed while the tab was
 * hidden, another view was shown or another conversation was open) gets a soft tint on its
 * bubble row, next to the "New messages" divider; a message that arrives while they are present
 * is not tinted; once the server CONFIRMS the read mark the tint fades out (CSS transition) and
 * never comes back for that message; own messages are never tinted; nothing survives an account
 * change.
 *
 * The production modules (view-chat.js, counters.js, data.js) run unchanged over a small stubbed
 * DOM: `#main` replaces its children on every innerHTML write (as in ui-t29), and the message list
 * parses every `.msg` row it is given (innerHTML or insertAdjacentHTML) into a node with a
 * classList and a dataset, as a browser does, so the classes the code assigns and later swaps can
 * be read back. `fetch` answers the read POST as the test decides (ok, 503, or never).
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
/** A working storage: the recent-conversations list lives there, and trimConversationCache drops
 *  the history of every conversation it does not name (a no-op stub lost conversation 6). */
function storage() {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null, setItem(k: string, v: string) { m.set(k, String(v)); },
    removeItem(k: string) { m.delete(k); }, clear() { m.clear(); },
  };
}
g.sessionStorage = storage();
g.localStorage = storage();
g.HTMLImageElement = class {};
g.Event = class { type: string; constructor(type: string) { this.type = type; } };
g.EventSource = class { static CLOSED = 2; close() {} addEventListener() {} };
g.requestAnimationFrame = (fn: () => void) => { fn(); return 1; };
g.ResizeObserver = class { observe() {} disconnect() {} };

/** The read POST: `readAnswer` decides (ok / a 503 / never); every POST is recorded. */
const posts: { path: string; body: Any }[] = [];
let readAnswer: "ok" | "503" | "never" = "never";
g.fetch = (path: string, init: Any) => {
  if (init?.method === "POST" && /\/read$/.test(path)) {
    posts.push({ path, body: JSON.parse(init.body) });
    if (readAnswer === "ok") return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (readAnswer === "503") return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: "busy" }) });
  }
  return new Promise(() => {});   // nothing else in these tests waits for the network
};
const settle = () => new Promise((r) => setImmediate(r));   // the awaits inside api() and the read timer

const i18n = await import(UI + "i18n.js");
i18n.setLang("en");
const apiMod = await import(UI + "api.js");
const store = await import(UI + "state.js");
const dom = await import(UI + "dom.js");
const counters = await import(UI + "counters.js");
const data = await import(UI + "data.js");
const chat = await import(UI + "view-chat.js");
const state = store.state as Record<string, Any>;
// What app.js registers: the read-confirmed hook of data.js is the ONLY thing that starts a fade.
store.registerViews({
  message: chat.upsertMessageNode, repin: dom.repinIfPinned, scrollToBottom: dom.scrollToBottom, thread: () => {},
  render: chat.renderMain, main: chat.renderMain, shell: chat.renderMain, readConfirmed: chat.fadeUnreadHighlights,
});

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

/** `#main` as a browser treats innerHTML: every write creates fresh elements for the ids in the
 *  markup; `#messages` is the row-parsing list above, the rest plain stubs (as in ui-t29). */
function hostify(host: El): El {
  const owned = new Set<string>();
  let html = "";
  Object.defineProperty(host, "innerHTML", {
    get: () => html,
    set(v: string) {
      html = String(v);
      for (const id of owned) els.delete(id);
      owned.clear();
      for (const tag of html.matchAll(/<[a-z]+\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const id = tag[1];
        const fresh = id === "messages" ? messageList() : hostify(el());
        fresh.id = id;
        for (const d of tag[0].matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) {
          fresh.dataset[d[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = d[2];
        }
        els.set(id, fresh); owned.add(id);
      }
    },
  });
  return host;
}

const ME = 1, OTHER = 2;
const msg = (conv: number, id: number, actorId = OTHER) =>
  ({ id, conversationId: conv, actorId, body: `m${id}`, ts: 1_700_000_000 + id * 1000, kind: "text" });

/** Conversations 5 and 6: ten messages each, mine and theirs alternating (even ids are theirs);
 *  the server's read mark for me in 5 is `lastRead`, 6 is read to the end. Nothing is open yet. */
function setup(lastRead: number, { unread = 0, reset = true }: { unread?: number; reset?: boolean } = {}) {
  els.clear();
  els.set("main", hostify(el({ id: "main" })));
  g.document.visibilityState = "visible";
  posts.length = 0;
  readAnswer = "never";
  data.cancelMarkRead();
  store.resetState();
  Object.assign(state, {
    actor: { id: ME, handle: "michal", kind: "human" }, view: "home", activeId: null, loadingConv: false,
    conversations: [{ id: 5, slug: "general", kind: "public" }, { id: 6, slug: "random", kind: "public" }],
    memberships: { 5: { lastReadMessageId: lastRead }, 6: { lastReadMessageId: 610 } },
    actorsCache: { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" } },
    msgs: {
      5: Array.from({ length: 10 }, (_, i) => msg(5, 501 + i, i % 2 ? OTHER : ME)),
      6: Array.from({ length: 10 }, (_, i) => msg(6, 601 + i, i % 2 ? OTHER : ME)),
    },
    loaded: { 5: true, 6: true }, online: true, unread: { 5: unread },
  });
  store.rebuildMentionRe();
  if (reset) chat.resetUnreadHighlights();   // the test-only reset; the account-change test goes without it
}

const list = () => els.get("messages")!;
const highlighted = (l: El = list()) => l.rows.filter((r: El) => r.classList.contains("unread-hl")).map((r: El) => Number(r.dataset.msg));
const fading = (l: El = list()) => l.rows.filter((r: El) => r.classList.contains("unread-hl-fade")).map((r: El) => Number(r.dataset.msg));

/** Opening conversation `id` the way the UI does (route, sidebar, search): openConversation. */
async function open(id = 5) { await chat.openConversation(id); return list(); }

/** The server confirms the read mark up to `upTo` (the debounce elapsed and the POST answered ok). */
async function confirmRead(upTo: number) {
  readAnswer = "ok";
  mock.timers.tick(500);
  await settle(); await settle(); await settle();
}

// ------------------------------------------------------------------ the pure helper (counters.js)
test("T-MG-44: highlightUnreadIds names the others' messages above the mark, never mine or deleted ones", () => {
  const l = [msg(5, 1, ME), msg(5, 2), msg(5, 3, ME), msg(5, 4), { ...msg(5, 5), deletedAt: 1 }, msg(5, 6)];
  assert.deepEqual(counters.highlightUnreadIds(l, 2, ME), [4, 6]);
  assert.deepEqual(counters.highlightUnreadIds(l, 0, ME), [2, 4, 6]);
  assert.deepEqual(counters.highlightUnreadIds(l, 6, ME), [], "nothing above the mark");
  assert.deepEqual(counters.highlightUnreadIds(l, null, ME), [], "no mark (no divider): nothing");
  assert.deepEqual(counters.highlightUnreadIds(undefined, 0, ME), []);
});

// ------------------------------------------------------------------ 1: open after absence
test("T-MG-44: opening a conversation with others' messages above the read mark tints exactly those rows", async () => {
  setup(504);
  const l = await open();
  assert.deepEqual(highlighted(l), [506, 508, 510], "theirs above 504; mine (505, 507, 509) are not tinted");
  assert.match(l.innerHTML, /class="newline"/, "the divider is still there");
});

test("T-MG-44: a conversation read to the end gets no tint", async () => {
  setup(510);
  assert.deepEqual(highlighted(await open()), []);
});

test("T-MG-44: a first visit (mark 0) follows the divider's estimate from the unread count", async () => {
  setup(0, { unread: 2 });
  assert.deepEqual(highlighted(await open()), [508, 510]);
});

// ------------------------------------------------------------------ 2: live while present, not tinted
test("T-MG-44: a message that arrives while the tab is visible and the conversation open is not tinted", async () => {
  setup(510);
  const l = await open();
  const m = msg(5, 511);
  state.msgs[5].push(m);
  chat.upsertMessageNode(m);
  assert.deepEqual(highlighted(l), []);
  chat.renderMessages();                            // a re-render does not change its mind
  assert.deepEqual(highlighted(l), []);
});

// ------------------------------------------------------------------ 2b: live while hidden, tinted
test("T-MG-44: a message that arrives while the tab is hidden is tinted, and stays so on a re-render", async () => {
  setup(510);
  const l = await open();
  g.document.visibilityState = "hidden";
  const theirs = msg(5, 511), mine = msg(5, 512, ME);
  state.msgs[5].push(theirs); chat.upsertMessageNode(theirs);
  state.msgs[5].push(mine); chat.upsertMessageNode(mine);
  assert.deepEqual(highlighted(l), [511], "theirs is tinted; my own message is not");
  g.document.visibilityState = "visible";
  chat.noteTabVisible();
  chat.renderMessages();                            // a panel toggle redraws the list (T-MG-29)
  assert.deepEqual(highlighted(l), [511]);
});

test("T-MG-44: coming back to the tab tints what landed meanwhile even when it was drawn in a full render", async () => {
  setup(510);
  const l = await open();
  g.document.visibilityState = "hidden";
  state.msgs[5].push(msg(5, 511), msg(5, 512));
  chat.renderMessages();                            // a replay after a break goes through a full render
  assert.deepEqual(highlighted(l), [511, 512]);
  g.document.visibilityState = "visible";
  chat.noteTabVisible();
  chat.renderMessages();
  assert.deepEqual(highlighted(l), [511, 512]);
});

// ------------------------------------------------------------------ 2c: another view open (fix round 1)
test("T-MG-44 r1: messages that arrive while another view (wiki) covers the active conversation are tinted on return", async () => {
  setup(510);
  await open();
  state.view = "notifications"; chat.renderMain();  // #/activity: the chat column is gone, activeId stays 5
  // Three live messages by SSE: the conversation is not open, so only the state takes them (no
  // upsertMessageNode call, as sse-events.js does); one of them is mine.
  state.msgs[5].push(msg(5, 511), msg(5, 512, ME), msg(5, 513));
  const l = await open();                           // #/c/general again: the same id, from another view
  assert.deepEqual(highlighted(l), [511, 513], "the two by others; not my own; nothing read earlier");
  chat.renderMessages();
  assert.deepEqual(highlighted(l), [511, 513], "a re-render keeps them");
});

// ------------------------------------------------------------------ F3 (r2): Activity -> Home restores the chat without openConversation
test("T-MG-44 r2 F3: a rail place switch (goPlace: view = chat, renderShell) tints what arrived while the Activity view was up", async () => {
  setup(510);
  await open();
  state.view = "notifications"; chat.renderMain();
  state.msgs[5].push(msg(5, 511), msg(5, 512, ME), msg(5, 513));
  state.view = "chat"; chat.renderMain();           // what app.js goPlace("home") does: no openConversation
  assert.deepEqual(highlighted(), [511, 513]);
});

// ------------------------------------------------------------------ F4 (r2): the reconnect catch-up after a return
test("T-MG-44 r2 F4: messages recovered by the SSE catch-up after returning to a disconnected tab are tinted", async () => {
  setup(510);
  await open();
  g.document.visibilityState = "hidden";
  g.document.visibilityState = "visible";
  chat.noteTabVisible();                            // nothing arrived yet: the stream was down
  state.msgs[5].push(msg(5, 511), msg(5, 512));     // the REST catch-up lands them...
  chat.renderMessages();                            // ...and views.messages() draws the list, tab visible
  assert.deepEqual(highlighted(), [511, 512], "recovered while absent, not seen live");
  const live = msg(5, 513);                         // a live one afterwards, seen arriving
  state.msgs[5].push(live); chat.upsertMessageNode(live);
  chat.renderMessages();
  assert.deepEqual(highlighted(), [511, 512], "the live one stays untinted across a re-render");
});

// ------------------------------------------------------------------ 3: the fade follows the CONFIRMED read (F2, r2)
test("T-MG-44 r2 F2: the fade starts only when the server confirms the read; a rescheduled read posts nothing yet", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    setup(504);
    const l = await open();                         // openConversation asked for a read up to 510
    assert.deepEqual(highlighted(l), [506, 508, 510]);
    mock.timers.tick(400);
    data.markReadDebounced(5, 510);                 // rescheduled (a scroll): the debounce starts over
    mock.timers.tick(100);
    await settle();
    assert.equal(posts.length, 0, "nothing was posted yet");
    assert.deepEqual(highlighted(l), [506, 508, 510], "still tinted: no confirmation");
    assert.deepEqual(fading(l), []);
    await confirmRead(510);
    assert.equal(posts.length, 1);
    assert.deepEqual(highlighted(l), [], "the tint is gone once the server confirmed");
    assert.deepEqual(fading(l), [506, 508, 510], "the fade class carries the transition");
    chat.renderMessages();                          // a redraw mid-fade keeps fading, not tinting
    assert.deepEqual(highlighted(l), []);
    assert.deepEqual(fading(l), [506, 508, 510]);
    mock.timers.tick(3000);
    assert.deepEqual(fading(l), [], "the fade class is removed after the transition");
    chat.renderMessages();
    assert.deepEqual(highlighted(l), [], "a re-render never tints a read message again");
    assert.deepEqual(fading(l), []);
  } finally { data.cancelMarkRead(); mock.timers.reset(); }   // a mocked read timer must not outlive its mock
});

test("T-MG-44 r2 F2: a failed read (503) leaves the rows tinted", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    setup(504, { unread: 3 });
    const l = await open();
    readAnswer = "503";
    mock.timers.tick(500);
    await settle(); await settle(); await settle();
    assert.equal(posts.length, 1, "the read was posted");
    assert.equal(state.unread[5], 3, "the counter stays: the server did not confirm");
    assert.deepEqual(highlighted(l), [506, 508, 510], "no confirmation, no fade");
    assert.deepEqual(fading(l), []);
  } finally { data.cancelMarkRead(); mock.timers.reset(); }   // a mocked read timer must not outlive its mock
});

test("T-MG-44: a partial confirmed read fades only up to it; the rest stays tinted", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    setup(504);
    const l = await open();
    data.markReadDebounced(5, 507);                 // 506 is read; 508 and 510 are not
    await confirmRead(507);
    assert.deepEqual(highlighted(l), [508, 510]);
    assert.deepEqual(fading(l), [506]);
  } finally { data.cancelMarkRead(); mock.timers.reset(); }   // a mocked read timer must not outlive its mock
});

test("T-MG-44: the highlight is per conversation: a confirmed read in another one touches nothing here", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    setup(504);
    const l = await open();
    data.cancelMarkRead();
    data.markReadDebounced(6, 610);
    await confirmRead(610);
    assert.deepEqual(highlighted(l), [506, 508, 510]);
  } finally { data.cancelMarkRead(); mock.timers.reset(); }   // a mocked read timer must not outlive its mock
});

// ------------------------------------------------------------------ 4: never again, across navigation (F1, r2)
test("T-MG-44 r2 F1: a message read here does not regain its tint after going to another conversation and back", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    setup(504);
    await open();
    await confirmRead(510);
    mock.timers.tick(3000);                         // the fade is over
    assert.deepEqual(highlighted(), []); assert.deepEqual(fading(), []);
    // Opening 5 trimmed the never-opened 6 from the cache (trimConversationCache keeps the active
    // and the recent ones): its history is "loaded" again, as a fetch would leave it.
    state.msgs[6] = Array.from({ length: 10 }, (_, i) => msg(6, 601 + i, i % 2 ? OTHER : ME)); state.loaded[6] = true;
    await open(6);
    const l = await open(5);                        // the membership mark is still the stale 504
    assert.equal(state.unread[5], 0);
    assert.deepEqual(highlighted(l), [], "506, 508, 510 were read: no tint");
    assert.deepEqual(fading(l), []);
    assert.match(l.innerHTML, /class="newline"/, "the divider itself is the existing, unchanged behaviour");
  } finally { data.cancelMarkRead(); mock.timers.reset(); }   // a mocked read timer must not outlive its mock
});

// ------------------------------------------------------------------ 4b: the server watermark (F7, r3)
test("T-MG-44 r3 F7: later renders never tint a message at or below the server's read watermark", async () => {
  setup(520);                                       // the server says read up to 520; the cached list ends at 510
  const l = await open();
  assert.deepEqual(highlighted(l), []);
  data.cancelMarkRead();
  for (const id of [512, 514]) state.msgs[5].push(msg(5, id));   // landed behind the cache (replay / catch-up)
  chat.renderMessages();
  assert.deepEqual(highlighted(list()), [], "512 and 514 are below the confirmed 520: already read");
  state.msgs[5].push(msg(5, 522));                 // above the watermark: missed
  chat.renderMessages();
  assert.deepEqual(highlighted(list()), [522]);
});

// ------------------------------------------------------------------ 6: account change (F5, r2)
test("T-MG-44 r2 F5: highlight state and timers do not cross an account change (session generation)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    setup(504);
    await open();
    await confirmRead(510);                         // A's rows are fading; the 3 s class timer is pending
    assert.deepEqual(fading(), [506, 508, 510]);
    mock.timers.tick(100);
    data.cancelMarkRead();
    apiMod.newSessionGeneration();                  // the production sign-out / account change (sse-events.js)
    // B signs in and opens the same conversation. NO resetUnreadHighlights(): the cleanup under
    // test is the production one (the map notices the new generation on first touch).
    setup(504, { reset: false });
    const l = await open();
    assert.deepEqual(highlighted(l), [506, 508, 510], "B sees their own unread, untouched by A's state");
    mock.timers.tick(3500);                         // well past A's 3000 ms fade-end timer
    assert.deepEqual(highlighted(l), [506, 508, 510], "A's timer did not strip B's tint");
    assert.deepEqual(fading(l), []);
  } finally { data.cancelMarkRead(); mock.timers.reset(); }   // a mocked read timer must not outlive its mock
});

// ------------------------------------------------------------------ 7: CSS
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
