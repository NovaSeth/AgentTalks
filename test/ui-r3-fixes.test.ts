/**
 * T-MG-3 fix round 3 (D-MG-26), codex review-r3:
 *  F1  a submit continuation (thread box, both sends; main composer) that resumes after the
 *      account, the conversation or the thread changed touches no state, no DOM, sends nothing;
 *  F2  drafts, wiki drafts, the last conversation and the recent list live in a per-actor
 *      namespace: two tabs (two module instances, one shared localStorage) never see each other's;
 *  F3  a filter-only listing whose newest page has no match keeps "Show older".
 * Browser boundaries only (the t-mg-8 pattern): the production handlers, views, actions and state
 * run unchanged.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

class ElementStub {
  id = "";
  value = "";
  checked = false;
  textContent = "";
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  scrollHeight = 100;
  scrollTop = 0;
  clientHeight = 100;
  disabled = false;
  selectionStart = 0;
  selectionEnd = 0;
  listeners = new Map<string, Set<(event: Any) => Any>>();
  children = new Map<string, ElementStub>();
  markup = "";
  parent: ElementStub | null = null;
  get innerHTML() { return this.markup; }
  set innerHTML(html: string) {
    for (const [id, child] of this.children) if (elements.get(id) === child) elements.delete(id);
    this.children.clear();
    this.markup = html;
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
      const child = new ElementStub();
      child.id = match[1];
      child.parent = this;
      this.children.set(match[1], child);
      elements.set(match[1], child);
    }
  }
  get isConnected() { return elements.get(this.id) === this; }
  addEventListener(type: string, fn: (event: Any) => Any) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: Any) => Any) { this.listeners.get(type)?.delete(fn); }
  async fire(type: string, fields: Record<string, unknown> = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, ...fields };
    for (const fn of [...(this.listeners.get(type) || [])]) await fn(event);
  }
  dispatchEvent(event: { type: string }) { void this.fire(event.type); }
  querySelector(selector: string): ElementStub | null {
    if (selector.startsWith("#")) return elements.get(selector.slice(1)) ?? null;
    return null;
  }
  querySelectorAll() { return []; }
  closest() { return null; }
  appendChild(child: ElementStub) { child.parent = this; if (child.id) elements.set(child.id, child); else overlays.push(child); }
  remove() { overlays = overlays.filter((entry) => entry !== this); }
  focus() { doc.activeElement = this; }
  blur() {}
  scrollTo() {}
  scrollIntoView() {}
  setSelectionRange() {}
  setAttribute() {}
  removeAttribute() {}
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
}

class StorageStub {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
  removeItem(key: string) { this.data.delete(key); }
}

let elements = new Map<string, ElementStub>();
let overlays: ElementStub[] = [];
const doc = Object.assign(new ElementStub(), {
  title: "", documentElement: {}, body: new ElementStub(), head: new ElementStub(), visibilityState: "hidden",
  activeElement: null as ElementStub | null,
  getElementById: (id: string) => elements.get(id) ?? null,
  createElement: () => new ElementStub(), createTextNode: () => new ElementStub(), contains: () => true,
});
const storage = new StorageStub();
const session = new StorageStub();
const globals = globalThis as Record<string, Any>;
Object.assign(globals, {
  document: doc, localStorage: storage, sessionStorage: session,
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {}, innerHeight: 800, innerWidth: 1200 },
  location: { origin: "https://test.local", href: "https://test.local/", hash: "" },
  EventSource: class { static CLOSED = 2; close() {} addEventListener() {} },
  Event: class { type: string; constructor(type: string) { this.type = type; } },
  URL: Object.assign(URL, { revokeObjectURL() {} }),
});
const base = new URL("../src/http/ui/js/", import.meta.url).href;
const i18n = await import(base + "i18n.js");
i18n.setLang("en");
const api = await import(base + "api.js");
const model = await import(base + "state.js");
const { state, views } = model;
const chat = await import(base + "view-chat.js");
const search = await import(base + "view-search.js");
const initial = structuredClone(state);
const initialViews = { ...views };

const A = { id: 1, handle: "alice", kind: "human" };
const B = { id: 2, handle: "bob", kind: "human" };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((done) => setImmediate(done)); };
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });

/** fetch that records every call; a path matching `hold` waits for the returned release. */
function recordFetch() {
  const calls: { url: string; method: string; body: Any }[] = [];
  const held: { url: string; release: (data: unknown) => void }[] = [];
  let reply = (url: string, body: Any): unknown => ({ message: { id: 100 + calls.length, conversationId: 5, actorId: 1, kind: "text", ts: 1, ...body } });
  let hold: (url: string, n: number) => boolean = () => false;
  globals.fetch = (url: string, init: Any = {}) => {
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method: init.method || "GET", body });
    const data = reply(url, body);
    if (hold(url, calls.length)) return new Promise((done) => held.push({ url, release: (d) => done(ok(d ?? data)) }));
    return Promise.resolve(ok(data));
  };
  return {
    calls, held,
    setHold(fn: typeof hold) { hold = fn; },
    setReply(fn: typeof reply) { reply = fn; },
  };
}

