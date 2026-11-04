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
const { state, views, resetState } = await import(base + "state.js");
const { renderMain, renderMessages, renderThread, upsertMessageNode, openConversation, openThread } = await import(base + "view-chat.js");
const msg = (id: number, threadId: number | null, body: string) =>
  ({ id, conversationId: 7, actorId: 1, body, kind: "text", ts: 1, threadId });
const response = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
const settle = () => new Promise<void>((done) => setImmediate(done));
function get(selector: string) {
  const el = doc.querySelector(selector);
  assert.ok(el, `Missing element: ${selector}`);
  return el;
}
const roots = [msg(90, null, "root ninety"), msg(91, null, "root ninety-one")];
let posts: { path: string; body: any }[] = [];
let release!: (value: unknown) => void;
let unexpected: string[] = [];

beforeEach((t) => {
  (t as TestContext).mock.timers.enable({ apis: ["setTimeout"] });
  resetState();
  doc.body.innerHTML = '<main id="main"></main>';
  doc.listeners.clear(); doc.activeElement = null;
  posts = []; unexpected = [];
  state.actor = { id: 1, handle: "anna", kind: "human" };
  state.actorsCache = { 1: state.actor };
  state.actorsList = [state.actor]; state.actorsAt = Date.now();
  state.conversations = [{ id: 7, kind: "public", slug: "general" }];
  state.memberships = { 7: { conversationId: 7, role: "member" } };
  state.activeId = 7; state.loaded[7] = true;
  state.msgs[7] = roots.map((m) => ({ ...m }));
  Object.assign(views, {
    render: renderMain, main: renderMain, messages: renderMessages, message: upsertMessageNode,
    thread: renderThread, openConversation: openConversation,
  });
  globals.fetch = async (path: string, options: { method: string; body?: string }) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    if (options.method === "POST" && path === "/api/conversations/7/messages") {
      posts.push({ path, body });
      return new Promise((resolve) => {
        release = () => resolve(response({ message: msg(200, body.threadId, body.body) }));
      });
    }
    if (path.endsWith("/pins")) return response({ pins: [] });
    const thread = path.match(/^\/api\/messages\/(\d+)\/thread$/);
    if (thread) return response({ messages: roots.filter((m) => m.id === Number(thread[1])), actors: {}, reactions: {} });
    unexpected.push(`${options.method} ${path}`);
    throw new Error(`Unexpected request: ${options.method} ${path}`);
  };
});
afterEach(() => { assert.deepEqual(unexpected, []); });

async function sendInThread(text: string) {
  renderMain();
  await openThread(90);
  const input = get("#th-input");
  input.value = text;
  return get("#th-send").fire("click");
}

test("B-MG-101: a thread reply resolving after switching threads is not inserted into the new thread", async () => {
  const sending = sendInThread("late reply");
  await settle();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.threadId, 90);
  await openThread(91);
  const before = state.threadMsgs.map((m: any) => m.id);
  release(null);
  await sending;
  await settle();
  assert.equal(state.threadOpen, 91);
  assert.deepEqual(state.threadMsgs.map((m: any) => m.id), before);
  assert.equal(doc.querySelector('#th-msgs [data-msg="200"]'), null, "reply must not appear under thread 91");
  assert.ok(state.msgs[7].some((m: any) => m.id === 200 && m.threadId === 90), "reply is stored for root 90");
});

test("B-MG-101: closing the panel during a thread send neither throws nor inserts anything", async () => {
  const sending = sendInThread("late reply");
  await settle();
  doc.querySelector("#th-close")!.fire("click");
  assert.equal(state.threadOpen, null);
  release(null);
  await sending;
  await settle();
  assert.equal(state.threadOpen, null);
  assert.equal(doc.querySelector("#thread-slot"), null);
  assert.equal(doc.querySelector('[data-msg="200"]'), null);
  assert.ok(state.msgs[7].some((m: any) => m.id === 200 && m.threadId === 90));
});

test("B-MG-101: a thread reply resolving while the same thread is open is shown", async () => {
  const sending = sendInThread("on time");
  await settle();
  release(null);
  await sending;
  await settle();
  assert.equal(state.threadOpen, 90);
  assert.match(get('#th-msgs [data-msg="200"]').textContent, /on time/);
});
