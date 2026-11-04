/**
 * T-MG-3 fix round 4 (D-MG-26), UX review round 2 (review-r4.json):
 *  U1   "keep pinned": a list that was at the bottom before a layout change (thread panel, dock
 *       growth, a failed message's "Send again" row) is scrolled to the bottom after it; a list
 *       the user had scrolled up is left alone;
 *  U30  a slug unknown to the loaded list is looked up on the server once before "no access";
 *  U31  the thread box collapses the secondary formatting tools behind "More formatting";
 *  U33  open-question cards show the question without markdown and say what a click does;
 *  U34  the "+" menu uses the ActionList layout (icon, label, description below);
 *  9    the Threads view's "seen" marks live per actor;
 *  10   a same-account switch during a thread send still sends the "also to the channel" copy.
 * Browser boundaries only (the r3 pattern): the production modules run unchanged.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class ClassList {
  set = new Set<string>();
  add(...names: string[]) { for (const n of names) this.set.add(n); }
  remove(...names: string[]) { for (const n of names) this.set.delete(n); }
  toggle(name: string, force?: boolean) {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name); else this.set.delete(name);
    return on;
  }
  contains(name: string) { return this.set.has(name); }
}

class ElementStub {
  id = "";
  value = "";
  checked = false;
  textContent = "";
  className = "";
  style: Record<string, Any> = { setProperty: (k: string, v: string) => { this.style[k] = v; } };
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>();
  classList = new ClassList();
  scrollHeight = 100;
  scrollTop = 0;
  clientHeight = 100;
  offsetHeight = 40;
  offsetWidth = 200;
  disabled = false;
  selectionStart = 0;
  selectionEnd = 0;
  scrolledTo: Any[] = [];
  listeners = new Map<string, Set<(event: Any) => Any>>();
  children = new Map<string, ElementStub>();
  markup = "";
  parent: ElementStub | null = null;
  get parentElement() { return this.parent; }
  get innerHTML() { return this.markup; }
  set innerHTML(html: string) {
    for (const [id, child] of this.children) if (elements.get(id) === child) elements.delete(id);
    this.children.clear();
    this.markup = html;
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
      const child = new ElementStub();
      child.id = match[1];
      child.parent = this;
      this.children.set(match[1], child);
      elements.set(match[1], child);
    }
  }
  get isConnected() { return elements.get(this.id) === this || overlays.includes(this); }
  addEventListener(type: string, fn: (event: Any) => Any) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: Any) => Any) { this.listeners.get(type)?.delete(fn); }
  async fire(type: string, fields: Record<string, unknown> = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, ...fields };
    for (const fn of [...(this.listeners.get(type) || [])]) await fn(event);
  }
  dispatchEvent(event: { type: string }) { void this.fire(event.type); }
  querySelector(selector: string): ElementStub | null {
    if (selector.startsWith("#")) return elements.get(selector.slice(1)) ?? null;
    if (selector === ".modal") return this;   // openModal reads the dialog out of its overlay
    return null;
  }
  querySelectorAll() { return []; }
  closest() { return null; }
  contains() { return false; }
  appendChild(child: ElementStub) { child.parent = this; if (child.id) elements.set(child.id, child); else overlays.push(child); }
  remove() { overlays = overlays.filter((entry) => entry !== this); }
  focus() { doc.activeElement = this; }
  blur() {}
  scrollTo(o: Any) { this.scrolledTo.push(o); this.scrollTop = typeof o === "object" ? o.top : o; }
  scrollIntoView() {}
  setSelectionRange() {}
  setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  getBoundingClientRect() { return { top: 500, left: 20, bottom: 540, right: 60, width: 40, height: this.offsetHeight }; }
}

class StorageStub {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
}

/** ResizeObserver stub: every instance is recorded so a test can fire its callback. */
const observers: { cb: () => void; targets: ElementStub[] }[] = [];
class ResizeObserverStub {
  entry: { cb: () => void; targets: ElementStub[] };
  constructor(cb: () => void) { this.entry = { cb, targets: [] }; observers.push(this.entry); }
  observe(el: ElementStub) { this.entry.targets.push(el); }
  disconnect() {}
}