/** The account switch the way the app does it: a new session generation, another actor. */
function switchAccount(to: Any) {
  api.newSessionGeneration();
  state.actor = to;
}

beforeEach(() => {
  Object.assign(state, structuredClone(initial));
  Object.assign(views, initialViews);
  views.render = () => {};
  views.message = () => {};
  views.messages = () => {};
  views.scrollToBottom = () => {};
  views.conversationRow = () => {};
  state.actor = A;
  state.view = "chat";
  state.conversations = [{ id: 5, kind: "channel", slug: "general" }, { id: 6, kind: "channel", slug: "random" }];
  state.memberships = { 5: { conversationId: 5 }, 6: { conversationId: 6 } };
  state.actorsCache = { 1: A, 2: B };
  state.actorsAt = Date.now();
  state.loaded[5] = true; state.loaded[6] = true;
  state.msgs[5] = [{ id: 9, conversationId: 5, actorId: 1, body: "root of A", kind: "text", ts: 1, threadId: null }];
  state.msgs[6] = [{ id: 11, conversationId: 6, actorId: 2, body: "root of B", kind: "text", ts: 1, threadId: null }];
  elements = new Map(); overlays = [];
  doc.listeners.clear(); doc.activeElement = null;
  storage.data.clear(); session.data.clear();
  api.setCsrf("csrf");
});

/** Thread 9 of conversation 5 open for A, a reply typed, "Also send to #general" ticked. */
function openThreadBox(text: string) {
  state.activeId = 5;
  state.threadOpen = 9;
  state.threadMsgs = [state.msgs[5][0]];
  const slot = new ElementStub(); slot.id = "thread-slot"; elements.set("thread-slot", slot);
  chat.renderThread();
  elements.get("th-input")!.value = text;
  elements.get("th-also")!.checked = true;
  return elements.get("th-send")!;
}

// ------------------------------------------------------------------ F1
test("F1 (codex repro): A's reply never lands in B's thread when the account changes during the second send", async () => {
  const net = recordFetch();
  net.setHold((url, n) => n === 2);                // the "also send to the channel" copy is in flight
  const send = openThreadBox("A_SYNTHETIC_REPLY");
  const submitting = send.fire("click");
  await settle();
  assert.equal(net.held.length, 1, "the second send is in flight");
  switchAccount(B);
  state.activeId = 6; state.threadOpen = 11; state.threadMsgs = [state.msgs[6][0]];
  net.held[0].release(undefined);
  await submitting; await settle();
  assert.deepEqual(state.threadMsgs.map((m: Any) => m.id), [11], "B's thread holds only B's root");
  assert.ok(!JSON.stringify(state.threadMsgs).includes("A_SYNTHETIC_REPLY"));
});

test("F1: the same account switching thread during the second send keeps the reply out of the new thread", async () => {
  const net = recordFetch();
  net.setHold((url, n) => n === 2);
  const send = openThreadBox("reply for 9");
  const submitting = send.fire("click");
  await settle();
  state.activeId = 6; state.threadOpen = 11; state.threadMsgs = [state.msgs[6][0]];
  net.held[0].release(undefined);
  await submitting; await settle();
  assert.deepEqual(state.threadMsgs.map((m: Any) => m.id), [11]);
});

test("F1: an account change during the first send makes no second send (no post under B's session)", async () => {
  const net = recordFetch();
  net.setHold((url, n) => n === 1);
  const send = openThreadBox("A text");
  const submitting = send.fire("click");
  await settle();
  switchAccount(B);
  state.activeId = 6; state.threadOpen = 11; state.threadMsgs = [state.msgs[6][0]];
  net.held[0].release(undefined);
  await submitting; await settle();
  assert.equal(net.calls.filter((c) => c.method === "POST").length, 1, "only the first POST ever left");
  assert.deepEqual(state.threadMsgs.map((m: Any) => m.id), [11]);
});

