/**
 * C1 (T-MG-3 wave 6): navigation and shell clean-up. One test per follow-up the slice owns:
 *
 *   W5-S8-A   #/unreads is a route (parse, build, applyRoute, the view writes it)
 *   W5-S10-B  applyRoute opens #/threads; view-threads.js has no hashchange listener of its own
 *   W5-S10-D  consumeOwnPush is keyed on the hashchange event's newURL, not on location.hash
 *   W5-S11-A  renderMain and registerViews dispatch search, threads and unreads
 *   W5-S11-B  the sidebar stays for search, threads, unreads and Activity
 *   W5-S11-C  Mod+F lives in the shortcut table and the help sheet
 *   W5-S8-C   Mod+. is run by runShortcut (one owner), not by view-chat's own listener
 *   W5-S10-A  a rail button and a sidebar row open the Threads view
 *   W5-S10-C  loadPins repaints the topbar meta (the pins pill)
 *   W4-S6-C   switching conversation closes the details and pinned panel
 *   W2-S2-B   the skeleton belongs to the conversation being loaded, not to a global flag
 *
 * Functional where the module is pure or runs on the document stub, a source assertion where the
 * behaviour is a line in app.js's wiring.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const src = (name: string) => readFileSync(UI + name, "utf8");

/** The body of a top-level function: from its header to the first line that is a lone `}`. */
function fnBody(source: string, header: string): string {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} not found`);
  return source.slice(start, source.indexOf("\n}", start));
}

/** The document stub of the S10 test, with elements kept BY ID so a render into `#messages`
 *  can be read back the way `#main` can. */
function stubBrowser(): { byId: Map<string, Record<string, unknown>> } {
  const el = (): Record<string, unknown> => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
  });
  const byId = new Map<string, Record<string, unknown>>();
  const get = (id: string) => { let e = byId.get(id); if (!e) { e = el(); byId.set(id, e); } return e; };
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: get, createElement: () => el(), createTextNode: () => el(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1728, innerHeight: 900, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local", hash: "" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.HTMLImageElement = class {};
  g.EventSource = class { close() {} addEventListener() {} };
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
  return { byId };
}

type Key = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };
const ev = (key: string, mods: Partial<Key> = {}): Key => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

// ------------------------------------------------------------------ routes
test("W5-S8-A: #/unreads is a route, applyRoute opens it and the view writes it", async () => {
  const { parseRoute, buildRoute } = await import(UI + "router.js");
  assert.deepEqual(parseRoute("#/unreads"), { view: "unreads" });
  assert.equal(buildRoute({ view: "unreads" }), "#/unreads");
  assert.deepEqual(parseRoute("#/unreads/x"), { view: "home" }, "nothing hangs under the route");
  const apply = fnBody(src("app.js"), "async function applyRoute(route)");
  assert.match(apply, /case "unreads": .*openUnreadsView/, "F5 on #/unreads restores the view");
  assert.match(apply, /case "threads": .*openThreadsView/, "F5 on #/threads restores the view");
  assert.match(fnBody(src("view-unreads.js"), "export async function openUnreadsView()"), /syncRoute\("#\/unreads"\)/,
    "Mod+Shift+A changes the hash");
});

test("W5-S10-B: view-threads.js has no hashchange listener of its own; app.js routes it", async () => {
  assert.doesNotMatch(src("view-threads.js"), /hashchange/, "one router: applyRoute in app.js");
});

