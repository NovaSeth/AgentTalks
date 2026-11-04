import { afterEach, beforeEach, test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

// DOM and HTTP are browser boundaries. Views, actions, rendering and state are real modules.
// This tree implements only the selectors and DOM operations used by these interactions.
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g,
  (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]!);
type Listener = { fn: (event: any) => any; capture: boolean };
class Element {
  tagName: string;
  constructor(tagName = "div") { this.tagName = tagName; }
  parentElement: Element | null = null;
  nodes: (Element | string)[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  value = "";
  disabled = false;
  scrollHeight = 1000;
  clientHeight = 500;
  scrollTop = 0;
  selectionStart = 0;
  selectionEnd = 0;
  scrolls: unknown[] = [];
  get children(): Element[] { return this.nodes.filter((node) => node instanceof Element); }
  get firstElementChild() { return this.children[0] ?? null; }
  get id() { return this.attrs.id ?? ""; }
  set id(value: string) { this.attrs.id = value; }
  get className() { return this.attrs.class ?? ""; }
  set className(value: string) { this.attrs.class = value; }
  classList = {
    contains: (name: string) => this.className.split(/\s+/).includes(name),
    add: (name: string) => { this.className = [...new Set([...this.className.split(/\s+/), name])].join(" "); },
    remove: (name: string) => { this.className = this.className.split(/\s+/).filter((x) => x !== name).join(" "); },
    toggle: (name: string, force?: boolean) => {
      if (force ?? !this.classList.contains(name)) this.classList.add(name);
      else this.classList.remove(name);
    },
  };
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  get textContent(): string { return this.nodes.map((n) => typeof n === "string" ? n : n.textContent).join(""); }
  set textContent(value: string) { this.clear(); this.nodes = [value]; }
  clear() { for (const child of this.children) child.parentElement = null; this.nodes = []; }
  set innerHTML(html: string) {
    this.clear();
    const stack: Element[] = [this];
    for (const token of html.match(/<[^>]*>|[^<]+/g) || []) {
      if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
      if (!token.startsWith("<")) { stack.at(-1)!.nodes.push(decode(token)); continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const child = new Element(tag);
      for (const attr of token.slice(tag.length + 1, -1).matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g)) {
        child.setAttribute(attr[1], decode(attr[2] ?? attr[3] ?? ""));
      }
      stack.at(-1)!.appendChild(child);
      if (!/^(input|img|br|hr|meta|link)$/.test(tag) && !token.endsWith("/>")) stack.push(child);
    }
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const exclude = part.match(/:not\(([^)]+)\)/);
      if (exclude && this.matches(exclude[1])) return false;
      part = part.replace(/:not\([^)]+\)/g, "").trim();
      const tag = part.match(/^[\w-]+/)?.[0];
      if (tag && this.tagName !== tag) return false;
      for (const id of part.matchAll(/#([\w-]+)/g)) if (this.id !== id[1]) return false;
      for (const cls of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(cls[1])) return false;
      for (const attr of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!(attr[1] in this.attrs) || (attr[2] !== undefined && this.attrs[attr[1]] !== attr[2])) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector: string): Element[] {
    const matches = (el: Element, part: string): boolean => {
      const tokens = part.trim().split(/\s+/);
      if (!el.matches(tokens.pop()!)) return false;
      let ancestor = el.parentElement;
      while (tokens.length) {
        const token = tokens.pop()!;
        while (ancestor && !ancestor.matches(token)) ancestor = ancestor.parentElement;
        if (!ancestor) return false;
        ancestor = ancestor.parentElement;
      }
      return true;
    };
    const all: Element[] = [];
    const visit = (el: Element) => { for (const child of el.children) { all.push(child); visit(child); } };
    visit(this);
    return all.filter((el) => selector.split(",").some((part) => matches(el, part)));
  }
  querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(child: Element | null): boolean { return child === this || this.children.some((el) => el.contains(child)); }
  appendChild(child: Element) { child.remove(); child.parentElement = this; this.nodes.push(child); return child; }
  remove() {
    if (this.parentElement) this.parentElement.nodes = this.parentElement.nodes.filter((el) => el !== this);
    this.parentElement = null;
  }
  replaceWith(child: Element) {
    const parent = this.parentElement!;
    child.remove();
    parent.nodes.splice(parent.nodes.indexOf(this), 1, child);
    child.parentElement = parent;
    this.parentElement = null;
  }
  addEventListener(type: string, fn: Listener["fn"], capture: boolean | object = false) {
    const entry = { fn, capture: capture === true };
    const listeners = this.listeners.get(type) ?? [];
    if (!listeners.some((l) => l.fn === fn && l.capture === entry.capture)) listeners.push(entry);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, fn: Listener["fn"], capture = false) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn || l.capture !== capture));
  }
  async fire(type: string, fields: Record<string, unknown> = {}) {
    const path: Element[] = [];
    for (let el: Element | null = this; el; el = el.parentElement) path.push(el);
    const event = { target: this as Element, currentTarget: this as Element, preventDefault() {}, stopPropagation() {}, ...fields };
    for (const el of path) {
      event.currentTarget = el;
      for (const { fn } of [...(el.listeners.get(type) ?? [])]) await fn(event);
    }
  }
  focus() { doc.activeElement = this; }
  setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
  scrollIntoView(options: unknown) { this.scrolls.push(options); }
  scrollTo(options: { top: number }) { this.scrollTop = options.top; }
}

