/**
 * S10 (T-MG-3 wave 5): the Threads view and the pinned panel.
 *
 * `view-threads.js` exports `threadsFor(msgs, me, seen)`: the threads I started or replied to,
 * newest activity first, with an unread marker that a later reply by somebody else switches on
 * and that opening the thread (recorded in `seen`) switches off. `renderThreadsMain` writes the
 * list into `#main`. The pinned panel is a side panel kind (`sidePanelOf` knows "pinned") with
 * its own slot in `renderMain`, listing the pins with a jump button each.
 * Pixel truth (the dot at the top, the jump) is the live checklist in the spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

/** The minimal browser from test/ui-s6-people.test.ts: a `#main` whose innerHTML is kept. */
function stubBrowser(): { main: Record<string, unknown> } {
  const el = (): Record<string, unknown> => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
  });
  const main = el();
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: (id: string) => (id === "main" ? main : el()), createElement: () => el(), createTextNode: () => el(),
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
  return { main };
}

const ME = 1; // michal
const NESTOR = 2;
const ANNA = 5;
const msg = (id: number, actorId: number, threadId: number | null, body = `m${id}`, conversationId = 7) =>
  ({ id, conversationId, actorId, threadId, body, ts: 1700000000 + id, kind: "text", deletedAt: null });

/** Four threads in two conversations:
 *  10: mine, nestor replied last (unread for me)        20: anna's, I replied, anna replied after me
 *  30: anna's, nestor replied, I never did (not mine)   40: mine, I replied last myself (no dot) */
const MSGS = [
  msg(10, ME, null, "my question"), msg(11, NESTOR, 10, "nestor answers"),
  msg(20, ANNA, null, "anna asks", 8), msg(21, ME, 20, "I reply", 8), msg(22, ANNA, 20, "anna again", 8),
  msg(30, ANNA, null, "not my business"), msg(31, NESTOR, 30, "nestor on anna's"),
  msg(40, ME, null, "my note"), msg(41, ME, 40, "my own follow-up"),
  msg(50, ME, null, "a root without replies"),
];

test("threadsFor: only threads I started or replied to, each with its root, replies and conversation", async () => {
  stubBrowser();
  const { threadsFor } = await import(UI + "view-threads.js");
  const out = threadsFor(MSGS, ME);
  assert.deepEqual(out.map((x: { root: { id: number } }) => x.root.id).sort(), [10, 20, 40], "30 is not mine, 50 has no replies");
  const t20 = out.find((x: { root: { id: number } }) => x.root.id === 20);
  assert.equal(t20.conversationId, 8);
  assert.deepEqual(t20.replies.map((r: { id: number }) => r.id), [21, 22]);
  assert.equal(t20.last.id, 22);
});

test("threadsFor: newest activity first - the last reply decides, not the root", async () => {
  stubBrowser();
  const { threadsFor } = await import(UI + "view-threads.js");
  const out = threadsFor(MSGS, ME);
  assert.deepEqual(out.map((x: { root: { id: number } }) => x.root.id), [40, 20, 10]);
  // A fresh reply by nestor to my oldest thread lifts it to the top.
  const later = threadsFor([...MSGS, msg(60, NESTOR, 10, "nestor again")], ME);
  assert.equal(later[0].root.id, 10);
  assert.equal(later[0].last.id, 60);
});

test("threadsFor: a reply by somebody else I have not seen is unread; my own last word is not", async () => {
  stubBrowser();
  const { threadsFor } = await import(UI + "view-threads.js");
  const by = Object.fromEntries(threadsFor(MSGS, ME).map((x: { root: { id: number }; unread: boolean }) => [x.root.id, x.unread]));
  assert.equal(by[10], true, "nestor replied to my thread and I have not opened it");
  assert.equal(by[20], true, "anna replied after me");
  assert.equal(by[40], false, "the last reply is mine");
});

test("threadsFor: opening a thread (seen up to the last reply) clears its marker until a newer reply", async () => {
  stubBrowser();
  const { threadsFor } = await import(UI + "view-threads.js");
  const seen = { 10: 11 };
  const opened = threadsFor(MSGS, ME, seen).find((x: { root: { id: number } }) => x.root.id === 10);
  assert.equal(opened.unread, false);
  const again = threadsFor([...MSGS, msg(60, NESTOR, 10, "nestor again")], ME, seen).find((x: { root: { id: number } }) => x.root.id === 10);
  assert.equal(again.unread, true, "a reply newer than the seen mark shows the dot again");
  assert.deepEqual(threadsFor([], ME), [], "no messages, no threads");
  assert.deepEqual(threadsFor(null, ME), [], "a missing list is not an error");
});

