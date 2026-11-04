/**
 * T-MG-3 fix round 2, agent FX2 (review-r2.json U6, U7, U8, U14, U15, U18, U19): conversation,
 * thread and profile behaviour.
 *
 * U6  the channel header never shows a bare "0": no faces pill before the members arrive, the pill
 *     carries the people Octicon, and the "members fetched" mark is set only AFTER the fetch (an
 *     abandoned open used to leave the header stuck on an empty list), reset on a route change.
 * U7  a send that fails while the offline bar is up does not add a toast saying the same thing.
 * U8  the thread panel says "Loading replies..." while they load, "No replies yet" when there are
 *     none, and paints replies already in the message cache before the fetch returns.
 * U14 a deep link to a message that is gone lands on the conversation with a toast, not a skeleton.
 * U15 the More menu: Octicons per item, a separator before the own-message group, "Mark as a
 *     problem" instead of the "Treat as a report" jargon.
 * U18 the profile's Message button icon takes the button's colour (S6 CSS).
 * U19 startDirect accepts several handles and creates a group.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

type El = Record<string, any>;
type Call = { method: string; path: string; body: any };

/** The minimal browser from test/ui-s4-composer.test.ts: one element kept per id, created
 *  elements recorded (toasts are counted from them), fetch answered by a routing function. */
function stubBrowser(): { els: Map<string, El>; created: El[]; calls: Call[]; route: (fn: (c: Call) => any) => void } {
  const el = (): El => ({
    innerHTML: "", textContent: "", value: "", className: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    disabled: false, checked: false, selectionStart: 0, selectionEnd: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {}, setSelectionRange() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    dispatchEvent() {},
  });
  const els = new Map<string, El>();
  const created: El[] = [];
  const byId = (id: string) => { if (!els.has(id)) els.set(id, el()); return els.get(id)!; };
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    // A created element (a toast, a menu) finds its own children; an element by id does not.
    getElementById: byId, createElement: () => {
      const e = el(); const kids = new Map<string, El>();
      e.querySelector = (sel: string) => { if (!kids.has(sel)) kids.set(sel, el()); return kids.get(sel); };
      created.push(e); return e;
    }, createTextNode: () => el(),
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
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.history = { pushState() {}, replaceState() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem(k: string, v: string) { store.set(k, v); }, removeItem(k: string) { store.delete(k); } };
  g.HTMLImageElement = class {};
  g.Event = class { type: string; constructor(type: string) { this.type = type; } };
  g.EventSource = class { close() {} addEventListener() {} };
  g.requestAnimationFrame = (fn: () => void) => { fn(); return 1; };
  const calls: Call[] = [];
  let router: (c: Call) => any = () => ({});
  g.fetch = async (path: string, init: any) => {
    const call = { method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const out = router(call);
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, json: async () => out, text: async () => "" };
  };
  return { els, created, calls, route: (fn) => { router = fn; } };
}

