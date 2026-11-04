/**
 * S11: the search grammar, its mapping to GET /api/search, result highlighting and grouping,
 * and the palette row labels. Pure functions under a document stub, like ui-sidebar-presence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const DAY = 24 * 3600;
const utcDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

async function loadUi() {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, getElementById: () => null, addEventListener() {}, querySelector: () => null,
    title: "", visibilityState: "visible",
  };
  g.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  g.sessionStorage = { getItem: () => null };
  g.localStorage = { getItem: () => null, setItem() {} };
  // The labels are compared against the English source strings, whatever the machine's language.
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const search = await import(UI + "search.js");
  const view = await import(UI + "view-search.js");
  const store = await import(UI + "state.js");
  return { search, view, ...store };
}

const NONE = { in: null, from: null, before: null, after: null };

// ------------------------------------------------------------------ parseQuery: 8 cases
const GRAMMAR: Array<[string, string, Record<string, unknown>]> = [
  ["bare words are the text", "crash loop", { text: "crash loop", ...NONE }],
  ["in:#slug narrows to a channel", "in:#bugs crash", { text: "crash", ...NONE, in: "bugs" }],
  ["in: without the hash and in any case", "IN:Bugs crash", { text: "crash", ...NONE, in: "bugs" }],
  ["from:@handle names the author", "from:@nestor deploy", { text: "deploy", ...NONE, from: "nestor" }],
  ["before:YYYY-MM-DD is strictly before that day (UTC)", "before:2026-01-31 x",
    { text: "x", ...NONE, before: utcDay(2026, 1, 31) - 1 }],
  ["after:YYYY-MM-DD is strictly after that day (UTC)", "after:2026-01-01 x",
    { text: "x", ...NONE, after: utcDay(2026, 1, 1) + DAY }],
  ["all four filters at once, text keeps its order", "in:bugs from:nestor after:2026-01-01 crash before:2026-02-01 loop",
    { text: "crash loop", in: "bugs", from: "nestor", after: utcDay(2026, 1, 1) + DAY, before: utcDay(2026, 2, 1) - 1 }],
  ["a filter that does not parse stays plain text", "before:yesterday x", { text: "before:yesterday x", ...NONE }],
];

for (const [name, q, expected] of GRAMMAR) {
  test(`parseQuery: ${name}`, async () => {
    const { search } = await loadUi();
    assert.equal(typeof search.parseQuery, "function", "search.js must export parseQuery");
    assert.deepEqual(search.parseQuery(q), expected);
  });
}

test("parseQuery: an empty query has no text and no filters", async () => {
  const { search } = await loadUi();
  assert.deepEqual(search.parseQuery("   "), { text: "", ...NONE });
});

// ----------------------------------------------------------- the API mapping (messages.ts:94)
const CONVS = [
  { id: 7, slug: "bugs", kind: "public" },
  { id: 9, slug: "general", kind: "public" },
];

test("searchParams maps in:/before:/after: to the server and raises the limit for from:", async () => {
  const { search } = await loadUi();
  const parsed = search.parseQuery("in:#bugs from:@nestor after:2026-01-01 before:2026-02-01 crash");
  const p = search.searchParams(parsed, CONVS);
  assert.equal(p.unresolvedIn, false);
  const qs = new URLSearchParams(p.query);
  assert.equal(qs.get("q"), "crash");
  assert.equal(qs.get("conversationId"), "7");
  assert.equal(qs.get("sinceTs"), String(utcDay(2026, 1, 1) + DAY));
  assert.equal(qs.get("untilTs"), String(utcDay(2026, 2, 1) - 1));
  // U7: from: is filtered on the client, so a filtered page asks for more rows than the palette.
  assert.equal(qs.get("limit"), "50");
  assert.equal(qs.has("from"), false, "the server has no from= parameter (N4); do not send one");
});

test("searchParams: a plain query sends only q and the default limit", async () => {
  const { search } = await loadUi();
  const qs = new URLSearchParams(search.searchParams(search.parseQuery("crash"), CONVS).query);
  assert.deepEqual([...qs.keys()].sort(), ["limit", "q"]);
  assert.equal(qs.get("limit"), "40");
});

test("searchParams: in: with an unknown slug is reported, not silently dropped", async () => {
  const { search } = await loadUi();
  const p = search.searchParams(search.parseQuery("in:#nowhere crash"), CONVS);
  assert.equal(p.unresolvedIn, true);
});

test("matchesFrom compares the author handle case-insensitively", async () => {
  const { search } = await loadUi();
  assert.equal(search.matchesFrom({ actorHandle: "Nestor" }, "nestor"), true);
  assert.equal(search.matchesFrom({ actorHandle: "michal" }, "nestor"), false);
  assert.equal(search.matchesFrom({ actorHandle: "michal" }, null), true, "no from: means every author");
});

// -------------------------------------------------------------------- highlight + grouping
test("highlightHtml escapes the body and marks every term by prefix, case-insensitively", async () => {
  const { search } = await loadUi();
  const html = search.highlightHtml("Fix the Bug in bugs <b>now</b>", ["bug"]);
  assert.equal(html, "Fix the <mark>Bug</mark> in <mark>bugs</mark> &lt;b&gt;now&lt;/b&gt;");
});

test("highlightHtml with no terms only escapes", async () => {
  const { search } = await loadUi();
  assert.equal(search.highlightHtml("a <b>", []), "a &lt;b&gt;");
});

test("groupByConversation keeps the newest conversation first and messages newest first", async () => {
  const { view } = await loadUi();
  assert.equal(typeof view.groupByConversation, "function", "view-search.js must export groupByConversation");
  const msgs = [
    { id: 1, conversationId: 7, ts: 100 },
    { id: 2, conversationId: 9, ts: 200 },
    { id: 3, conversationId: 7, ts: 300 },
  ];
  const groups = view.groupByConversation(msgs);
  assert.deepEqual(groups.map((g: { conversationId: number }) => g.conversationId), [7, 9]);
  assert.deepEqual(groups[0].messages.map((m: { id: number }) => m.id), [3, 1]);
});

// ------------------------------------------------------- palette row labels (S8's list, M15)
test("rowLabel gives every palette row a screen-reader name", async () => {
  const { search } = await loadUi();
  assert.equal(typeof search.rowLabel, "function", "search.js must export rowLabel");
  assert.equal(search.rowLabel("conversation", { name: "#bugs" }), "Open #bugs");
  assert.equal(search.rowLabel("person", { name: "@nestor" }), "Message @nestor");
  assert.equal(search.rowLabel("wiki", { name: "Deploy" }), "Open the wiki page Deploy");
  assert.equal(search.rowLabel("message", { name: "@nestor", where: "#bugs" }), "Message from @nestor in #bugs");
  assert.equal(search.rowLabel("search", { name: "crash" }), "Search messages for crash");
});
