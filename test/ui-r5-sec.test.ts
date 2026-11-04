/**
 * T-MG-3 fix round 5 (D-MG-27), codex review-r5:
 *  F4  the legacy-storage migration claims un-namespaced data ONLY for the actor the old owner
 *      marker names, once; everything unattributed (no marker, or written by an old tab after the
 *      migration ran) is deleted, never handed to whoever signs in next;
 *  F5  unsent messages live in per-actor keys (atalks_unsent_<actorId>_<conv>): a sign-out never
 *      reads or rewrites another account's list, so it cannot drop that account's newer write;
 *  F6  the asynchronous slug lookup of a route opens a conversation (or the no-access screen) only
 *      when neither the navigation nor the session changed while it ran.
 * Browser boundaries only: two tabs are two module instances over one shared localStorage, and
 * applyRoute is the production source from app.js, run with its collaborators recorded.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** localStorage with a hook after every call (an interleaving point for another tab). */
class StorageStub {
  data = new Map<string, string>();
  after: ((op: string, key: string | null) => void) | null = null;
  private tick(op: string, key: string | null) { const fn = this.after; if (fn) fn(op, key); }
  get length() { return this.data.size; }
  key(index: number) { const k = [...this.data.keys()][index] ?? null; this.tick("key", k); return k; }
  getItem(key: string) { const v = this.data.get(key) ?? null; this.tick("getItem", key); return v; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); this.tick("setItem", key); }
  removeItem(key: string) { this.data.delete(key); this.tick("removeItem", key); }
}

const storage = new StorageStub();
const composer = { id: "composer-input", value: "" };
const globals = globalThis as Record<string, Any>;
Object.assign(globals, {
  localStorage: storage,
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    title: "", documentElement: {}, visibilityState: "hidden",
    body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
    getElementById: (id: string) => (id === "composer-input" ? composer : null),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
    createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} }, style: {} }),
  },
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {} },
  location: { origin: "https://test.local", href: "https://test.local/", hash: "" },
});

const base = new URL("../src/http/ui/js/", import.meta.url).href;
const i18n = await import(base + "i18n.js");
i18n.setLang("en");

const A = { id: 1, handle: "alice", kind: "human" };
const B = { id: 2, handle: "bob", kind: "human" };
let tabs = 0;

/** One browser tab signed in as `actor`: its own module instance, the shared localStorage. */
async function tab(actor: Any) {
  const s = await import(base + `state.js?r5tab=${++tabs}`);
  s.state.actor = actor;
  s.claimLocalData(actor.id);
  return s;
}
/** A tab that has not signed in yet (the module is loaded, nothing claimed). */
async function freshTab() { return import(base + `state.js?r5tab=${++tabs}`); }
const unsentBodies = (s: Any, conv = 5) => s.visibleMessages(conv).filter((m: Any) => m.failed).map((m: Any) => m.body);
const atalksKeys = () => [...storage.data.keys()].filter((k) => k.startsWith("atalks_"));

beforeEach(() => { storage.data.clear(); storage.after = null; });

// ------------------------------------------------------------------ F4
test("F4 (codex repro): an old unreloaded tab's wiki draft written after the upgrade is not B's", async () => {
  await tab(A);                                   // tab A upgrades: the migration runs
  // The same tab, still running the pre-r3 code (no reload), autosaves its wiki draft the old way.
  storage.setItem("atalks_wiki_draft_home", JSON.stringify({ title: "Home", body: "A_SYNTHETIC_WIKI_DRAFT" }));
  const b = await tab(B);
  assert.equal(b.loadWikiDraft("home"), null, "B never reads A's late legacy write");
  assert.equal(storage.getItem("atalks_wiki_draft_home"), null, "the late legacy key is quarantined (deleted)");
  assert.equal(storage.getItem("atalks_wiki_draft_2_home"), null, "and not moved into B's namespace");
  const a = await tab(A);
  assert.equal(a.loadWikiDraft("home"), null, "nobody is assigned unattributed data, A included");
});

