/**
 * T-MG-3 fix round 1a: account isolation and message safety.
 *  F1   an in-flight answer from account A never lands in account B's view (session generation);
 *  F2   overlays mounted outside #app (secret dialogs, menus, pickers, toasts) close on teardown;
 *  F3   a 401 during a send keeps the message for the same account, never for another one;
 *  W3-S4-B  an unsent message survives F5 and its fail line is a human sentence.
 * Node, a small DOM stub (body children tracked, document listeners counted).
 */
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
test("F1: an in-flight search answer from account A never reaches account B after a session loss", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  let releaseA: (r: Response) => void = () => {};
  setFetch((path: string) => {
    if (path.startsWith("/api/search")) return new Promise<Response>((r) => { releaseA = r; });
    return Promise.resolve(json({}));
  });
  const pendingA = ui.vsearch.openSearchView("plan");
  await tick();
  ui.sse.onSessionLost();
  await signIn(ui, B, setFetch);
  setFetch(async (path: string) => {
    if (path.startsWith("/api/search")) return json({ messages: [{ id: 20, conversationId: 5, actorId: 2, body: "public plan", ts: 2 }], actors: { 2: B } });
    return json({});
  });
  await ui.vsearch.openSearchView("plan");
  releaseA(json({
    messages: [{ id: 10, conversationId: 99, actorId: 1, body: "privateA plan", ts: 9 }],
    actors: { 77: { handle: "secretfriend", kind: "agent" } },
  }));
  await pendingA;
  await tick();
  const main = byId.get("main")!.innerHTML;
  assert.equal(ui.st.state.actor.id, B.id);
  assert.ok(!main.includes("privateA"), "A private message never reaches B view");
  assert.ok(main.includes("public <mark>plan</mark>"), "B sees B own result");
  assert.equal(ui.st.state.actorsCache[77], undefined, "A's actor directory never merges into B's");
});

test("F1: a stale 401 from account A's request does not sign account B out", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  let releaseA: (r: Response) => void = () => {};
  setFetch((path: string) => path === "/api/presence"
    ? new Promise<Response>((r) => { releaseA = r; }) : Promise.resolve(json({})));
  const call = ui.api.api("GET", "/api/presence").catch((e: Any) => e);
  await tick();
  ui.sse.onSessionLost();
  await signIn(ui, B, setFetch);
  releaseA(json({ error: "x", code: "session_invalid" }, 401));
  const err = await call;
  assert.ok(err instanceof Error);
  assert.equal(ui.st.state.actor?.id, B.id, "B stays signed in");
});

// ------------------------------------------------------------------ F2
test("F2: a session loss closes the secret dialog, menus, pickers and old toasts, with their listeners", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  const before = docListeners.get("keydown")?.size ?? 0;
  const m = ui.dom.openModal(`<h2 id="m-title">Token</h2><textarea>at_SECRET_TOKEN</textarea>`);
  m.preventDismiss();                                  // what showSecretOnce does
  ui.composer.openEmojiPicker(new El(), () => {});
  ui.toasts.showToast("A's private toast");
  assert.ok(body.children.length >= 3, "the overlays are mounted outside #app");
  ui.sse.onSessionLost();
  const leftovers = body.children.filter((c) => c !== undefined && c.className !== "toast-stack");
  assert.deepEqual(leftovers.map((c) => c.className), [], "no overlay survives the teardown");
  assert.ok(!m.overlay.isConnected, "the persistent secret dialog is removed");
  const stack = body.children.find((c) => c.className === "toast-stack");
  assert.equal(stack?.children.length ?? 0, 1, "only the 'session ended' toast is shown");
  assert.equal(docListeners.get("keydown")?.size ?? 0, before, "the dialog's keydown listener is gone");
});

test("F2: signing out closes overlays too", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  const m = ui.dom.openModal(`<h2 id="m-title">Token</h2>`, { persistent: true });
  ui.toasts.showToast("A's private toast");
  await ui.login.doLogout();
  assert.ok(!m.overlay.isConnected);
  const stack = body.children.find((c) => c.className === "toast-stack");
  assert.equal(stack?.children.length ?? 0, 0);
});

