/**
 * T-MG-3 fix round 2, agent FX3: sidebar, Activity, search, wiki, routes.
 * Findings U4, U5, U9, U10, U11, U16 (decision: the rail loses Threads, the sidebar row stays),
 * U20 and the follow-ups W6-S14-A, W6-S14-C, W6-C2-B.
 *
 * Node, document stub (the S8 pattern): pure exports where the logic moved into one, source
 * and CSS assertions for the wiring and the Primer tokens, one rendered-markup check for the
 * wiki tree roles.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));
const src = (f: string) => readFileSync(UI + f, "utf8");
const cssBlock = (n: number) => {
  const css = readFileSync(CSS, "utf8");
  const start = css.indexOf(`/* === S${n} === */`);
  const next = css.indexOf(`/* === S${n + 1} === */`);
  return css.slice(start, next < 0 ? undefined : next);
};

function stubBrowser() {
  const el = (): Record<string, unknown> => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
  });
  const main = el();
  const sbScroll = el();
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: (id: string) => (id === "main" ? main : id === "sb-scroll" ? sbScroll : el()), createElement: () => el(),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, innerWidth: 1728, innerHeight: 900, visualViewport: null,
    location: { origin: "https://test.local" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "" };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.EventSource = class { close() {} addEventListener() {} };
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
  return { main, sbScroll };
}

async function loadUi() {
  const els = stubBrowser();
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const markdown = await import(UI + "markdown.js");
  const notifications = await import(UI + "view-notifications.js");
  const sidebar = await import(UI + "view-sidebar.js");
  const search = await import(UI + "view-search.js");
  const router = await import(UI + "router.js");
  const store = await import(UI + "state.js");
  return { markdown, notifications, sidebar, search, router, ...els, ...store };
}

// ------------------------------------------------------------------ U4: catch-up labels
test("U4: the catch-up rows carry short labels that fit a 256px sidebar", () => {
  const sb = src("view-sidebar.js");
  assert.match(sb, /t\("While you were away"\)/, "the digest row");
  assert.match(sb, /t\("Open questions"\)/, "the questions row");
  assert.doesNotMatch(sb, /What happened while you were away/);
  assert.doesNotMatch(sb, /Questions waiting for an answer/);
  const pl = src("i18n-pl.js");
  assert.match(pl, /"While you were away": "Poza Tobą"/);
  assert.match(pl, /"Channels you can join": "Kanały do dołączenia"/, "the PL section head no longer truncates");
  assert.doesNotMatch(pl, /"What happened while you were away"/, "the dead entry is gone (i18n.test rejects unused keys)");
});

test("U4: section heads may wrap to a second line instead of truncating", () => {
  const s1 = cssBlock(1);
  const rule = /\.sb-group h3 \.sb-label\{([^}]*)\}/.exec(s1);
  assert.ok(rule, "the S1 block styles .sb-label");
  assert.doesNotMatch(rule![1], /white-space:nowrap/, "nowrap is what cut KANAŁY, DO KTÓRYCH MOŻ...");
  assert.match(rule![1], /-webkit-line-clamp:2/, "two lines, then an ellipsis");
});

// ------------------------------------------------------------------ U5: Activity header on a phone
test("U5: the Activity header actions are icon buttons with names; the label hides on phones", () => {
  const n = src("view-notifications.js");
  assert.match(n, /id="btn-notif-perm"[^>]*aria-label="\$\{t\("Turn on system notifications"\)\}"/);
  assert.match(n, /id="btn-notif-read"[^>]*aria-label="\$\{t\("Mark all as read"\)\}"/);
  assert.match(n, /\$\{iconBell\(\)\}<span class="notif-act-l">\$\{t\("Turn on system notifications"\)\}<\/span>/);
  assert.match(n, /\$\{iconCheck\(\)\}<span class="notif-act-l">\$\{t\("Mark all as read"\)\}<\/span>/);
  assert.match(n, /<div class="topbar notif-topbar">/, "the header is addressable by the S8 CSS");
  const s8 = cssBlock(8);
  const phone = /@media \(max-width:760px\)\{[^@]*?\.notif-topbar \.notif-act-l\{display:none\}/;
  assert.match(s8, phone, "at 390px the two actions shrink to icons, so the title keeps its room");
  assert.match(s8, /\.notif-topbar \.title\{[^}]*min-width:0/);
});

// ------------------------------------------------------------------ U9: the build stamp
test("U9: the sidebar foot shows nothing unless the UI is older than the server's", async () => {
  const { sidebar } = await loadUi();
  assert.equal(typeof sidebar.uiVersionNotice, "function", "view-sidebar.js exports uiVersionNotice(mine, theirs)");
  assert.equal(sidebar.uiVersionNotice("846f2706", "846f2706"), "");
  assert.equal(sidebar.uiVersionNotice("846f2706", undefined), "");
  assert.equal(sidebar.uiVersionNotice("", "abc"), "");
  assert.match(sidebar.uiVersionNotice("846f2706", "1a2b3c4d"), /846f2706/);
  assert.match(sidebar.uiVersionNotice("846f2706", "1a2b3c4d"), /1a2b3c4d/);
});

test("U9: the stamp moved into the help popover as a version line", () => {
  const sb = src("view-sidebar.js");
  assert.doesNotMatch(sb, /foot\.textContent = `UI \$\{UI_STAMP/, "no raw stamp in the sidebar foot");
  const help = sb.slice(sb.indexOf("function showGuidelines()"), sb.indexOf("async function showAgentGuidelines()"));
  assert.match(help, /t\("Interface version \{stamp\}"/, "the help modal names the version");
  assert.match(help, /UI_STAMP/);
});

