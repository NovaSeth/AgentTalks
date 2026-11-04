/**
 * T-MG-18 item 1 (D-MG-30, closes B-MG-111..115): the legacy storage import is gone. Every
 * un-namespaced key of an older layout is DELETED at sign-in and at sign-out, never shown to anyone;
 * the current layout (per-account namespaces, per-message unsent keys) is untouched.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class StorageStub {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
}

const storage = new StorageStub();
Object.assign(globalThis as Record<string, Any>, {
  localStorage: storage,
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: {
    title: "", documentElement: {}, visibilityState: "hidden",
    body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
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
async function tab(actor: Any) {
  const s = await import(base + `state.js?d30tab=${++tabs}`);
  s.state.actor = actor;
  return s;
}
const entry = (id: string, body: string) => JSON.stringify({ clientMsgId: id, body, threadId: null, ts: 1, error: null });
const LEGACY: Record<string, string> = {
  "atalks_draft_5": "legacy draft",
  "atalks_wiki_draft_home": "{\"title\":\"x\"}",
  "atalks_last_conv": "5",
  "atalks_recent": "[5]",
  "atalks_threads_seen": "{}",
  "atalks_owner": "1",
  "atalks_unsent_5": JSON.stringify([{ ownerId: 1, clientMsgId: "old", body: "old shared", ts: 1 }]),
  "atalks_unsent_1_5": JSON.stringify([{ clientMsgId: "r5", body: "r5 list", ts: 1 }]),
  "atalks_unsent_done_1": "[\"x\"]",
  "atalks_storage_v": "2",
  "atalks_storage_v_since": "123",
};
const legacyLeft = () => Object.keys(LEGACY).filter((k) => storage.data.has(k));

beforeEach(() => storage.data.clear());

test("D-MG-30: a sign-in deletes every legacy key and imports nothing from them", async () => {
  for (const [k, v] of Object.entries(LEGACY)) storage.data.set(k, v);
  const s = await tab(A);
  s.claimLocalData(A.id);
  assert.deepEqual(legacyLeft(), []);
  assert.equal(s.visibleMessages(5).filter((m: Any) => m.failed).length, 0, "no legacy unsent message is shown");
  assert.equal(s.lastConvId(), null);
  assert.equal(s.loadDraft(5), null);
  assert.equal(storage.data.has("atalks_draft_1_5"), false, "nothing is moved into a namespace");
  assert.equal(storage.data.has("atalks_unsent_1_5_old"), false);
  assert.equal(storage.data.has("atalks_unsent_1_5_r5"), false);
});

test("D-MG-30: a sign-out deletes every legacy key as well", async () => {
  const s = await tab(A);
  s.claimLocalData(A.id);
  for (const [k, v] of Object.entries(LEGACY)) storage.data.set(k, v);
  s.clearLocalAccountData(A.id);
  assert.deepEqual(legacyLeft(), []);
});

test("D-MG-30: the current actor's live namespaced data is untouched by a claim", async () => {
  storage.data.set("atalks_draft_1_5", "mine");
  storage.data.set("atalks_wiki_draft_1_home", "{}");
  storage.data.set("atalks_last_conv_1", "7");
  storage.data.set("atalks_recent_1", "[7]");
  storage.data.set("atalks_threads_seen_1", "{}");
  storage.data.set("atalks_unsent_1_5_m1", entry("m1", "live unsent"));
  for (const [k, v] of Object.entries(LEGACY)) storage.data.set(k, v);
  const s = await tab(A);
  s.claimLocalData(A.id);
  for (const k of ["atalks_draft_1_5", "atalks_wiki_draft_1_home", "atalks_last_conv_1", "atalks_recent_1", "atalks_threads_seen_1", "atalks_unsent_1_5_m1"]) {
    assert.equal(storage.data.has(k), true, k);
  }
  assert.deepEqual(s.visibleMessages(5).filter((m: Any) => m.failed).map((m: Any) => m.body), ["live unsent"]);
});

test("D-MG-30: another account's namespaced data stays invisible and untouched across claim and sign-out", async () => {
  const theirs = {
    "atalks_draft_2_5": "bob draft", "atalks_wiki_draft_2_home": "{}", "atalks_last_conv_2": "9",
    "atalks_recent_2": "[9]", "atalks_threads_seen_2": "{}", "atalks_unsent_2_5_b1": entry("b1", "bob unsent"),
  };
  for (const [k, v] of Object.entries(theirs)) storage.data.set(k, v);
  for (const [k, v] of Object.entries(LEGACY)) storage.data.set(k, v);
  const a = await tab(A);
  a.claimLocalData(A.id);
  assert.deepEqual(a.visibleMessages(5).filter((m: Any) => m.failed), []);
  assert.equal(a.loadDraft(5), null);
  assert.equal(a.lastConvId(), null);
  a.clearLocalAccountData(A.id);
  for (const [k, v] of Object.entries(theirs)) assert.equal(storage.data.get(k), v, k);
  const b = await tab(B);
  b.claimLocalData(B.id);
  assert.deepEqual(b.visibleMessages(5).filter((m: Any) => m.failed).map((m: Any) => m.body), ["bob unsent"]);
});

test("D-MG-30: a sign-out removes the leaving actor's namespaced keys, including per-message unsent keys", async () => {
  const s = await tab(A);
  s.claimLocalData(A.id);
  for (const k of ["atalks_draft_1_5", "atalks_wiki_draft_1_home", "atalks_last_conv_1", "atalks_recent_1", "atalks_threads_seen_1"]) storage.data.set(k, "x");
  storage.data.set("atalks_unsent_1_5_m1", entry("m1", "a"));
  storage.data.set("atalks_unsent_1_6_m2", entry("m2", "b"));
  storage.data.set("atalks_unsent_2_5_m1", entry("m1", "bob"));
  s.clearLocalAccountData(A.id);
  assert.deepEqual([...storage.data.keys()].sort(), ["atalks_unsent_2_5_m1"]);
});

test("D-MG-30: key formats are told apart exactly (a per-message key has a clientMsgId segment)", async () => {
  storage.data.set("atalks_unsent_1_5_9", entry("9", "numeric id"));   // a digits-only clientMsgId is still per-message
  storage.data.set("atalks_wiki_draft_3_notes", "{}");                  // namespaced: the owner is digits
  storage.data.set("atalks_wiki_draft_notes", "{}");                    // legacy
  storage.data.set("atalks_unsent_7", "[]");                            // legacy shared list
  storage.data.set("atalks_unsent_2_7", "[]");                          // r5 list
  const s = await tab(A);
  s.claimLocalData(A.id);
  assert.equal(storage.data.has("atalks_unsent_1_5_9"), true);
  assert.equal(storage.data.has("atalks_wiki_draft_3_notes"), true);
  assert.equal(storage.data.has("atalks_wiki_draft_notes"), false);
  assert.equal(storage.data.has("atalks_unsent_7"), false);
  assert.equal(storage.data.has("atalks_unsent_2_7"), false);
});

test("D-MG-30: persistUnsent writes per-message keys only and a finished message's key is removed", async () => {
  const s = await tab(A);
  s.claimLocalData(A.id);
  s.state.pending[5] = [{ clientMsgId: "m1", body: "one", ts: 1, failed: true }, { clientMsgId: "m2", body: "two", ts: 2 }];
  s.persistUnsent(5);
  assert.deepEqual([...storage.data.keys()].sort(), ["atalks_unsent_1_5_m1", "atalks_unsent_1_5_m2"]);
  s.state.pending[5] = [{ clientMsgId: "m2", body: "two", ts: 2 }];
  s.persistUnsent(5, ["m1"]);
  assert.deepEqual([...storage.data.keys()].sort(), ["atalks_unsent_1_5_m2"]);
  assert.equal([...storage.data.keys()].some((k) => k.startsWith("atalks_unsent_done_")), false, "no tombstone set");
});
