/**
 * T-MG-16 items 1-2 (codex review-r7 F7, F8; D-MG-28): unsent messages survive the storage upgrade.
 *  F7  an attributable unsent entry (a valid ownerId) that an old, unreloaded tab writes into the
 *      legacy shared list AFTER the upgrade is moved to its owner on every sweep; only entries
 *      with no owner are discarded;
 *  F8  every unsent message lives under its own key (atalks_unsent_<actorId>_<conv>_<clientMsgId>),
 *      so a migration or a cleanup paused at any storage call cannot overwrite another write.
 * Browser boundaries only: two tabs are two module instances over one shared localStorage, and a
 * hook after every storage call is the interleaving point for the other tab.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

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
const globals = globalThis as Record<string, Any>;
Object.assign(globals, {
  localStorage: storage,
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    title: "", documentElement: {}, visibilityState: "hidden",
    body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
    getElementById: () => null,
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

async function freshTab() { return import(base + `state.js?t16tab=${++tabs}`); }
async function tab(actor: Any) {
  const s = await freshTab();
  s.state.actor = actor;
  s.claimLocalData(actor.id);
  return s;
}
const unsentBodies = (s: Any, conv = 5) => s.visibleMessages(conv).filter((m: Any) => m.failed).map((m: Any) => m.body);
const unsentKeys = () => [...storage.data.keys()].filter((k) => k.startsWith("atalks_unsent_")).sort();
/** The write of a tab still running the pre-r5 code (1a713b8): the shared per-conversation list,
 *  every entry tagged with its writer (copied from that revision's persistUnsent). */
function oldTabPersist(owner: number, convId: number, pending: Any[], done: string[] = []) {
  const key = "atalks_unsent_" + convId;
  const mine = pending.map((p) => ({ ownerId: owner, clientMsgId: p.clientMsgId, body: p.body, threadId: null, ts: p.ts, error: null }));
  const skip = new Set([...done, ...mine.map((u) => u.clientMsgId)]);
  let others: Any[] = [];
  const stored = JSON.parse(storage.getItem(key) || "[]");
  if (Array.isArray(stored)) others = stored.filter((u: Any) => u && u.clientMsgId && !skip.has(u.clientMsgId));
  const list = [...others, ...mine];
  if (list.length) storage.setItem(key, JSON.stringify(list)); else storage.removeItem(key);
}

beforeEach(() => { storage.data.clear(); storage.after = null; });

// ------------------------------------------------------------------ F7
test("F7 (codex repro): an old tab's attributable unsent write after the upgrade survives A's sign-out", async () => {
  const a = await tab(A);                         // A upgrades: the migration ran, the flag is set
  // Tab B, not reloaded, still runs 1a713b8 and persists b2 into the old shared list.
  oldTabPersist(2, 5, [{ clientMsgId: "b2", body: "b2", ts: 2 }]);
  a.clearLocalAccountData(1);                     // A signs out: the sweep runs again
  const b = await tab(B);                         // B reloads into the new code
  assert.deepEqual(unsentBodies(b), ["b2"], "B gets its own message back");
  const a2 = await tab(A);
  assert.deepEqual(unsentBodies(a2), [], "and nobody else does");
  assert.equal(storage.getItem("atalks_unsent_5"), null, "the legacy shared list is gone");
});

test("F7: every sweep moves tagged entries to their owners and still drops the unattributed ones", async () => {
  await tab(A);
  storage.setItem("atalks_owner", "1");          // a late marker claims nothing
  storage.setItem("atalks_unsent_7", JSON.stringify([
    { clientMsgId: "t1", body: "tagged for A", ts: 1, ownerId: 1 },
    { clientMsgId: "t2", body: "tagged for B", ts: 1, ownerId: 2 },
    { clientMsgId: "u1", body: "no owner", ts: 1 },
    { clientMsgId: "u2", body: "bad owner", ts: 1, ownerId: "x" },
  ]));
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b, 7), ["tagged for B"]);
  const a = await tab(A);
  assert.deepEqual(unsentBodies(a, 7), ["tagged for A"], "the marker does not hand A the untagged entries");
  assert.ok(![...storage.data.values()].some((v) => v.includes("no owner") || v.includes("bad owner")), "unattributed entries are deleted");
});