let elements = new Map<string, ElementStub>();
let overlays: ElementStub[] = [];
const doc = Object.assign(new ElementStub(), {
  title: "", documentElement: new ElementStub(), body: new ElementStub(), head: new ElementStub(), visibilityState: "hidden",
  activeElement: null as ElementStub | null,
  getElementById: (id: string) => elements.get(id) ?? null,
  createElement: () => new ElementStub(), createTextNode: () => new ElementStub(), contains: () => true,
});
const storage = new StorageStub();
const session = new StorageStub();
const globals = globalThis as Record<string, Any>;
Object.assign(globals, {
  document: doc, localStorage: storage, sessionStorage: session,
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {}, innerHeight: 800, innerWidth: 1200 },
  location: { origin: "https://test.local", href: "https://test.local/", hash: "" },
  EventSource: class { static CLOSED = 2; close() {} addEventListener() {} },
  Event: class { type: string; constructor(type: string) { this.type = type; } },
  ResizeObserver: ResizeObserverStub,
  URL: Object.assign(URL, { revokeObjectURL() {} }),
});
const base = new URL("../src/http/ui/js/", import.meta.url).href;
const i18n = await import(base + "i18n.js");
i18n.setLang("en");
const api = await import(base + "api.js");
const model = await import(base + "state.js");
const dom = await import(base + "dom.js");
const data = await import(base + "data.js");
const composer = await import(base + "composer.js");
const commands = await import(base + "commands.js");
const chat = await import(base + "view-chat.js");
const { state, views } = model;
const initial = structuredClone(state);
const initialViews = { ...views };

const A = { id: 1, handle: "alice", kind: "human" };
const B = { id: 2, handle: "bob", kind: "human" };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((done) => setImmediate(done)); };
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const CSS = readFileSync(new URL("../src/http/ui/app.css", import.meta.url), "utf8");
const VIEW_THREADS = readFileSync(new URL("../src/http/ui/js/view-threads.js", import.meta.url), "utf8");

function recordFetch() {
  const calls: { url: string; method: string; body: Any }[] = [];
  const held: { url: string; release: (data: unknown) => void }[] = [];
  let reply = (url: string, body: Any): unknown => ({ message: { id: 100 + calls.length, conversationId: 5, actorId: 1, kind: "text", ts: 1, ...body } });
  let hold: (url: string, n: number) => boolean = () => false;
  globals.fetch = (url: string, init: Any = {}) => {
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method || "GET", body });
    const data = reply(url, body);
    if (hold(url, calls.length)) return new Promise((done) => held.push({ url, release: (d) => done(ok(d ?? data)) }));
    return Promise.resolve(ok(data));
  };
  return { calls, held, setHold(fn: typeof hold) { hold = fn; }, setReply(fn: typeof reply) { reply = fn; } };
}

/** The message list at a given reading position. */
function listAt(scrollTop: number, scrollHeight = 1000, clientHeight = 500) {
  const el = new ElementStub();
  el.id = "messages";
  el.scrollHeight = scrollHeight; el.clientHeight = clientHeight; el.scrollTop = scrollTop;
  elements.set("messages", el);
  return el;
}

beforeEach(() => {
  Object.assign(state, structuredClone(initial));
  Object.assign(views, initialViews);
  views.render = () => {};
  views.message = () => {};
  views.messages = () => {};
  views.scrollToBottom = () => {};
  views.conversationRow = () => {};
  state.actor = A;
  state.view = "chat";
  state.conversations = [{ id: 5, kind: "public", slug: "general" }, { id: 6, kind: "public", slug: "random" }];
  state.memberships = { 5: { conversationId: 5 }, 6: { conversationId: 6 } };
  state.actorsCache = { 1: A, 2: B };
  state.actorsAt = Date.now();
  state.loaded[5] = true; state.loaded[6] = true;
  state.msgs[5] = [{ id: 9, conversationId: 5, actorId: 1, body: "root of A", kind: "text", ts: 1, threadId: null }];
  state.msgs[6] = [{ id: 11, conversationId: 6, actorId: 2, body: "root of B", kind: "text", ts: 1, threadId: null }];
  elements = new Map(); overlays = []; observers.length = 0;
  doc.listeners.clear(); doc.activeElement = null;
  storage.data.clear(); session.data.clear();
  api.setCsrf("csrf");
});

