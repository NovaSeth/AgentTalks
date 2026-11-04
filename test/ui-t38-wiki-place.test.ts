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

// A small browser (fix round 2): elements live in a map by id, so the rail buttons keep the
// classes paintRail toggles and the shell keeps the markup renderShell wrote; the hashchange
// listener app.js installs is captured, so a test can drive the real route handler.
const elements = new Map<string, any>();
const listeners: Record<string, Function> = {};
function makeEl(id = ""): any {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  return {
    id, innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    classList: {
      add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c),
      toggle: (c: string, on?: boolean) => { if (on === undefined) on = !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; },
      contains: (c: string) => classes.has(c),
    },
    setAttribute: (k: string, v: string) => { attrs.set(k, v); }, getAttribute: (k: string) => attrs.get(k) ?? null,
    removeAttribute: (k: string) => { attrs.delete(k); }, hasAttribute: (k: string) => attrs.has(k),
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => makeEl(), querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
  };
}
function el(id: string) {
  if (!elements.has(id)) {
    const node = makeEl(id);
    // The app root: writing its markup replaces the rail, as a browser would, so a class paintRail
    // toggled on an older rail button does not survive a full render.
    if (id === "app") {
      let html = "";
      Object.defineProperty(node, "innerHTML", {
        get: () => html,
        set: (v: string) => { html = v; for (const [k, n] of elements) if (k.startsWith("rail-")) n.classList.remove("on"); },
      });
    }
    elements.set(id, node);
  }
  return elements.get(id);
}