// ------------------------------------------------------------------ U10: stripMd
test("U10: stripMd turns markdown into the plain text a preview shows", async () => {
  const { markdown } = await loadUi();
  assert.equal(typeof markdown.stripMd, "function", "markdown.js exports stripMd");
  const s = markdown.stripMd;
  assert.equal(s("Ship **v0.2.1** to staging"), "Ship v0.2.1 to staging");
  assert.equal(s("tag `agenttalks:v0.2.0` built"), "tag agenttalks:v0.2.0 built");
  assert.equal(s("see [the runbook](https://x.test/r) and [[deploy|Deploy page]] and [[incident]]"), "see the runbook and Deploy page and incident");
  assert.equal(s("# Heading\n- item one\n* item two\n> quoted\n1. third"), "Heading item one item two quoted third");
  assert.equal(s("before ```js\nconst a = 1;\n``` after"), "before const a = 1; after");
  assert.equal(s("_em_ and *it* and ~~gone~~"), "em and it and gone");
  assert.equal(s("  spaced   out \n\n lines "), "spaced out lines");
  assert.equal(s(null), "");
});

test("U10: notifications, unreads, search, the palette and the digest preview use stripMd", () => {
  for (const f of ["view-notifications.js", "view-unreads.js", "view-search.js", "search.js", "view-sidebar.js"]) {
    assert.match(src(f), /import \{[^}]*\bstripMd\b[^}]*\} from "\.\/markdown\.js"/, `${f} imports stripMd`);
  }
  assert.match(src("view-notifications.js"), /escapeHtml\(stripMd\(n\.excerpt\)\)/, "the Activity excerpt");
  assert.match(src("view-unreads.js"), /stripMd\(m\.body\)/, "the unread row preview");
  assert.match(src("view-search.js"), /snippetAround\(stripMd\(m\.body\)/, "the search hit");
  assert.match(src("search.js"), /snippetAround\(stripMd\(m\.body\)/, "the palette hit");
  assert.match(src("view-sidebar.js"), /stripMd\(m\.body/, "the digest mention row");
});

// ------------------------------------------------------------------ U11: filter-only search
test("U11: applyFilters runs from:/before:/after: on the client, newest first", async () => {
  const { search, state } = await loadUi();
  assert.equal(typeof search.applyFilters, "function", "view-search.js exports applyFilters(messages, parsed)");
  state.actorsCache = { 1: { handle: "michal" }, 2: { handle: "nestor" } };
  const list = [
    { id: 1, actorId: 2, ts: 100, body: "a" },
    { id: 2, actorId: 1, ts: 200, body: "b" },
    { id: 3, actorId: 2, ts: 300, body: "c", deletedAt: 5 },
    { id: 4, actorId: 2, ts: 400, body: "d" },
  ];
  const parsed = (extra: Record<string, unknown>) => ({ text: "", in: "general", from: null, before: null, after: null, ...extra });
  assert.deepEqual(search.applyFilters(list, parsed({})).map((m: { id: number }) => m.id), [4, 2, 1], "newest first, deleted left out");
  assert.deepEqual(search.applyFilters(list, parsed({ from: "nestor" })).map((m: { id: number }) => m.id), [4, 1]);
  assert.deepEqual(search.applyFilters(list, parsed({ before: 250 })).map((m: { id: number }) => m.id), [2, 1]);
  assert.deepEqual(search.applyFilters(list, parsed({ after: 150 })).map((m: { id: number }) => m.id), [4, 2]);
});

test("U11: a filter-only query with in: lists the conversation; without in: the hint suggests one", () => {
  const v = src("view-search.js");
  assert.match(v, /\/api\/conversations\/\$\{convId\}\/messages\?\$\{qs\}/, "filter-only fetches the conversation's messages");
  assert.match(v, /const qs = `limit=\$\{FILTER_PAGE\}/, "a page of the newest messages, then before= for older ones");
  assert.match(v, /t\("Add a word to search for"\)/, "the hint stays when there is no in:");
  assert.match(v, /t\("Or add in:#channel to list the latest messages there\."\)/);
  assert.match(v, /data-suggest-in=/, "a click fills in: with the conversation you came from");
});

// ------------------------------------------------------------------ U16: Threads once
test("U16 (decision): the rail has no Threads button; the sidebar row keeps the entry", () => {
  const app = src("app.js");
  assert.doesNotMatch(app, /railButton\("rail-threads"/, "no rail Threads place (desktop rail and phone tab bar)");
  assert.doesNotMatch(app, /getElementById\("rail-threads"\)/);
  const sb = src("view-sidebar.js");
  assert.match(sb, /id="sb-threads"/, "the sidebar Threads row stays");
  assert.match(sb, /getElementById\("sb-threads"\)[^\n]*openThreadsView/);
});

// ------------------------------------------------------------------ U20: the wiki delete button
test("U20: deleting a wiki page is a danger-coloured icon button with a tooltip and a confirm", () => {
  const w = src("view-wiki.js");
  assert.match(w, /<button class="iconbtn danger" id="wiki-delete" aria-label="\$\{t\("Delete page"\)\}" title="\$\{t\("Delete page"\)\}"/);
  assert.match(w, /confirmModal\(\{\s*title: t\("Delete the page/, "the confirm dialog stays");
  const s14 = cssBlock(14);
  assert.match(s14, /\.topbar \.iconbtn\.danger\{[^}]*color:var\(--fgColor-danger\)/);
  assert.match(s14, /\.topbar \.iconbtn\.danger:hover\{[^}]*background:var\(--bgColor-danger-muted\)/);
});

// ------------------------------------------------------------------ W6-S14-A: the wiki Activity row
test("W6-S14-A: a wiki change reads 'changed the page <title>' and opens the page", async () => {
  const { notifications: n, state } = await loadUi();
  state.conversations = [];
  state.wiki.pages = [{ slug: "runbook", title: "Runbook" }];
  assert.equal(n.notifSentence({ kind: "wiki", from: "nestor", wikiSlug: "runbook" }), "@nestor changed the page Runbook");
  assert.equal(n.notifSentence({ kind: "wiki", from: "nestor", wikiSlug: "gone" }), "@nestor changed the page gone");
  assert.doesNotMatch(src("view-notifications.js"), /changed a page you co-author/);
  assert.match(src("i18n-pl.js"), /"changed the page": "zmienił\(a\) stronę"/);
});

// ------------------------------------------------------------------ W6-S14-C: wiki tree roles
test("W6-S14-C: the sidebar wiki tree carries tree, treeitem, group and aria-expanded", async () => {
  const { sidebar, state, sbScroll } = await loadUi();
  state.actor = { id: 1, handle: "michal", kind: "human" };
  state.actorsList = [{ id: 2, handle: "nestor", kind: "agent" }];
  state.conversations = [{ id: 1, kind: "public", slug: "general" }];
  state.memberships = { 1: {} };
  state.unread = {};
  state.view = "chat";
  state.activeId = 1;
  state.wiki.pages = [
    { slug: "runbook", title: "Runbook" },
    { slug: "deploy", title: "Deploy checklist", parentSlug: "runbook" },
    { slug: "notes", title: "Notes" },
  ];
  sidebar.renderSidebarList();
  const html = String(sbScroll.innerHTML);
  assert.match(html, /<div class="wiki-tree" role="tree" aria-label="Wiki">/);
  assert.match(html, /data-wikipage="runbook"[^>]*role="treeitem"[^>]*aria-expanded="true"[^>]*aria-level="1"/);
  assert.match(html, /<div role="group">[\s\S]*data-wikipage="deploy"[^>]*role="treeitem"[^>]*aria-level="2"/);
  assert.match(html, /data-wikipage="notes"[^>]*role="treeitem"/);
  assert.doesNotMatch(html, /data-wikipage="notes"[^>]*aria-expanded/, "a leaf has no aria-expanded");
});

// ------------------------------------------------------------------ W6-C2-B: #/people
test("W6-C2-B: #/people is a route that opens the directory (Who is here)", async () => {
  const { router } = await loadUi();
  assert.deepEqual(router.parseRoute("#/people"), { view: "people" });
  assert.equal(router.buildRoute({ view: "people" }), "#/people");
  assert.deepEqual(router.parseRoute("#/people/x"), { view: "home" });
  const app = src("app.js");
  assert.match(app, /case "people": [^\n]*openPeopleDirectory\(\)/, "applyRoute has a people branch");
  assert.match(app, /function openPeopleDirectory\(/);
});
