/**
 * T-MG-38: Wiki and claimed resources as their own rail place, above Admin.
 *
 * Node tests in the style of ui-s1-sidebar.test.ts (a document stub, pure exported functions,
 * string checks of the rendered markup) and ui-s3-router.test.ts (the parse/build table).
 * The live part (the `on` state following a click, the phone drawer) is checked by the
 * orchestrator in a browser.
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
  const router = await import(UI + "router.js");
  const store = await import(UI + "state.js");
  return { sidebar, router, ...store };
}

function seedState(state: Record<string, any>) {
  state.actor = { id: 1, handle: "michal", kind: "human", isAdmin: false };
  state.conversations = [
    { id: 1, kind: "public", slug: "general" },
    { id: 3, kind: "dm", others: [{ handle: "nestor", kind: "agent" }] },
  ];
  state.memberships = { 1: true, 3: true };
  state.unread = {};
  state.unreadBadge = {};
  state.actorsList = [{ id: 7, handle: "nestor", kind: "agent", lastActiveAt: Math.floor(Date.now() / 1000) }];
  state.presence = [];
  state.openQuestions = {};
  state.digest = null;
  state.leases = [{ resource: "deploy", handle: "nestor", expiresAt: Math.floor(Date.now() / 1000) + 600 }];
  state.wiki = { pages: [{ slug: "runbook", title: "Runbook" }], slug: null };
  state.view = "chat";
  state.activeId = 1;
}

function renderWith(sidebar: Record<string, any>, t: { mock: { method: Function } }) {
  const panel = { innerHTML: "", scrollTop: 0, querySelectorAll: () => [], querySelector: () => null };
  t.mock.method(document, "getElementById", (id: string) => id === "sb-scroll" ? panel as unknown as HTMLElement : null);
  sidebar.renderSidebarList();
  return panel.innerHTML;
}

test("T38: the Wiki place shows exactly the wiki tree and the claimed resources; Home shows neither", async () => {
  const { sidebar } = await loadUi();
  assert.deepEqual(sidebar.sectionsFor("wiki"), ["wiki", "leases"]);
  assert.ok(!sidebar.sectionsFor("home").includes("wiki"), "the wiki tree moved out of Home");
  assert.ok(!sidebar.sectionsFor("home").includes("leases"), "the claimed resources moved out of Home");
  assert.ok(sidebar.sectionsFor("home").includes("channels"), "Home keeps its channels");
  assert.deepEqual(sidebar.sectionsFor("dms"), ["directs", "people"], "DMs is unchanged");
});

test("T38: setSidebarPlace keeps \"wiki\" as a third place; nonsense still falls back to Home", async () => {
  const { sidebar } = await loadUi();
  sidebar.setSidebarPlace("wiki");
  assert.equal(sidebar.getSidebarPlace(), "wiki");
  sidebar.setSidebarPlace("dms");
  assert.equal(sidebar.getSidebarPlace(), "dms");
  sidebar.setSidebarPlace("nonsense");
  assert.equal(sidebar.getSidebarPlace(), "home");
});

test("T38: the Wiki place renders the tree and the leases, no channels, no people; Home renders no wiki", async (t) => {
  const { sidebar, state } = await loadUi();
  seedState(state);
  stored.clear();
  sidebar.setSidebarPlace("wiki");
  let html = renderWith(sidebar, t);
  assert.ok(html.includes('data-section="wiki"'), "Wiki header");
  assert.ok(html.includes('data-section="leases"'), "Claimed resources header");
  assert.ok(html.indexOf('data-section="wiki"') < html.indexOf('data-section="leases"'), "the tree comes first");
  assert.ok(html.includes('data-wikipage="runbook"'), "the wiki page row");
  assert.ok(html.includes('data-freelease="deploy"') || html.includes("deploy"), "the lease row");
  assert.ok(!html.includes('data-open="1"'), "no #general");
  assert.ok(!html.includes('data-section="channels"'), "no Channels header");
  assert.ok(!html.includes('data-section="directs"'), "no Direct conversations header");
  assert.ok(!html.includes('data-person="nestor"'), "no people");

  sidebar.setSidebarPlace("home");
  html = renderWith(sidebar, t);
  assert.ok(html.includes('data-section="channels"'), "Home keeps Channels");
  assert.ok(!html.includes('data-section="wiki"'), "Home has no Wiki header");
  assert.ok(!html.includes('data-section="leases"'), "Home has no Claimed resources header");
});

test("T38: collapsed-section storage keeps working for the wiki and leases sections in their new place", async (t) => {
  const { sidebar, state } = await loadUi();
  seedState(state);
  stored.clear();
  sidebar.setSidebarPlace("wiki");
  sidebar.setSectionCollapsed("leases", true);
  assert.deepEqual(JSON.parse(stored.get("atalks_sb_collapsed") ?? "{}"), { leases: true });
  const html = renderWith(sidebar, t);
  assert.match(html, /<button[^>]*class="sb-toggle"[^>]*data-section="leases"[^>]*aria-expanded="false"/);
  assert.match(html, /<button[^>]*class="sb-toggle"[^>]*data-section="wiki"[^>]*aria-expanded="true"/);
  sidebar.setSectionCollapsed("leases", false);
  sidebar.setSidebarPlace("home");
});

test("T38: the rail has #rail-wiki (iconDoc) between Activity and Admin, for every signed-in actor", () => {
  const app = readFileSync(UI + "app.js", "utf8");
  const at = (id: string) => app.indexOf(`railButton("${id}"`);
  assert.ok(at("rail-wiki") > 0, "app.js rail has #rail-wiki");
  assert.ok(at("rail-notif") < at("rail-wiki"), "Wiki comes after Activity");
  assert.ok(at("rail-wiki") < at("rail-users"), "Wiki comes before Admin");
  assert.ok(at("rail-users") < at("rail-search"), "Search stays last");
  assert.match(app, /railButton\("rail-wiki", t\("Wiki"\),[^\n]*iconDoc\(\)/, "the Wiki place uses the Primer book icon");
  assert.doesNotMatch(app, /adminHuman \? railButton\("rail-wiki"/, "the Wiki place is not gated on admin");
  assert.match(app, /getElementById\("rail-wiki"\)\.addEventListener\("click"/, "the button is wired");
  assert.match(app, /\["rail-wiki", "wiki"\]/, "paintRail handles the third place");
});

test("T38: #/wiki with no slug is the Wiki place's own route; #/wiki/<slug> still opens a page", async () => {
  const { router } = await loadUi();
  assert.deepEqual(router.parseRoute("#/wiki"), { view: "wikiPlace" });
  assert.deepEqual(router.parseRoute("#/wiki/runbook"), { view: "wiki", slug: "runbook" });
  assert.equal(router.buildRoute({ view: "wikiPlace" }), "#/wiki");
  assert.equal(router.buildRoute({ view: "wiki", slug: "runbook" }), "#/wiki/runbook");
  assert.deepEqual(router.parseRoute(router.buildRoute({ view: "wikiPlace" })), { view: "wikiPlace" });
  const app = readFileSync(UI + "app.js", "utf8");
  assert.match(app, /case "wikiPlace": [^\n]*goPlace\("wiki"\)/, "the route selects the Wiki place like #/dms does");
});

test("T38: every new English string of the Wiki place has a Polish translation", async () => {
  const { PL } = await import(UI + "i18n-pl.js");
  for (const key of ["Wiki", "Wiki and claimed resources", "Claimed resources"]) {
    assert.equal(typeof PL[key], "string", `i18n-pl.js has ${JSON.stringify(key)}`);
  }
});

// ------------------------------------------------------------------ fix round 1
// The orchestrator's browser check: `#/wiki/<slug>` left the rail on Home, and `#/c/general`
// from the Wiki place left a sidebar without channels. The place follows the NAVIGATION, in the
// sidebar module itself (every path - route, row, [[link]], search, Cmd+K - ends in a sidebar
// render), as a transition: the same page or conversation seen again never moves the place.

test("T38-r1: placeAfterNavigation - a wiki page selects Wiki; a conversation leaves Wiki for Home; DMs is untouched", async () => {
  const { sidebar } = await loadUi();
  assert.equal(sidebar.placeAfterNavigation("home", "wiki"), "wiki");
  assert.equal(sidebar.placeAfterNavigation("dms", "wiki"), "wiki");
  assert.equal(sidebar.placeAfterNavigation("wiki", "chat"), "home");
  assert.equal(sidebar.placeAfterNavigation("dms", "chat"), "dms", "a conversation from DMs keeps DMs, as today");
  assert.equal(sidebar.placeAfterNavigation("home", "chat"), "home");
  assert.equal(sidebar.placeAfterNavigation("wiki", "notifications"), "wiki", "other views move nothing");
});

test("T38-r1: a sidebar render after a wiki page opened puts the place on Wiki; a conversation opened from Wiki returns to Home; a repeat render moves nothing", async (t) => {
  const { sidebar, state } = await loadUi();
  seedState(state);
  stored.clear();
  sidebar.setSidebarPlace("home");
  state.view = "chat"; state.activeId = 1;
  renderWith(sidebar, t);
  assert.equal(sidebar.getSidebarPlace(), "home");

  // #/wiki/runbook (or a row, a [[link]], a search result): openWikiPage sets the view and asks for the sidebar.
  state.view = "wiki"; state.wiki.slug = "runbook";
  let html = renderWith(sidebar, t);
  assert.equal(sidebar.getSidebarPlace(), "wiki", "the page's tree is visible");
  assert.ok(html.includes('data-section="wiki"'));

  // The reader picks Home from the rail while on the page; a presence tick redraws the sidebar.
  sidebar.setSidebarPlace("home");
  renderWith(sidebar, t);
  assert.equal(sidebar.getSidebarPlace(), "home", "the same page seen again does not drag the reader back");

  // Back to the Wiki place, then #/c/general: a conversation from Wiki returns to Home.
  sidebar.setSidebarPlace("wiki");
  state.view = "chat"; state.activeId = 1;
  html = renderWith(sidebar, t);
  assert.equal(sidebar.getSidebarPlace(), "home", "no sidebar without channels");
  assert.ok(html.includes('data-section="channels"'));

  // In a conversation, the rail's Wiki place is a choice that survives redraws of the same conversation.
  sidebar.setSidebarPlace("wiki");
  renderWith(sidebar, t);
  assert.equal(sidebar.getSidebarPlace(), "wiki");
  // Another conversation (Cmd+K) from the Wiki place: Home again.
  state.activeId = 3;
  renderWith(sidebar, t);
  assert.equal(sidebar.getSidebarPlace(), "home");
  sidebar.setSidebarPlace("home");
});

test("T38-r1: app.js decides the place before drawing the rail and repaints the rail after every sidebar refresh", () => {
  const app = readFileSync(UI + "app.js", "utf8");
  const shell = app.indexOf("function renderShell()");
  const follow = app.indexOf("followPlace()", shell);
  const rail = app.indexOf('railButton("rail-chats"', shell);
  assert.ok(follow > shell && follow < rail, "renderShell settles the place before the rail markup");
  assert.match(app, /sidebar: \(\) => \{ renderSidebarList\(\); paintRail\(\); \}/, "views.sidebar paints the rail");
});
