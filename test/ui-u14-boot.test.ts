/**
 * T-MG-3 fix U14 (boot): a deep link to a missing message as the FIRST page after sign-in.
 *
 * Live finding: the first batch (`?limit=30`) answered in 1 ms, but the focus fetch
 * (`?before=<id+1>`) sat in the browser's per-host connection queue behind requests a torn-down
 * page had left open (up to Node's 60 s headers timeout), and openConversation drew nothing
 * until that fetch returned: the channel stayed a skeleton although its messages were already in
 * the state. Two rules fix the cause:
 *   1. the newest batch is drawn as soon as it lands, before any focus fetch;
 *   2. an id above the newest loaded message needs no fetch at all: the first batch holds the
 *      newest messages, so a higher id cannot exist here - the toast and the address rewrite
 *      happen at once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

type El = Record<string, any>;
type Call = { method: string; path: string };

function stubBrowser() {
  const el = (): El => ({
    innerHTML: "", textContent: "", value: "", className: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    disabled: false, checked: false, selectionStart: 0, selectionEnd: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {}, setSelectionRange() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    dispatchEvent() {},
  });
  const els = new Map<string, El>();
  const created: El[] = [];
  const byId = (id: string) => { if (!els.has(id)) els.set(id, el()); return els.get(id)!; };
  const g = globalThis as Record<string, any>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: byId, createElement: () => {
      const e = el(); const kids = new Map<string, El>();
      e.querySelector = (sel: string) => { if (!kids.has(sel)) kids.set(sel, el()); return kids.get(sel); };
      created.push(e); return e;
    }, createTextNode: () => el(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1440, innerHeight: 900, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.history = { pushState() {}, replaceState() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem(k: string, v: string) { store.set(k, v); }, removeItem(k: string) { store.delete(k); } };
  g.HTMLImageElement = class {};
  g.Event = class { type: string; constructor(type: string) { this.type = type; } };
  g.EventSource = class { close() {} addEventListener() {} };
  g.requestAnimationFrame = (fn: () => void) => { fn(); return 1; };
  const calls: Call[] = [];
  let router: (c: Call) => any = () => ({});
  g.fetch = async (path: string, init: any) => {
    const call = { method: init?.method ?? "GET", path };
    calls.push(call);
    const out = await router(call);
    return { ok: true, status: 200, json: async () => out, text: async () => "" };
  };
  return { els, created, calls, route: (fn: (c: Call) => any) => { router = fn; } };
}

/** A boot: nothing loaded yet, the address bar holds the deep link. */
async function bootChat(hash: string) {
  const browser = stubBrowser();
  (globalThis as any).location.hash = hash;
  const { state, rebuildMentionRe } = await import(UI + "state.js");
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const chat = await import(UI + "view-chat.js");
  const s = state as Record<string, any>;
  s.actor = { id: 1, handle: "michal", kind: "human" };
  rebuildMentionRe();
  s.view = "chat";
  s.conversations = [{ id: 1, slug: "general", kind: "public" }];
  s.memberships = { 1: { lastReadMessageId: 0 } };
  s.activeId = null;
  s.actorsCache = { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" } };
  s.msgs = {};
  s.loaded = {};
  s.hasMore = {};
  s.loadingConv = false;
  s.openQuestions = {};
  s.convPins = [];
  s.convMembers = [];
  s.convMembersFor = null;
  s.online = true;
  s.threadOpen = null;
  s.threadMsgs = [];
  s.pending = {};
  s.drafts = {};
  s.presence = [];
  s.readMark = {};
  return { ...browser, state: s, chat };
}

const newest = { id: 10, conversationId: 1, actorId: 2, body: "newest", ts: 1, kind: "text" };
const toasts = (created: El[]) => created.filter((e) => e.className === "toast");
const tick = () => new Promise((r) => setTimeout(r, 10));
const never = () => new Promise<never>(() => {});

test("U14 boot: an id above the newest message needs no focus fetch - the channel, the toast and the address come at once", async () => {
  const { els, state, chat, route, calls, created } = await bootChat("#/c/general/m/999999");
  route((c) => {
    if (c.path.includes("before=")) return never();            // the stalled connection queue
    return { messages: [newest], actors: [], reactions: [], pins: [], questions: [] };
  });
  await chat.openConversation(1, 999999);                      // must resolve despite the stall
  assert.equal(state.loadingConv, false);
  assert.doesNotMatch(els.get("messages")!.innerHTML, /skeleton/);
  assert.match(els.get("messages")!.innerHTML, /data-msg="10"/, "the newest messages are drawn");
  assert.equal(calls.filter((c) => c.path.includes("before=")).length, 0, "no focus fetch for an id above the newest");
  assert.equal(toasts(created).length, 1, "one toast");
  assert.equal(toasts(created)[0].querySelector(".tmsg").textContent, "That message is gone or you cannot see it.");
  assert.equal((globalThis as any).location.hash, "#/c/general", "the address drops /m/<id>");
});

test("U14 boot: an id below the newest draws the loaded batch BEFORE the focus fetch answers", async () => {
  const { els, state, chat, route, calls } = await bootChat("#/c/general/m/5");
  route((c) => {
    if (c.path.includes("before=")) return never();            // the stalled connection queue
    return { messages: [newest], actors: [], reactions: [], pins: [], questions: [] };
  });
  const opening = chat.openConversation(1, 5);                 // stays pending: the focus fetch never lands
  await tick();
  assert.equal(calls.filter((c) => c.path.includes("before=6")).length, 1, "the focus fetch was asked (5 is older than the batch)");
  assert.equal(state.loadingConv, false, "the skeleton flag is off once the batch landed");
  assert.doesNotMatch(els.get("messages")!.innerHTML, /skeleton/);
  assert.match(els.get("messages")!.innerHTML, /data-msg="10"/, "the newest messages are on screen while the focus fetch waits");
  void opening;
});
