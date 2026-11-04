/**
 * S7: counters and unread truth. One derivation (counters.js) feeds the tab title, the rail
 * badge and the "New messages" divider; the digest count never moves backwards in time; a
 * lost session returns to the sign-in screen with the draft kept.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

const ME = 1, OTHER = 2;
const msg = (id: number, actorId = OTHER) => ({ id, actorId, ts: 1_700_000_000 + id, body: "m" + id, kind: "text" });

async function loadUi() {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, getElementById: () => null, addEventListener() {},
    title: "", visibilityState: "visible",
  };
  g.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null };
  // Node has no navigator: the language falls back to the system locale. The assertions below
  // compare English source sentences, so pin it.
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const counters = await import(UI + "counters.js");
  const store = await import(UI + "state.js");
  return { counters, ...store };
}

// ------------------------------------------------------------ titleCount
test("titleCount sums the weighted badges plus unread wiki notifications, not the soft counts", async () => {
  const { counters, state } = await loadUi();
  state.unread = { 1: 7, 2: 3, 3: 4 };            // 7 in a channel (soft), 3 in a DM, 4 in a group
  state.unreadBadge = { 1: 2, 2: 3, 3: 4 };       // 2 mentions weigh in the channel
  state.notifications = [
    { id: 1, wikiSlug: "home", readAt: null },      // wiki change, unread: counts
    { id: 2, wikiSlug: "home", readAt: 123 },       // read: does not
    { id: 3, conversationId: 2, readAt: null },     // a DM mention: already in unreadBadge
  ];
  assert.equal(counters.titleCount(state), 2 + 3 + 4 + 1);
});

test("titleCount is 0 for an empty state and tolerates missing fields", async () => {
  const { counters } = await loadUi();
  assert.equal(counters.titleCount({}), 0);
  assert.equal(counters.titleCount({ unreadBadge: { 1: null, 2: "x" }, notifications: null }), 0);
});

// ------------------------------------------------------------ dividerAfter
test("dividerAfter with a read mark returns that mark when somebody else wrote after it", async () => {
  const { counters } = await loadUi();
  const list = [msg(10), msg(11, ME), msg(12), msg(13)];
  assert.equal(counters.dividerAfter(list, 11, 2, ME), 11);
});

test("dividerAfter with a read mark is null when only my own messages follow it", async () => {
  const { counters } = await loadUi();
  const list = [msg(10), msg(11), msg(12, ME), msg(13, ME)];
  assert.equal(counters.dividerAfter(list, 11, 0, ME), null);
});

test("dividerAfter with mark 0 and 5 unread places the line above the 5th message from the end", async () => {
  const { counters } = await loadUi();
  const list = [msg(1), msg(2), msg(3), msg(4), msg(5), msg(6), msg(7), msg(8)];
  const after = counters.dividerAfter(list, 0, 5, ME);
  // The divider goes before the first message by somebody else with id > after.
  const first = list.find((m) => m.id > after && m.actorId !== ME);
  assert.equal(first?.id, 4, "the 5th from the end is message 4");
  assert.equal(after, 3);
});

test("dividerAfter with mark 0 skips my own messages when counting back", async () => {
  const { counters } = await loadUi();
  const list = [msg(1), msg(2), msg(3, ME), msg(4), msg(5, ME), msg(6)];
  // 2 unread from others: 4 and 6; the line goes above 4.
  const after = counters.dividerAfter(list, 0, 2, ME);
  assert.equal(list.find((m) => m.id > after && m.actorId !== ME)?.id, 4);
});

test("dividerAfter with mark 0 and no unread shows nothing", async () => {
  const { counters } = await loadUi();
  assert.equal(counters.dividerAfter([msg(1), msg(2)], 0, 0, ME), null);
  assert.equal(counters.dividerAfter([], 0, 5, ME), null);
});

test("dividerAfter with mark 0 and more unread than loaded puts the line above the first message", async () => {
  const { counters } = await loadUi();
  const list = [msg(40), msg(41), msg(42)];
  const after = counters.dividerAfter(list, 0, 30, ME);
  assert.ok(after < 40 && after !== null);
  assert.equal(list.find((m) => m.id > after && m.actorId !== ME)?.id, 40);
});

test("dividerAfter ignores pending (non-numeric id) entries", async () => {
  const { counters } = await loadUi();
  const list = [msg(1), msg(2), { id: "tmp-1", actorId: OTHER, ts: 1, body: "", kind: "text", pending: true }];
  assert.equal(counters.dividerAfter(list, 0, 1, ME), 1);
});

// ------------------------------------------------------------ railBadges
test("railBadges derives the Activity badge from notifUnread and formats 99+", async () => {
  const { counters } = await loadUi();
  assert.deepEqual(counters.railBadges({ notifUnread: 3 }), { activity: 3 });
  assert.deepEqual(counters.railBadges({}), { activity: 0 });
  assert.equal(counters.badgeText(3), "3");
  assert.equal(counters.badgeText(150), "99+");
});

// ------------------------------------------------------------ digest anchor
test("acceptDigest keeps the newest answer: a late older poll never overwrites it, an error keeps what we had", async () => {
  const { counters } = await loadUi();
  const twelve = { count: 12, sinceId: 100, seq: 2 };
  // A response from an OLDER request (seq 1) arriving after the newer one is stale.
  assert.deepEqual(counters.acceptDigest(twelve, { count: 5, sinceId: 90, seq: 1 }), twelve);
  // A newer request wins, including a drop (the user read something).
  assert.deepEqual(counters.acceptDigest(twelve, { count: 5, sinceId: 110, seq: 3 }), { count: 5, sinceId: 110, seq: 3 });
  // A failed fetch (undefined) keeps the current digest; a real "nothing missed" (null) clears it.
  assert.deepEqual(counters.acceptDigest(twelve, undefined), twelve);
  assert.equal(counters.acceptDigest(twelve, { seq: 3, digest: null }.digest), null);
  assert.deepEqual(counters.acceptDigest(null, { count: 1, sinceId: 1, seq: 1 }), { count: 1, sinceId: 1, seq: 1 });
});

// ------------------------------------------------------------ dom title
test("updateTitleBadge writes the counters.js total into the tab title", async () => {
  const { state } = await loadUi();
  const dom = await import(UI + "dom.js");
  state.unread = { 1: 9 };
  state.unreadBadge = { 1: 2 };
  state.notifications = [{ id: 1, wikiSlug: "a", readAt: null }];
  dom.updateTitleBadge();
  assert.equal(document.title, "(3) AgentTalks");
  state.unreadBadge = {};
  state.notifications = [];
  dom.updateTitleBadge();
  assert.equal(document.title, "AgentTalks");
});

// ------------------------------------------------------------ api 401
test("api() reports a 401 to the session-lost handler, except for the sign-in and sign-out calls", async (t) => {
  await loadUi();
  const api = await import(UI + "api.js");
  const seen: string[] = [];
  api.onUnauthorized((e: { status: number }, path: string) => { seen.push(`${e.status} ${path}`); });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "session not found", code: "session_invalid" }), { status: 401 }));
  await assert.rejects(api.api("GET", "/api/conversations"));
  await assert.rejects(api.api("POST", "/api/login", { handle: "a", password: "b" }));
  await assert.rejects(api.api("POST", "/api/logout"));
  assert.deepEqual(seen, ["401 /api/conversations"]);
  const sse = await import(UI + "sse-events.js");
  api.onUnauthorized(sse.onSessionLost);
});

test("api() errors carry a human sentence, the raw server text stays aside", async (t) => {
  await loadUi();
  const api = await import(UI + "api.js");
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "conversation is archived", code: "conversation_archived" }), { status: 409 }));
  const err = await api.api("POST", "/api/conversations/1/messages", { body: "x" }).catch((e: Error) => e);
  assert.equal(err.message, "This channel is archived - it no longer accepts messages.");
  assert.equal(err.serverMessage, "conversation is archived");
  assert.equal(api.describeError(err), err.message);
});

// ------------------------------------------------------------ session lost
test("a lost session saves the draft, returns to sign-in with a toast and keeps the draft for the next login", async (t) => {
  const { state, resetState, views } = await loadUi();
  const api = await import(UI + "api.js");
  const sse = await import(UI + "sse-events.js");
  resetState();
  state.actor = { id: ME, handle: "me" };
  state.activeId = 7;
  state.conversations = [{ id: 7, slug: "bugs" }];
  state.memberships = { 7: { conversationId: 7 } };
  const ta = { value: "half a thought" };
  t.mock.method(document, "getElementById", (id: string) => id === "composer-input" ? ta as unknown as HTMLElement : null);
  const saved: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v; }, removeItem: (k: string) => { delete saved[k]; }, length: 0, key: () => null };
  let rendered = 0;
  views.render = () => { rendered++; };
  // A tiny element stub: enough for showToast to build its node and set the text.
  const shown: string[] = [];
  const stubEl = (): Record<string, unknown> => {
    const el: Record<string, unknown> = {
      className: "", innerHTML: "", _text: "",
      setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {} },
      querySelector: () => el,
    };
    Object.defineProperty(el, "textContent", { set(v: string) { shown.push(v); }, get() { return ""; } });
    return el;
  };
  (document as unknown as Record<string, unknown>).createElement = stubEl;
  (document as unknown as Record<string, unknown>).body = { appendChild() {} };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "x", code: "session_invalid" }), { status: 401 }));
  await assert.rejects(api.api("GET", "/api/conversations"));
  assert.equal(state.actor, null, "the session is gone");
  assert.equal(rendered, 1, "the screen is redrawn (sign-in)");
  assert.ok(shown.some((s) => s.includes("Your session ended")), `toast shown: ${JSON.stringify(shown)}`);
  assert.deepEqual(Object.keys(state.memberships), [], "afterLogin reloads the list");
  assert.equal(state.drafts[7]?.text, "half a thought", "the draft survives in memory");
  assert.equal(saved["atalks_draft_7"], "half a thought", "and in localStorage");
  assert.equal(typeof sse.onSessionLost, "function");
  // A second 401 while already signed out changes nothing.
  await assert.rejects(api.api("GET", "/api/conversations"));
  assert.equal(rendered, 1);
  views.render = () => {};
});

// ------------------------------------------------------------ join marks read
test("joinChannel marks the channel read right after joining", async (t) => {
  const { state, resetState } = await loadUi();
  const actions = await import(UI + "actions.js");
  resetState();
  state.actor = { id: ME, handle: "me" };
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: { method: string }) => {
    calls.push(`${init.method} ${url}`);
    if (url === "/api/conversations") return new Response(JSON.stringify({ conversations: [{ id: 5, slug: "bugs" }], memberships: [{ conversationId: 5 }], unread: [{ conversationId: 5, unread: 9, badge: 0 }] }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await actions.joinChannel(5);
  assert.equal(state.unread[5], 9, "the fresh list still says 9 unread");
  t.mock.timers.tick(600);
  await new Promise((r) => setImmediate(r));
  assert.ok(calls.includes("POST /api/conversations/5/read"), `read was called: ${calls.join(", ")}`);
  assert.equal(state.unread[5], 0, "the row un-bolds once the server confirms");
});

// ------------------------------------------------------------ mark freeze
test("markReadDebounced freezes a zero read mark at the divider position before clearing the count", async (t) => {
  const { state, resetState } = await loadUi();
  const data = await import(UI + "data.js");
  resetState();
  state.actor = { id: ME, handle: "me" };
  state.activeId = 3;
  state.readMark[3] = 0;
  state.unread[3] = 2;
  state.msgs[3] = [msg(1), msg(2), msg(3), msg(4)];
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({}), { status: 200 }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  data.markReadDebounced(3);
  t.mock.timers.tick(600);
  await new Promise((r) => setImmediate(r));
  assert.equal(state.unread[3], 0);
  assert.equal(state.readMark[3], 2, "the divider stays above message 3 on the next render");
});
