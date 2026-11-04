/**
 * S3 (T-MG-3 wave 3): every view has a URL. `router.js` parses `location.hash` into a plain route
 * object and builds the hash back from one; `conversationRoute` picks `#/c/<slug>` for a channel
 * and `#/dm/<handles>` for a direct conversation; `permalink` is what "Copy link" puts on the
 * clipboard; `unreadFrom` is the local count "Mark unread" paints on the sidebar row.
 *
 * Checked here (node, pure functions): the parse/build table (slug with a hyphen, a DM with two
 * handles, bad input -> home), the message and thread variants, the search query. The live part
 * of the slice (thread flash, Back/Forward, the no-access column) is the checklist in the spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

const TABLE: Array<[string, Record<string, unknown>]> = [
  ["#/c/general", { view: "chat", slug: "general" }],
  ["#/c/design-review", { view: "chat", slug: "design-review" }],
  ["#/c/general/m/25", { view: "chat", slug: "general", messageId: 25 }],
  ["#/c/bugs/t/7", { view: "chat", slug: "bugs", threadId: 7 }],
  ["#/dm/anna", { view: "dm", handles: ["anna"] }],
  ["#/dm/anna,nestor", { view: "dm", handles: ["anna", "nestor"] }],
  ["#/dm/anna/m/40", { view: "dm", handles: ["anna"], messageId: 40 }],
  ["#/wiki/runbook", { view: "wiki", slug: "runbook" }],
  ["#/activity", { view: "activity" }],
  ["#/dms", { view: "dms" }],
  ["#/admin", { view: "admin" }],
  ["#/search?q=hello%20world", { view: "search", q: "hello world" }],
];

test("S3: parseRoute reads every route of section 1", async () => {
  const { parseRoute } = await import(UI + "router.js");
  for (const [hash, expected] of TABLE) assert.deepEqual(parseRoute(hash), expected, hash);
});

test("S3: bad input parses to home, never to null", async () => {
  const { parseRoute } = await import(UI + "router.js");
  for (const bad of ["", "#", "#/", "#/nope", "#/c/", "#/c/general/m/abc", "#/c/general/x/1", "#/dm/", null, undefined, 42]) {
    assert.deepEqual(parseRoute(bad), { view: "home" }, String(bad));
  }
});

test("S3: buildRoute is the inverse of parseRoute", async () => {
  const { parseRoute, buildRoute } = await import(UI + "router.js");
  for (const [hash, route] of TABLE) {
    assert.equal(buildRoute(route), hash, JSON.stringify(route));
    assert.deepEqual(parseRoute(buildRoute(route)), route);
  }
  assert.equal(buildRoute({ view: "home" }), "");
  assert.equal(buildRoute(null), "");
  // A slug with a character outside the URL alphabet is encoded, and comes back decoded.
  assert.equal(buildRoute({ view: "wiki", slug: "a b" }), "#/wiki/a%20b");
  assert.deepEqual(parseRoute("#/wiki/a%20b"), { view: "wiki", slug: "a b" });
});

test("S3: conversationRoute picks the slug for a channel and the handles for a DM", async () => {
  const { conversationRoute } = await import(UI + "router.js");
  const channel = { id: 3, kind: "public", slug: "bugs" };
  assert.equal(conversationRoute(channel, []), "#/c/bugs");
  assert.equal(conversationRoute(channel, [], { messageId: 10 }), "#/c/bugs/m/10");
  assert.equal(conversationRoute(channel, [], { threadId: 7 }), "#/c/bugs/t/7");
  const dm = { id: 9, kind: "group", slug: null };
  assert.equal(conversationRoute(dm, [{ handle: "nestor" }, { handle: "anna" }]), "#/dm/anna,nestor");
  assert.equal(conversationRoute(dm, [{ handle: "anna" }], { messageId: 40 }), "#/dm/anna/m/40");
  // A direct conversation whose participants are not known yet falls back to its id.
  assert.equal(conversationRoute(dm, []), "#/c/9");
});

test("S3: permalink is origin + / + hash", async () => {
  const { permalink } = await import(UI + "router.js");
  assert.equal(permalink("#/c/bugs/m/10", "https://host"), "https://host/#/c/bugs/m/10");
  assert.equal(permalink("#/c/bugs/m/10", "https://host/"), "https://host/#/c/bugs/m/10");
});

test("S3: unreadFrom counts the others' messages from the marked one on", async () => {
  const { unreadFrom } = await import(UI + "router.js");
  const me = 1;
  const list = [
    { id: 10, actorId: 2 }, { id: 11, actorId: 1 }, { id: 12, actorId: 2 },
    { id: 13, actorId: 3, deletedAt: 5 }, { id: 14, actorId: 3 },
  ];
  assert.equal(unreadFrom(list, 12, me), 2, "12 and 14; 11 is mine, 13 is deleted");
  assert.equal(unreadFrom(list, 10, me), 3);
  assert.equal(unreadFrom(list, 99, me), 0);
  assert.equal(unreadFrom(undefined, 12, me), 0);
});

test("S3: the More menu offers Copy link and Mark unread; openConversation syncs the hash", () => {
  const chat = readFileSync(UI + "view-chat.js", "utf8");
  assert.match(chat, /data-mact="\$\{p\.action\}"/, "menu items keep their action hook");
  assert.match(chat, /action: "copylink"/, "Copy link item");
  assert.match(chat, /action: "unread"/, "Mark unread item");
  assert.match(chat, /t\("Copy link"\)/);
  assert.match(chat, /t\("Mark unread"\)/);
  assert.match(chat, /syncRoute\(/, "openConversation pushes its route");
  const app = readFileSync(UI + "app.js", "utf8");
  assert.match(app, /addEventListener\("hashchange"/, "app.js listens to hashchange");
  const wiki = readFileSync(UI + "view-wiki.js", "utf8");
  assert.match(wiki, /syncRoute\(/, "openWikiPage pushes its route");
});