class Storage {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const doc = Object.assign(new Element("document"), {
  body: new Element("body"), documentElement: {}, activeElement: null as Element | null,
  createElement: (tag: string) => new Element(tag),
  getElementById: (id: string): Element | null => doc.querySelector(`#${id}`),
});
doc.appendChild(doc.body);
const globals = globalThis as Record<string, any>;
const storage = new Storage();
Object.assign(globals, {
  document: doc, localStorage: storage, sessionStorage: new Storage(),
  window: { matchMedia: () => ({ matches: false }), innerHeight: 800 },
});
const base = new URL("../../src/http/ui/js/", import.meta.url).href;
const { state, widok, resetState, upsertMessage } = await import(base + "stan.js");
const { renderMain, renderMessages, renderThread, upsertMessageNode, openConversation, openThread } = await import(base + "widok-czat.js");
const { showNewsModal, renderNotificationsMain } = await import(base + "widok-powiadomienia.js");
const { openSearchPalette } = await import(base + "szukaj.js");
const ownMessage = { id: 29, conversationId: 7, actorId: 1, body: "original text", kind: "text", ts: 1, threadId: null };
let serverMessages: any[] = [];
let requests: { method: string; path: string; body: any }[] = [];
let unexpected: string[] = [];
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
const settle = () => new Promise<void>((done) => setImmediate(done));
function get(selector: string) {
  const el = doc.querySelector(selector);
  assert.ok(el, `Missing element: ${selector}`);
  return el;
}

beforeEach((t) => {
  (t as TestContext).mock.timers.enable({ apis: ["setTimeout"] });
  resetState();
  doc.body.innerHTML = '<main id="main"></main>';
  doc.listeners.clear(); doc.activeElement = null;
  storage.data.clear(); requests = []; unexpected = [];
  state.actor = { id: 1, handle: "anna", kind: "human" };
  state.actorsCache = { 1: state.actor };
  state.actorsList = [state.actor]; state.actorsAt = Date.now();
  state.conversations = [{ id: 7, kind: "public", slug: "general" }, { id: 8, kind: "public", slug: "other" }];
  state.memberships = { 7: { conversationId: 7, role: "member" }, 8: { conversationId: 8, role: "member" } };
  state.activeId = 7; state.loaded[7] = true; state.loaded[8] = true;
  state.msgs[7] = [{ ...ownMessage }]; state.msgs[8] = [];
  serverMessages = [{ ...ownMessage }];
  Object.assign(widok, {
    render: renderMain, glowny: renderMain, wiadomosci: renderMessages, wiadomosc: upsertMessageNode,
    watek: renderThread, otworzRozmowe: openConversation, powiadomienia: renderNotificationsMain,
  });
  globals.fetch = async (path: string, options: { method: string; body?: string }) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ method: options.method, path, body });
    if (options.method === "PATCH" && path === "/api/messages/29") {
      const message = { ...ownMessage, body: body.body, editedAt: 2 };
      serverMessages = [message];
      return response({ message });
    }
    if (path === "/api/questions/open") return response({ questions: [] });
    if (path.endsWith("/pins")) return response({ pins: [] });
    if (path === "/api/notifications/read") return response({ ok: true });
    if (path.startsWith("/api/notifications?")) return response({ notifications: [], unread: 0 });
    if (path.startsWith("/api/wiki/search?")) return response({ hits: [] });
    if (path.startsWith("/api/search?")) return response({ messages: serverMessages.filter((m) => m.body.includes("needle")), actors: {} });
    if (/^\/api\/conversations\/7\/messages\?/.test(path)) return response({ messages: serverMessages, actors: {}, reactions: {} });
    if (/^\/api\/conversations\/8\/messages\?/.test(path)) return response({ messages: [], actors: {}, reactions: {} });
    const thread = path.match(/^\/api\/messages\/(\d+)\/thread$/);
    if (thread) return response({ messages: serverMessages.filter((m) => m.id === Number(thread[1]) || m.threadId === Number(thread[1])), actors: {}, reactions: {} });
    unexpected.push(`${options.method} ${path}`);
    throw new Error(`Unexpected request: ${options.method} ${path}`);
  };
});
afterEach(() => { assert.deepEqual(unexpected, []); });

