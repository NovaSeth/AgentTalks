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
  static CLOSED = 2;
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
/** The server's reactions of conversation 5: messageId -> {emoji: [handle]} (T-MG-43). */
let reactions5: Record<number, Any> = {};
const requests: string[] = [];
const MAX_LIMIT = 500;
let failAfterOnce = false;
let onRequest: ((path: string) => void) | null = null;
/** When set, a request whose path matches is answered from the table as it is NOW, but only after the gate opens. */
let hold: { match: RegExp; gate: Promise<void> } | null = null;
/** One-shot holds (T-MG-43 r1): only the FIRST request matching each entry waits for its gate. */
let onceHolds: { match: RegExp; gate: Promise<void> }[] = [];
g.fetch = async (path: string) => {
  requests.push(String(path));
  onRequest?.(String(path));
  const url = new URL(String(path), "https://test.local");
  const m = /^\/api\/conversations\/(\d+)\/messages$/.exec(url.pathname);
  let messages: Any[] = [];
  if (failAfterOnce && m && m[1] === "5" && url.searchParams.has("after")) {
    failAfterOnce = false;
    return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
  }
  if (m && m[1] === "5") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), MAX_LIMIT);
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");
    messages = after !== null
      ? server5.filter((x) => x.id > Number(after)).slice(0, limit)
      : before !== null
        ? server5.filter((x) => x.id < Number(before)).slice(-limit)
        : server5.slice(-limit);
  }
  // The page is cut NOW (messages and reactions alike); a held request only answers later.
  const reactions = Object.fromEntries(messages.filter((x) => x.id in reactions5).map((x) => [x.id, structuredClone(reactions5[x.id])]));
  if (hold && hold.match.test(String(path))) await hold.gate;
  const once = onceHolds.findIndex((h) => h.match.test(String(path)));
  if (once >= 0) await onceHolds.splice(once, 1)[0].gate;
  return { ok: true, status: 200, json: async () => ({ messages, reactions, actors: [] }) };
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
  hold = null;
  onceHolds = [];
  failAfterOnce = false;
  reactions5 = {};
  Object.assign(state, {
    actor: { id: 1, handle: "michal", kind: "human" }, view: "chat", activeId: 5,
    conversations: [{ id: 5, slug: "general", kind: "public" }],
    memberships: { 5: {} }, actorsCache: { 1: { handle: "michal" }, 2: { handle: "nestor" } }, actorsList: [],
    msgs: { 5: [] }, loaded: { 5: true }, unread: {}, unreadBadge: {}, online: true, sseCursor: 0,
    reactions: {}, threadOpen: null,
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

// ---- fix round 1 (codex review-r1 F1): the floor is the newest id held when the stream broke
const twoLoaded = () => Object.assign(state, {
  conversations: [{ id: 4, slug: "a", kind: "public" }, { id: 5, slug: "general", kind: "public" }],
  memberships: { 4: {}, 5: {} }, msgs: { 4: [], 5: [] }, loaded: { 4: true, 5: true },
});
const live = (m: Any) => last().listeners.message[0]({ data: JSON.stringify({ type: "message", conversationId: m.conversationId, message: m }) });

test("F1 (codex 1): an SSE message delivered while another conversation catches up does not move the floor", async (t) => {
  twoLoaded();
  server5 = range(31).map((i) => msg(i));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE(); last().open(); last().drop(2);
  t.mock.timers.tick(1000);
  let delivered = false;
  onRequest = (p) => { if (!delivered && p.includes("/conversations/4/")) { delivered = true; live(msg(31)); } };
  last().open();
  await settle();
  assert.deepEqual(ids(5), range(31));
});

test("F1 (codex 2): a refresh of the history during the gap does not move the floor", async (t) => {
  server5 = range(31).map((i) => msg(i));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE(); last().open(); last().drop(2);
  for (let i = 2; i <= 31; i++) store.upsertMessage(5, msg(i));   // a refresh while the stream is down
  t.mock.timers.tick(1000);
  last().open();
  await settle();
  assert.deepEqual(ids(5), range(31));
});

test("F1 (codex 3): a failed page followed by a reconnect keeps the floor", async (t) => {
  server5 = range(31).map((i) => msg(i));
  failAfterOnce = true;
  await resume(t);
  await settle();
  last().drop(2);
  t.mock.timers.tick(2000);
  last().open();
  await settle();
  assert.deepEqual(ids(5), range(31));
});

// ---- fix round 2 (codex review-r2 F2, F3): floors are captured at every break, retried at every resume
test("F2 (codex): a second break after a successful catch-up recaptures the floor", async (t) => {
  server5 = range(31).map((i) => msg(i));
  await resume(t);
  await settle();
  assert.deepEqual(ids(5), range(31));
  last().drop(2);
  for (let i = 32; i <= 62; i++) server5.push(msg(i));
  for (let i = 33; i <= 62; i++) store.upsertMessage(5, msg(i));   // a refresh during the second break
  t.mock.timers.tick(1000);
  last().open();
  await settle();
  assert.deepEqual(ids(5), range(62));
});

test("F3 (codex): a retained floor is retried although an SSE event advanced the live cursor", async (t) => {
  twoLoaded();
  server5 = range(31).map((i) => msg(i));
  failAfterOnce = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE(); last().open(); last().drop(2);
  t.mock.timers.tick(1000);
  let delivered = false;
  onRequest = (p) => { if (!delivered && p.includes("/conversations/4/")) { delivered = true; live(msg(31)); } };
  last().open();
  await settle();
  last().drop(2);
  t.mock.timers.tick(2000);
  assert.equal(last().url, "/api/events?after=31");
  last().open();
  await settle();
  assert.deepEqual(ids(5), range(31));
});

// ---- fix round 3 (codex review-r3 F4): a delayed catch-up never overwrites a newer live revision
const edited = (id: number, body: string) => ({ ...msg(id), body, editedAt: 99 });
const updated = (m: Any) => last().listeners.message_updated[0]({ data: JSON.stringify({ type: "message_updated", conversationId: m.conversationId, message: m }) });
const bodyOf = (id: number) => state.msgs[5].find((m: Any) => m.id === id)?.body;

async function heldResume(t: Any, match: RegExp, server: Any[] = [msg(1), msg(2)]) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  server5 = server;
  state.msgs[5] = [msg(1)];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE(); last().open();
  live(msg(1));
  last().drop(2);
  t.mock.timers.tick(1000);
  hold = { match, gate };
  last().open();
  await settle();
  state.conversations = [{ id: 5, slug: "general", kind: "public" }];   // the fake list route answers with none
  return release;
}

test("F4 (codex): a delayed after= page does not replace a message edited live meanwhile", async (t) => {
  const release = await heldResume(t, /after=1/);
  assert.ok(requests.some((p) => p.includes("after=1")), requests.join(", "));
  updated(edited(2, "edited live"));
  await settle();
  assert.equal(bodyOf(2), "edited live");
  release();
  await settle();
  assert.equal(bodyOf(2), "edited live");
  assert.deepEqual(ids(5), [1, 2]);
});

test("F4: a delayed newest-30 refresh does not replace a message edited live meanwhile", async (t) => {
  const release = await heldResume(t, /messages\?limit=30$/);
  live(msg(2));
  updated(edited(2, "edited live"));
  await settle();
  release();
  await settle();
  assert.equal(bodyOf(2), "edited live");
  assert.deepEqual(ids(5), [1, 2]);
});

// ---- T-MG-43 (codex T-MG-18 r4 F5 = B-MG-118): REST reactions are merged independently of the body filter
const reacted = (id: number) => last().listeners.reaction[0]({ data: JSON.stringify({ type: "reaction", conversationId: 5, messageId: id }) });
const thumbs = (...who: string[]) => ({ "+1": who });

test("B-MG-118 (codex repro): a message held from SSE during the newest-30 refresh keeps its REST reactions", async (t) => {
  reactions5 = { 2: thumbs("nestor") };
  const release = await heldResume(t, /messages\?limit=30$/, range(32).map((i) => msg(i)));
  live(msg(2));                       // SSE messages carry no reactions
  await settle();
  release();
  await settle();
  assert.deepEqual(ids(5), range(32));
  assert.deepEqual(state.reactions[2], thumbs("nestor"));
});

test("B-MG-118: a reaction refreshed by a live event during the after= page is not overwritten by the older page", async (t) => {
  reactions5 = { 2: thumbs("nestor") };
  const release = await heldResume(t, /after=1/);
  assert.ok(requests.some((p) => p.includes("after=1")), requests.join(", "));
  reactions5 = { 2: thumbs("nestor", "michal") };   // a newer reaction, after the page was cut
  reacted(2);
  await settle();
  assert.deepEqual(state.reactions[2], thumbs("nestor", "michal"));
  release();
  await settle();
  assert.deepEqual(state.reactions[2], thumbs("nestor", "michal"));
});

test("B-MG-118: a reaction removed by a live event during the after= page stays removed", async (t) => {
  reactions5 = { 2: thumbs("nestor") };
  const release = await heldResume(t, /after=1/);
  reactions5 = {};
  reacted(2);
  await settle();
  release();
  await settle();
  assert.equal(state.reactions[2], undefined);
});

test("B-MG-118: a held message edited live during the newest-30 refresh still gets its REST reactions", async (t) => {
  reactions5 = { 1: thumbs("nestor") };
  const release = await heldResume(t, /messages\?limit=30$/);
  updated(edited(1, "edited live"));
  await settle();
  release();
  await settle();
  assert.equal(bodyOf(1), "edited live");
  assert.deepEqual(state.reactions[1], thumbs("nestor"));
});

test("F4 (T-MG-43): a message replaced by a REST reaction refresh during the after= page keeps that newer revision", async (t) => {
  const release = await heldResume(t, /after=1/);
  server5[1] = edited(2, "edited after the page was cut");
  reactions5 = { 2: thumbs("nestor") };
  reacted(2);                         // its refresh (before=3&limit=1) upserts message 2 from REST
  await settle();
  assert.equal(bodyOf(2), "edited after the page was cut");
  release();
  await settle();
  assert.equal(bodyOf(2), "edited after the page was cut");
  assert.deepEqual(state.reactions[2], thumbs("nestor"));
});

// ---- T-MG-43 (codex T-MG-18 r4 F6 = B-MG-119): a held gap message gets the newer REST revision
async function failedRetry(t: Any) {
  server5 = [msg(1)];
  failAfterOnce = true;
  await resume(t);
  await settle();
  assert.deepEqual(ids(5), [1]);
  last().drop(2);
  server5[0] = edited(1, "edited during outage");
  for (let i = 2; i <= 31; i++) server5.push(msg(i));
  t.mock.timers.tick(2000);
  assert.equal(last().url, "/api/events");
}

test("B-MG-119 (codex repro): after a failed retry the reconnect refreshes a held gap message older than the newest 30", async (t) => {
  await failedRetry(t);
  last().open();
  await settle();
  assert.deepEqual(ids(5), range(31));
  assert.equal(bodyOf(1), "edited during outage");
});

test("F4 (T-MG-43): a held gap message edited by a live event during the after= request keeps the live body", async (t) => {
  await failedRetry(t);
  let release!: () => void;
  hold = { match: /after=0/, gate: new Promise<void>((r) => { release = r; }) };
  last().open();
  await settle();
  state.conversations = [{ id: 5, slug: "general", kind: "public" }];   // the fake list route answers with none
  assert.ok(requests.some((p) => p.includes("after=0")), requests.join(", "));
  updated(edited(1, "edited live"));
  await settle();
  release();
  await settle();
  assert.equal(bodyOf(1), "edited live");
  assert.deepEqual(ids(5), range(31));
});

// ---- T-MG-43 fix round 1 (codex review-r1 F1): a page of a superseded catch-up never undoes a newer one
const general = () => { state.conversations = [{ id: 5, slug: "general", kind: "public" }]; };

test("r1 F1 (codex repro): a superseded newest-30 page landing late keeps the newer catch-up's reactions and body", async (t) => {
  const release = await heldResume(t, /messages\?limit=30$/);
  hold = null;
  last().drop(2);
  server5[0] = edited(1, "edited in outage 2");
  reactions5 = { 1: thumbs("nestor") };
  t.mock.timers.tick(1000);
  last().open();
  await settle();
  general();
  assert.equal(bodyOf(1), "edited in outage 2");
  assert.deepEqual(state.reactions[1], thumbs("nestor"));
  release();
  await settle();
  assert.equal(bodyOf(1), "edited in outage 2");
  assert.deepEqual(state.reactions[1], thumbs("nestor"));
});

test("r1 F1: when the superseded page lands first, the newer catch-up's page still applies", async (t) => {
  let releaseOld!: () => void;
  let releaseNew!: () => void;
  server5 = [msg(1), msg(2)];
  state.msgs[5] = [msg(1)];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  sse.connectSSE(); last().open();
  live(msg(1));
  last().drop(2);
  t.mock.timers.tick(1000);
  onceHolds = [{ match: /messages\?limit=30$/, gate: new Promise<void>((r) => { releaseOld = r; }) }];
  last().open();
  await settle();
  general();
  last().drop(2);
  server5[0] = edited(1, "edited in outage 2");
  reactions5 = { 1: thumbs("nestor") };
  t.mock.timers.tick(1000);
  onceHolds = [{ match: /messages\?limit=30$/, gate: new Promise<void>((r) => { releaseNew = r; }) }];
  last().open();
  await settle();
  general();
  releaseOld();
  await settle();
  releaseNew();
  await settle();
  assert.equal(bodyOf(1), "edited in outage 2");
  assert.deepEqual(state.reactions[1], thumbs("nestor"));
  assert.deepEqual(ids(5), [1, 2]);
});

test("r1 F1: an unstamped write during the after= page (an own edit, applyMessageUpdate) is kept", async (t) => {
  const release = await heldResume(t, /after=1/);
  store.upsertMessage(5, edited(2, "own edit"));
  release();
  await settle();
  assert.equal(bodyOf(2), "own edit");
});

test("r1 F1: a reaction refresh sent before a newer catch-up and landing after it does not undo that catch-up", async (t) => {
  await heldResume(t, /never/);
  hold = null;
  await settle();
  let releaseRefresh!: () => void;
  onceHolds = [{ match: /before=3&limit=1/, gate: new Promise<void>((r) => { releaseRefresh = r; }) }];
  reacted(2);                         // its refresh is cut now: body m2, no reactions
  await settle();
  last().drop(2);
  server5[1] = edited(2, "edited in outage 2");
  reactions5 = { 2: thumbs("nestor") };
  t.mock.timers.tick(1000);
  last().open();
  await settle();
  general();
  assert.equal(bodyOf(2), "edited in outage 2");
  releaseRefresh();
  await settle();
  assert.equal(bodyOf(2), "edited in outage 2");
  assert.deepEqual(state.reactions[2], thumbs("nestor"));
});
