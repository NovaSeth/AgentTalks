import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

// Browser boundaries only: the production event handlers, views, actions and state run unchanged.
class ElementStub {
  id = "";
  value = "";
  textContent = "";
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  scrollHeight = 1000;
  scrollTop = 0;
  clientHeight = 100;
  disabled = false;
  listeners = new Map<string, Set<(event: any) => any>>();
  children = new Map<string, ElementStub>();
  markup = "";
  parent: ElementStub | null = null;
  get innerHTML() { return this.markup; }
  set innerHTML(html: string) {
    if ([...this.children.values()].includes(doc.activeElement!)) doc.activeElement = null;
    for (const [id, child] of this.children) if (elements.get(id) === child) elements.delete(id);
    this.children.clear();
    this.markup = html;
    // Only ID lookup and replacement identity matter for these tests; no layout or HTML execution.
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
      const child = new ElementStub();
      child.parent = this;
      this.children.set(match[1], child);
      elements.set(match[1], child);
    }
  }
  addEventListener(type: string, fn: (event: any) => any) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: any) => any) { this.listeners.get(type)?.delete(fn); }
  async fire(type: string, fields: Record<string, unknown> = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, ...fields };
    for (const fn of [...(this.listeners.get(type) || [])]) await fn(event);
  }
  dispatchEvent(event: { type: string }) { void this.fire(event.type); }
  querySelector(selector: string): ElementStub | null {
    if (selector.startsWith("#")) return elements.get(selector.slice(1)) ?? null;
    if (selector === ".modal") return this;
    return null;
  }
  querySelectorAll() { return []; }
  closest(selector: string) { return selector === ".overlay" ? this : null; }
  appendChild(child: ElementStub) {
    child.parent = this;
    if (child.id) elements.set(child.id, child);
    else overlays.push(child);
  }
  remove() { overlays = overlays.filter((entry) => entry !== this); }
  focus() { doc.activeElement = this; }
  scrollTo() {}
  setAttribute() {}
}