// ------------------------------------------------------------------ F8
/** Legacy shared list with B's b1; A's sweep runs, and after A's k-th storage call tab B (new code)
 *  completes its own migration and persists b2. Returns whether the injection happened. */
async function f8Run(k: number | null, pauseAt: (op: string, key: string | null) => boolean, upgraded = false) {
  storage.data.clear();
  if (upgraded) storage.setItem("atalks_storage_v", "2");   // a browser that already upgraded once
  oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
  const a = await freshTab();
  const b = await freshTab();
  let calls = 0;
  let injected = false;
  storage.after = (op, key) => {
    if (injected) return;
    if (k != null ? ++calls !== k : !pauseAt(op, key)) return;
    injected = true;
    storage.after = null;
    b.state.actor = B; b.claimLocalData(2);
    (b.state.pending[5] ||= []).push({ clientMsgId: "b2", body: "b2", ts: 2, failed: true });
    b.persistUnsent(5);
  };
  a.state.actor = A; a.claimLocalData(1);
  storage.after = null;
  return injected;
}

test("F8 (codex repro): A paused after reading B's unsent storage cannot overwrite B's newer b2", async () => {
  const injected = await f8Run(null, (op, key) => op === "getItem" && !!key && key.startsWith("atalks_unsent_2_5"));
  assert.ok(injected, "A's migration reads B's unsent storage while it moves b1");
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b), ["b1", "b2"], "b2 survives A's resumed migration");
});

test("F8: at EVERY storage call of A's migration, B's concurrent migration and write keep [b1, b2]", async () => {
  for (const upgraded of [false, true]) {
    let points = 0;
    for (let k = 1; ; k++) {
      if (!(await f8Run(k, () => false, upgraded))) break;
      points++;
      const b = await tab(B);
      assert.deepEqual(unsentBodies(b), ["b1", "b2"], `B wrote after A's storage call #${k} (upgraded: ${upgraded})`);
      const a = await tab(A);
      assert.deepEqual(unsentBodies(a), [], `A gets nothing (point #${k}, upgraded: ${upgraded})`);
    }
    assert.ok(points > 3, "the sweep was interrupted at every one of its storage calls");
  }
});

test("F8: a message B sent while A's migration was paused is not written back by A", async () => {
  for (const upgraded of [false, true]) {
    storage.data.clear();
    if (upgraded) storage.setItem("atalks_storage_v", "2");
    oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
    const a = await freshTab();
    const b = await freshTab();
    let injected = false;
    storage.after = (op, key) => {
      if (injected || op !== "getItem" || key !== "atalks_unsent_5") return;
      injected = true; storage.after = null;
      b.state.actor = B; b.claimLocalData(2);             // B migrates b1 ...
      b.state.pending[5] = []; b.persistUnsent(5, ["b1"]); // ... and sends it: its key is removed
    };
    a.state.actor = A; a.claimLocalData(1);
    storage.after = null;
    assert.ok(injected);
    const b2 = await tab(B);
    assert.deepEqual(unsentBodies(b2), [], `the sent b1 does not come back as "not sent" (upgraded: ${upgraded})`);
  }
});

