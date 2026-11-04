/**
 * T-MG-18 item 2 (B-MG-116): after a resume the REST catch-up of a loaded conversation used to fetch
 * only the newest 30 messages, so a gap longer than that lost its oldest messages. It now pages
 * GET /api/conversations/:id/messages?after=<floor> until a page is shorter than the limit.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class FakeEventSource {
  static all: FakeEventSource[] = [];
  url: string; readyState = 0;
  listeners: Record<string, ((e: Any) => unknown)[]> = {};
  onopen: (() => unknown) | null = null;
  onerror: (() => unknown) | null = null;
  constructor(url: string) { this.url = url; FakeEventSource.all.push(this); }
  addEventListener(type: string, fn: (e: Any) => unknown) { (this.listeners[type] ||= []).push(fn); }
  close() { this.readyState = 2; }
  open() { this.readyState = 1; return this.onopen?.(); }
  drop(readyState: number) { this.readyState = readyState; this.onerror?.(); }
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

/** The server's table: conversation 5 holds `server5`; the route limit is 500 (core/messages.ts). */
let server5: Any[] = [];
const requests: string[] = [];
const MAX_LIMIT = 500;
let onRequest: ((path: string) => void) | null = null;
g.fetch = async (path: string) => {
  requests.push(String(path));
  onRequest?.(String(path));
  const url = new URL(String(path), "https://test.local");
  const m = /^\/api\/conversations\/(\d+)\/messages$/.exec(url.pathname);
  let messages: Any[] = [];
  if (m && m[1] === "5") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), MAX_LIMIT);
    const after = url.searchParams.get("after");
    messages = after !== null
      ? server5.filter((x) => x.id > Number(after)).slice(0, limit)
      : server5.slice(-limit);
  }
  return { ok: true, status: 200, json: async () => ({ messages, reactions: {}, actors: [] }) };
};

const i18n = await import(UI + "i18n.js");
i18n.setLang("en");
const store = await import(UI + "state.js");
const sse = await import(UI + "sse-events.js");
const api = await import(UI + "api.js");
const state = store.state as Record<string, Any>;
store.registerViews({ offlineBar: () => {}, sidebar: () => {}, conversationRow: () => {}, message: () => {}, thread: () => {} });

const msg = (id: number, conversationId = 5) => ({ id, conversationId, actorId: 2, body: `m${id}`, ts: id, kind: "text" });
const last = () => FakeEventSource.all[FakeEventSource.all.length - 1];
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise<void>((r) => setImmediate(r)); };
const ids = (conv: number) => (state.msgs[conv] || []).map((m: Any) => m.id);
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

beforeEach(() => {
  sse.disconnectSSE();
  FakeEventSource.all = [];
  requests.length = 0;
  onRequest = null;
  Object.assign(state, {
    actor: { id: 1, handle: "michal", kind: "human" }, view: "chat", activeId: 5,
    conversations: [{ id: 5, slug: "general", kind: "public" }],
    memberships: { 5: {} }, actorsCache: { 1: { handle: "michal" }, 2: { handle: "nestor" } }, actorsList: [],
    msgs: { 5: [] }, loaded: { 5: true }, unread: {}, unreadBadge: {}, online: true, sseCursor: 0,
  });
});

async function resume(t: Any) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE();
  last().open();
  last().drop(2);
  t.mock.timers.tick(1000);
  assert.equal(last().url, "/api/events", "an empty loaded history resumes without a cursor: the REST catch-up runs");
  last().open();
}

test("B-MG-116 (codex repro): a loaded empty conversation catches up all 31 messages of the gap, message 1 included", async (t) => {
  server5 = range(31).map((i) => msg(i));
  await resume(t);
  await settle();
  assert.deepEqual(ids(5), range(31));
  assert.ok(requests.some((p) => /messages\?after=0/.test(p)), requests.join(", "));
});

test("B-MG-116: a gap longer than one page is paged until a short page, merged in order", async (t) => {
  server5 = range(1203).map((i) => msg(i));
  await resume(t);
  await settle();
  assert.deepEqual(ids(5), range(1203));
  const pages = requests.filter((p) => p.includes("after="));
  assert.equal(pages.length, 7, pages.join(", "));   // 1203 messages, 200 per page, the last page short
});

test("B-MG-116: an answer that arrives under another session generation is not merged", async (t) => {
  server5 = range(31).map((i) => msg(i));
  onRequest = () => { api.newSessionGeneration(); };    // the account changed while the catch-up was in flight
  await resume(t);
  await settle();
  assert.deepEqual(ids(5), []);
});