test("renderThreadsMain writes the Threads list into #main: unread dot, newest first, a button per thread", async () => {
  const { main } = stubBrowser();
  const { state } = await import(UI + "state.js");
  const threads = await import(UI + "view-threads.js");
  state.actor = { id: ME, handle: "michal", kind: "human" };
  state.view = "threads";
  state.conversations = [{ id: 7, slug: "general", kind: "public" }, { id: 8, slug: "bugs", kind: "public" }];
  state.msgs = { 7: MSGS.filter((m) => m.conversationId === 7), 8: MSGS.filter((m) => m.conversationId === 8) };
  state.actorsCache = { 1: { id: 1, handle: "michal" }, 2: { id: 2, handle: "nestor" }, 5: { id: 5, handle: "anna" } };
  threads.renderThreadsMain();
  const html = String(main.innerHTML);
  assert.match(html, /id="threads-list"/, "the list host");
  const rows = [...html.matchAll(/data-thread-root="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(rows, [40, 20, 10], "newest activity first");
  const row10 = html.slice(html.indexOf('data-thread-root="10"'), html.indexOf('data-thread-root="10"') + 900);
  assert.match(row10, /th-unread/, "nestor's reply shows the dot");
  assert.match(row10, /#general/, "the row says where the thread lives");
  const row40 = html.slice(html.indexOf('data-thread-root="40"'), html.indexOf('data-thread-root="20"'));
  assert.doesNotMatch(row40, /th-unread/, "my own last word is no news");
  // An empty state says what a thread is and how to start one.
  state.msgs = {};
  threads.renderThreadsMain();
  assert.match(String(main.innerHTML), /empty/i);
});

test("the pinned panel is a side panel kind: sidePanelOf knows it, renderMain hosts #pinned-slot", async () => {
  const { main } = stubBrowser();
  const { state } = await import(UI + "state.js");
  const chat = await import(UI + "view-chat.js");
  state.actor = { id: ME, handle: "michal", kind: "human" };
  state.view = "chat";
  state.activeId = 7;
  state.conversations = [{ id: 7, slug: "general", kind: "public", topic: "" }];
  state.memberships = { 7: true };
  state.msgs = { 7: MSGS.filter((m) => m.conversationId === 7) };
  state.threadOpen = null; state.detailsOpen = false; state.profileHandle = null; state.loadingConv = false;
  state.pinnedOpen = false;
  assert.equal(chat.sidePanelOf(state), null);
  state.pinnedOpen = true;
  assert.deepEqual(chat.sidePanelOf(state), { kind: "pinned", id: 7 });
  state.detailsOpen = true;
  assert.deepEqual(chat.sidePanelOf(state), { kind: "pinned", id: 7 }, "pinned is opened from details, so it wins over details");
  state.detailsOpen = false;
  state.convPins = [{ messageId: 10, by: "anna" }, { messageId: 999, by: "nestor" }];
  chat.renderMain();
  const html = String(main.innerHTML);
  const panel = html.slice(html.indexOf('id="side-panel"'), html.indexOf("</aside>"));
  assert.match(panel, /id="pinned-slot"/, "the pinned host lives inside the panel");
  assert.match(panel, /data-kind="pinned"/, "the panel names what it shows");
  assert.deepEqual(state.sidePanel, { kind: "pinned", id: 7 });
});

test("renderPinned lists every pin with a jump button; the header pill and details open the panel", async () => {
  stubBrowser();
  const src = readFileSync(UI + "view-chat.js", "utf8");
  assert.match(src, /export function renderPinned\(/, "view-chat.js exports renderPinned");
  const body = src.slice(src.indexOf("export function renderPinned("));
  assert.match(body, /id="pinned-slot"|getElementById\("pinned-slot"\)/, "renders into the pinned slot");
  assert.match(body, /data-jump=/, "a jump per pin");
  // The pins pill in the header opens the panel, not the details section.
  assert.match(src, /openPinnedPanel/, "one function opens the pinned panel");
  assert.match(src, /section === "pins"[^\n]*openPinnedPanel|openPinnedPanel\(\)[^\n]*pins/, "the pins pill routes to the pinned panel");
  const css = readFileSync(CSS, "utf8");
  const s10 = css.slice(css.indexOf("/* === S10 === */"), css.indexOf("/* === S11 === */"));
  assert.match(s10, /#pinned-slot/, "the S10 CSS block lays out the pinned slot");
  assert.match(s10, /th-unread/, "and the thread unread dot");
});

test("the Threads route parses and builds; view-chat.js dispatches state.view 'threads'; the module is served", async () => {
  stubBrowser();
  const { parseRoute, buildRoute } = await import(UI + "router.js");
  assert.deepEqual(parseRoute("#/threads"), { view: "threads" });
  assert.equal(buildRoute({ view: "threads" }), "#/threads");
  assert.deepEqual(parseRoute("#/threads/x"), { view: "home" }, "nothing hangs under the route");
  const chat = readFileSync(UI + "view-chat.js", "utf8");
  assert.match(chat, /state\.view === "threads"/, "renderMain knows the threads view");
  const ui = readFileSync(fileURLToPath(new URL("../src/http/ui.ts", import.meta.url)), "utf8");
  assert.match(ui, /"view-threads\.js"/, "UI_MODULES serves view-threads.js");
});