test("F4: an old tab that rewrites the owner marker after the upgrade gets nothing claimed either", async () => {
  await tab(A);
  storage.setItem("atalks_owner", "1");            // the old code's browser-wide marker, written late
  storage.setItem("atalks_draft_5", "LATE_A");
  storage.setItem("atalks_last_conv", "5");
  storage.setItem("atalks_recent", "[5]");
  storage.setItem("atalks_threads_seen", JSON.stringify({ 9: 3 }));
  storage.setItem("atalks_unsent_5", JSON.stringify([{ clientMsgId: "late", body: "late unsent", ts: 1, ownerId: 1 }]));
  const b = await tab(B);
  assert.equal(b.loadDraft(5), null);
  assert.equal(b.lastConvId(), null);
  assert.deepEqual(b.loadThreadsSeen(), {});
  assert.deepEqual(unsentBodies(b), []);
  const a = await tab(A);
  assert.equal(a.loadDraft(5), null, "written after the migration: dropped, not claimed (not even by the marker's actor)");
  assert.deepEqual(unsentBodies(a), []);
  for (const key of ["atalks_owner", "atalks_draft_5", "atalks_last_conv", "atalks_recent", "atalks_threads_seen", "atalks_unsent_5"]) {
    assert.equal(storage.getItem(key), null, `${key} is gone`);
  }
});

test("F4: on the first run legacy keys with no owner marker are deleted, never given to the first sign-in", async () => {
  storage.setItem("atalks_draft_9", "old draft");
  storage.setItem("atalks_wiki_draft_home", JSON.stringify({ title: "t", body: "old wiki" }));
  storage.setItem("atalks_last_conv", "9");
  storage.setItem("atalks_unsent_9", JSON.stringify([{ clientMsgId: "x", body: "ownerless", ts: 1 }]));
  const c = await tab({ id: 3, handle: "c" });
  assert.equal(c.loadDraft(9), null);
  assert.equal(c.loadWikiDraft("home"), null);
  assert.equal(c.lastConvId(), null);
  assert.deepEqual(unsentBodies(c, 9), []);
  assert.deepEqual(atalksKeys().filter((k) => k !== "atalks_storage_v"), [], "every unattributed key is deleted");
});

test("F4: on the first run the marker's actor gets the legacy data once, and only that actor", async () => {
  storage.setItem("atalks_owner", "1");
  storage.setItem("atalks_draft_5", "LEGACY_A");
  storage.setItem("atalks_unsent_5", JSON.stringify([{ clientMsgId: "old", body: "legacy unsent", ts: 1 }]));
  const b = await tab(B);                          // B signs in first in this browser
  assert.equal(b.loadDraft(5), null);
  assert.deepEqual(unsentBodies(b), []);
  const a = await tab(A);
  assert.equal(a.loadDraft(5)?.text, "LEGACY_A");
  assert.deepEqual(unsentBodies(a), ["legacy unsent"]);
  // A late legacy write after that is not claimed by anyone, A included.
  storage.setItem("atalks_owner", "1");
  storage.setItem("atalks_draft_6", "LATE");
  const a2 = await tab(A);
  assert.equal(a2.loadDraft(6), null);
  assert.equal(a2.loadDraft(5)?.text, "LEGACY_A", "what was claimed stays claimed");
});

test("F4: a marker that is not an actor id claims nothing", async () => {
  storage.setItem("atalks_owner", "null");
  storage.setItem("atalks_draft_5", "?");
  const a = await tab(A);
  assert.equal(a.loadDraft(5), null);
  assert.equal(storage.getItem("atalks_draft_null_5"), null);
  assert.equal(storage.getItem("atalks_draft_5"), null);
});