// ------------------------------------------------------------------ U1
test("U1: a list at the bottom before a layout change is scrolled to the bottom after it", () => {
  const el = listAt(500);                 // 1000 - 500 - 500 = 0: at the bottom
  dom.notePinned();
  el.scrollHeight = 1044;                 // the thread panel narrowed the column: the content grew
  dom.repinIfPinned();
  assert.equal(el.scrolledTo.length, 1);
  assert.equal(el.scrolledTo[0].top, 1044);
});

test("U1: a list the user scrolled up is never yanked", () => {
  const el = listAt(120);
  dom.notePinned();
  el.scrollHeight = 1100;
  dom.repinIfPinned();
  assert.equal(el.scrolledTo.length, 0);
});

test("U1: the dock observer writes --dock-h and re-pins a pinned list", () => {
  const el = listAt(500);
  dom.notePinned();
  const main = new ElementStub(); main.id = "main"; elements.set("main", main);
  const dock = new ElementStub(); dock.offsetHeight = 112; main.appendChild(dock);
  dom.watchDockHeight(dock);
  assert.equal(observers.length, 1, "one ResizeObserver on the dock");
  el.scrollHeight = 1032;                 // the padding followed the dock
  observers[0].cb();
  assert.equal(main.style["--dock-h"], "112px");
  assert.equal(el.scrolledTo.at(-1)?.top, 1032);
});

test("U1: the list observer re-pins when the list itself is resized (panel open/close, viewport)", () => {
  const el = listAt(500);
  dom.watchListPin(el);
  assert.equal(observers.length, 1, "one ResizeObserver on the list");
  el.scrollHeight = 1200;
  observers[0].cb();
  assert.equal(el.scrolledTo.at(-1)?.top, 1200);
  // Observing twice does not stack observers.
  dom.watchListPin(el);
  assert.equal(observers.length, 1);
});

// ------------------------------------------------------------------ U30 (client)
test("U30: an unknown slug is looked up on the server once before it counts as missing", async () => {
  const net = recordFetch();
  net.setReply(() => ({ conversations: [...state.conversations, { id: 7, kind: "public", slug: "ux-fresh" }], memberships: [], unread: [] }));
  const found = await data.conversationBySlug("ux-fresh");
  assert.equal(found?.id, 7);
  assert.equal(net.calls.filter((c) => c.url.endsWith("/api/conversations")).length, 1, "one refresh of the list");
  // A known slug needs no request.
  const known = await data.conversationBySlug("general");
  assert.equal(known?.id, 5);
  assert.equal(net.calls.length, 1);
});

test("U30: a slug the server does not know either resolves to null after one request", async () => {
  const net = recordFetch();
  net.setReply(() => ({ conversations: state.conversations, memberships: [], unread: [] }));
  assert.equal(await data.conversationBySlug("nope"), null);
  assert.equal(net.calls.length, 1);
});

// ------------------------------------------------------------------ U31
test("U31: the compact (thread) card hides the secondary tools behind a 'More formatting' toggle", () => {
  const html = composer.composerCardHtml({ prefix: "th", label: "Reply", placeholder: "Reply...", compact: true });
  for (const id of ["strike", "codeblock", "list", "quote"]) {
    assert.match(html, new RegExp(`data-fmt="${id}"[^>]*data-secondary`), `${id} is secondary`);
  }
  for (const id of ["bold", "italic", "code", "link"]) {
    assert.doesNotMatch(html, new RegExp(`data-fmt="${id}"[^>]*data-secondary`), `${id} stays visible`);
  }
  assert.match(html, /id="th-fmt-more"[^>]*aria-expanded="false"/);
  assert.match(html, /class="card compact"/);
  const main = composer.composerCardHtml({ prefix: "composer", label: "Msg", placeholder: "...", files: true });
  assert.doesNotMatch(main, /fmt-more/, "the main box keeps every tool visible");
  assert.doesNotMatch(main, /data-secondary/);
});

