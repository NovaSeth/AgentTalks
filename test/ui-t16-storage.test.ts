/**
 * T-MG-16 item 2 (codex review-r7 F8), narrowed by D-MG-30: every unsent message lives under its own
 * key (atalks_unsent_<actorId>_<conv>_<clientMsgId>), so no write rewrites another message's key.
 * The legacy import and its tombstone/7-day tests were removed with the import (legacy data is
 * deleted now: test/ui-d-mg-30-legacy-delete.test.ts).
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
/** The per-message keys only (no other unsent key exists in the layout). */
const unsentKeys = () => [...storage.data.keys()].filter((k) => /^atalks_unsent_\d+_\d+_.+$/.test(k)).sort();

beforeEach(() => { storage.data.clear(); storage.after = null; });

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
  assert.ok(written.every((w) => w.endsWith("_m1") || w.endsWith("_m2")),
    "only the conversation's own message keys are touched");
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