test("F1: a thread switch after the first send (same account) still sends the channel copy to the original channel, no thread insert", async () => {
  const net = recordFetch();
  net.setHold((url, n) => n === 1);
  const send = openThreadBox("reply for 9");
  const submitting = send.fire("click");
  await settle();
  state.activeId = 6; state.threadOpen = 11; state.threadMsgs = [state.msgs[6][0]];
  net.held[0].release(undefined);
  await submitting; await settle();
  // r4 (fix round 4, item 10): the SAME account's switch no longer cancels the channel copy -
  // both sends name their conversation explicitly, so the copy goes to the original channel;
  // only the state and DOM updates for the place no longer on screen are skipped.
  const posts = net.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[1].url, "/api/conversations/5/messages");
  assert.deepEqual(state.threadMsgs.map((m: Any) => m.id), [11]);
});

test("F1: the thread box still does both sends and shows the reply when nothing changed", async () => {
  const net = recordFetch();
  const send = openThreadBox("both");
  await send.fire("click"); await settle();
  const posts = net.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.threadId, 9);
  assert.equal(posts[1].body.threadId, undefined, "the channel copy has no thread");
  assert.ok(state.threadMsgs.some((m: Any) => m.body === "both" && m.threadId === 9));
});

/** The main composer of conversation 5 with text and two attachments. */
function mainComposer(text: string) {
  state.activeId = 5;
  const host = new ElementStub(); host.id = "composer"; elements.set("composer", host);
  state.pendingFiles = [
    { id: "f1", file: { name: "one.txt", type: "text/plain", size: 1 } },
    { id: "f2", file: { name: "two.txt", type: "text/plain", size: 1 } },
  ];
  chat.renderComposer();
  elements.get("composer-input")!.value = text;
  return elements.get("composer-send")!;
}

test("F1: main composer - an account change during an upload uploads nothing more and posts nothing under B", async () => {
  const net = recordFetch();
  net.setReply((url) => url.includes("/files") ? { file: { id: 1 }, message: { id: 50, conversationId: 5, actorId: 1, kind: "file", ts: 1 } } : { message: { id: 51, conversationId: 5, actorId: 1, kind: "text", ts: 1, body: "x" } });
  net.setHold((url, n) => n === 1);
  const send = mainComposer("A_MAIN_TEXT");
  const submitting = send.fire("click");
  await settle();
  switchAccount(B);
  state.activeId = 6;
  state.pendingFiles = [];
  net.held[0].release(undefined);
  await submitting; await settle();
  assert.equal(net.calls.length, 1, `nothing after the first upload: ${JSON.stringify(net.calls.map((c) => c.url))}`);
  assert.deepEqual(state.pendingFiles, [], "B's composer gets none of A's files");
});

test("F1: main composer - a conversation switch during an upload sends nothing into the new conversation", async () => {
  const net = recordFetch();
  net.setReply((url) => url.includes("/files") ? { file: { id: 1 }, message: { id: 50, conversationId: 5, actorId: 1, kind: "file", ts: 1 } } : { message: { id: 51, conversationId: 5, actorId: 1, kind: "text", ts: 1, body: "x" } });
  net.setHold((url, n) => n === 1);
  const send = mainComposer("text for five");
  const submitting = send.fire("click");
  await settle();
  state.activeId = 6;
  state.pendingFiles = [];
  net.held[0].release(undefined);
  await submitting; await settle();
  assert.ok(!net.calls.some((c) => c.url.includes("/conversations/6/")), `no request to 6: ${JSON.stringify(net.calls.map((c) => c.url))}`);
  assert.deepEqual(state.pendingFiles, [], "6's composer gets none of 5's files");
  assert.equal(state.drafts[5]?.text, "text for five", "the words stay as 5's draft");
});

test("F1 audit: the @ list whose directory answer arrives after an account change does not open", async () => {
  const composer = await import(base + "composer.js");
  const ta = new ElementStub(); ta.id = "composer-input"; elements.set("composer-input", ta);
  let release!: (list: unknown) => void;
  const ac = composer.createAutocomplete(ta, { actors: () => new Promise((done) => { release = done; }) });
  ta.value = "@al"; ta.selectionStart = ta.selectionEnd = 3;
  const refreshing = ac.refresh();
  switchAccount(B);
  release([A, B]);
  await refreshing; await settle();
  assert.equal(overlays.length, 0, "no popover is mounted for the previous account's field");
});