test("U31: the toggle opens and closes the secondary group (class on the card, aria-expanded)", async () => {
  const card = new ElementStub(); card.id = "th-card";
  card.innerHTML = composer.composerCardHtml({ prefix: "th", label: "Reply", placeholder: "Reply...", compact: true });
  elements.set("th-card", card);
  const ta = elements.get("th-input")!;
  composer.bindFormatting(ta, card);
  const more = elements.get("th-fmt-more")!;
  await more.fire("click");
  assert.ok(card.classList.contains("fmt-open"));
  assert.equal(more.getAttribute("aria-expanded"), "true");
  await more.fire("click");
  assert.ok(!card.classList.contains("fmt-open"));
  assert.equal(more.getAttribute("aria-expanded"), "false");
});

// ------------------------------------------------------------------ U33
test("U33: open-question cards strip markdown and say 'Go to the question'", async () => {
  const net = recordFetch();
  net.setReply(() => ({ questions: [{ message: { id: 42, conversationId: 5, actorId: 2, ts: 1, body: "Is `agenttalks:v0.2.0` out with **flushpackets=on**?" } }] }));
  await chat.openQuestionsPanel();
  const modal = overlays.find((o) => o.markup.includes("qrow"));
  assert.ok(modal, "the modal is open");
  assert.match(modal!.markup, /Is agenttalks:v0\.2\.0 out with flushpackets=on\?/);
  assert.doesNotMatch(modal!.markup, /`agenttalks/);
  assert.match(modal!.markup, /Go to the question/);
  assert.match(modal!.markup, /class="qgo"/);
});

// ------------------------------------------------------------------ U34
test("U34: the + menu items are icon, label, description below (ActionList), like the message menu", () => {
  const anchor = new ElementStub();
  commands.openPlusMenu(anchor, {});
  const pop = overlays.find((o) => o.className.includes("plus-menu"));
  assert.ok(pop, "the menu is open");
  const items = [...pop!.markup.matchAll(/<button[^>]*role="menuitem"[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.match(item, /<span class="mm-i"[^>]*>[\s\S]*<svg/, "a leading icon cell");
    assert.match(item, /<span class="mm-body">[\s\S]*<span class="mm-l">[^<]+<\/span>[\s\S]*<span class="mm-o">/, "label then description in one body column");
    assert.doesNotMatch(item, /<span class="mm-l">[\s\S]*<svg/, "no icon inside the label");
  }
});

// ------------------------------------------------------------------ CSS (U32, U35, U36)
test("U32: the help dialog body keeps a bottom padding and a fade; the footnote sits under a divider", () => {
  assert.match(CSS, /\.gd-body\{[^}]*padding-bottom:[^}]*mask-image:/s);
  assert.match(CSS, /\.gd-body\s*\+\s*\.mhint\{[^}]*border-top:/);
});

test("U35: rail labels have side padding and an ellipsis; the Polish rail is wider on desktop", () => {
  assert.match(CSS, /\.rail-btn \.rail-l\{[^}]*padding:0 var\(--base-size-4\)[^}]*text-overflow:ellipsis/);
  assert.match(CSS, /@media \(min-width:761px\)\{[^}]*:root\[lang="pl"\] \.shell\.with-rail\{grid-template-columns:var\(--base-size-80\)/);
});

test("U36: toasts are centred and never over the header's buttons (r5 U40: under the header, not over the dock)", () => {
  const rules = CSS.match(/\.toast-stack\{[^}]*\}/g)!;
  const desktop = rules.find((r) => r.includes("left:50%"));
  assert.ok(desktop, "a centred rule exists");
  // r4 anchored the stack bottom-centre above the dock; r5 (U40) found it covering the failed
  // message's "Send again" row there and moved it 16 px under the 56 px header. The U36 point
  // (clear of the header's buttons) holds: the stack starts below the header's full height.
  assert.match(desktop!, /top:calc\(var\(--base-size-64\) \+ var\(--base-size-8\)\)/);
  assert.match(desktop!, /bottom:auto/);
  assert.doesNotMatch(desktop!, /top:auto/);
  // No phone rule is needed any more: the tab bar is at the bottom, the stack at the top.
  assert.ok(!rules.some((r) => r.includes("env(safe-area-inset-bottom")));
});

// ------------------------------------------------------------------ 9: threads seen per actor
test("9: the Threads view's seen marks are stored per actor (atalks_threads_seen_<actorId>)", () => {
  model.saveThreadsSeen({ 9: 12 });
  assert.equal(storage.getItem("atalks_threads_seen_1"), JSON.stringify({ 9: 12 }));
  assert.equal(storage.getItem("atalks_threads_seen"), null, "no browser-wide key");
  assert.deepEqual(model.loadThreadsSeen(), { 9: 12 });
  state.actor = B;
  assert.deepEqual(model.loadThreadsSeen(), {}, "another account sees nothing");
  assert.doesNotMatch(VIEW_THREADS, /"atalks_threads_seen"/, "view-threads.js has no bare key");
});

test("9: a pre-r4 browser-wide seen map migrates to the old marker's actor and sign-out clears only that actor's", () => {
  // F4 (r5): only the actor the old owner marker names claims legacy data (no marker: deleted).
  storage.setItem("atalks_owner", "1");
  storage.setItem("atalks_threads_seen", JSON.stringify({ 9: 3 }));
  model.claimLocalData(1);
  assert.equal(storage.getItem("atalks_threads_seen"), null);
  assert.deepEqual(model.loadThreadsSeen(), { 9: 3 });
  state.actor = B; model.saveThreadsSeen({ 11: 5 });
  model.clearLocalAccountData(1);
  assert.equal(storage.getItem("atalks_threads_seen_1"), null);
  assert.equal(storage.getItem("atalks_threads_seen_2"), JSON.stringify({ 11: 5 }));
});

// ------------------------------------------------------------------ 10: same-account switch keeps the copy
function openThreadBox(text: string) {
  state.activeId = 5;
  state.threadOpen = 9;
  state.threadMsgs = [state.msgs[5][0]];
  const slot = new ElementStub(); slot.id = "thread-slot"; elements.set("thread-slot", slot);
  chat.renderThread();
  elements.get("th-input")!.value = text;
  elements.get("th-also")!.checked = true;
  return elements.get("th-send")!;
}

test("10: the same account switching conversation after the reply still sends the channel copy, touches no state of the new place", async () => {
  const net = recordFetch();
  net.setHold((url, n) => n === 1);
  const send = openThreadBox("reply for 9");
  const submitting = send.fire("click");
  await settle();
  state.activeId = 6; state.threadOpen = 11; state.threadMsgs = [state.msgs[6][0]];
  net.held[0].release(undefined);
  await submitting; await settle();
  const posts = net.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2, "both sends left");
  assert.equal(posts[1].url, "/api/conversations/5/messages", "the copy goes to the ORIGINAL conversation");
  assert.equal(posts[1].body.threadId, undefined);
  assert.deepEqual(state.threadMsgs.map((m: Any) => m.id), [11], "the new thread is untouched");
});

test("10: an account change during the first send still makes no second send", async () => {
  const net = recordFetch();
  net.setHold((url, n) => n === 1);
  const send = openThreadBox("A text");
  const submitting = send.fire("click");
  await settle();
  api.newSessionGeneration(); state.actor = B;
  state.activeId = 6; state.threadOpen = 11; state.threadMsgs = [state.msgs[6][0]];
  net.held[0].release(undefined);
  await submitting; await settle();
  assert.equal(net.calls.filter((c) => c.method === "POST").length, 1);
});