// ------------------------------------------------------------------ F3
async function sendWith401(ui: Any, setFetch: Any) {
  await signIn(ui, A, setFetch);
  ui.st.state.activeId = 5;
  const ta = byId.get("composer-input") ?? new El();
  byId.set("composer-input", ta);
  ta.value = "the message I typed";
  ui.st.saveDraft();
  ta.value = "";                                       // the composer clears the field before sending
  setFetch(async (path: string) => path.endsWith("/messages")
    ? json({ error: "x", code: "session_invalid" }, 401) : json({}));
  const r = await ui.actions.sendMessage("the message I typed");
  assert.equal(r, null);
  assert.equal(ui.st.state.actor, null, "the session is gone");
}

test("F3: a 401 during a send keeps the message for the same account after sign-in", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await sendWith401(ui, setFetch);
  await signIn(ui, A, setFetch);
  const back = ui.st.visibleMessages(5).filter((m: Any) => m.failed);
  assert.equal(back.length, 1, `the unsent message comes back: ${JSON.stringify(ui.st.state.pending)}`);
  assert.equal(back[0].body, "the message I typed");
  assert.ok(back[0].clientMsgId, "a retry keeps the idempotency key");
});

test("F3: another account never sees the unsent message", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await sendWith401(ui, setFetch);
  await signIn(ui, B, setFetch);
  assert.deepEqual(ui.st.visibleMessages(5), []);
  assert.deepEqual(ui.st.state.pending, {});
  assert.ok(!Object.keys(store).some((k) => k.startsWith("atalks_unsent_")), "nothing of A stays in storage");
  assert.ok(!JSON.stringify(store).includes("the message I typed"));
});

// ------------------------------------------------------------------ W3-S4-B
test("W3-S4-B: offline, a send fails with a human sentence and the message survives F5", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  ui.st.state.activeId = 5;
  const ta = new El();
  byId.set("composer-input", ta);
  setFetch(async (path: string) => {
    if (path.endsWith("/messages")) throw new TypeError("Failed to fetch");
    return json({});
  });
  ta.value = "written offline";
  ui.st.saveDraft();
  ta.value = "";
  assert.equal(await ui.actions.sendMessage("written offline"), null);
  const failed = ui.st.state.pending[5][0];
  assert.equal(failed.failed, true);
  assert.equal(failed.error, "No connection to the server. Check your network and try again.");
  // F5: beforeunload saves the (empty) composer, the tab's memory is gone, the session resumes.
  ui.st.saveDraft();
  ui.st.resetState();
  await signIn(ui, A, setFetch);
  const back = ui.st.visibleMessages(5).filter((m: Any) => m.failed);
  assert.equal(back.length, 1, "the unsent message is back after the reload");
  assert.equal(back[0].body, "written offline");
  assert.equal(back[0].error, "No connection to the server. Check your network and try again.");
  // Sending it again succeeds and forgets it for good.
  setFetch(async (path: string) => path.endsWith("/messages")
    ? json({ message: { id: 31, conversationId: 5, actorId: 1, body: "written offline", ts: 3, kind: "text" } }) : json({}));
  ui.actions.retryPending(5, back[0].clientMsgId);
  await tick(); await tick();
  assert.deepEqual(ui.st.state.pending[5], []);
  assert.equal(store["atalks_unsent_5"], undefined);
});

test("F2: a confirmation open at teardown settles as 'no' and drops its Escape listener", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  const before = docListeners.get("keydown")?.size ?? 0;
  const answer = ui.dom.confirmModal({ title: "Delete?" });
  assert.equal(docListeners.get("keydown")?.size, before + 2, "the window's focus trap and the Escape answer");
  ui.dom.closeAccountOverlays();
  assert.equal(await answer, false);
  assert.equal(docListeners.get("keydown")?.size ?? 0, before);
});

test("W3-S4-B: a send in one tab keeps another tab's unsent message in the shared storage", async (t) => {
  const ui = await loadUi();
  freshState(ui);
  const setFetch = useFetch(t);
  await signIn(ui, A, setFetch);
  ui.st.state.activeId = 5;
  store["atalks_unsent_5"] = JSON.stringify([{ clientMsgId: "other-tab-1", body: "from the other tab", threadId: null, ts: 1, error: null }]);
  setFetch(async (path: string) => path.endsWith("/messages")
    ? json({ message: { id: 40, conversationId: 5, actorId: 1, body: "sent here", ts: 4, kind: "text" } }) : json({}));
  assert.ok(await ui.actions.sendMessage("sent here", { conversationId: 5, threadId: null }));
  const left = JSON.parse(store["atalks_unsent_5"] ?? "[]");
  assert.deepEqual(left.map((u: Any) => u.clientMsgId), ["other-tab-1"]);
});