test("F1 audit: an answer to a question lands in the question's conversation, not the one open now", async () => {
  const actions = await import(base + "actions.js");
  const net = recordFetch();
  net.setReply((url) => url.includes("/answer") ? { message: { id: 77, conversationId: 5, actorId: 1, kind: "text", ts: 1, body: "the answer", threadId: null } } : { questions: [] });
  net.setHold((url) => url.includes("/answer"));
  state.activeId = 5;
  const answering = actions.answerQuestion(3, "the answer");
  await settle();
  state.activeId = 6;
  net.held[0].release(undefined);
  await answering; await settle();
  assert.ok(!state.msgs[6].some((m: Any) => m.id === 77), "6 does not get 5's answer");
  assert.ok(state.msgs[5].some((m: Any) => m.id === 77));
});

// ------------------------------------------------------------------ F2
/** One browser tab: its own module instance (its own `state`), the shared localStorage. */
async function tab(name: string, actor: Any) {
  const s = await import(base + `state.js?tab=${name}`);
  s.state.actor = actor;
  s.claimLocalData(actor.id);
  return s;
}
const typeInto = (text: string) => { const ta = new ElementStub(); ta.id = "composer-input"; ta.value = text; elements.set("composer-input", ta); };

test("F2 (codex repro): tab A's draft is never loaded by tab B signed in as another account", async () => {
  const a = await tab("a1", A);
  const b = await tab("b1", B);
  a.state.activeId = 5;
  typeInto("ALICE_SYNTHETIC_DRAFT");
  a.saveDraft();
  assert.equal(b.loadDraft(5), null, "B never sees A's draft");
  assert.equal(storage.getItem("atalks_owner"), null, "no global owner marker decides visibility");
  // B's own draft in the same conversation lives next to A's, neither overwrites the other.
  b.state.activeId = 5;
  typeInto("BOB_DRAFT");
  b.saveDraft();
  const a2 = await tab("a2", A);           // A reloads
  assert.equal(a2.loadDraft(5)?.text, "ALICE_SYNTHETIC_DRAFT", "A sees its own after reload");
  const b2 = await tab("b2", B);
  assert.equal(b2.loadDraft(5)?.text, "BOB_DRAFT");
});

test("F2: wiki drafts, the last conversation and the recent list are per account too", async () => {
  const a = await tab("a3", A);
  const b = await tab("b3", B);
  a.saveWikiDraft("home", { title: "Home", body: "ALICE_WIKI" });
  a.rememberLastConv(5);
  a.pushRecent(5);
  assert.equal(b.loadWikiDraft("home"), null);
  assert.equal(b.lastConvId(), null);
  assert.deepEqual(b.recentConversations([{ id: 6 }, { id: 5 }]).map((c: Any) => c.id), [6, 5], "B's order is not A's");
  const a2 = await tab("a4", A);
  assert.equal(a2.loadWikiDraft("home")?.body, "ALICE_WIKI");
  assert.equal(a2.lastConvId(), 5);
  assert.deepEqual(a2.recentConversations([{ id: 6 }, { id: 5 }]).map((c: Any) => c.id), [5, 6]);
});

test("F2: sign-out clears only the signing-out account's keys (drafts, wiki, navigation, unsent)", async () => {
  const a = await tab("a5", A);
  const b = await tab("b5", B);
  a.state.activeId = 5; typeInto("ALICE"); a.saveDraft();
  a.saveWikiDraft("home", { title: "t", body: "ALICE_WIKI" }); a.rememberLastConv(5); a.pushRecent(5);
  a.state.pending[5] = [{ clientMsgId: "m-a", body: "a unsent", ts: 1, failed: true }]; a.persistUnsent(5);
  b.state.activeId = 5; typeInto("BOB"); b.saveDraft();
  b.saveWikiDraft("home", { title: "t", body: "BOB_WIKI" }); b.rememberLastConv(6); b.pushRecent(6);
  b.state.pending[5] = [{ clientMsgId: "m-b", body: "b unsent", ts: 1, failed: true }]; b.persistUnsent(5);
  b.clearLocalAccountData(2);
  const a2 = await tab("a6", A);
  assert.equal(a2.loadDraft(5)?.text, "ALICE");
  assert.equal(a2.loadWikiDraft("home")?.body, "ALICE_WIKI");
  assert.equal(a2.lastConvId(), 5);
  // F5 (r5): unsent messages are per actor too.
  assert.deepEqual(JSON.parse(storage.getItem("atalks_unsent_1_5")!).map((u: Any) => u.clientMsgId), ["m-a"], "A's unsent entry stays");
  assert.equal(storage.getItem("atalks_unsent_2_5"), null, "B's is gone");
  const b2 = await tab("b6", B);
  assert.equal(b2.loadDraft(5), null);
  assert.equal(b2.loadWikiDraft("home"), null);
  assert.equal(b2.lastConvId(), null);
  a2.clearLocalAccountData(1);
  // The storage-layout flag (F4 r5) is browser-level and names no account.
  assert.deepEqual([...storage.data.keys()].filter((k) => k.startsWith("atalks_") && k !== "atalks_storage_v"), [], "nothing of either account is left");
});

