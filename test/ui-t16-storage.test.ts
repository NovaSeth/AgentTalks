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
/** The per-message keys only (not the old lists, not the tombstone set). */
const unsentKeys = () => [...storage.data.keys()].filter((k) => /^atalks_unsent_\d+_\d+_.+$/.test(k)).sort();
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
  assert.ok(storage.getItem("atalks_unsent_5"), "the legacy shared list is only read, never removed (fix round 1)");
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
  assert.ok(!unsentKeys().some((k) => /_u[12]$/.test(k)), "unattributed entries are never imported (fix round 1: the list is kept, shown to nobody)");
  const c = await tab({ id: 12, handle: "c" });
  assert.deepEqual(unsentBodies(c, 7), [], "nor shown to a third account");
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
  assert.ok(written.every((w) => w.endsWith("_m1") || w.endsWith("_m2") || w === "setItem atalks_unsent_done_1"),
    "only the conversation's own message keys and the account's tombstone set are touched");
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

test("F8: a full storage refusing one write still removes the sent message and writes the others", async () => {
  const a = await tab(A);
  a.state.pending[5] = [{ clientMsgId: "sent", body: "sent", ts: 1, failed: true }]; a.persistUnsent(5);
  const setItem = storage.setItem;
  storage.setItem = function (key: string, value: string) {
    if (key.endsWith("_big")) throw new Error("QuotaExceededError");
    return setItem.call(this, key, value);
  };
  try {
    a.state.pending[5] = [{ clientMsgId: "big", body: "x", ts: 2, failed: true }, { clientMsgId: "small", body: "y", ts: 3, failed: true }];
    a.persistUnsent(5, ["sent"]);
  } finally { storage.setItem = setItem; }
  assert.deepEqual(unsentKeys(), ["atalks_unsent_1_5_small"], "the sent one is gone, the refused one is only in memory");
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

// ------------------------------------------------------------------ fix round 1 (codex review-r1 F1, F2)
// The migration is non-destructive: a legacy shared list (atalks_unsent_<conv>) and an r5 list
// (atalks_unsent_<actor>_<conv>) are only read and copied into per-message keys that do not exist
// yet; a message sent or discarded through the new code leaves a tombstone
// (atalks_unsent_done_<actor>) that every import and restore honours.
const DAY = 24 * 3600 * 1000;

test("R1 F1 (codex repro): an old tab's write while A's sign-out sweep reads the shared list keeps [b1, b2]", async () => {
  // Codex injected after the third read of atalks_unsent_5 (the old code's check-then-remove);
  // here after the n-th read for every n the sweep reaches.
  let points = 0;
  for (let n = 1; ; n++) {
    storage.data.clear();
    oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
    const a = await tab(A);
    let reads = 0, injected = false;
    storage.after = (op, key) => {
      if (injected || op !== "getItem" || key !== "atalks_unsent_5" || ++reads !== n) return;
      injected = true; storage.after = null;
      oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }, { clientMsgId: "b2", body: "b2", ts: 2 }]);
    };
    a.clearLocalAccountData(1);
    storage.after = null;
    if (!injected) break;
    points++;
    const b = await tab(B);
    assert.deepEqual(unsentBodies(b), ["b1", "b2"], `old tab wrote after read #${n}`);
  }
  assert.ok(points >= 2, "the sign-out sweep reads the shared list");
});

test("R1 F1: an old tab's write after EVERY storage call of A's sign-out sweep keeps [b1, b2]", async () => {
  let points = 0;
  for (let k = 1; ; k++) {
    storage.data.clear();
    oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
    const a = await tab(A);
    let calls = 0, injected = false;
    storage.after = () => {
      if (injected || ++calls !== k) return;
      injected = true; storage.after = null;
      oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }, { clientMsgId: "b2", body: "b2", ts: 2 }]);
    };
    a.clearLocalAccountData(1);
    storage.after = null;
    if (!injected) break;
    points++;
    const b = await tab(B);
    assert.deepEqual(unsentBodies(b), ["b1", "b2"], `old tab wrote after A's storage call #${k}`);
  }
  assert.ok(points > 3);
});

