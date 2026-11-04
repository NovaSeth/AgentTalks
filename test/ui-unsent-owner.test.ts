// T-MG-3 fix 1a-follow-up: every unsent entry carries its owner (two accounts, two tabs, one storage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class El {
  children: El[] = [];
  parentNode: El | null = null;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  innerHTML = "";
  textContent = "";
  value = "";
  className = "";
  hidden = false;
  disabled = false;
  tabIndex = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  offsetParent = null;
  scrollHeight = 0;
  scrollTop = 0;
  clientHeight = 0;
  selectionStart = 0;
  selectionEnd = 0;
  sel = new Map<string, El>();
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  appendChild(c: El) { c.remove(); c.parentNode = this; this.children.push(c); return c; }
  remove() {
    if (!this.parentNode) return;
    const a = this.parentNode.children;
    const i = a.indexOf(this);
    if (i >= 0) a.splice(i, 1);
    this.parentNode = null;
  }
  get isConnected(): boolean { let p: El = this; while (p.parentNode) p = p.parentNode; return p === body; }
  querySelector(s: string) { if (!this.sel.has(s)) this.sel.set(s, new El()); return this.sel.get(s)!; }
  querySelectorAll() { return []; }
  closest(): El { return this.parentNode ?? new El(); }
  contains(x: El) { let p: El | null = x; while (p) { if (p === this) return true; p = p.parentNode; } return false; }
  addEventListener() {} removeEventListener() {} dispatchEvent() {}
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  hasAttribute(k: string) { return k in this.attrs; }
  focus() {} blur() {} select() {} setSelectionRange() {} scrollTo() {} scrollIntoView() {} replaceWith() {}
  replaceChildren() { for (const c of [...this.children]) c.remove(); }
  insertAdjacentHTML() {}
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
}

const body = new El();
const byId = new Map<string, El>();
const docListeners = new Map<string, Set<unknown>>();
const store: Record<string, string> = {};
const session: Record<string, string> = {};

