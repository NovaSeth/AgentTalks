/**
 * T-MG-16 item 4 (B-MG-97): the live stream's replay cursor before the first event.
 * Until a message event arrives the cursor is 0, and a reconnect without `?after` is "the future
 * only" to the server, so messages posted while the stream was down were lost for conversations
 * the UI had loaded. The cursor is now pinned to the newest loaded message id when a stream that
 * was open drops before any event (every message after that id would have arrived live), and a
 * return after a stream that never opened starts from the newest loaded id too.
 * The production sse-events.js runs over a stubbed EventSource and mocked timers.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class FakeEventSource {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
  static all: FakeEventSource[] = [];
  url: string; readyState = 0; closed = false;
  listeners: Record<string, ((e: Any) => unknown)[]> = {};
  onopen: (() => unknown) | null = null;
  onerror: (() => unknown) | null = null;
  constructor(url: string) { this.url = url; FakeEventSource.all.push(this); }
  addEventListener(type: string, fn: (e: Any) => unknown) { (this.listeners[type] ||= []).push(fn); }
  close() { this.closed = true; this.readyState = 2; }
  open() { this.readyState = 1; return this.onopen?.(); }
  /** The connection breaks: CLOSED = nobody retries, CONNECTING = the browser retries by itself. */
  drop(readyState: number) { this.readyState = readyState; this.onerror?.(); }
  emit(type: string, data: Any) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(data) }); }
}

const el = (): Record<string, Any> => ({
  innerHTML: "", textContent: "", style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute: () => "", addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
  querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
});
const g = globalThis as Record<string, Any>;
g.document = {
  documentElement: {}, body: el(), head: el(), title: "", visibilityState: "visible",
  getElementById: () => null, createElement: () => el(), createTextNode: () => el(),
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  activeElement: null, contains: () => true,
};
g.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { origin: "https://test.local" } };
g.location = { origin: "https://test.local", href: "https://test.local/", hash: "" };
g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
g.localStorage = { length: 0, key: () => null, getItem: () => null, setItem() {}, removeItem() {} };
g.EventSource = FakeEventSource;
const fetched: string[] = [];
g.fetch = (path: string) => { fetched.push(String(path)); return new Promise(() => {}); }; // probes and reloads never answer

const i18n = await import(UI + "i18n.js");
i18n.setLang("en");
const store = await import(UI + "state.js");
const sse = await import(UI + "sse-events.js");
const state = store.state as Record<string, Any>;
store.registerViews({ offlineBar: () => {}, sidebar: () => {}, conversationRow: () => {}, message: () => {}, thread: () => {} });

const msg = (id: number, conversationId = 5) => ({ id, conversationId, actorId: 2, body: `m${id}`, ts: id, kind: "text" });
const last = () => FakeEventSource.all[FakeEventSource.all.length - 1];
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r)); };

beforeEach(() => {
  sse.disconnectSSE();
  FakeEventSource.all = [];
  fetched.length = 0;
  Object.assign(state, {
    actor: { id: 1, handle: "michal", kind: "human" }, view: "chat", activeId: 5,
    conversations: [{ id: 5, slug: "general", kind: "public" }, { id: 7, slug: "bugs", kind: "public" }],
    memberships: { 5: {}, 7: {} }, actorsCache: { 1: { handle: "michal" }, 2: { handle: "nestor" } }, actorsList: [],
    msgs: { 5: [msg(38), msg(40)] }, loaded: { 5: true }, unread: {}, unreadBadge: {}, online: true, sseCursor: 0,
  });
});

test("B-MG-97 (repro): an open stream that closes before its first event resumes after the newest loaded message", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  const first = last();
  assert.equal(first.url, "/api/events", "a first connection asks for the future only");
  first.open();
  first.drop(FakeEventSource.CLOSED);
  t.mock.timers.tick(1000);
  assert.equal(FakeEventSource.all.length, 2, "the client reconnects by itself");
  assert.equal(last().url, "/api/events?after=40", "the gap after message 40 is replayed");
});

test("B-MG-97: a drop the browser would retry by itself (CONNECTING, no event id) is taken over with the cursor", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  const first = last();
  first.open();
  first.drop(FakeEventSource.CONNECTING);
  assert.ok(first.closed, "the browser's own retry would carry no cursor (no Last-Event-ID): it is stopped");
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events?after=40");
});