test("F4: sign-out runs the same sweep (a late legacy key does not survive it)", async () => {
  const a = await tab(A);
  storage.setItem("atalks_draft_5", "LATE");
  a.clearLocalAccountData(1);
  assert.equal(storage.getItem("atalks_draft_5"), null);
});

// ------------------------------------------------------------------ F5
/** A persists a1, B persists b1 in conversation 5 (each in its own tab). */
async function twoAccountsUnsent() {
  const a = await tab(A);
  const b = await tab(B);
  a.state.pending[5] = [{ clientMsgId: "a1", body: "a1", ts: 1, failed: true }]; a.persistUnsent(5);
  b.state.pending[5] = [{ clientMsgId: "b1", body: "b1", ts: 1, failed: true }]; b.persistUnsent(5);
  return { a, b };
}

test("F5 (codex repro): A's sign-out paused mid-way cannot drop B's newer unsent message", async () => {
  // Every interleaving point of A's cleanup: B persists b2 right after A's k-th storage call.
  for (let k = 1; ; k++) {
    storage.data.clear();
    const { a, b } = await twoAccountsUnsent();
    let calls = 0;
    let injected = false;
    storage.after = () => {
      if (injected || ++calls !== k) return;
      injected = true;
      storage.after = null;
      b.state.pending[5].push({ clientMsgId: "b2", body: "b2", ts: 2, failed: true });
      b.persistUnsent(5);
    };
    a.clearLocalAccountData(1);
    storage.after = null;
    if (!injected) break;                         // past A's last storage call: every point tried
    const b2 = await freshTab();
    b2.state.actor = B; b2.claimLocalData(2);
    assert.deepEqual(unsentBodies(b2), ["b1", "b2"], `B keeps b1 and b2 (B wrote after A's storage call #${k})`);
    const a2 = await freshTab();
    a2.state.actor = A; a2.claimLocalData(1);
    assert.deepEqual(unsentBodies(a2), [], `A's sign-out removed A's own (point #${k})`);
  }
});

test("F5: the getItem/setItem interleaving of the review (A reads, B writes, A writes) keeps b2", async () => {
  const { a, b } = await twoAccountsUnsent();
  let paused = false;
  const readByA: string[] = [];
  const bWritesB2 = () => {
    b.state.pending[5].push({ clientMsgId: "b2", body: "b2", ts: 2, failed: true });
    b.persistUnsent(5);
  };
  storage.after = (op, key) => {
    if (paused || op !== "getItem" || !key?.startsWith("atalks_unsent_")) return;
    readByA.push(key);
    paused = true;
    bWritesB2();
  };
  a.clearLocalAccountData(1);
  storage.after = null;
  if (!paused) bWritesB2();                       // A read no unsent list at all: B simply writes next
  assert.deepEqual(readByA.filter((k) => !k.startsWith("atalks_unsent_1_")), [], "A's sign-out reads no other account's list");
  const b2 = await tab(B);
  assert.deepEqual(unsentBodies(b2), ["b1", "b2"]);
});

test("F5: unsent messages are stored per actor; nobody's list holds another account's entry", async () => {
  await twoAccountsUnsent();
  assert.equal(storage.getItem("atalks_unsent_5"), null, "no shared list");
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_1_5")!).map((u: Any) => u.clientMsgId), ["a1"]);
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_2_5")!).map((u: Any) => u.clientMsgId), ["b1"]);
  const b = await tab(B);
  b.clearLocalAccountData(2);
  assert.equal(storage.getItem("atalks_unsent_2_5"), null);
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_1_5")!).map((u: Any) => u.clientMsgId), ["a1"], "A's untouched");
});

