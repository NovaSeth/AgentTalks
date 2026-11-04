/**
 * S6 (T-MG-3 wave 4): people. A click on a name or avatar opens a profile in the side panel,
 * the channel header shows faces, a member count and a pins pill, the "New conversation" modal
 * uses a people picker with chips and `@system` is never offered or listed.
 *
 * What is checked here (node, document stub): the pure helpers of `view-people.js`
 * (`filterPeople`, `visibleMembers`, `profileFacts`), `sidePanelOf` knowing the profile kind,
 * `renderMain` writing the header meta slot and the profile slot, and the source of the sidebar
 * and the modal wiring (people rows open the profile, the modal no longer ships a <select>).
 * Pixel truth (6 faces in #general, Esc returning focus) is the live checklist in the spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

/** The minimal browser from test/ui-s2-panel.test.ts, plus a `#main` whose innerHTML is kept. */
function stubBrowser(): { main: Record<string, unknown> } {
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
  const main = el();
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: (id: string) => (id === "main" ? main : el()), createElement: () => el(), createTextNode: () => el(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1728, innerHeight: 900, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.HTMLImageElement = class {};
  g.EventSource = class { close() {} addEventListener() {} };
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
  return { main };
}

const PEOPLE = [
  { id: 1, handle: "michal", displayName: "Michal", kind: "human" },
  { id: 2, handle: "nestor", displayName: "Nestor", kind: "agent" },
  { id: 3, handle: "milosz", displayName: "Milosz", kind: "agent" },
  { id: 4, handle: "system", displayName: "System", kind: "system" },
  { id: 5, handle: "anna", displayName: "Anna Nowak", kind: "human" },
];

test("filterPeople: no query lists everybody but @system and me, handles sorted", async () => {
  stubBrowser();
  const { filterPeople } = await import(UI + "view-people.js");
  const out = filterPeople(PEOPLE, "", { excludeSystem: true, excludeHandle: "michal" });
  assert.deepEqual(out.map((a: { handle: string }) => a.handle), ["anna", "milosz", "nestor"]);
});

test("filterPeople: a handle prefix ranks before a display-name hit", async () => {
  stubBrowser();
  const { filterPeople } = await import(UI + "view-people.js");
  const out = filterPeople(PEOPLE, "nes", { excludeSystem: true });
  assert.deepEqual(out.map((a: { handle: string }) => a.handle), ["nestor"]);
  const byName = filterPeople(PEOPLE, "nowak", { excludeSystem: true });
  assert.deepEqual(byName.map((a: { handle: string }) => a.handle), ["anna"]);
});

test("filterPeople: @ prefix and case are ignored, already chosen people are left out", async () => {
  stubBrowser();
  const { filterPeople } = await import(UI + "view-people.js");
  const out = filterPeople(PEOPLE, "@MI", { excludeSystem: true, exclude: ["michal"] });
  assert.deepEqual(out.map((a: { handle: string }) => a.handle), ["milosz"]);
});

test("filterPeople: @system is offered only when asked for, never by default", async () => {
  stubBrowser();
  const { filterPeople } = await import(UI + "view-people.js");
  assert.equal(filterPeople(PEOPLE, "sys").length, 0);
  assert.equal(filterPeople(PEOPLE, "sys", { excludeSystem: false }).length, 1);
});

test("filterPeople: a query nobody matches gives an empty list, not an error", async () => {
  stubBrowser();
  const { filterPeople } = await import(UI + "view-people.js");
  assert.deepEqual(filterPeople(PEOPLE, "zzz"), []);
  assert.deepEqual(filterPeople(null, "a"), []);
});

test("visibleMembers drops @system from a member list", async () => {
  stubBrowser();
  const { visibleMembers } = await import(UI + "view-people.js");
  const cache = Object.fromEntries(PEOPLE.map((a) => [a.id, a]));
  const members = [{ actorId: 1, role: "admin" }, { actorId: 4, role: "member" }, { actorId: 2, role: "member" }, { actorId: 9, role: "member" }];
  assert.deepEqual(visibleMembers(members, cache).map((m: { actorId: number }) => m.actorId), [1, 2, 9]);
});

test("profileFacts: online with doing, else last seen from lastActiveAt", async () => {
  stubBrowser();
  const { profileFacts } = await import(UI + "view-people.js");
  const presence = [
    { actorId: 3, handle: "milosz", online: true, doing: "measuring SSE latency" },
    { actorId: 2, handle: "nestor", online: false, doing: null },
  ];
  const busy = profileFacts({ id: 3, handle: "milosz", kind: "agent" }, presence);
  assert.equal(busy.online, true);
  assert.equal(busy.doing, "measuring SSE latency");
  const away = profileFacts({ id: 2, handle: "nestor", kind: "agent", lastActiveAt: 1700000000 }, presence);
  assert.equal(away.online, false);
  assert.equal(away.doing, null);
  assert.equal(away.lastActiveAt, 1700000000);
});

test("sidePanelOf: an open profile is the panel's kind and wins over details and thread", async () => {
  stubBrowser();
  const { sidePanelOf } = await import(UI + "view-chat.js");
  assert.deepEqual(sidePanelOf({ profileHandle: "milosz", detailsOpen: true, threadOpen: 7, activeId: 1 }),
    { kind: "profile", id: "milosz" });
  assert.deepEqual(sidePanelOf({ profileHandle: null, detailsOpen: false, threadOpen: 7, activeId: 1 }),
    { kind: "thread", id: 7 });
});

test("renderMain writes the header meta slot and a profile slot inside the side panel", async () => {
  const { main } = stubBrowser();
  const { state } = await import(UI + "state.js");
  const chat = await import(UI + "view-chat.js");
  state.actor = { id: 1, handle: "michal", kind: "human" };
  state.view = "chat";
  state.activeId = 1;
  state.conversations = [{ id: 1, kind: "public", slug: "general", topic: "" }];
  state.memberships = { 1: { role: "member" } };
  state.profileHandle = "milosz";
  state.actorsList = PEOPLE;
  for (const a of PEOPLE) state.actorsCache[a.id] = a;
  chat.renderMain();
  const html = String(main.innerHTML);
  assert.match(html, /id="topbar-meta"/);
  assert.equal((html.match(/id="profile-slot"/g) || []).length, 1);
  assert.match(html, /data-kind="profile"/);
  state.profileHandle = null;
  chat.renderMain();
  assert.doesNotMatch(String(main.innerHTML), /id="profile-slot"/);
});

test("people rows open the profile; the modal uses the picker, not a <select>", () => {
  const sidebar = readFileSync(UI + "view-sidebar.js", "utf8");
  assert.match(sidebar, /\[data-person\]"\)\.forEach\(\(b\) =>\s*b\.addEventListener\("click", \(\) => openProfile\(/);
  const chat = readFileSync(UI + "view-chat.js", "utf8");
  assert.doesNotMatch(chat, /<select id="nc-who"/);
  assert.match(chat, /mountPeoplePicker\(/);
  const css = readFileSync(CSS, "utf8");
  const s6 = css.slice(css.indexOf("/* === S6 === */"), css.indexOf("/* === S7 === */"));
  assert.match(s6, /\.topbar-meta/);
  assert.match(s6, /\.pp-chip/);
});
