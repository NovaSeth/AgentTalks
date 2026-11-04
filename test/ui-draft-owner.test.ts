/**
 * S7 security: drafts, the last conversation and the recent list are tied to the account that
 * wrote them. A different person signing in next in the same browser never sees them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

function stubStorage() {
  const data: Record<string, string> = {};
  const ls = {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = String(v); },
    removeItem: (k: string) => { delete data[k]; },
    get length() { return Object.keys(data).length; },
    key: (i: number) => Object.keys(data)[i] ?? null,
  };
  return { data, ls };
}

async function setup() {
  const g = globalThis as Record<string, unknown>;
  const ta = { value: "" };
  const el = (): Record<string, unknown> => {
    const e: Record<string, unknown> = { className: "", innerHTML: "", setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {} }, querySelector: () => e };
    Object.defineProperty(e, "textContent", { set() {}, get() { return ""; } });
    return e;
  };
  g.document = {
    documentElement: {}, getElementById: (id: string) => (id === "composer-input" ? ta : null),
    addEventListener() {}, title: "", visibilityState: "visible", createElement: el, body: { appendChild() {} },
  };
  g.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const { data, ls } = stubStorage();
  g.localStorage = ls;
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const store = await import(UI + "state.js");
  const sse = await import(UI + "sse-events.js");
  store.resetState();
  store.state.drafts = {};
  store.views.render = () => {};
  return { ...store, sse, data, ta };
}

/** Account A writes a draft in conversation 5, then the session is lost. */
async function accountAWithLostSession() {
  const s = await setup();
  s.claimLocalData(1);
  s.state.actor = { id: 1, handle: "a" };
  s.state.activeId = 5;
  s.ta.value = "secret of A";
  s.saveDraft();
  s.data["atalks_last_conv"] = "5";
  s.data["atalks_recent"] = "[5]";
  s.data["atalks_wiki_draft_home"] = "wiki text";
  s.sse.onSessionLost();
  return s;
}

test("account B signing in after A's lost session gets none of A's drafts or navigation", async () => {
  const s = await accountAWithLostSession();
  assert.equal(s.state.actor, null);
  assert.equal(s.state.drafts[5]?.text, "secret of A", "kept in memory for A until the next sign-in");
  assert.equal(s.state.draftsOwner, 1);
  s.state.actor = { id: 2, handle: "b" };
  s.claimLocalData(2);
  assert.equal(s.state.drafts[5], undefined);
  assert.equal(s.loadDraft(5), null);
  assert.equal(s.data["atalks_draft_5"], undefined);
  assert.equal(s.data["atalks_last_conv"], undefined);
  assert.equal(s.data["atalks_recent"], undefined);
  assert.equal(s.data["atalks_wiki_draft_home"], undefined);
  assert.equal(s.data["atalks_owner"], "2");
});

test("the same account signing in again gets its draft back", async () => {
  const s = await accountAWithLostSession();
  s.state.actor = { id: 1, handle: "a" };
  s.claimLocalData(1);
  assert.equal(s.loadDraft(5)?.text, "secret of A");
  assert.equal(s.data["atalks_last_conv"], "5");
  assert.equal(s.data["atalks_owner"], "1");
});

test("a legacy draft without an owner marker is kept once and claimed by the first sign-in", async () => {
  const s = await setup();
  s.data["atalks_draft_9"] = "old draft";
  s.claimLocalData(3);
  assert.equal(s.data["atalks_draft_9"], "old draft");
  assert.equal(s.data["atalks_owner"], "3");
  s.claimLocalData(4);
  assert.equal(s.data["atalks_draft_9"], undefined, "once claimed, another account does not inherit it");
});

test("saveDraft never stores a draft without an owner", async () => {
  const s = await setup();
  s.state.actor = { id: 7, handle: "g" };
  s.state.activeId = 2;
  s.ta.value = "x";
  s.saveDraft();
  assert.equal(s.data["atalks_owner"], "7");
});

test("session resume and login paths claim the local data", async () => {
  const s = await accountAWithLostSession();
  const api = await import(UI + "api.js");
  const login = await import(UI + "view-login.js");
  api.setCsrf("t");
  (globalThis as Record<string, unknown>).sessionStorage = { getItem: () => "b", setItem() {}, removeItem() {} };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ actor: { id: 2, handle: "b" }, conversations: [], unread: [] }), { status: 200 })) as typeof fetch;
  try {
    assert.equal(await login.tryRestoreSession(), true);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(s.state.actor.id, 2);
  assert.equal(s.state.drafts[5], undefined);
  assert.equal(s.data["atalks_draft_5"], undefined);
  assert.equal(s.data["atalks_owner"], "2");
});