class StorageStub {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

let elements = new Map<string, ElementStub>();
let overlays: ElementStub[] = [];
const doc = Object.assign(new ElementStub(), {
  title: "", documentElement: {}, body: new ElementStub(), visibilityState: "hidden",
  activeElement: null as ElementStub | null,
  getElementById: (id: string) => elements.get(id) ?? null,
  createElement: () => new ElementStub(), contains: () => true,
});
const storage = new StorageStub();
const session = new StorageStub();
const notifications: unknown[] = [];
class NotificationStub {
  static permission = "granted";
  constructor(title: string, options: unknown) { notifications.push({ title, options }); }
}
class EventSourceStub {
  static CLOSED = 2;
  static current: EventSourceStub;
  listeners = new Map<string, (event: any) => any>();
  url: string;
  readyState = 1;
  constructor(url: string) { this.url = url; EventSourceStub.current = this; }
  addEventListener(type: string, fn: (event: any) => any) { this.listeners.set(type, fn); }
  close() {}
  async message(type: string, message: any) {
    await this.listeners.get(type)!({ data: JSON.stringify({ type, conversationId: message.conversationId, message }) });
  }
}
const globals = globalThis as Record<string, any>;
Object.assign(globals, {
  document: doc, localStorage: storage, sessionStorage: session,
  window: { matchMedia: () => ({ matches: false }), addEventListener() {}, innerHeight: 800, Notification: NotificationStub },
  EventSource: EventSourceStub, Notification: NotificationStub,
});
const base = new URL("../../src/http/ui/js/", import.meta.url).href;
const model = await import(base + "state.js");
const { state, views, upsertMessage } = model;
const { connectSSE, disconnectSSE } = await import(base + "sse-events.js");
const { sendMessage } = await import(base + "actions.js");
const { renderThread, renderComposer } = await import(base + "view-chat.js");
const { mdToHtml } = await import(base + "markdown.js");
const { doLogout } = await import(base + "view-login.js");
const { confirmModal } = await import(base + "dom.js");
const initial = structuredClone(state);
const initialViews = { ...views };
const message = { id: 100, conversationId: 7, actorId: 2, body: "hello", kind: "text", ts: 1, threadId: null };
function element(id: string) {
  const el = new ElementStub();
  elements.set(id, el);
  return el;
}
function deferredResponse() {
  let resolve!: (data: unknown) => void;
  const response = new Promise((done) => { resolve = (data) => done({ ok: true, json: async () => data }); });
  globals.fetch = async () => response;
  return resolve;
}
const settle = () => new Promise<void>((done) => setImmediate(done));

beforeEach(() => {
  disconnectSSE();
  Object.assign(state, structuredClone(initial));
  Object.assign(views, initialViews);
  state.actor = { id: 1, handle: "me", kind: "human" };
  state.conversations = [{ id: 7, kind: "dm", slug: null }];
  state.memberships = { 7: { conversationId: 7, notify: "all" } };
  state.actorsCache = { 1: state.actor, 2: { handle: "bob", kind: "agent" } };
  state.loaded[7] = true;
  state.msgs[7] = [];
  model.resetMentionRe();
  elements = new Map(); overlays = [];
  notifications.length = 0;
  doc.listeners.clear(); doc.activeElement = null; doc.visibilityState = "hidden";
  storage.data.clear(); session.data.clear();
  globals.fetch = async () => ({ ok: true, json: async () => ({}) });
});

test("B-MG-35: edits, deletes and replayed updates replace messages without new-message effects", async () => {
  state.activeId = 7;
  element("messages");
  const live = element("live");
  const drawn: any[] = [];
  views.message = (msg: any) => drawn.push(msg);
  connectSSE();
  await EventSourceStub.current.message("message", message);
  assert.equal(state.unread[7], 1);
  assert.equal(state.unreadBadge[7], 1);
  assert.equal(notifications.length, 1);
  assert.equal(state.newBelow, 1);
  const announced = live.textContent;
  const title = doc.title;
  for (const update of [
    { ...message, body: "edited", editedAt: 2 },
    { ...message, body: "", deletedAt: 3 },
    { ...message, fixedAt: 4 },
    { ...message, resolvedAt: 5 },
  ]) {
    await EventSourceStub.current.message("message_updated", update);
    assert.deepEqual(state.msgs[7], [update]);
    assert.equal(drawn.at(-1), state.msgs[7][0]);
    assert.deepEqual([state.unread[7], state.unreadBadge[7], notifications.length, state.newBelow], [1, 1, 1, 1]);
    assert.equal(live.textContent, announced);
    assert.equal(doc.title, title);
  }
});

test("B-MG-38: REST upserts do not advance the cursor used to reconnect SSE", async () => {
  connectSSE();
  await EventSourceStub.current.message("message", message);
  assert.equal(state.sseCursor, 100);
  upsertMessage(7, { ...message, id: 200 });
  connectSSE();
  assert.equal(EventSourceStub.current.url, "/api/events?after=100");
  await EventSourceStub.current.message("message", { ...message, id: 150 });
  assert.equal(state.sseCursor, 150);
  state.loaded[7] = false;
  await EventSourceStub.current.message("message", { ...message, id: 160 });
  assert.equal(state.sseCursor, 160);
  await EventSourceStub.current.message("message_updated", { ...message, id: 120, body: "old edit" });
  assert.equal(state.sseCursor, 160);
});

test("B-MG-36: a thread send response upserts the reply already received over SSE", async () => {
  state.activeId = 7;
  state.threadOpen = 90;
  element("thread-slot");
  renderThread();
  const resolve = deferredResponse();
  elements.get("th-input")!.value = "reply";
  const sending = elements.get("th-send")!.fire("click");
  const reply = { ...message, actorId: 1, body: "reply", threadId: 90 };
  connectSSE();
  await EventSourceStub.current.message("message", reply);
  assert.equal(state.threadMsgs.length, 1);
  resolve({ message: reply });
  await sending;
  assert.deepEqual(state.threadMsgs, [reply]);
  assert.deepEqual(state.msgs[7], [reply]);
});

test("B-MG-37: Enter then further typing keeps the composer, focus and new draft after send", async () => {
  state.activeId = 7;
  element("composer");
  views.composer = renderComposer;
  renderComposer();
  const input = elements.get("composer-input")!;
  input.value = "first";
  input.focus();
  const resolve = deferredResponse();
  await input.fire("keydown", { key: "Enter", shiftKey: false });
  assert.equal(input.value, "");
  input.value = "next";
  await input.fire("input");
  resolve({ message: { ...message, actorId: 1, body: "first" } });
  await settle();
  assert.equal(elements.get("composer-input"), input);
  assert.equal(input.value, "next");
  assert.equal(doc.activeElement, input);
  assert.equal(state.drafts[7].text, "next");
  assert.equal(storage.getItem("atalks_draft_1_7"), "next");   // actor 1's namespace (F2 r3)
});

test("B-MG-37: a successful send only clears unchanged sent text", async () => {
  state.activeId = 7;
  const input = element("composer-input");
  input.value = "first";
  input.focus();
  const resolve = deferredResponse();
  const sending = sendMessage("first");
  resolve({ message: { ...message, actorId: 1, body: "first" } });
  await sending;
  assert.equal(input.value, "");
  assert.equal(doc.activeElement, input);
});

test("B-MG-39: mentions never rewrite link destinations or code", () => {
  for (const [source, expected] of [
    ["[x](https://a.b/(@bob)", '<p><a href="https://a.b/(@bob" target="_blank" rel="noopener noreferrer">x</a></p>'],
    ["https://a.b/x(@bob", '<p><a href="https://a.b/x(@bob" target="_blank" rel="noopener noreferrer">https://a.b/x(@bob</a></p>'],
    ["`@bob`", "<p><code>@bob</code></p>"],
    ["`[x](https://a.b/(@bob)`", "<p><code>[x](https://a.b/(@bob)</code></p>"],
  ]) assert.equal(mdToHtml(source, "message", "me"), expected);
  assert.match(mdToHtml("hello @bob and @me", "message", "me"), /class="mention" data-actor="bob"/);
  assert.match(mdToHtml("hello @bob and @me", "message", "me"), /class="me-mention" data-actor="me"/);
});

test("B-MG-39: user NUL placeholders remain text instead of referencing code blocks", () => {
  assert.equal(mdToHtml("\x00B0\x00", "page", "me"), "<p>B0</p>");
  const html = mdToHtml("\x00B0\x00\n\n```\nsecret\n```", "page", "me");
  assert.match(html, /^<p>B0<\/p>/);
  assert.equal((html.match(/<pre><code>secret<\/code><\/pre>/g) || []).length, 1);
});

test("B-MG-39: markdown still escapes hostile HTML, URLs and wiki titles", () => {
  state.wiki.pages = [{ slug: "x", title: '<img src=x onerror="alert(1)">' }];
  for (const source of [
    "[click](javascript:alert(1))", "[[a|<img src=x onerror=alert(1)>]]", "<img src=x onerror=alert(1)>",
    "`<script>`", '[a](https://x.y/"onmouseover="alert(1))', '@bob"onmouseover=x',
    "| a | b |\n|---|---|\n| <b> | **x** |", "[[x]]",
  ]) {
    const html = mdToHtml(source, "page", "me");
    assert.doesNotMatch(html, /<script|<img|href="javascript:|\sonmouseover="/);
  }
});

test("B-MG-41: logout clears all account state and drafts while preserving browser preferences", async () => {
  state.activeId = 7;
  state.msgs[7] = [message];
  state.pending[7] = [{ ...message, id: "tmp-1" }];
  state.drafts[7] = { text: "private" };
  state.threadOpen = 100; state.threadMsgs = [message];
  state.notifications = [{ body: "private" }]; state.notifUnread = 1;
  state.wiki = { ...state.wiki, editing: true, draft: { body: "private wiki" }, pages: [{ slug: "private" }] };
  model.dmMembersCache[7] = [2]; model.animatedMsgs.add(100); model.reports.add(100);
  for (const key of ["atalks_draft_7", "atalks_draft_8", "atalks_wiki_draft_private", "atalks_last_conv"]) storage.setItem(key, "private");
  storage.setItem("atalks_lang", "en"); storage.setItem("unrelated", "keep");
  session.setItem("atalks_actor", "me"); session.setItem("atalks_csrf", "test");
  await doLogout();
  assert.deepEqual(state, initial);
  assert.deepEqual(model.dmMembersCache, {});
  assert.equal(model.animatedMsgs.size, 0);
  assert.equal(model.reports.size, 0);
  // The storage-layout flag (F4 r5) is a browser-level record, like the language: no account data.
  assert.deepEqual([...storage.data], [["atalks_lang", "en"], ["unrelated", "keep"], ["atalks_storage_v", "2"]]);
  assert.equal(session.getItem("atalks_actor"), null);
  assert.equal(session.getItem("atalks_csrf"), null);
});

for (const closeBy of ["cf-no", "cf-yes", "Escape", "backdrop"]) {
  test(`B-MG-43: confirmation closed by ${closeBy} releases every keydown listener`, async () => {
    const baseline = doc.listeners.get("keydown")?.size ?? 0;
    for (let i = 0; i < 3; i++) {
      const result = confirmModal({ title: "Delete?" });
      if (closeBy === "Escape") await doc.fire("keydown", { key: "Escape" });
      else if (closeBy === "backdrop") await overlays.at(-1)!.fire("click");
      else await elements.get(closeBy)!.fire("click");
      assert.equal(await result, closeBy === "cf-yes");
      assert.equal(doc.listeners.get("keydown")?.size ?? 0, baseline);
    }
  });
}

test("B-MG-37: sending a main-composer thread reply does not rebuild the composer", async () => {
  state.activeId = 7;
  state.replyTo = 90;
  const root = { ...message, id: 90 };
  state.msgs[7] = [root];
  element("main"); element("composer");
  const { openThread } = await import(base + "view-chat.js");
  views.openThread = openThread;
  views.composer = renderComposer;
  renderComposer();
  const input = elements.get("composer-input")!;
  input.value = "reply"; input.focus();
  const resolve = deferredResponse();
  const post = globals.fetch;
  globals.fetch = async (url: string) => url.endsWith("/thread")
    ? { ok: true, json: async () => ({ messages: [root], actors: {}, reactions: {} }) }
    : post();
  await input.fire("keydown", { key: "Enter", shiftKey: false });
  input.value = "next";
  resolve({ message: { ...message, actorId: 1, body: "reply", threadId: 90 } });
  await settle();
  assert.equal(elements.get("composer-input"), input);
  assert.equal(doc.activeElement, input);
  assert.equal(input.value, "next");
  assert.equal(state.threadOpen, 90);
});

test("B-MG-37: typing the same message again during a send preserves the new text", async () => {
  state.activeId = 7;
  element("composer");
  renderComposer();
  const input = elements.get("composer-input")!;
  input.value = "again"; input.focus();
  const resolve = deferredResponse();
  await input.fire("keydown", { key: "Enter", shiftKey: false });
  input.value = "again";
  resolve({ message: { ...message, actorId: 1, body: "again" } });
  await settle();
  assert.equal(input.value, "again");
  assert.equal(doc.activeElement, input);
  assert.equal(storage.getItem("atalks_draft_1_7"), "again");   // actor 1's namespace (F2 r3)
});

test("B-MG-37: a response after switching conversations preserves both new drafts", async () => {
  state.activeId = 7;
  const input = element("composer-input");
  input.value = "sent";
  const resolve = deferredResponse();
  const sending = sendMessage("sent");
  input.value = "next in seven";
  model.saveDraft();
  state.activeId = 8;
  input.value = "next in eight";
  input.focus();
  model.saveDraft();
  resolve({ message: { ...message, actorId: 1, body: "sent" } });
  await sending;
  assert.equal(input.value, "next in eight");
  assert.equal(doc.activeElement, input);
  assert.equal(state.drafts[7].text, "next in seven");
  assert.equal(state.drafts[8].text, "next in eight");
});

test("B-MG-39: a wiki title cannot inject an internal inline placeholder", () => {
  state.wiki.pages = [{ slug: "x", title: "\x00I0\x00" }];
  const html = mdToHtml("[[x]]", "page", "me");
  assert.match(html, />I0<\/a>/);
  assert.doesNotMatch(html, /\x00|undefined/);
});
