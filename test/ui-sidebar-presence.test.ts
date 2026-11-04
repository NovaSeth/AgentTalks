import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const DAY = 24 * 3600;
const NOW = 2_000_000_000;

async function loadUi() {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, getElementById: () => null, addEventListener() {},
    title: "", visibilityState: "visible",
  };
  g.window = { matchMedia: () => ({ matches: false }) };
  g.sessionStorage = { getItem: () => null };
  g.localStorage = { getItem: () => null };
  const sidebar = await import(UI + "widok-sidebar.js");
  const data = await import(UI + "dane.js");
  const store = await import(UI + "stan.js");
  return { sidebar, data, ...store };
}

for (const [days, expected] of [[13, "active"], [14, "faded"], [90, "archived"]] as const) {
  test(`sidebar classifies ${days} silent days as ${expected}`, async () => {
    const { sidebar } = await loadUi();
    assert.equal(typeof sidebar.presenceBucket, "function", "sidebar must expose its presence classifier");
    assert.equal(sidebar.presenceBucket(NOW - days * DAY, false, NOW * 1000), expected);
  });
}

test("online presence wins over old activity", async () => {
  const { sidebar } = await loadUi();
  assert.equal(typeof sidebar.presenceBucket, "function", "sidebar must expose its presence classifier");
  assert.equal(sidebar.presenceBucket(NOW - 365 * DAY, true, NOW * 1000), "active");
});

test("the actor directory cache retains uploaded avatars", async (t) => {
  const { data, state, avatarUrl } = await loadUi();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ actors: [{
    id: 42, handle: "returning-agent", displayName: "Returning agent", kind: "agent",
    avatar: "h123", createdAt: NOW - 365 * DAY, lastActiveAt: NOW - 90 * DAY,
  }] }), { status: 200 }));
  state.actorsCache = {};
  await data.ensureActors({ force: true });
  assert.equal(state.actorsCache[42].avatar, "h123");
  assert.equal(avatarUrl("returning-agent"), "/api/actors/42/avatar?v=h123");
});

for (const days of [14, 90]) {
  test(`a message immediately restores an actor silent for ${days} days without fetching`, async (t) => {
    const { sidebar, data, state, widok } = await loadUi();
    const events = await import(UI + "zdarzenia-sse.js");
    t.mock.method(Date, "now", () => NOW * 1000);
    const panel = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], querySelector: () => null };
    t.mock.method(document, "getElementById", (id: string) => id === "sb-scroll" ? panel as unknown as HTMLElement : null);
    const listeners = new Map<string, (event: { data: string }) => unknown>();
    (globalThis as Record<string, unknown>).EventSource = class {
      addEventListener(name: string, handler: (event: { data: string }) => unknown) { listeners.set(name, handler); }
      close() {}
    };
    t.after(() => events.disconnectSSE());
    const actor = {
      id: 42, handle: "returning-agent", displayName: "Returning agent", kind: "agent",
      avatar: "h123", createdAt: NOW - 365 * DAY, lastActiveAt: NOW - days * DAY,
    };
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return new Response(JSON.stringify({ actors: [actor] }), { status: 200 });
    });
    state.actor = { id: 1, handle: "viewer", kind: "human" };
    state.conversations = [{ id: 7, kind: "public", slug: "general" }];
    state.actorsCache = {};
    state.presence = [];
    state.activeId = null;
    state.threadOpen = null;
    state.unread = {};
    await data.ensureActors({ force: true });
    sidebar.renderSidebarList();
    assert.match(panel.innerHTML, /class="conv person faded"/);
    assert.equal(panel.innerHTML.includes('id="sb-arch"'), days === 90);
    let renders = 0;
    t.mock.method(widok, "sidebar", () => { renders++; sidebar.renderSidebarList(); });
    events.connectSSE();
    const receive = listeners.get("message");
    assert.ok(receive, "the real SSE connection must register the message handler");
    await receive({ data: JSON.stringify({ conversationId: 7, message: {
      id: 100, actorId: 42, conversationId: 7, ts: NOW, kind: "text", body: "Back again",
      threadId: null, editedAt: null, deletedAt: null,
    } }) });
    assert.equal(sidebar.presenceBucket(state.actorsList[0].lastActiveAt, false, NOW * 1000), "active");
    assert.equal(state.actorsCache[42].lastActiveAt, NOW);
    assert.equal(state.actorsCache[42].avatar, "h123");
    assert.ok(renders > 0, "the open sidebar must redraw on activity");
    assert.doesNotMatch(panel.innerHTML, /class="conv person faded"|id="sb-arch"/);
    assert.match(panel.innerHTML, /class="conv person" data-person="returning-agent"/);
    // Replayed messages must not move the actor's latest activity backwards.
    await receive({ data: JSON.stringify({ conversationId: 7, message: {
      id: 99, actorId: 42, conversationId: 7, ts: NOW - 120 * DAY, kind: "text", body: "Old message",
      threadId: null, editedAt: null, deletedAt: null,
    } }) });
    assert.equal(state.actorsList[0].lastActiveAt, NOW);
    assert.equal(state.actorsCache[42].lastActiveAt, NOW);
    assert.equal(requests, 1, "message activity must use the existing actor cache");
  });
}