async function loadUi() {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: { style: { setProperty() {} } }, body: makeEl("body"), head: makeEl("head"), title: "",
    getElementById: (id: string) => el(id), createElement: () => makeEl(), createTextNode: () => makeEl(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (name: string, fn: Function) => { listeners[name] = fn; }, removeEventListener() {},
    innerWidth: 1728, innerHeight: 900, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local" },
    scrollY: 0, scrollTo() {},
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => { stored.set(k, v); },
    removeItem: (k: string) => { stored.delete(k); },
  };
  g.HTMLImageElement = class {};
  g.EventSource = class { close() {} addEventListener() {} };
  g.history = { back() {}, forward() {}, replaceState() {}, pushState() {} };
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

// ------------------------------------------------------------------ fix round 2
// The orchestrator's second browser check: `#/c/general` from a wiki page kept the Wiki place,
// `#/wiki/<slug>` from DMs kept DMs. This test drives the REAL route handler (the hashchange
// listener app.js installs) through both sequences, with a server that answers the few GETs
// the routes make.

async function bootApp() {
  const ui = await loadUi();
  const g = globalThis as Record<string, any>;
  // A held GET (fix round 3): `holdWiki(key)` makes every request whose path contains the key
  // wait until the returned release() is called - a slow server, for the race of F3.
  const holds = new Map<string, Promise<void>>();
  const holdWiki = (key: string) => {
    let release = () => {};
    holds.set(key, new Promise<void>((r) => { release = () => { holds.delete(key); r(); }; }));
    return release;
  };
  g.fetch = async (path: string) => {
    for (const [key, p] of holds) if (path.includes(key)) await p;
    const json = /\/api\/wiki\/[^/]+\/history/.test(path) ? { revisions: [] }
      : /\/api\/wiki\/[^/]+$/.test(path) ? { page: { slug: path.split("/").pop(), title: "Page", revisions: 1, updatedBy: "nestor", updatedAt: 0, createdBy: "nestor" }, files: [] }
      : /\/messages/.test(path) ? { messages: [] }
      : {};
    return { ok: true, status: 200, json: async () => json, text: async () => "", headers: { get: () => null } };
  };
  await import(UI + "app.js");
  await new Promise((r) => setTimeout(r, 30));
  const { state, sidebar, views } = ui;
  seedState(state);
  state.wiki = { pages: [{ slug: "nowosci", title: "Nowosci" }, { slug: "slow", title: "Slow" }], slug: null, editing: false, draft: null, page: null, files: [], history: [] };
  state.msgs = state.msgs || {}; state.loaded = state.loaded || {}; state.readMark = state.readMark || {};
  const goNoWait = (hash: string) => {
    g.location.hash = hash;
    return listeners.hashchange({ newURL: "https://test.local/" + hash });
  };
  const go = async (hash: string) => {
    await goNoWait(hash);
    await new Promise((r) => setTimeout(r, 10));
  };
  const railOn = () => ["rail-chats", "rail-dms", "rail-wiki"].filter((id) => el(id).classList.contains("on")
    || new RegExp('id="' + id + '" aria-current="page"').test(el("app").innerHTML));
  return { state, sidebar, views, go, goNoWait, holdWiki, railOn };
}

test("T38-r2: the route handler - a conversation opened from a wiki page returns to Home; a wiki page opened from DMs selects Wiki", async () => {
  const { state, sidebar, go, railOn } = await bootApp();
  sidebar.setSidebarPlace("home");
  await go("#/c/general");
  assert.equal(state.view, "chat");
  assert.equal(sidebar.getSidebarPlace(), "home");

  await go("#/wiki/nowosci");
  assert.equal(state.view, "wiki");
  assert.equal(sidebar.getSidebarPlace(), "wiki", "a wiki page lights Wiki");

  await go("#/c/general");
  assert.equal(state.view, "chat");
  assert.equal(sidebar.getSidebarPlace(), "home", "a conversation from the Wiki place returns to Home");
  assert.deepEqual(railOn(), ["rail-chats"]);

  await go("#/dms");
  assert.equal(sidebar.getSidebarPlace(), "dms");

  await go("#/wiki/nowosci");
  assert.equal(state.view, "wiki");
  assert.equal(sidebar.getSidebarPlace(), "wiki", "a wiki page from DMs lights Wiki");
  assert.ok(railOn().includes("rail-wiki"));
  assert.ok(!railOn().includes("rail-dms"));
});

// ------------------------------------------------------------------ fix round 3 (Codex review r1)
// F1 Wiki chosen from Activity opened Home; F2 reopening the current page by a non-route entry
// kept the tree hidden; F3 a delayed route completion overrode a newer place. The rule now lives
// in ONE place: router.js reports every navigation (syncRoute, which every opener calls at the
// START, before it awaits anything) and app.js moves the place from that report alone. Nothing
// happens on completion or on a redraw, so a newer choice always wins.

test("T38-r3: placeAfterNavigation - a wiki page selects Wiki; a conversation (channel or DM) leaves Wiki for Home; the rest moves nothing", async () => {
  const { sidebar } = await loadUi();
  assert.equal(sidebar.placeAfterNavigation("home", "wiki"), "wiki");
  assert.equal(sidebar.placeAfterNavigation("dms", "wiki"), "wiki");
  assert.equal(sidebar.placeAfterNavigation("wiki", "chat"), "home");
  assert.equal(sidebar.placeAfterNavigation("wiki", "dm"), "home");
  assert.equal(sidebar.placeAfterNavigation("dms", "chat"), "dms", "a conversation from DMs keeps DMs, as today");
  assert.equal(sidebar.placeAfterNavigation("home", "dm"), "home");
  for (const v of ["search", "threads", "unreads", "activity", "dms", "wikiPlace", "home"]) {
    assert.equal(sidebar.placeAfterNavigation("wiki", v), "wiki", v);
  }
});

test("T38-r3 F1: Wiki chosen from Activity opens the chat with the Wiki place and its tree", async () => {
  const { state, sidebar, go, views } = await bootApp();
  await go("#/c/general");
  state.view = "notifications";
  views.render();
  await go("#/wiki");
  assert.equal(state.view, "chat");
  assert.equal(sidebar.getSidebarPlace(), "wiki");
  assert.ok(String(el("sb-scroll").innerHTML).includes('data-section="wiki"'), "the tree is drawn");
  // A redraw of the sidebar (a presence tick) keeps the choice.
  views.sidebar();
  assert.equal(sidebar.getSidebarPlace(), "wiki");
});

test("T38-r3 F2: reopening the current page through a non-route entry selects Wiki again; a plain redraw keeps Home", async () => {
  const { state, sidebar, views } = await bootApp();
  const { openWikiPage } = await import(UI + "view-wiki.js");
  await openWikiPage("nowosci");
  assert.equal(sidebar.getSidebarPlace(), "wiki");
  sidebar.setSidebarPlace("home");
  views.sidebar();
  assert.equal(sidebar.getSidebarPlace(), "home", "a redraw keeps the reader's choice");
  await openWikiPage("nowosci");   // a [[link]] or a breadcrumb to the page on screen
  assert.equal(state.view, "wiki");
  assert.equal(sidebar.getSidebarPlace(), "wiki");
  assert.ok(String(el("sb-scroll").innerHTML).includes('data-section="wiki"'));
});

test("T38-r3 F3: a route that completes after a newer place was chosen does not take the place back", async () => {
  const { state, sidebar, go, goNoWait, holdWiki } = await bootApp();
  await go("#/c/general");
  const release = holdWiki("slow");
  const pending = goNoWait("#/wiki/slow");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sidebar.getSidebarPlace(), "wiki", "the place moves when the navigation starts");
  await go("#/dms");
  assert.equal(sidebar.getSidebarPlace(), "dms");
  release();
  await pending;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sidebar.getSidebarPlace(), "dms", "the late completion changes nothing");
  // The same for a conversation whose load finishes after the reader picked Wiki from the rail.
  const releaseMsgs = holdWiki("messages");
  const pendingConv = goNoWait("#/c/general");
  await new Promise((r) => setTimeout(r, 5));
  sidebar.setSidebarPlace("wiki");
  releaseMsgs();
  await pendingConv;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sidebar.getSidebarPlace(), "wiki");
  assert.equal(state.view, "chat");
});

test("T38-r3: the rule has ONE home - router.js reports navigations, app.js applies them; no settle-on-completion, no follow-on-render", () => {
  const app = readFileSync(UI + "app.js", "utf8");
  const router = readFileSync(UI + "router.js", "utf8");
  const sidebar = readFileSync(UI + "view-sidebar.js", "utf8");
  assert.match(router, /export function onNavigate\(/, "router.js exports onNavigate");
  assert.match(app, /onNavigate\(/, "app.js listens");
  assert.doesNotMatch(app, /settleRoutePlace|followPlace/, "no second rule in app.js");
  assert.doesNotMatch(sidebar, /function followPlace/, "no follow-on-render in view-sidebar.js");
});