for (const closeBy of ["button", "backdrop", "Escape"]) {
  test(`B-MG-43: news closed by ${closeBy} releases listeners and advances the queue once`, async () => {
    const baseline = doc.listeners.get("keydown")?.length ?? 0;
    let finished = 0;
    for (let i = 0; i < 3; i++) {
      showNewsModal({ text: "News" }, () => { finished++; });
      if (closeBy === "button") await get("#news-ok").fire("click");
      else if (closeBy === "backdrop") await get(".overlay").fire("click");
      else await doc.fire("keydown", { key: "Escape" });
      assert.equal(doc.querySelector(".overlay"), null);
      assert.equal(finished, i + 1);
      assert.equal(doc.listeners.get("keydown")?.length ?? 0, baseline, "closed news must release document listeners");
    }
    await doc.fire("keydown", { key: "Escape" });
    assert.equal(finished, 3);
  });
}

async function editFromKeyboard() {
  renderMain();
  await get("#composer-input").fire("keydown", { key: "ArrowUp" });
  const editor = get(".inline-edit textarea");
  assert.equal(editor.value, "original text");
  editor.value = "edited text";
  return editor;
}

test("B-MG-58: Enter saves an inline edit and replaces the editor with the new text", async () => {
  const editor = await editFromKeyboard();
  await editor.fire("keydown", { key: "Enter" });
  assert.equal(state.msgs[7][0].body, "edited text");
  assert.equal(state.msgs[7][0].editedAt, 2);
  assert.equal(!!doc.querySelector(".inline-edit"), false, "successful save must close the editor");
  assert.equal(get('[data-text="29"]').textContent, "edited text");
  assert.ok(get('[data-msg="29"] .edited'));
});

test("B-MG-58: Escape cancels an inline edit without restoring it on redraw", async () => {
  const editor = await editFromKeyboard();
  await editor.fire("keydown", { key: "Escape" });
  assert.equal(!!doc.querySelector(".inline-edit"), false, "cancel must close the editor");
  assert.equal(get('[data-text="29"]').textContent, "original text");
  renderMessages();
  assert.equal(doc.querySelector(".inline-edit"), null);
  assert.equal(requests.filter((r) => r.method === "PATCH").length, 0);
});

test("B-MG-58: a failed save preserves the editor and its draft", async () => {
  const editor = await editFromKeyboard();
  globals.fetch = async () => response({ error: "Save failed" }, false);
  await editor.fire("keydown", { key: "Enter" });
  assert.equal(get(".inline-edit textarea"), editor);
  assert.equal(editor.value, "edited text");
  assert.equal(state.msgs[7][0].body, "original text");
});

test("B-MG-58: a live update and a full redraw preserve an unfinished edit", async () => {
  const editor = await editFromKeyboard();
  editor.setSelectionRange(2, 4);
  upsertMessageNode(ownMessage);
  assert.equal(get(".inline-edit textarea"), editor);
  renderMessages();
  assert.equal(get(".inline-edit textarea").value, "edited text");
  assert.equal(get(".inline-edit textarea").selectionStart, 2);
  assert.equal(get(".inline-edit textarea").selectionEnd, 4);
});

for (const value of ["original text", "   "]) {
  test(`B-MG-58: Enter with ${value.trim() ? "unchanged" : "empty"} text closes the editor without saving`, async () => {
    const editor = await editFromKeyboard();
    editor.value = value;
    await editor.fire("keydown", { key: "Enter" });
    assert.equal(!!doc.querySelector(".inline-edit"), false);
    assert.equal(get('[data-text="29"]').textContent, "original text");
    assert.equal(requests.filter((r) => r.method === "PATCH").length, 0);
  });
}