test("W5-S10-D: consumeOwnPush is keyed on the hashchange event, so two pushes in one tick are both echoes", async () => {
  stubBrowser();
  const { syncRoute, consumeOwnPush } = await import(UI + "router.js");
  const loc = (globalThis as Record<string, unknown>).location as { hash: string };
  syncRoute("#/c/general");
  syncRoute("#/c/general/t/7");
  assert.equal(loc.hash, "#/c/general/t/7", "location.hash holds the LAST push when the first event arrives");
  // The browser delivers one event per push, each naming the hash it moved to.
  assert.equal(consumeOwnPush({ newURL: "https://test.local/#/c/general", oldURL: "https://test.local/" }), true);
  assert.equal(consumeOwnPush({ newURL: "https://test.local/#/c/general/t/7", oldURL: "https://test.local/#/c/general" }), true);
  // Back to the first hash later is the user's doing, not an echo.
  assert.equal(consumeOwnPush({ newURL: "https://test.local/#/c/general", oldURL: "https://test.local/#/c/general/t/7" }), false);
  const listener = src("app.js").slice(src("app.js").indexOf('addEventListener("hashchange"'));
  assert.match(listener.slice(0, 400), /consumeOwnPush\(e\)/, "the listener hands the event over, not location.hash");
  assert.match(listener.slice(0, 400), /parseRoute\(hashOfEvent\(e\)/, "and parses the hash the event moved to");
  const { hashOfEvent } = await import(UI + "router.js");
  assert.equal(hashOfEvent({ newURL: "https://test.local/#/c/general" }), "#/c/general");
  assert.equal(hashOfEvent({ newURL: "https://test.local/" }), "", "no hash in the URL: nothing to consume");
  assert.equal(hashOfEvent("#/dms"), "#/dms", "a plain string passes through");
});

// ------------------------------------------------------------------ views and shell
test("W5-S11-A: renderMain dispatches search, threads and unreads through the views registry", async () => {
  const { byId } = stubBrowser();
  const { state, registerViews } = await import(UI + "state.js");
  const chat = await import(UI + "view-chat.js");
  state.actor = { id: 1, handle: "michal", kind: "human" };
  state.conversations = [{ id: 7, slug: "general", kind: "public", topic: "" }];
  state.memberships = { 7: true };
  state.msgs = { 7: [] };
  state.activeId = 7;
  const main = byId.get("main") ?? (byId.set("main", { innerHTML: "" } as Record<string, unknown>), byId.get("main")!);
  for (const view of ["search", "threads", "unreads"]) {
    let called = 0;
    registerViews({ [view]: () => { called++; } });
    state.view = view;
    main.innerHTML = "<p>keep me</p>";
    chat.renderMain();
    assert.equal(called, 1, `renderMain hands the ${view} view to views.${view}`);
    assert.equal(main.innerHTML, "<p>keep me</p>", `renderMain does not redraw the chat column over the ${view} view`);
  }
  const reg = src("app.js").slice(src("app.js").indexOf("registerViews({"));
  assert.match(reg.slice(0, 2000), /threads: renderThreadsMain/);
  assert.match(reg.slice(0, 2000), /unreads: renderUnreadsMain/);
  assert.match(reg.slice(0, 2000), /search: renderSearchMain/);
});

test("W5-S11-B: the sidebar stays for search, threads and unreads; Activity and admin have none", async () => {
  const body = fnBody(src("app.js"), "function hasSidebar(");
  for (const view of ["chat", "wiki", "search", "threads", "unreads"]) {
    assert.match(body, new RegExp(`state\\.view === "${view}"`), `${view} keeps the sidebar`);
  }
  assert.doesNotMatch(body, /"users"/, "accounts have nothing to pick from the sidebar");
  assert.doesNotMatch(body, /"notifications"/, "Activity is its own list; the channel list leads nowhere there (owner's report)");
  // The three places that used to compute the condition by hand (renderShell, goPlace, paintRail)
  // now ask one function: the chain appears once, inside hasSidebar itself.
  const app = src("app.js");
  assert.equal((app.match(/state\.view === "chat" \|\| state\.view === "wiki"/g) || []).length, 1, "no inline copies of the condition");
  for (const fn of ["function goPlace(place)", "function paintRail()", "function renderShell()"]) {
    assert.doesNotMatch(fnBody(app, fn), /state\.view === "chat"/, `${fn} asks hasSidebar/inConversations`);
  }
});

test("W5-S11-C: Mod+F is in the shortcut table and the help sheet; view-search.js has no key listener of its own", async () => {
  stubBrowser();
  const s = await import(UI + "shortcuts.js");
  assert.equal(s.SHORTCUTS.findInConversation, "Mod+F");
  assert.equal(s.matchShortcut(ev("f", { metaKey: true }), "mac"), "findInConversation");
  assert.equal(s.matchShortcut(ev("f", { ctrlKey: true }), "win"), "findInConversation");
  assert.ok(s.SHORTCUT_HELP.some((h: { name: string }) => h.name === "findInConversation"), "the sheet lists it");
  assert.doesNotMatch(src("view-search.js"), /document\.addEventListener\("keydown"/, "one key handler: app.js");
  assert.match(fnBody(src("app.js"), "function runShortcut(name)"), /case "findInConversation": .*findInConversation\(\)/);
});

test("W5-S8-C: Mod+. is run by runShortcut, not by view-chat's own listener", async () => {
  const app = src("app.js");
  assert.doesNotMatch(app, /name !== "sidePanel"/, "the key handler no longer skips the shortcut it matched");
  assert.match(fnBody(app, "function runShortcut(name)"), /case "sidePanel": .*toggleSidePanel\(\)/);
  const chat = src("view-chat.js");
  assert.doesNotMatch(chat, /bindSidePanelKeys/, "view-chat has no keydown listener for Mod+.");
  assert.doesNotMatch(chat, /e\.key !== "\."/);
});

test("W5-S10-A: a rail button and a sidebar row under the header open the Threads view", async () => {
  const app = src("app.js");
  assert.match(app, /railButton\("rail-threads"/, "the rail has a Threads place");
  assert.match(app, /getElementById\("rail-threads"\)[^\n]*openThreadsView/, "the button opens #/threads");
  const sidebar = src("view-sidebar.js");
  const head = sidebar.slice(sidebar.indexOf('<div class="sb-head">'), sidebar.indexOf('<div class="sb-scroll"'));
  assert.match(head, /id="sb-threads"/, "the row sits under the workspace header, above the list");
  assert.match(sidebar, /getElementById\("sb-threads"\)[^\n]*openThreadsView/);
  const pl = src("i18n-pl.js");
  assert.match(pl, /"Threads":/, "the row label is translated");
});

test("W5-S10-C: loadPins repaints the topbar meta, so the pins pill appears on first open", async () => {
  assert.match(fnBody(src("data.js"), "export async function loadPins(convId)"), /views\.presence\(\)/);
});

// ------------------------------------------------------------------ add-ons from C2 (coordinator)
test("W5-S8-B: the rail DMs badge comes from counters.railBadges, and view-unreads keeps no second body", async () => {
  const app = src("app.js");
  assert.match(app, /const dmUnread = railBadges\(state\)\.dms/, "renderShell");
  assert.match(fnBody(app, "function paintDmBadge()"), /railBadges\(state\)\.dms/, "paintDmBadge");
  assert.doesNotMatch(app, /import \{[^}]*unreadDmCount[^}]*\} from "\.\/view-unreads\.js"/);
  const unreads = src("view-unreads.js");
  assert.match(unreads, /export \{ unreadDmCount \} from "\.\/counters\.js"/, "re-exported, not duplicated");
  assert.doesNotMatch(unreads, /export function unreadDmCount/);
  stubBrowser();
  const u = await import(UI + "view-unreads.js");
  const c = await import(UI + "counters.js");
  assert.equal(u.unreadDmCount, c.unreadDmCount, "the same function object");
});

test("W2-S7-A: markRead's frozen divider is bounded by the newest unread id the server sent", async () => {
  const body = fnBody(src("data.js"), "export function markReadDebounced(");
  assert.match(body, /dividerAfter\(state\.msgs\[convId\], 0, state\.unread\[convId\], state\.actor\.id, state\.lastUnread\[convId\]\)/);
});

// ------------------------------------------------------------------ the conversation column
test("W4-S6-C: switching conversation closes the details and pinned panel of the previous one", async () => {
  const body = fnBody(src("view-chat.js"), "export async function openConversation(id, focusMessageId)");
  const guard = body.slice(body.indexOf("previousConversation !== id"));
  assert.match(guard.slice(0, 600), /state\.detailsOpen = false/, "details belong to the conversation they describe");
  assert.match(guard.slice(0, 600), /state\.pinnedOpen = false/, "so does the pinned list");
});

test("W2-S2-B: the skeleton shows only for the conversation being loaded, not for another one that is ready", async () => {
  const { byId } = stubBrowser();
  const { state } = await import(UI + "state.js");
  const chat = await import(UI + "view-chat.js");
  state.actor = { id: 1, handle: "michal", kind: "human" };
  state.view = "chat";
  state.conversations = [
    { id: 7, slug: "general", kind: "public", topic: "" },
    { id: 9, slug: "bugs", kind: "public", topic: "" },
  ];
  state.memberships = { 7: true };            // #bugs is a preview: not a member
  state.msgs = { 9: [{ id: 8, conversationId: 9, actorId: 2, threadId: null, body: "a bug", ts: 1700000000, kind: "text", deletedAt: null }] };
  state.loaded = { 9: true };
  state.actorsCache = { 2: { id: 2, handle: "milosz" } };
  state.threadOpen = null; state.detailsOpen = false; state.pinnedOpen = false; state.profileHandle = null;
  // #general's history is still on its way when the preview of #bugs is drawn.
  state.activeId = 9;
  state.loadingConv = 7;
  chat.renderMain();
  const messages = String(byId.get("messages")?.innerHTML ?? "");
  assert.doesNotMatch(messages, /skeleton/, "the preview is readable: another conversation's load is not ours");
  assert.match(messages, /data-msg="8"/, "the loaded message of #bugs is on screen");
  // Our own load in flight: the skeleton.
  state.loadingConv = 9;
  chat.renderMain();
  assert.match(String(byId.get("messages")?.innerHTML ?? ""), /skeleton/);
  const body = fnBody(src("view-chat.js"), "export async function openConversation(id, focusMessageId)");
  assert.match(body, /state\.loadingConv = id/, "the flag names the conversation");
  assert.match(body, /if \(state\.loadingConv === id\) state\.loadingConv = false/, "and only its own load clears it");
});