test("F8: one key per message; a write never rewrites another message's key", async () => {
  const a = await tab(A);
  a.state.pending[5] = [{ clientMsgId: "m1", body: "one", ts: 1, failed: true }, { clientMsgId: "m2", body: "two", ts: 2, failed: true }];
  a.persistUnsent(5);
  assert.deepEqual(unsentKeys(), ["atalks_unsent_1_5_m1", "atalks_unsent_1_5_m2"]);
  assert.equal(JSON.parse(storage.getItem("atalks_unsent_1_5_m2")!).body, "two");
  const written: string[] = [];
  storage.after = (op, key) => { if (op === "setItem" || op === "removeItem") written.push(`${op} ${key}`); };
  a.state.pending[5] = a.state.pending[5].filter((p: Any) => p.clientMsgId !== "m1");
  a.persistUnsent(5, ["m1"]);
  storage.after = null;
  assert.ok(!written.includes("setItem atalks_unsent_1_5_m1"), "the sent message is not written again");
  assert.ok(written.includes("removeItem atalks_unsent_1_5_m1"));
  assert.ok(written.every((w) => w.endsWith("_m1") || w.endsWith("_m2")), "only the conversation's own message keys are touched");
  assert.deepEqual(unsentKeys(), ["atalks_unsent_1_5_m2"]);
});

test("F8: two tabs of the same account, one persisting at every point of the other's write, lose nothing", async () => {
  for (let k = 1; ; k++) {
    storage.data.clear();
    const t1 = await tab(A);
    const t2 = await tab(A);
    t1.state.pending[5] = [{ clientMsgId: "m1", body: "one", ts: 1, failed: true }];
    t2.state.pending[5] = [{ clientMsgId: "m2", body: "two", ts: 2, failed: true }];
    let calls = 0, injected = false;
    storage.after = () => {
      if (injected || ++calls !== k) return;
      injected = true; storage.after = null;
      t2.persistUnsent(5);
    };
    t1.persistUnsent(5);
    storage.after = null;
    if (!injected) break;
    const t3 = await tab(A);
    assert.deepEqual(unsentBodies(t3), ["one", "two"], `point #${k}`);
  }
  storage.data.clear();
  const t1 = await tab(A);
  const t2 = await tab(A);
  t1.state.pending[5] = [{ clientMsgId: "m1", body: "one", ts: 1, failed: true }]; t1.persistUnsent(5);
  t2.state.pending[5] = [{ clientMsgId: "m2", body: "two", ts: 2, failed: true }]; t2.persistUnsent(5);
  t2.state.pending[5] = []; t2.persistUnsent(5, ["m2"]);
  assert.deepEqual(unsentKeys(), ["atalks_unsent_1_5_m1"], "t2's send removes only m2");
  t1.persistUnsent(5);
  assert.deepEqual(unsentKeys(), ["atalks_unsent_1_5_m1"], "t1 persisting its own list does not resurrect or drop anything");
});

test("F8: an r5 per-conversation list (atalks_unsent_<actor>_<conv>) is split into message keys on any sweep", async () => {
  await tab(A);                                    // the flag is set: this is a later sweep
  storage.setItem("atalks_unsent_2_5", JSON.stringify([
    { clientMsgId: "r1", body: "r5 one", ts: 1 }, { clientMsgId: "r2", body: "r5 two", ts: 2 },
  ]));
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b), ["r5 one", "r5 two"]);
  assert.deepEqual(unsentKeys(), ["atalks_unsent_2_5_r1", "atalks_unsent_2_5_r2"]);
});

test("F8: a sign-out removes only this account's message keys", async () => {
  const a = await tab(A);
  const b = await tab(B);
  a.state.pending[5] = [{ clientMsgId: "a1", body: "a1", ts: 1, failed: true }]; a.persistUnsent(5);
  b.state.pending[5] = [{ clientMsgId: "b1", body: "b1", ts: 1, failed: true }]; b.persistUnsent(5);
  const c = await tab({ id: 12, handle: "c" });
  c.state.pending[5] = [{ clientMsgId: "c1", body: "c1", ts: 1, failed: true }]; c.persistUnsent(5);
  a.clearLocalAccountData(1);
  assert.deepEqual(unsentKeys(), ["atalks_unsent_12_5_c1", "atalks_unsent_2_5_b1"], "actor 1's prefix does not reach actor 12");
});