async function openChat() {
  const browser = stubBrowser();
  const { state, rebuildMentionRe } = await import(UI + "state.js");
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const chat = await import(UI + "view-chat.js");
  const people = await import(UI + "view-people.js");
  const s = state as Record<string, any>;
  s.actor = { id: 1, handle: "michal", kind: "human" };
  rebuildMentionRe();
  s.view = "chat";
  s.conversations = [{ id: 1, slug: "general", kind: "public" }, { id: 2, slug: "bugs", kind: "public" }];
  s.memberships = { 1: { lastReadMessageId: 0 }, 2: { lastReadMessageId: 0 } };
  s.activeId = 1;
  s.actorsCache = { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" } };
  s.msgs = { 1: [{ id: 10, conversationId: 1, actorId: 2, body: "root", ts: 1, kind: "text" }] };
  s.loaded = { 1: true };
  s.openQuestions = {};
  s.convPins = [];
  s.convMembers = [];
  s.convMembersFor = null;
  s.online = true;
  s.threadOpen = null;
  s.threadMsgs = [];
  s.pending = {};
  s.drafts = {};
  s.presence = [];
  return { ...browser, state: s, chat, people };
}

const toasts = (created: El[]) => created.filter((e) => e.className === "toast");
const tick = () => new Promise((r) => setTimeout(r, 5));

// ------------------------------------------------------------------- U6
test("U6: headerFacesHtml renders nothing for an empty member list and carries the people Octicon otherwise", async () => {
  const { people, state } = await openChat();
  assert.equal(people.headerFacesHtml([], state.actorsCache), "", "no members: no pill, never a bare 0");
  const html = people.headerFacesHtml([{ actorId: 1 }, { actorId: 2 }], state.actorsCache);
  assert.match(html, /<svg class="octicon/, "the people Octicon");
  assert.match(html, /hdr-count">2</);
  assert.doesNotMatch(html, /hdr-more/, "two members: no overflow chip");
});

test("U17 add-on: the header shows at most three faces and a +N chip for the rest, the count stays the total", async () => {
  const { people } = await openChat();
  const cache: Record<number, any> = {};
  for (let i = 1; i <= 7; i++) cache[i] = { handle: "p" + i, kind: "agent" };
  const html = people.headerFacesHtml([1, 2, 3, 4, 5, 6, 7].map((actorId) => ({ actorId })), cache);
  assert.equal((html.match(/class="av/g) || []).length, 3, "three faces");
  assert.match(html, /hdr-more">\+4</, "four more as a chip");
  assert.match(html, /hdr-count">7</, "the count is the total");
});

test("W6-C2-A add-on: message action buttons carry Primer tooltips (aria-label + tooltipped), not bare title=", () => {
  const src = readFileSync(UI + "view-chat.js", "utf8");
  const actions = src.slice(src.indexOf('<div class="actions" role="group"'), src.indexOf("</div>` : \"\"}\n    </div>`;"));
  const buttons = [...actions.matchAll(/<button[^>]*>/g)].map((m) => m[0]);
  assert.ok(buttons.length >= 5, `found ${buttons.length} action buttons`);
  for (const b of buttons) {
    assert.match(b, /aria-label=/, `no aria-label: ${b.slice(0, 80)}`);
    assert.match(b, /tooltipped tooltipped-n/, `no Primer tooltip: ${b.slice(0, 80)}`);
    assert.doesNotMatch(b, /\btitle=/, `bare title tooltip: ${b.slice(0, 80)}`);
  }
});

test("U6: the members mark is set only after the fetch succeeds, so an abandoned open retries", async () => {
  const { people, state, route } = await openChat();
  // The body is a promise the test resolves by hand: the in-flight window stays open until then.
  let resolveMembers: (v: any) => void = () => {};
  route(() => new Promise((r) => { resolveMembers = r; }));
  let ready = 0;
  people.ensureHeaderMembers(1, () => { ready++; });
  await tick();
  assert.equal(state.convMembersFor, null, "in flight: the header must not believe it has the list");
  resolveMembers({ members: [{ actorId: 1 }, { actorId: 2 }] });
  await tick();
  assert.equal(state.convMembersFor, 1);
  assert.equal(state.convMembers.length, 2);
  assert.equal(ready, 1);
});

test("U6: openConversation forgets the previous conversation's members and pins before drawing the next", () => {
  const src = readFileSync(UI + "view-chat.js", "utf8");
  const open = src.slice(src.indexOf("export async function openConversation"), src.indexOf("export async function openThread"));
  assert.match(open, /convMembersFor = null/, "a route change drops the members of the other conversation");
  assert.match(open, /loadingConv = false[^\n]*\n[^\n]*gen !== sessionGeneration\(\)|loadingConv === id\) state\.loadingConv = false;\s*\n\s*if \(gen !== sessionGeneration\(\)\) return;/s,
    "the skeleton flag is cleared before the abandoned-open return, never left on");
});

// ------------------------------------------------------------------- U7
test("U7: a send that fails while the offline bar is up adds no toast (the bar and the bubble already say it)", async () => {
  const { state, route, created } = await openChat();
  const { sendMessage } = await import(UI + "actions.js");
  route(() => Object.assign(new TypeError("Failed to fetch"), {}));
  state.online = false;
  const before = toasts(created).length;
  const r = await sendMessage("hello while offline", { conversationId: 1 });
  assert.equal(r, null);
  assert.equal(toasts(created).length, before, "no duplicate toast while the offline bar is visible");
  assert.ok((state.pending[1] || []).some((p: any) => p.failed), "the bubble is marked as not sent");
  state.pending = {};
  state.online = true;
  const r2 = await sendMessage("hello while online", { conversationId: 1 });
  assert.equal(r2, null);
  // r5 U40: online too, the "not sent" row on screen (its .failwhy sentence and Send again) is the
  // one notice; a toast would only cover it. Before r5 this expected one toast here.
  assert.equal(toasts(created).length, before, "the bubble's own row is the only notice while it is on screen");
  assert.ok((state.pending[1] || []).some((p: any) => p.failed && p.error), "the row carries the error sentence");
  state.pending = {};
  // A failure the user cannot see (another conversation is open) still gets the toast.
  state.activeId = 2;
  const r3 = await sendMessage("hello to a conversation that is not open", { conversationId: 1 });
  assert.equal(r3, null);
  assert.equal(toasts(created).length, before + 1, "no row on screen: the toast is the notice");
  state.activeId = 1;
  state.pending = {};
});

// ------------------------------------------------------------------- U8
test("U8: the thread panel says it is loading, then that there are no replies yet", async () => {
  const { els, chat, route } = await openChat();
  let resolveThread: (v: any) => void = () => {};
  route(() => new Promise((r) => { resolveThread = r; }));
  const opening = chat.openThread(10);
  await tick();
  const loading = els.get("thread-slot")!.innerHTML;
  assert.match(loading, /Loading replies/, "while the fetch is in flight");
  assert.doesNotMatch(loading, /No replies yet/);
  resolveThread({ messages: [{ id: 10, conversationId: 1, actorId: 2, body: "root", ts: 1, kind: "text" }], actors: [], reactions: [] });
  await opening;
  const loaded = els.get("thread-slot")!.innerHTML;
  assert.doesNotMatch(loaded, /Loading replies/);
  assert.match(loaded, /No replies yet/, "an empty thread says so instead of showing the root alone");
  chat.closeThread();
});

test("U8: replies already in the message cache are painted before the fetch returns", async () => {
  const { els, state, chat, route } = await openChat();
  state.msgs[1].push({ id: 11, conversationId: 1, actorId: 1, body: "cached reply", ts: 2, kind: "text", threadId: 10 });
  route(() => new Promise(() => {}));
  void chat.openThread(10);
  await tick();
  const html = els.get("thread-slot")!.innerHTML;
  assert.match(html, /cached reply/, "the cached reply is on screen at once");
  assert.doesNotMatch(html, /Loading replies/, "with something to show, no loading line");
  state.threadOpen = null;
});

// ------------------------------------------------------------------- U14
test("U14: a deep link to a missing message lands on the conversation with a toast and no skeleton", async () => {
  const { els, state, chat, route, created } = await openChat();
  route(() => ({ messages: [], actors: [], reactions: [], pins: [], questions: [] }));
  const before = toasts(created).length;
  await chat.openConversation(1, 99999);
  assert.equal(state.loadingConv, false);
  assert.doesNotMatch(els.get("messages")!.innerHTML, /skeleton/);
  assert.match(els.get("messages")!.innerHTML, /data-msg="10"/, "the conversation's messages are drawn");
  assert.equal(toasts(created).length, before + 1, "one toast");
  assert.equal(toasts(created).at(-1)!.querySelector(".tmsg").textContent, "That message is gone or you cannot see it.");
});

test("U14: the toast sentence exists and is spoken by openConversation", () => {
  const src = readFileSync(UI + "view-chat.js", "utf8");
  const open = src.slice(src.indexOf("export async function openConversation"), src.indexOf("export async function openThread"));
  assert.match(open, /t\("That message is gone or you cannot see it\."\)/);
});

// ------------------------------------------------------------------- U15
test("U15: the More menu carries Octicons, a separator before the own-message group and plain wording", () => {
  const src = readFileSync(UI + "view-chat.js", "utf8");
  const menu = src.slice(src.indexOf("function openMessageMenu"), src.indexOf("function markUnreadFrom"));
  assert.match(menu, /action: "pin"[^\n]*icon:/, "pin has an icon");
  assert.match(menu, /action: "copy"[^\n]*icon:/, "copy has an icon");
  assert.match(menu, /action: "copylink"[^\n]*icon:/, "copy link has an icon");
  assert.match(menu, /action: "unread"[^\n]*icon:/, "mark unread has an icon");
  assert.match(menu, /action: "report"[^\n]*icon:/, "report has an icon");
  assert.match(menu, /action: "edit"/, "own messages get Edit in the menu");
  assert.match(menu, /separator: true/, "a separator before the own-message group");
  assert.match(menu, /mm-sep/, "the separator is drawn");
  assert.match(menu, /t\("Mark as a problem"\)/);
  assert.doesNotMatch(menu, /Treat as a report/);
  assert.doesNotMatch(menu, /Only then do the/);
  assert.match(menu, /data-mact="\$\{p\.action\}"/, "ui-s3-router.test.ts hooks on this");
  const css = readFileSync(CSS, "utf8");
  const s12 = css.slice(css.indexOf("/* === S12 === */"), css.indexOf("/* === S13 === */"));
  assert.match(s12, /\.msg-menu \.mm-sep\{/, "separator rule in the S12 block");
  assert.match(s12, /\.msg-menu \.mm-i/, "icon slot rule in the S12 block");
  assert.match(s12, /\.msg-menu button\.danger[^{]*\{[^}]*fgColor-danger/, "danger items use the Primer danger token");
});

// ------------------------------------------------------------------- U18
test("U18: the profile's Message button icon takes the button's colour (S6 block)", () => {
  const css = readFileSync(CSS, "utf8");
  const s6 = css.slice(css.indexOf("/* === S6 === */"), css.indexOf("/* === S7 === */"));
  assert.match(s6, /\.pf-actions \.btn svg\{[^}]*color:inherit/);
  assert.match(s6, /\.pf-actions \.btn svg\{[^}]*fill:currentColor/);
});

// ------------------------------------------------------------------- U19
test("U19: startDirect with several handles creates a group, with one a DM", async () => {
  const { calls, route } = await openChat();
  const { startDirect } = await import(UI + "actions.js");
  route((c) => c.path === "/api/conversations" && c.method === "POST"
    ? { conversation: { id: 7, kind: c.body.kind, members: c.body.members } }
    : { conversations: [], memberships: {} });
  await startDirect(["anna", "nestor"]);
  const group = calls.find((c) => c.path === "/api/conversations" && c.method === "POST");
  assert.ok(group, "a POST happened");
  assert.equal(group!.body.kind, "group");
  assert.deepEqual(group!.body.members, ["anna", "nestor"]);
  calls.length = 0;
  await startDirect("anna");
  const dm = calls.find((c) => c.path === "/api/conversations" && c.method === "POST");
  assert.equal(dm!.body.kind, "dm");
  assert.deepEqual(dm!.body.members, ["anna"]);
});
