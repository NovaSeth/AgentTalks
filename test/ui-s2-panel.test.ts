/**
 * S2 (T-MG-3 wave 2): the side panel is one slot in the conversation view and, from 1280 px up,
 * a column next to the messages instead of a drawer painted over them; the join bar is readable.
 *
 * What is checked here (node, document stub): `renderMain` writes exactly one `#side-panel`
 * that hosts both the thread and the details slot; the message column is wrapped so the panel
 * can sit beside it; `sidePanelOf` derives `state.sidePanel` from the open flags; app.css's S2
 * block carries the column media query and the join-bar stacking fix (G20). Pixel truth (no
 * clipped text at 1728 px, overlay at 1180 px, contrast) is the live checklist in the spec.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

/** The minimal browser from test/ui-start.test.ts, plus a `#main` whose innerHTML is kept. */
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

async function openChat(member: boolean) {
  const { main } = stubBrowser();
  const { state } = await import(UI + "state.js");
  const chat = await import(UI + "view-chat.js");
  state.actor = { id: 1, handle: "michal", kind: "human" };
  state.view = "chat";
  state.activeId = 7;
  state.conversations = [{ id: 7, slug: "general", kind: "public", topic: "" }];
  state.memberships = member ? { 7: true } : {};
  state.messages = { 7: [] };
  state.threadOpen = null;
  state.detailsOpen = false;
  state.loadingConv = false;
  return { main, state, chat };
}

test("S2: renderMain writes exactly one #side-panel hosting the thread and details slots", async () => {
  const { main, state, chat } = await openChat(true);
  chat.renderMain();
  let html = String(main.innerHTML);
  assert.equal(html.match(/id="side-panel"/g)?.length, 1, "one side panel slot");
  // Nothing open: the panel is there, the hosts are not (B-MG-59 relies on a missing #thread-slot).
  assert.doesNotMatch(html, /id="thread-slot"|id="details-slot"/, "no host while nothing is open");
  // The message column is one box so the panel can stand next to it (grid column from 1280 px).
  const col = html.indexOf('class="main-col"');
  assert.ok(col >= 0 && col < html.indexOf('class="topbar"'), "topbar, messages and dock sit in .main-col");
  assert.ok(html.indexOf('id="side-panel"') > html.indexOf('id="messages"'), "the panel follows the message column");

  state.threadOpen = 42;
  state.detailsOpen = true;
  chat.renderMain();
  html = String(main.innerHTML);
  const panel = html.slice(html.indexOf('id="side-panel"'), html.indexOf("</aside>"));
  assert.match(panel, /id="thread-slot"/, "the thread host lives inside the panel");
  assert.match(panel, /id="details-slot"/, "the details host lives inside the panel");
  assert.match(panel, /data-kind="details"/, "the panel names what it shows");
});

test("S2: the join bar keeps its place in the dock and the panel slot is still present for a preview", async () => {
  const { main, chat } = await openChat(false);
  chat.renderMain();
  const html = String(main.innerHTML);
  assert.match(html, /class="joinbar" id="joinbar"/);
  assert.equal(html.match(/id="side-panel"/g)?.length, 1);
});

test("S2: sidePanelOf derives the panel vocabulary from the open flags (details wins over thread)", async () => {
  const { state, chat } = await openChat(true);
  assert.equal(typeof chat.sidePanelOf, "function", "view-chat.js exports sidePanelOf");
  assert.equal(chat.sidePanelOf(state), null);
  state.threadOpen = 42;
  assert.deepEqual(chat.sidePanelOf(state), { kind: "thread", id: 42 });
  state.detailsOpen = true;
  assert.deepEqual(chat.sidePanelOf(state), { kind: "details", id: 7 });
  chat.renderMain();
  assert.deepEqual(state.sidePanel, { kind: "details", id: 7 }, "renderMain publishes state.sidePanel");
});

test("S2: app.css S2 block carries the 1280 px column query and the join-bar stacking fix (G20)", () => {
  const css = readFileSync(CSS, "utf8");
  const start = css.indexOf("/* === S2 === */"), end = css.indexOf("/* === S3 === */");
  assert.ok(start >= 0 && end > start, "S2 block markers");
  const block = css.slice(start, end);
  assert.match(block, /@media \(min-width:\s*1280px\)/, "the column threshold (D3)");
  assert.match(block, /\.side-panel/, "the panel is styled in the S2 block");
  assert.match(block, /\.joinbar\{[^}]*position:relative[^}]*z-index:\s*[1-9]/, "the join bar stacks above .dock::before");
});