test("B-MG-97: a conversation loaded while the stream is down does not move the pinned cursor", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  last().open();
  last().drop(FakeEventSource.CLOSED);
  // During the break #bugs is opened: its history ends at 70, while #general's gap starts after 40.
  state.msgs[7] = [msg(69, 7), msg(70, 7)]; state.loaded[7] = true;
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events?after=40", "messages 41-69 of #general are not skipped");
});

test("B-MG-97: a stream that never opened resumes after the newest loaded message on its return", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  last().drop(FakeEventSource.CLOSED);              // a 502 during a deployment: never open
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events?after=40");
});

test("B-MG-97 controls: an event's id is the cursor; with nothing loaded the return asks for the future only", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  const first = last();
  first.open();
  first.emit("message", { type: "message", conversationId: 5, message: msg(45) });
  await settle();
  assert.equal(state.sseCursor, 45);
  first.drop(FakeEventSource.CONNECTING);
  assert.equal(first.closed, false, "with an event id the browser's retry sends Last-Event-ID: left alone");
  first.drop(FakeEventSource.CLOSED);
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events?after=45");

  sse.disconnectSSE();
  FakeEventSource.all = [];
  state.msgs = {}; state.loaded = {};
  sse.connectSSE();
  last().open();
  last().drop(FakeEventSource.CLOSED);
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events", "no loaded history: nothing to replay");
});

test("B-MG-97: a history that is cached but not loaded (one SSE message) does not seed the cursor", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  state.msgs = { 5: [msg(40)], 7: [msg(90, 7)] }; state.loaded = { 5: true };
  sse.connectSSE();
  last().open();
  last().drop(FakeEventSource.CLOSED);
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events?after=40");
});

// ------------------------------------------------------------------ fix round 1 (codex review-r1 F3, F4)
test("R1 F3 (codex repro): a first stream that drops while CONNECTING is retried by the client, after the newest loaded id", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  const first = last();
  first.drop(FakeEventSource.CONNECTING);           // never opened: the browser would retry future-only
  assert.ok(first.closed, "the browser's own retry (no cursor) is stopped");
  t.mock.timers.tick(1000);
  assert.equal(FakeEventSource.all.length, 2);
  assert.equal(last().url, "/api/events?after=40");
});

test("R1 F3: a never-opened stream (CLOSED) and a history loaded during the break still resume after 40, not 70", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  last().drop(FakeEventSource.CLOSED);
  state.msgs[7] = [msg(69, 7), msg(70, 7)]; state.loaded[7] = true;
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events?after=40");
  // The retry drops before open again: every retry without an event keeps 40.
  last().drop(FakeEventSource.CONNECTING);
  t.mock.timers.tick(2000);
  assert.equal(last().url, "/api/events?after=40");
  last().open();                                     // opened, but the replay had not arrived yet
  last().drop(FakeEventSource.CLOSED);
  t.mock.timers.tick(4000);
  assert.equal(last().url, "/api/events?after=40", "an open without any event does not move the floor");
});

test("R1 F4 (codex repro): an empty loaded history is a cursor of zero: the return catches that conversation up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  state.msgs = { 5: [] }; state.loaded = { 5: true };
  sse.connectSSE();
  last().open();
  last().drop(FakeEventSource.CLOSED);
  state.msgs[7] = [msg(70, 7)]; state.loaded[7] = true;   // loaded during the break: a gap after its load too
  t.mock.timers.tick(1000);
  const url = last().url;
  assert.ok(url === "/api/events?after=0" || url === "/api/events", url);
  if (url === "/api/events") {
    last().open();
    for (let i = 0; i < 4; i++) await settle();
    assert.ok(fetched.some((p) => p.startsWith("/api/conversations/5/messages")), `REST catch-up of #5: ${fetched.join(", ")}`);
  }
});

test("R1 F4 control: nothing loaded at all is no cursor: the return is future-only and fetches no history", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  state.msgs = {}; state.loaded = {};
  sse.connectSSE();
  last().open();
  last().drop(FakeEventSource.CLOSED);
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events");
  last().open();
  await settle();
  assert.ok(!fetched.some((p) => p.includes("/messages")), fetched.join(", "));
});