for (const entry of ["notification", "search"]) {
  for (const { threadId, cached } of [{ threadId: 1, cached: false }, { threadId: 1, cached: true }, { threadId: null, cached: false }]) {
    test(`B-MG-59: ${entry} highlights a ${threadId ? "thread reply in its panel" : "top-level message in the main list"}${cached ? " with an uncached root" : ""}`, async (t) => {
      const root = { ...ownMessage, id: 1, body: "thread root" };
      const target = { ...ownMessage, id: 25, body: "needle reply", threadId };
      serverMessages = [root, target];
      state.msgs[7] = cached ? [target] : [];
      state.activeId = 8;
      if (entry === "notification") {
        state.view = "notifications";
        state.notifications = [{ id: 4, kind: "mention", from: "bob", conversationId: 7, messageId: 25, excerpt: "needle reply", createdAt: 1, readAt: 1 }];
        renderNotificationsMain();
        await get('[data-notif="4"]').fire("click");
      } else {
        renderMain();
        openSearchPalette();
        get("#pal-input").value = "needle";
        await get("#pal-input").fire("input");
        t.mock.timers.tick(250);
        await settle();
        assert.match(get(".pal-row").textContent, /needle reply/);
        await get(".pal-row").fire("click");
      }
      await settle();
      assert.equal(state.activeId, 7);
      assert.equal(state.view, "chat");
      assert.equal(state.threadOpen, threadId, "reply links must open their thread root");
      const message = get(`${threadId ? "#th-msgs" : "#messages"} [data-msg="25"]`);
      assert.ok(message.classList.contains("flash"), "the destination must be highlighted");
      assert.deepEqual(message.scrolls, [{ block: "center", behavior: "auto" }]);
      assert.match(message.textContent, /needle reply/);
      if (threadId) {
        assert.equal(doc.querySelector('#messages [data-msg="25"]'), null);
        assert.match(get('#th-msgs [data-msg="1"]').textContent, /thread root/);
      }
      else assert.equal(doc.querySelector("#thread-slot"), null);
      t.mock.timers.tick(1600);
      assert.equal(message.classList.contains("flash"), false);
    });
  }
}

test("B-MG-59: a delayed destination refresh cannot open a thread after leaving its conversation", async () => {
  const target = { ...ownMessage, id: 25, body: "needle reply", threadId: 1 };
  state.msgs[7] = [target];
  serverMessages = [{ ...ownMessage, id: 1 }, target];
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => { release = resolve; });
  const fetch = globals.fetch;
  globals.fetch = (path: string, options: any) => path === "/api/conversations/7/pins" ? pending : fetch(path, options);
  const opening = openConversation(7, 25);
  await settle();
  await openConversation(8);
  release(response({ pins: [] }));
  await opening;
  assert.equal(state.activeId, 8);
  assert.equal(state.threadOpen, null);
  assert.equal(!!doc.querySelector("#thread-slot"), false);
});

test("B-MG-59: a delayed thread response cannot replace a newer thread destination", async () => {
  const first = { ...ownMessage, id: 25, body: "first reply", threadId: 1 };
  const second = { ...ownMessage, id: 26, body: "second reply", threadId: 2 };
  const roots = [{ ...ownMessage, id: 1 }, { ...ownMessage, id: 2 }];
  state.msgs[7] = [...roots, first, second];
  serverMessages = [...roots, first, second];
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => { release = resolve; });
  const fetch = globals.fetch;
  globals.fetch = (path: string, options: any) => path === "/api/messages/1/thread" ? pending : fetch(path, options);
  const opening = openConversation(7, 25);
  await settle();
  assert.equal(state.threadOpen, 1);
  await openThread(2);
  release(response({ messages: [roots[0], first], actors: {}, reactions: {} }));
  await opening;
  assert.equal(state.threadOpen, 2);
  assert.deepEqual(state.threadMsgs.map((message: any) => message.id), [2, 26]);
  assert.equal(!!doc.querySelector('#th-msgs [data-msg="25"]'), false, "old reply must not appear under the newer root");
  assert.match(get('#th-msgs [data-msg="26"]').textContent, /second reply/);
});

test("B-MG-58: a save completing after a list redraw closes the restored editor", async () => {
  const editor = await editFromKeyboard();
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => { release = resolve; });
  globals.fetch = () => pending;
  const saving = editor.fire("keydown", { key: "Enter" });
  renderMessages();
  assert.ok(get(".inline-edit textarea") !== editor);
  release(response({ message: { ...ownMessage, body: "edited text", editedAt: 2 } }));
  await saving;
  assert.equal(!!doc.querySelector(".inline-edit"), false);
  assert.equal(get('[data-text="29"]').textContent, "edited text");
});