test("R1 F2 (codex repro): a paused migration cannot resurrect a message B already sent", async () => {
  oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
  const a = await freshTab();
  const b = await freshTab();
  let injected = false;
  storage.after = (op, key) => {
    if (injected || op !== "getItem" || key !== "atalks_unsent_2_5_b1" || storage.data.has(key)) return;
    injected = true; storage.after = null;
    b.state.actor = B; b.claimLocalData(2);              // B migrates b1 ...
    b.state.pending[5] = []; b.persistUnsent(5, ["b1"]); // ... and sends it
  };
  a.state.actor = A; a.claimLocalData(1);              // A resumes and writes its stale copy
  storage.after = null;
  assert.ok(injected, "A read the absent per-message key");
  const b2 = await tab(B);
  assert.deepEqual(unsentBodies(b2), [], "the sent b1 never comes back as not sent");
});

test("R1 F2: B's claim and send after EVERY storage call of A's migration never resurrect b1", async () => {
  for (const upgraded of [false, true]) {
    let points = 0;
    for (let k = 1; ; k++) {
      storage.data.clear();
      if (upgraded) storage.setItem("atalks_storage_v", "2");
      oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
      const a = await freshTab();
      const b = await freshTab();
      let calls = 0, injected = false;
      storage.after = () => {
        if (injected || ++calls !== k) return;
        injected = true; storage.after = null;
        b.state.actor = B; b.claimLocalData(2);
        b.state.pending[5] = []; b.persistUnsent(5, ["b1"]);
      };
      a.state.actor = A; a.claimLocalData(1);
      storage.after = null;
      if (!injected) break;
      points++;
      const b2 = await tab(B);
      assert.deepEqual(unsentBodies(b2), [], `point #${k} (upgraded: ${upgraded})`);
    }
    assert.ok(points > 3);
  }
});

test("R1: the legacy lists are only read: a sweep neither deletes nor rewrites them", async () => {
  oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
  storage.setItem("atalks_unsent_2_7", JSON.stringify([{ clientMsgId: "r1", body: "r5", ts: 1 }]));
  const before = { shared: storage.getItem("atalks_unsent_5"), r5: storage.getItem("atalks_unsent_2_7") };
  const writes: string[] = [];
  storage.after = (op, key) => { if (op === "setItem" || op === "removeItem") writes.push(`${op} ${key}`); };
  const a = await tab(A);
  a.clearLocalAccountData(1);
  await tab(B);
  storage.after = null;
  assert.ok(!writes.some((w) => / atalks_unsent_(5|2_7)$/.test(w)), writes.join(", "));
  assert.equal(storage.getItem("atalks_unsent_5"), before.shared);
  assert.equal(storage.getItem("atalks_unsent_2_7"), before.r5);
});

test("R1: a sent or discarded message leaves a tombstone, bounded to the 500 newest ids", async () => {
  const b = await tab(B);
  b.state.pending[5] = [{ clientMsgId: "m1", body: "one", ts: 1, failed: true }];
  b.persistUnsent(5);
  b.state.pending[5] = []; b.persistUnsent(5, ["m1"]);
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_done_2")!), ["m1"]);
  assert.equal(storage.getItem("atalks_unsent_2_5_m1"), null);
  // A stale copy of m1 (another tab's late write) is not restored, and is removed.
  storage.setItem("atalks_unsent_2_5_m1", JSON.stringify({ clientMsgId: "m1", body: "one", ts: 1 }));
  const b2 = await tab(B);
  assert.deepEqual(unsentBodies(b2), []);
  assert.equal(storage.getItem("atalks_unsent_2_5_m1"), null);
  b2.persistUnsent(5, Array.from({ length: 600 }, (_, i) => `x${i}`));
  const done = JSON.parse(storage.getItem("atalks_unsent_done_2")!);
  assert.equal(done.length, 500);
  assert.equal(done[499], "x599", "the newest ids are kept");
});

