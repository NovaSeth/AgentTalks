/**
 * T-MG-16 items 3 and 5:
 *  F9 (codex review-r7, B-MG-110)  a failed send toasts unless its "not sent" row is actually on
 *      screen: the chat view of its conversation, the row in the document and inside the list's
 *      visible box. Leaving for the wiki during the send keeps activeId, but the row is not shown;
 *  B-MG-98  saving (Enter) or cancelling (Escape) an inline edit gives the focus back to the
 *      composer the edit belongs to, so an immediate ArrowUp edits the last message again.
 * The production modules run unchanged (sendMessage, upsertMessageNode, bindMessageEvents) over a
 * small stubbed DOM: the message list keeps the rows it was given, focus is tracked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

type El = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let active: El | null = null;
function el(extra: El = {}): El {
  const e: El = {
    innerHTML: "", textContent: "", value: "", className: "", style: {}, dataset: {}, hidden: false, isConnected: true,
    scrollHeight: 0, scrollTop: 0, clientHeight: 0, selectionStart: 0, selectionEnd: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    listeners: {} as Record<string, ((ev: Any) => unknown)[]>,
    addEventListener(type: string, fn: (ev: Any) => unknown) { (e.listeners[type] ||= []).push(fn); },
    removeEventListener() {}, appendChild() {}, remove() { e.isConnected = false; }, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() { active = e; }, blur() { if (active === e) active = null; }, click() {},
    setSelectionRange() {}, dispatchEvent() {}, insertAdjacentHTML() {}, scrollIntoView() {},
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    ...extra,
  };
  return e;
}

const els = new Map<string, El>();
const created: El[] = [];
const g = globalThis as Record<string, Any>;
g.document = {
  documentElement: {}, body: el(), head: el(), title: "", visibilityState: "visible",
  getElementById: (id: string) => els.get(id) ?? null,
  createElement: () => {
    const e = el(); const kids = new Map<string, El>();
    e.querySelector = (sel: string) => { if (!kids.has(sel)) kids.set(sel, el()); return kids.get(sel); };
    created.push(e); return e;
  },
  createTextNode: () => el(),
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  get activeElement() { return active; }, contains: () => true,
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

/** fetch held until the test answers it. */
let held: { resolve: (r: Any) => void; path: string; method: string }[] = [];
g.fetch = (path: string, init: Any) => new Promise((resolve) => held.push({ resolve, path, method: init?.method ?? "GET" }));
const answer = (status: number, body: Any) => held.shift()!.resolve({ ok: status < 400, status, json: async () => body });

const i18n = await import(UI + "i18n.js");
i18n.setLang("en");
const store = await import(UI + "state.js");
const chat = await import(UI + "view-chat.js");
const actions = await import(UI + "actions.js");
const state = store.state as Record<string, Any>;
store.registerViews({ message: chat.upsertMessageNode, repin: () => {}, scrollToBottom: () => {}, thread: () => {} });

/** The message list: rows by data-msg id, a visible box from 56 to 800 px. */
function messageList() {
  const rows = new Map<string, El>();
  const texts = new Map<string, El>();
  const row = (id: string) => el({ id, getBoundingClientRect: () => ({ top: 700, bottom: 760, left: 0, right: 900, width: 900, height: 60 }) });
  const list = el({
    rows, texts,
    getBoundingClientRect: () => ({ top: 56, bottom: 800, left: 0, right: 900, width: 900, height: 744 }),
    querySelector(sel: string) {
      let m = /^\[data-msg="(.+)"\]$/.exec(sel);
      if (m) return rows.get(m[1]) ?? null;
      if (sel === "[data-msg]") return rows.values().next().value ?? null;
      m = /^\[data-text="(.+)"\]$/.exec(sel);
      if (m) { if (!texts.has(m[1])) texts.set(m[1], textHolder()); return texts.get(m[1]); }
      return null;
    },
    insertAdjacentHTML(_pos: string, html: string) {
      for (const m of html.matchAll(/data-msg="([^"]+)"/g)) if (!rows.has(m[1])) rows.set(m[1], row(m[1]));
    },
  });
  rows.set("10", row("10"));
  return list;
}
/** A [data-text] holder: its edit field is one textarea whose keydown handler the test fires. */
function textHolder() {
  const ta = el({ value: "" });
  return el({ ta, querySelector: (sel: string) => (sel === "textarea" ? ta : null) });
}