test("F5: two tabs of the SAME account keep each other's unsent entries in their shared key", async () => {
  const t1 = await tab(A);
  const t2 = await tab(A);
  t1.state.pending[5] = [{ clientMsgId: "m1", body: "one", ts: 1, failed: true }]; t1.persistUnsent(5);
  t2.state.pending[5] = [{ clientMsgId: "m2", body: "two", ts: 2, failed: true }]; t2.persistUnsent(5);
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_1_5")!).map((u: Any) => u.clientMsgId).sort(), ["m1", "m2"]);
  // t2 sends m2: only m2 leaves the list.
  t2.state.pending[5] = []; t2.persistUnsent(5, ["m2"]);
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_1_5")!).map((u: Any) => u.clientMsgId), ["m1"]);
  t1.state.pending[5] = []; t1.persistUnsent(5, ["m1"]);
  assert.equal(storage.getItem("atalks_unsent_1_5"), null, "an empty list removes the key");
});

test("F5: a shared pre-r5 list is split once into the per-actor keys by each entry's ownerId", async () => {
  storage.setItem("atalks_unsent_5", JSON.stringify([
    { clientMsgId: "m-a", body: "a-text", ts: 1, ownerId: 1 },
    { clientMsgId: "m-b", body: "b-text", ts: 1, ownerId: 2 },
  ]));
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b), ["b-text"]);
  assert.equal(storage.getItem("atalks_unsent_5"), null, "the shared list is gone");
  const a = await tab(A);
  assert.deepEqual(unsentBodies(a), ["a-text"]);
});

test("F5: the session-lost path stores the entries under the account that wrote them", async () => {
  const a = await tab(A);
  a.state.pending[5] = [{ clientMsgId: "p1", body: "in flight", ts: 1, pending: true }];
  a.state.draftsOwner = 1; a.state.actor = null;   // the session was lost: the drafts owner remains
  a.preserveUnsent();
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_1_5")!).map((u: Any) => u.body), ["in flight"]);
  a.state.draftsOwner = null; a.state.pending[5] = [{ clientMsgId: "p2", body: "nobody", ts: 1, pending: true }];
  a.persistUnsent(5);
  assert.ok(!JSON.stringify([...storage.data]).includes("nobody"), "no known account: nothing is written");
});

// ------------------------------------------------------------------ F6
const APP = readFileSync(new URL("../src/http/ui/js/app.js", import.meta.url), "utf8");
const api = await import(base + "api.js");
const data = await import(base + "data.js");
const model = await import(base + "state.js");
const router = await import(base + "router.js");
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** The production applyRoute (and only it) from app.js, its collaborators recorded. */
function loadApplyRoute() {
  const start = APP.indexOf("async function applyRoute(route)");
  assert.ok(start >= 0, "applyRoute is in app.js");
  const source = APP.slice(start, APP.indexOf("\n}", start) + 2);
  const log = { opened: [] as number[], noAccess: [] as string[], threads: [] as number[], sidebar: 0 };
  const deps: Record<string, Any> = {
    state: model.state,
    conversationBySlug: data.conversationBySlug,
    sessionGeneration: api.sessionGeneration,
    dmOthers: model.dmOthers,
    renderSidebarList: () => { log.sidebar++; },
    renderNoAccess: (route: Any) => { log.noAccess.push(route.slug); },
    openConversation: async (id: number) => {
      log.opened.push(id);
      model.state.view = "chat"; model.state.activeId = id;
      const c = model.state.conversations.find((x: Any) => x.id === id);
      globals.location.hash = `#/c/${c?.slug ?? id}`;        // what syncRoute writes
    },
    openThread: async (id: number) => { log.threads.push(id); },
  };
  const names = Object.keys(deps);
  const applyRoute = new Function(...names, `"use strict";\n${source}\nreturn applyRoute;`)(...names.map((n) => deps[n]));
  return { applyRoute, log };
}

/** fetch that holds GET /api/conversations until released with the server's list. */
function heldConversations() {
  const held: ((body: unknown) => void)[] = [];
  globals.fetch = () => new Promise((done) => held.push((body) => done(ok(body))));
  return { held, release: (body: unknown) => held.shift()!(body) };
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((done) => setImmediate(done)); };
const GENERAL = { id: 5, kind: "public", slug: "general" };
const FRESH = { id: 7, kind: "public", slug: "fresh" };
const LIST = { conversations: [GENERAL, FRESH], memberships: [{ conversationId: 5 }, { conversationId: 7 }], unread: [] };