test("F2: legacy un-namespaced keys go once to the actor the old marker names, and the marker goes", async () => {
  storage.setItem("atalks_owner", "1");
  storage.setItem("atalks_draft_5", "LEGACY_A");
  storage.setItem("atalks_wiki_draft_home", JSON.stringify({ title: "t", body: "LEGACY_WIKI" }));
  storage.setItem("atalks_last_conv", "5");
  storage.setItem("atalks_recent", "[5]");
  storage.setItem("atalks_unsent_5", JSON.stringify([{ clientMsgId: "old", body: "legacy unsent", ts: 1 }]));
  const b = await tab("b7", B);             // B signs in first in this browser
  assert.equal(b.loadDraft(5), null);
  assert.equal(b.loadWikiDraft("home"), null);
  assert.equal(b.lastConvId(), null);
  assert.equal(storage.getItem("atalks_owner"), null, "the marker is gone");
  assert.equal(storage.getItem("atalks_draft_5"), null, "the legacy key is gone");
  assert.equal(storage.getItem("atalks_unsent_5"), null, "the shared legacy list is gone");
  assert.equal(JSON.parse(storage.getItem("atalks_unsent_1_5")!)[0].clientMsgId, "old", "the legacy unsent entry is A's (in A's key, F5 r5)");
  assert.equal(storage.getItem("atalks_unsent_2_5"), null, "and not B's");
  const a = await tab("a7", A);
  assert.equal(a.loadDraft(5)?.text, "LEGACY_A");
  assert.equal(a.loadWikiDraft("home")?.body, "LEGACY_WIKI");
  assert.equal(a.lastConvId(), 5);
  assert.ok(a.visibleMessages(5).some((m: Any) => m.body === "legacy unsent"));
});

test("F2/F4 (r5): legacy keys with no marker at all are quarantined, never claimed by a sign-in", async () => {
  storage.setItem("atalks_draft_9", "old draft");
  const c = await tab("c1", { id: 3, handle: "c" });
  assert.equal(c.loadDraft(9), null, "the first sign-in does not inherit unattributed data");
  const d = await tab("d1", { id: 4, handle: "d" });
  assert.equal(d.loadDraft(9), null, "nor does any later one");
  assert.equal(storage.getItem("atalks_draft_9"), null, "the legacy key is deleted");
});

// ------------------------------------------------------------------ F3
test("F3 (codex repro): an empty first page of a filter-only listing keeps Show older", () => {
  const parsed = { text: "", in: "general", from: "zed", before: null, after: null };
  const html: string = search.resultsHtml([], [], { loading: false, parsed, unresolvedIn: false, error: null, q: "in:#general from:@zed", listing: true, olderBefore: 201, scanned: 200 });
  assert.match(html, /data-older="201"/, "the pager stays");
  assert.match(html, /No matches in the newest 200 messages - show older/);
  assert.doesNotMatch(html, /Nothing in #general matches these filters/);
});

test("F3: with no older messages the empty listing still says nothing matches, without a pager", () => {
  const parsed = { text: "", in: "general", from: "zed", before: null, after: null };
  const html: string = search.resultsHtml([], [], { loading: false, parsed, unresolvedIn: false, error: null, q: "", listing: true, olderBefore: null, scanned: 40 });
  assert.match(html, /Nothing in #general matches these filters/);
  assert.doesNotMatch(html, /data-older/);
});