function openChat() {
  els.clear(); created.length = 0; held = []; active = null;
  const list = messageList();
  els.set("messages", list);
  els.set("composer-input", el({ id: "composer-input" }));
  Object.assign(state, {
    actor: { id: 1, handle: "michal", kind: "human" }, view: "chat", activeId: 5,
    conversations: [{ id: 5, slug: "general", kind: "public" }], memberships: { 5: { lastReadMessageId: 0 } },
    actorsCache: { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" } },
    msgs: { 5: [{ id: 10, conversationId: 5, actorId: 1, body: "first", ts: 1, kind: "text" }] },
    loaded: { 5: true }, pending: {}, drafts: {}, online: true, threadOpen: null, threadMsgs: [], openQuestions: {},
  });
  store.rebuildMentionRe();
  return list;
}
const toasts = () => created.filter((e) => e.className === "toast").length;
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setImmediate(r)); };

// ------------------------------------------------------------------ F9
test("F9 (codex repro): hold the POST in channel 5, open the wiki, reject with 503: one toast", async () => {
  const list = openChat();
  const sending = actions.sendMessage("hello", { conversationId: 5 });
  await settle();
  assert.equal(held[0]?.method, "POST");
  const rec = state.pending[5][0];
  assert.ok(list.rows.has(rec.id), "the pending row was drawn in the chat");
  // The user opens a wiki page: the main column is redrawn, the list leaves the document.
  state.view = "wiki"; els.delete("messages"); for (const r of list.rows.values()) r.isConnected = false;
  assert.equal(state.activeId, 5, "activeId stays (the U40 condition alone says 'row shown')");
  answer(503, { error: "Service unavailable", code: "unavailable" });
  assert.equal(await sending, null);
  assert.equal(rec.failed, true);
  assert.equal(toasts(), 1, "the failure is told: no failed row is on screen");
});

test("F9 control: the failed row visible in the open chat raises no toast", async () => {
  const list = openChat();
  const sending = actions.sendMessage("hello", { conversationId: 5 });
  await settle();
  answer(503, { error: "Service unavailable", code: "unavailable" });
  assert.equal(await sending, null);
  assert.ok(list.rows.get(state.pending[5][0].id)?.isConnected, "the failed row is on screen");
  assert.equal(toasts(), 0, "the row itself carries the error and Send again");
});

test("F9: a failed row scrolled out of the list's visible box is not 'on screen': one toast", async () => {
  const list = openChat();
  const sending = actions.sendMessage("hello", { conversationId: 5 });
  await settle();
  const row = list.rows.get(state.pending[5][0].id)!;
  row.getBoundingClientRect = () => ({ top: 900, bottom: 960, left: 0, right: 900, width: 900, height: 60 });
  answer(503, { error: "Service unavailable", code: "unavailable" });
  await sending;
  assert.equal(toasts(), 1);
});

test("F9: the chat view of the conversation with the row missing from the list (not drawn): one toast", async () => {
  const list = openChat();
  const sending = actions.sendMessage("hello", { conversationId: 5 });
  await settle();
  list.rows.delete(state.pending[5][0].id);
  list.insertAdjacentHTML = () => {};             // nothing is drawn again
  list.querySelector = ((orig) => (sel: string) => (sel.startsWith("[data-msg=") && sel !== "[data-msg=\"10\"]" ? null : orig(sel)))(list.querySelector);
  answer(503, { error: "Service unavailable", code: "unavailable" });
  await sending;
  assert.equal(toasts(), 1);
});

// ------------------------------------------------------------------ B-MG-98
/** Starts the inline edit of message 10 by the production click path (the pencil button). */
function startEdit(scope: El) {
  chat.bindMessageEvents(scope);
  const button = el({ dataset: { edit: "10" } });
  const target = el({ closest: (sel: string) => (sel === "[data-edit]" ? button : null) });
  for (const fn of scope.listeners.click) fn({ target, preventDefault() {}, stopPropagation() {} });
  const ta = scope.texts.get("10").ta as El;
  assert.equal(active, ta, "the edit field has the focus while editing");
  return ta;
}
const key = (ta: El, k: string) => { for (const fn of ta.listeners.keydown) fn({ key: k, shiftKey: false, preventDefault() {} }); };

test("B-MG-98: Enter saves the inline edit and the focus returns to the composer", async () => {
  const list = openChat();
  const ta = startEdit(list);
  ta.value = "first, fixed";
  key(ta, "Enter");
  await settle();
  assert.equal(held[0]?.method, "PATCH");
  answer(200, { message: { id: 10, conversationId: 5, actorId: 1, body: "first, fixed", ts: 1, kind: "text", editedAt: 2 } });
  await settle();
  assert.equal(active, els.get("composer-input"), "ArrowUp in the composer can edit again at once");
});