test("R1: an old tab's list is imported for each entry's owner only; unattributed entries are never shown", async () => {
  await tab(A);                                    // the flag is set: a later sweep
  storage.setItem("atalks_unsent_7", JSON.stringify([
    { clientMsgId: "t1", body: "tagged for A", ts: 1, ownerId: 1 },
    { clientMsgId: "u1", body: "no owner", ts: 1 },
  ]));
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b, 7), []);
  const c = await tab({ id: 12, handle: "c" });
  assert.deepEqual(unsentBodies(c, 7), []);
  const a = await tab(A);
  assert.deepEqual(unsentBodies(a, 7), ["tagged for A"]);
  assert.ok(!unsentKeys().some((k) => k.endsWith("_u1")), "the untagged entry is not copied anywhere");
});

test("R1: a sign-out does not let the kept legacy lists hand the account's entries back", async () => {
  oldTabPersist(1, 5, [{ clientMsgId: "a1", body: "a1", ts: 1 }]);
  storage.setItem("atalks_unsent_1_7", JSON.stringify([{ clientMsgId: "a2", body: "a2", ts: 1 }]));
  const a = await tab(A);
  assert.deepEqual(unsentBodies(a), ["a1"]);
  assert.deepEqual(unsentBodies(a, 7), ["a2"]);
  a.clearLocalAccountData(1);
  const a2 = await tab(A);
  assert.deepEqual(unsentBodies(a2), []);
  assert.deepEqual(unsentBodies(a2, 7), []);
  assert.equal(storage.getItem("atalks_unsent_1_7"), null, "an explicit sign-out deletes the account's r5 list (coordinator add-on)");
});

test("R1: legacy lists are collected 7 days after the new layout was first seen, after a last copy", async () => {
  oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }]);
  await tab(A);
  const since = Number(storage.getItem("atalks_storage_v_since"));
  assert.ok(since > 0 && Math.abs(Date.now() - since) < 60000, "the first-seen time is stored with the flag");
  await tab(A);
  assert.ok(storage.getItem("atalks_unsent_5"), "kept within the 7 days");
  storage.setItem("atalks_storage_v_since", String(Date.now() - 8 * DAY));
  oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "b1", ts: 1 }, { clientMsgId: "b2", body: "b2", ts: 2 }]);
  storage.setItem("atalks_unsent_2_7", JSON.stringify([{ clientMsgId: "r1", body: "r5", ts: 3 }]));
  await tab(A);                                    // A's sweep copies for B, then collects
  assert.equal(storage.getItem("atalks_unsent_5"), null);
  assert.equal(storage.getItem("atalks_unsent_2_7"), null);
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b), ["b1", "b2"]);
  assert.deepEqual(unsentBodies(b, 7), ["r5"]);
});

// ------------------------------------------------------------------ coordinator add-on (sign-out deletes the bodies)
// Explicit sign-out is the one moment deletion is intended: no text of the account may stay on a
// shared device, in the kept old lists either. Normal use keeps the non-destructive rule.
test("R1 sign-out: no storage value holds A's text afterwards; B's entries in the same shared list survive", async () => {
  storage.setItem("atalks_unsent_5", JSON.stringify([
    { ownerId: 1, clientMsgId: "a1", body: "ALICE-SECRET-1", ts: 1 },
    { ownerId: 2, clientMsgId: "b1", body: "bob one", ts: 2 },
    { clientMsgId: "u1", body: "untagged", ts: 3 },
  ]));
  storage.setItem("atalks_unsent_1_7", JSON.stringify([{ clientMsgId: "a2", body: "ALICE-SECRET-2", ts: 1 }]));
  storage.setItem("atalks_unsent_2_7", JSON.stringify([{ clientMsgId: "b2", body: "bob r5", ts: 1 }]));
  const a = await tab(A);
  a.state.pending[9] = [{ clientMsgId: "a3", body: "ALICE-SECRET-3", ts: 4, failed: true }];
  a.persistUnsent(9);
  a.state.pending[9] = [{ clientMsgId: "a4", body: "ALICE-SECRET-4", ts: 5, failed: true }];
  a.persistUnsent(9, ["a3"]);                      // a tombstone set exists for A
  assert.ok(storage.getItem("atalks_unsent_done_1"));
  a.clearLocalAccountData(1);
  const leaks = [...storage.data].filter(([, v]) => v.includes("ALICE-SECRET")).map(([k]) => k);
  assert.deepEqual(leaks, [], "A's text is in no key");
  assert.equal(storage.getItem("atalks_unsent_1_7"), null, "A's r5 list is deleted outright");
  assert.equal(storage.getItem("atalks_unsent_done_1"), null, "A's tombstones go with the bodies");
  assert.ok(![...storage.data.keys()].some((k) => /^atalks_unsent_1_\d+_/.test(k)), "A's per-message keys are gone");
  const shared = JSON.parse(storage.getItem("atalks_unsent_5")!);
  assert.deepEqual(shared.map((u: Any) => u.clientMsgId), ["b1", "u1"], "only A's entries left the shared list");
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b), ["bob one"]);
  assert.deepEqual(unsentBodies(b, 7), ["bob r5"]);
});