function installBrowser() {
  const g = globalThis as Any;
  g.document = {
    documentElement: new El(), body, head: new El(), title: "", visibilityState: "visible",
    getElementById: (id: string) => { if (!byId.has(id)) byId.set(id, new El()); return byId.get(id); },
    createElement: () => new El(), createTextNode: () => new El(),
    addEventListener: (type: string, fn: unknown) => { if (!docListeners.has(type)) docListeners.set(type, new Set()); docListeners.get(type)!.add(fn); },
    removeEventListener: (type: string, fn: unknown) => { docListeners.get(type)?.delete(fn); },
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; },
    contains: (x: El) => body.contains(x),
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800, visualViewport: null,
    location: { origin: "https://test.local" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.sessionStorage = {
    getItem: (k: string) => (k in session ? session[k] : null),
    setItem: (k: string, v: string) => { session[k] = String(v); },
    removeItem: (k: string) => { delete session[k]; },
  };
  g.localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  g.HTMLImageElement = class {};
  g.Event = class { type: string; constructor(type: string) { this.type = type; } };
  g.EventSource = class { static CLOSED = 2; close() {} addEventListener() {} };
}

installBrowser();

async function loadUi() {
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const api = await import(UI + "api.js");
  const st = await import(UI + "state.js");
  const sse = await import(UI + "sse-events.js");
  const login = await import(UI + "view-login.js");
  const actions = await import(UI + "actions.js");
  const dom = await import(UI + "dom.js");
  const toasts = await import(UI + "toasts.js");
  const vsearch = await import(UI + "view-search.js");
  const composer = await import(UI + "composer.js");
  return { api, st, sse, login, actions, dom, toasts, vsearch, composer };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const tick = () => new Promise((r) => setImmediate(r));

const A = { id: 1, handle: "alice", kind: "human" };
const B = { id: 2, handle: "bob", kind: "human" };

/** Signs `actor` in through the real resume path (tryRestoreSession), as F5 or a login would. */
async function signIn(ui: Any, actor: Any, setFetch: (f: Any) => void) {
  ui.api.setCsrf("csrf-" + actor.handle);
  session["atalks_actor"] = actor.handle;
  setFetch(async (path: string) => {
    if (path === "/api/me") return json({ actor, conversations: [{ id: 5, slug: "general" }], unread: [], memberships: [{ conversationId: 5 }] });
    return json({});
  });
  assert.equal(await ui.login.tryRestoreSession(), true);
  assert.equal(ui.st.state.actor.id, actor.id);
}

function freshState(ui: Any) {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(session)) delete session[k];
  body.replaceChildren();
  byId.clear();
  ui.st.resetState();
  ui.st.state.draftsOwner = null;
  ui.st.views.render = () => {};
  ui.st.views.shell = () => {};
}

function useFetch(t: Any) {
  let impl: Any = async () => json({});
  t.mock.method(globalThis, "fetch", (path: string, init: Any) => impl(path, init));
  return (f: Any) => { impl = f; };
}

// ------------------------------------------------------------------ F1

const seed = (conv: number, list: Any[]) => { store["atalks_unsent_" + conv] = JSON.stringify(list); };
const entry = (id: string, body: string, ownerId?: number) =>
  ({ clientMsgId: id, body, threadId: null, ts: 1, error: null, ...(ownerId === undefined ? {} : { ownerId }) });
const failedBodies = (ui: Any) => ui.st.visibleMessages(5).filter((m: Any) => m.failed).map((m: Any) => m.body);
/** T-MG-16 (F8 r7): one key per message, atalks_unsent_<actor>_<conv>_<clientMsgId>. */
const storedIds = (owner: number, conv: number) => Object.keys(store)
  .filter((k) => k.startsWith(`atalks_unsent_${owner}_${conv}_`)).map((k) => JSON.parse(store[k]).clientMsgId).sort();

test("(a) D-MG-30: a shared list holding A and B entries is deleted; neither account restores from it", async (t) => {
  for (const actor of [A, B] as Any[]) {
    const ui = await loadUi();
    freshState(ui);
    const setFetch = useFetch(t);
    store["atalks_owner"] = String(actor.id);
    seed(5, [entry("m-a", "a-text", 1), entry("m-b", "b-text", 2)]);
    await signIn(ui, actor, setFetch);
    assert.deepEqual(failedBodies(ui), []);
    assert.equal(store["atalks_unsent_5"], undefined, "the legacy list is deleted");
    assert.equal(store["atalks_owner"], undefined);
  }
});

test("(b) B persists after A wrote its own key: A's entry stays A's, is not shown to B", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  store["atalks_unsent_1_5_m-a"] = JSON.stringify(entry("m-a", "a-text"));
  await signIn(ui, B, setFetch);
  assert.deepEqual(failedBodies(ui), []);
  ui.st.state.pending[5] = [{ clientMsgId: "m-b", body: "b-text", ts: 2, failed: true, error: null }];
  ui.st.persistUnsent(5);
  assert.deepEqual(storedIds(1, 5), ["m-a"], "A's entry stays A's, untouched by B's write");
  assert.deepEqual(storedIds(2, 5), ["m-b"], "B's entry only in B's key");
  assert.equal(store["atalks_owner"], undefined, "persistUnsent never writes the owner marker");
  ui.st.state.pending = {};
  ui.st.claimLocalData(2);
  assert.deepEqual(failedBodies(ui), ["b-text"]);
});

test("(b2) persistUnsent leaves the marker alone even when it was never set", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  delete store["atalks_owner"];
  ui.st.state.pending[5] = [{ clientMsgId: "m-a", body: "a-text", ts: 2, failed: true, error: null }];
  ui.st.persistUnsent(5);
  assert.equal(store["atalks_owner"], undefined);
  assert.deepEqual(storedIds(1, 5), ["m-a"], "stored in A's own key (F5 r5)");
  assert.equal(store["atalks_unsent_5"], undefined);
});

test("(c) D-MG-30: a legacy entry without ownerId is deleted, whoever the marker names", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  for (const [marker, actor] of [["1", A], ["2", A], ["1", B]] as Any[]) {
    freshState(ui);
    store["atalks_owner"] = marker;
    seed(5, [entry("old", "legacy-text")]);
    await signIn(ui, actor, setFetch);
    assert.deepEqual(failedBodies(ui), []);
    assert.deepEqual(storedIds(actor.id, 5), []);
    assert.equal(store["atalks_unsent_5"], undefined, "the legacy list is deleted");
  }
});