test("B-MG-98: Escape cancels the edit and the focus returns to the composer", async () => {
  const list = openChat();
  const ta = startEdit(list);
  key(ta, "Escape");
  assert.equal(active, els.get("composer-input"));
});

test("B-MG-98: Enter with an unchanged text closes the edit and returns the focus too", async () => {
  const list = openChat();
  const ta = startEdit(list);
  ta.value = "first";
  key(ta, "Enter");
  assert.equal(active, els.get("composer-input"));
  assert.equal(held.length, 0, "nothing to save");
});

test("B-MG-98: an edit in the thread panel returns the focus to the thread box", async () => {
  openChat();
  const threadList = messageList();
  threadList.id = "th-msgs";
  els.set("th-msgs", threadList);
  els.set("th-input", el({ id: "th-input" }));
  const ta = startEdit(threadList);
  key(ta, "Escape");
  assert.equal(active, els.get("th-input"));
});

test("B-MG-98: focus moved elsewhere while the save was in flight stays where the user put it", async () => {
  const list = openChat();
  const ta = startEdit(list);
  ta.value = "first, fixed";
  key(ta, "Enter");
  await settle();
  const search = el({ id: "search" });
  search.focus();
  answer(200, { message: { id: 10, conversationId: 5, actorId: 1, body: "first, fixed", ts: 1, kind: "text", editedAt: 2 } });
  await settle();
  assert.equal(active, search, "the composer does not steal the focus back");
});

// ------------------------------------------------------------------ fix round 1 (codex review-r1 F5)
/** The thread slot with the production renderThread: every redraw replaces the elements its HTML
 *  names (th-msgs, th-input, ...), and an element leaving the document loses the focus, as in a
 *  browser (the edit field inside the old th-msgs too). */
function hostify(host: El): El {
  let html = "";
  const owned = new Set<string>();
  const drop = (id: string) => {
    const old = els.get(id);
    if (!old) return;
    old.isConnected = false;
    if (active === old) active = null;
    if (old.texts) for (const h of old.texts.values()) if (active === h.ta) active = null;
    old.dropAll?.();
    els.delete(id);
  };
  host.dropAll = () => { for (const id of owned) drop(id); owned.clear(); };
  Object.defineProperty(host, "innerHTML", {
    get: () => html,
    set(v: string) {
      html = String(v);
      host.dropAll();
      for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
        const id = m[1];
        if (els.has(id) && owned.has(id)) continue;
        const fresh = id === "th-msgs" ? messageList() : hostify(el({ id }));
        fresh.id = id;
        if (id === "th-msgs") fresh.rows.clear();
        els.set(id, fresh); owned.add(id);
      }
    },
  });
  return host;
}
function threadSlot() {
  const slot = hostify(el({ id: "thread-slot" }));
  els.set("thread-slot", slot);
  return slot;
}

test("R1 F5 (codex repro): Enter saves a thread edit, the real thread renderer redraws, the focus is in the new th-input", async () => {
  openChat();
  store.registerViews({ thread: chat.renderThread });
  try {
    Object.assign(state, { threadOpen: 10, threadMsgs: [state.msgs[5][0]] });
    threadSlot();
    chat.renderThread();
    const firstBox = els.get("th-input");
    assert.ok(firstBox, "the thread box was drawn");
    const ta = startEdit(els.get("th-msgs")!);
    ta.value = "thread edit saved";
    key(ta, "Enter");
    await settle();
    assert.equal(held[0]?.method, "PATCH");
    answer(200, { message: { id: 10, conversationId: 5, actorId: 1, body: "thread edit saved", ts: 1, kind: "text", editedAt: 2 } });
    await settle();
    const box = els.get("th-input");
    assert.notEqual(box, firstBox, "the save redrew the thread (the old box left the document)");
    assert.equal(active, box, "the focus is in the thread box that is on screen now");
  } finally {
    store.registerViews({ thread: () => {} });
  }
});

test("R1 F5: Enter saves a main-list edit; the focus lands in the composer that is in the document after the update", async () => {
  const list = openChat();
  const ta = startEdit(list);
  ta.value = "first, fixed";
  key(ta, "Enter");
  await settle();
  // The update redraws the main composer (a new element under the same id).
  const fresh = el({ id: "composer-input" });
  store.registerViews({ message: (m: Any) => { els.set("composer-input", fresh); return chat.upsertMessageNode(m); } });
  try {
    answer(200, { message: { id: 10, conversationId: 5, actorId: 1, body: "first, fixed", ts: 1, kind: "text", editedAt: 2 } });
    await settle();
  } finally { store.registerViews({ message: chat.upsertMessageNode }); }
  assert.equal(active, fresh);
});