function onGeneral() {
  model.state.actor = A;
  model.state.conversations = [GENERAL];
  model.state.memberships = { 5: { conversationId: 5 } };
  model.state.activeId = null;
  model.state.view = "chat";
  model.state.route = null;
}
/** The address changes (Back, a link, a typed URL) and app.js's hashchange handler routes it. */
function navigate(applyRoute: Any, hash: string) {
  globals.location.hash = hash;
  return applyRoute(router.parseRoute(hash));
}

test("F6 (codex repro): hold #fresh, navigate to #general, release: only #general is opened", async () => {
  onGeneral();
  const { applyRoute, log } = loadApplyRoute();
  const net = heldConversations();
  const fresh = navigate(applyRoute, "#/c/fresh");
  await settle();
  await navigate(applyRoute, "#/c/general");
  net.release(LIST);
  await fresh; await settle();
  assert.deepEqual(log.opened, [5], "the late lookup opens nothing");
  assert.equal(model.state.activeId, 5);
  assert.deepEqual(log.noAccess, []);
});

test("F6: a lookup that finds nothing after the user moved on renders no no-access screen", async () => {
  onGeneral();
  const { applyRoute, log } = loadApplyRoute();
  const net = heldConversations();
  const gone = navigate(applyRoute, "#/c/nope");
  await settle();
  await navigate(applyRoute, "#/c/general");
  net.release({ conversations: [GENERAL], memberships: [{ conversationId: 5 }], unread: [] });
  await gone; await settle();
  assert.deepEqual(log.noAccess, [], "no-access would cover #general");
  assert.deepEqual(log.opened, [5]);
});

test("F6: a sidebar click (an open without a route) during the lookup wins too", async () => {
  onGeneral();
  const { applyRoute, log } = loadApplyRoute();
  const net = heldConversations();
  const fresh = navigate(applyRoute, "#/c/fresh");
  await settle();
  model.state.activeId = 5; globals.location.hash = "#/c/general";   // openConversation(5) + syncRoute
  net.release(LIST);
  await fresh; await settle();
  assert.deepEqual(log.opened, [], "the late lookup does not take the user back");
  assert.equal(model.state.activeId, 5);
});

test("F6: a session change during the lookup opens nothing and renders no no-access", async () => {
  onGeneral();
  const { applyRoute, log } = loadApplyRoute();
  const net = heldConversations();
  const fresh = navigate(applyRoute, "#/c/fresh");
  await settle();
  api.newSessionGeneration();                    // sign-out / another sign-in in this tab
  net.release(LIST);
  await fresh; await settle();
  assert.deepEqual(log.opened, []);
  assert.deepEqual(log.noAccess, []);
});

test("F6: an undisturbed lookup still opens the new channel (and its thread)", async () => {
  onGeneral();
  const { applyRoute, log } = loadApplyRoute();
  const net = heldConversations();
  const fresh = navigate(applyRoute, "#/c/fresh/t/42");
  await settle();
  net.release(LIST);
  await fresh; await settle();
  assert.deepEqual(log.opened, [7]);
  assert.deepEqual(log.threads, [42]);
  assert.equal(log.sidebar, 1, "the sidebar shows the channel the lookup found");
});

test("F6: an unknown slug with nobody navigating away still ends on no-access", async () => {
  onGeneral();
  const { applyRoute, log } = loadApplyRoute();
  const net = heldConversations();
  const gone = navigate(applyRoute, "#/c/nope");
  await settle();
  net.release({ conversations: [GENERAL], memberships: [{ conversationId: 5 }], unread: [] });
  await gone; await settle();
  assert.deepEqual(log.noAccess, ["nope"]);
});
