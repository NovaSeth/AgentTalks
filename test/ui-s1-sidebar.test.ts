/**
 * T-MG-3 slice S1: collapsible sidebar sections + rail places.
 *
 * Node tests in the style of ui-sidebar-presence.test.ts: a document stub, an import of the
 * module, pure exported functions, and one string check of the rendered markup.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

const stored = new Map<string, string>();

async function loadUi() {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, getElementById: () => null, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], title: "", visibilityState: "visible",
  };
  g.window = { matchMedia: () => ({ matches: false }), innerWidth: 1728, innerHeight: 900 };
  g.sessionStorage = { getItem: () => null };
  g.localStorage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => { stored.set(k, v); },
    removeItem: (k: string) => { stored.delete(k); },
  };
  const sidebar = await import(UI + "view-sidebar.js");
  const store = await import(UI + "state.js");
  return { sidebar, ...store };
}

const ROWS = [
  { id: 1, kind: "public", slug: "general" },
  { id: 2, kind: "public", slug: "bugs" },
  { id: 3, kind: "private", slug: "design-review" },
];
const UNREAD = { 2: 3 };

test("S1-visibleRows 1: an open section lists every row", async () => {
  const { sidebar } = await loadUi();
  assert.equal(typeof sidebar.visibleRows, "function", "view-sidebar.js must export visibleRows");
  assert.deepEqual(sidebar.visibleRows("channels", ROWS, false, 1, UNREAD), ROWS);
});

test("S1-visibleRows 2: a collapsed section keeps only its unread rows", async () => {
  const { sidebar } = await loadUi();
  assert.deepEqual(sidebar.visibleRows("channels", ROWS, true, null, UNREAD).map((r: { id: number }) => r.id), [2]);
});

test("S1-visibleRows 3: a collapsed section keeps the active row next to the unread ones", async () => {
  const { sidebar } = await loadUi();
  assert.deepEqual(sidebar.visibleRows("channels", ROWS, true, 3, UNREAD).map((r: { id: number }) => r.id), [2, 3]);
});

test("S1-visibleRows 4: a collapsed section with nothing unread and nothing active shows nothing", async () => {
  const { sidebar } = await loadUi();
  assert.deepEqual(sidebar.visibleRows("channels", ROWS, true, 99, {}), []);
});

test("S1: collapsed state round-trips through localStorage atalks_sb_collapsed", async () => {
  const { sidebar, state } = await loadUi();
  stored.clear();
  sidebar.setSectionCollapsed("channels", true);
  assert.equal(state.sbCollapsed.channels, true, "state.sbCollapsed mirrors the toggle");
  assert.deepEqual(JSON.parse(stored.get("atalks_sb_collapsed") ?? "{}"), { channels: true });
  sidebar.setSectionCollapsed("channels", false);
  assert.deepEqual(JSON.parse(stored.get("atalks_sb_collapsed") ?? "{}"), {});
  assert.deepEqual(sidebar.collapsedFromStorage({ getItem: () => '{"wiki":true,"people":false}' }), { wiki: true });
  assert.deepEqual(sidebar.collapsedFromStorage({ getItem: () => "not json" }), {}, "bad storage falls back to open");
  assert.deepEqual(sidebar.collapsedFromStorage({ getItem: () => null }), {});
});

test("S1: the rail places know which sections they show", async () => {
  const { sidebar } = await loadUi();
  assert.deepEqual(sidebar.sectionsFor("dms"), ["directs", "people"]);
  assert.ok(sidebar.sectionsFor("home").includes("channels"));
  // T-MG-38: the wiki tree moved from Home to its own Wiki place (ui-t38-wiki-place.test.ts).
  assert.ok(!sidebar.sectionsFor("home").includes("wiki"));
  assert.ok(sidebar.sectionsFor("wiki").includes("wiki"));
  assert.deepEqual(sidebar.sectionsFor("nonsense"), sidebar.sectionsFor("home"), "an unknown place behaves like Home");
});

function seedState(state: Record<string, any>) {
  state.actor = { id: 1, handle: "michal", kind: "human", isAdmin: true };
  state.conversations = [
    { id: 1, kind: "public", slug: "general" },
    { id: 2, kind: "public", slug: "bugs" },
    { id: 3, kind: "dm", others: [{ handle: "nestor", kind: "agent" }] },
    { id: 4, kind: "public", slug: "random" },
  ];
  state.memberships = { 1: true, 2: true, 3: true };
  state.unread = { 2: 5 };
  state.unreadBadge = {};
  state.actorsList = [{ id: 7, handle: "nestor", kind: "agent", lastActiveAt: Math.floor(Date.now() / 1000) }];
  state.presence = [];
  state.openQuestions = {};
  state.digest = null;
  state.leases = [];
  state.wiki = { pages: [], slug: null };
  state.view = "chat";
  state.activeId = 3;
}

function renderWith(sidebar: Record<string, any>, t: { mock: { method: Function } }) {
  const panel = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], querySelector: () => null };
  t.mock.method(document, "getElementById", (id: string) => id === "sb-scroll" ? panel as unknown as HTMLElement : null);
  sidebar.renderSidebarList();
  return panel.innerHTML;
}

test("S1: section headers are buttons whose aria-expanded matches state; collapsed Channels lists exactly #bugs", async (t) => {
  const { sidebar, state } = await loadUi();
  seedState(state);
  stored.clear();
  sidebar.setSidebarPlace("home");
  sidebar.setSectionCollapsed("channels", false);
  let html = renderWith(sidebar, t);
  assert.match(html, /<button[^>]*class="sb-toggle"[^>]*data-section="channels"[^>]*aria-expanded="true"/);
  assert.ok(html.includes('data-open="1"'), "open Channels shows #general");
  assert.ok(html.includes('data-open="2"'), "open Channels shows #bugs");

  sidebar.setSectionCollapsed("channels", true);
  html = renderWith(sidebar, t);
  assert.match(html, /<button[^>]*class="sb-toggle"[^>]*data-section="channels"[^>]*aria-expanded="false"/);
  assert.ok(!html.includes('data-open="1"'), "collapsed Channels hides the read #general");
  assert.ok(html.includes('data-open="2"'), "collapsed Channels still lists the unread #bugs");
  assert.ok(html.includes('data-open="3"'), "the Direct conversations section is untouched");
  assert.ok(html.includes('data-open="4"'), "the joinable channels section is untouched");
  sidebar.setSectionCollapsed("channels", false);
});

test("S1: the DMs place renders no channel rows, only direct conversations and people", async (t) => {
  const { sidebar, state } = await loadUi();
  seedState(state);
  sidebar.setSidebarPlace("dms");
  const html = renderWith(sidebar, t);
  sidebar.setSidebarPlace("home");
  assert.ok(!html.includes('data-open="1"'), "no #general");
  assert.ok(!html.includes('data-open="2"'), "no #bugs even though it is unread");
  assert.ok(!html.includes('data-open="4"'), "no joinable channel");
  assert.ok(html.includes('data-open="3"'), "the DM with @nestor stays");
  assert.ok(html.includes('data-person="nestor"'), "people stay");
  assert.ok(!html.includes('data-section="channels"'), "no Channels header");
  assert.ok(!html.includes('data-section="wiki"'), "no Wiki header");
});

test("S1: the rail offers Home, DMs, Activity and Admin and the sidebar header drops the duplicate sign-out", () => {
  const app = readFileSync(UI + "app.js", "utf8");
  for (const id of ["rail-chats", "rail-dms", "rail-notif", "rail-wiki", "rail-users"]) {
    assert.ok(app.includes(`"${id}"`), `app.js rail has #${id}`);
  }
  assert.ok(app.includes('t("Activity")'), "the bell is named Activity");
  assert.ok(app.includes('t("Home")'), "the first place is Home");
  assert.ok(app.includes('t("Direct messages")'), "the second place is DMs");
  const sidebar = readFileSync(UI + "view-sidebar.js", "utf8");
  assert.ok(!sidebar.includes('id="btn-logout"'), "sign out lives in the account menu only");
  assert.ok(sidebar.includes('id="btn-search"'), "search stays reachable from the sidebar");
});