test("R1 sign-out: a shared list holding only A's entries is deleted", async () => {
  oldTabPersist(1, 5, [{ clientMsgId: "a1", body: "ALICE-ONLY", ts: 1 }]);
  const a = await tab(A);
  a.clearLocalAccountData(1);
  assert.equal(storage.getItem("atalks_unsent_5"), null);
});

test("R1 sign-out: an old tab of B writing the shared list at any point of A's sign-out is lost only inside A's read-to-write-back step", async () => {
  // The accepted race (coordinator): between A's last read of the shared list and its write-back.
  // Before that read or after that write B's entry must survive.
  let points = 0, outside = 0;
  for (let k = 1; ; k++) {
    storage.data.clear();
    oldTabPersist(1, 5, [{ clientMsgId: "a1", body: "ALICE", ts: 1 }]);
    const a = await tab(A);
    const ops: string[] = [];
    let injected = false;
    storage.after = (op, key) => {
      ops.push(`${op} ${key}`);
      if (injected || ops.length !== k) return;
      injected = true;
      const keep = storage.after; storage.after = null;
      oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "bob", ts: 2 }]);
      storage.after = keep;
    };
    a.clearLocalAccountData(1);
    storage.after = null;
    if (!injected) break;
    points++;
    const write = ops.findIndex((o) => o === "setItem atalks_unsent_5" || o === "removeItem atalks_unsent_5");
    const read = write < 0 ? -1 : ops.slice(0, write).lastIndexOf("getItem atalks_unsent_5");
    const inWindow = write >= 0 && k - 1 >= read && k - 1 < write;
    if (inWindow) continue;
    outside++;
    const b = await tab(B);
    assert.deepEqual(unsentBodies(b), ["bob"], `old tab of B wrote after A's storage call #${k}: ${ops[k - 1]}`);
  }
  assert.ok(points > 3 && outside > 3);
});

test("R1: a tombstone write that fails (quota) leaves nothing restorable: the copies in the old lists go", async () => {
  oldTabPersist(2, 5, [{ clientMsgId: "b1", body: "bob one", ts: 1 }, { clientMsgId: "b9", body: "bob keep", ts: 2 }]);
  storage.setItem("atalks_unsent_2_7", JSON.stringify([{ clientMsgId: "b2", body: "bob r5", ts: 1 }]));
  const b = await tab(B);
  assert.deepEqual(unsentBodies(b), ["bob one", "bob keep"]);
  const setItem = storage.setItem;
  storage.setItem = function (key: string, value: string) {
    if (key.startsWith("atalks_unsent_done_")) throw new Error("QuotaExceededError");
    return setItem.call(this, key, value);
  };
  try {
    b.state.pending[5] = b.state.pending[5].filter((p: Any) => p.clientMsgId !== "b1");
    b.persistUnsent(5, ["b1"]);
    b.state.pending[7] = []; b.persistUnsent(7, ["b2"]);
  } finally { storage.setItem = setItem; }
  const b2 = await tab(B);
  assert.deepEqual(unsentBodies(b2), ["bob keep"], "the sent b1 is not restorable");
  assert.deepEqual(unsentBodies(b2, 7), [], "nor the r5 copy of b2");
});
