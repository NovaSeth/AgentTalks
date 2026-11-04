/**
 * S12 (T-MG-3 wave 6): message polish. The hover bar carries a quick-react row of the four most
 * used emoji of the conversation, then "add a reaction", "reply in a thread", the report
 * controls, "edit" and "more"; reaction chips carry a tooltip with the names; the delivery line
 * collapses to a small icon ten seconds after the send; older messages load as you scroll up.
 *
 * Follow-ups owned here: W1-C (a message that mentions ME gets the Primer attention tint and a
 * left attention border, not the danger tint; @all gets no row tint) and W4-S6-A (author name
 * and avatar are buttons that open the profile, so the keyboard reaches them).
 *
 * What is checked here (node, document stub): the pure helpers `topReactions`, `reactionTooltip`,
 * `mentionsMeDirectly` and the markup of `messageHtml` / `deliveryHtml`, plus source assertions
 * for the CSS block and the scroll watch. Pixel truth is the live checklist of the slice.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

/** The minimal browser from test/ui-s6-people.test.ts. */
function stubBrowser(): void {
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
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: () => el(), createElement: () => el(), createTextNode: () => el(),
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
}

type AnyState = Record<string, any>;

/** One public channel, me (@michal, human) and two agents; six messages, some with reactions. */
async function seed(): Promise<{ state: AnyState; chat: AnyState }> {
  stubBrowser();
  const { state, rebuildMentionRe, animatedMsgs } = await import(UI + "state.js");
  const i18n = await import(UI + "i18n.js");
  // Node has no navigator: the language falls back to the system locale; the assertions read English.
  i18n.setLang("en");
  const chat = await import(UI + "view-chat.js");
  const s = state as AnyState;
  s.actor = { id: 1, handle: "michal", kind: "human" };
  rebuildMentionRe();
  s.view = "chat";
  s.activeId = 1;
  s.conversations = [{ id: 1, kind: "public", slug: "general", topic: "" }];
  s.memberships = { 1: { role: "member" } };
  s.actorsCache = {
    1: { handle: "michal", displayName: "Michal", kind: "human" },
    2: { handle: "nestor", displayName: "Nestor", kind: "agent" },
    3: { handle: "milosz", displayName: "Milosz", kind: "agent" },
  };
  s.openQuestions = {};
  s.convPins = [];
  s.reportFilter = false;
  s.lastDelivery = null;
  s.msgs = { 1: [
    { id: 10, conversationId: 1, actorId: 2, kind: "text", body: "hello", ts: 1000 },
    { id: 11, conversationId: 1, actorId: 3, kind: "text", body: "@michal look here", ts: 1001 },
    { id: 12, conversationId: 1, actorId: 2, kind: "text", body: "@all stand-up in five", ts: 1002 },
    { id: 13, conversationId: 1, actorId: 1, kind: "text", body: "on it", ts: 1003 },
  ] };
  s.reactions = {
    10: { "🔥": ["michal", "nestor"], "👀": ["milosz"] },
    11: { "🔥": ["nestor"], "🎉": ["michal"], "👀": ["nestor"], "🚀": ["milosz"], "✅": ["michal"] },
  };
  animatedMsgs.clear();
  return { state: s, chat };
}

const msg = (s: AnyState, id: number) => s.msgs[1].find((m: AnyState) => m.id === id);

test("topReactions: the four most used emoji of the conversation, by count, then the palette fills up", async () => {
  const { chat } = await seed();
  // 🔥 x3, 👀 x2, then 🎉 🚀 ✅ at one each in first-seen order: the row takes four.
  assert.deepEqual(chat.topReactions(1), ["🔥", "👀", "🎉", "🚀"]);
  // A conversation without reactions falls back to the head of the palette.
  assert.equal(chat.topReactions(999).length, 4);
  assert.equal(chat.topReactions(999)[0], "👍");
});

test("reactionTooltip: names in a sentence, me first as 'You'", async () => {
  const { chat } = await seed();
  assert.equal(chat.reactionTooltip("🔥", ["michal", "nestor"], "michal"), "You and @nestor reacted with 🔥");
  assert.equal(chat.reactionTooltip("👀", ["milosz"], "michal"), "@milosz reacted with 👀");
  assert.equal(chat.reactionTooltip("🎉", ["michal"], "michal"), "You reacted with 🎉");
  assert.equal(chat.reactionTooltip("🚀", ["a", "b", "c"], "michal"), "@a, @b and @c reacted with 🚀");
});

test("messageHtml: the hover bar is quick reacts, add reaction, reply, edit, more - in that order", async () => {
  const { state, chat } = await seed();
  const html: string = chat.messageHtml(msg(state, 13), false, { threads: new Map() });
  const actions = html.slice(html.indexOf('class="actions"'));
  const quick = [...actions.matchAll(/data-react="13" data-emoji="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(quick, ["🔥", "👀", "🎉", "🚀"], "the four most used emoji of the conversation");
  const order = ["data-emoji=\"🚀\"", "data-addreact=\"13\"", "data-reply=\"13\"", "data-edit=\"13\"", "data-more=\"13\""]
    .map((needle) => actions.indexOf(needle));
  assert.ok(order.every((i) => i >= 0), `every button present: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "Slack order kept");
  assert.match(actions, /aria-label="React with 🔥"/);
});

test("messageHtml: a reaction chip names who reacted and says whether it is mine (aria-pressed)", async () => {
  const { state, chat } = await seed();
  const html: string = chat.messageHtml(msg(state, 10), false, { threads: new Map() });
  assert.match(html, /title="You and @nestor reacted with 🔥"/);
  assert.match(html, /data-emoji="🔥"[^>]*aria-pressed="true"/);
  assert.match(html, /title="@milosz reacted with 👀"/);
  assert.match(html, /data-emoji="👀"[^>]*aria-pressed="false"/);
});

test("W4-S6-A: author name and avatar are buttons that open the profile", async () => {
  const { state, chat } = await seed();
  const html: string = chat.messageHtml(msg(state, 10), false, { threads: new Map() });
  assert.match(html, /<button type="button" class="author" data-profile="nestor"[^>]*>@nestor<\/button>/);
  assert.match(html, /<button type="button" class="av-btn" data-profile="nestor" aria-label="Open the profile of @nestor"/);
  // An in-flight bubble keeps plain text: there is nothing to open yet.
  const pending: string = chat.messageHtml({ id: "tmp-1", conversationId: 1, actorId: 1, body: "x", ts: 1, pending: true, clientMsgId: "c1" }, false);
  assert.doesNotMatch(pending, /data-profile/);
});

test("W1-C: only a message that mentions ME carries .mine-mention; @all does not", async () => {
  const { state, chat } = await seed();
  assert.equal(chat.mentionsMeDirectly("@michal look here"), true);
  assert.equal(chat.mentionsMeDirectly("@all stand-up"), false);
  assert.equal(chat.mentionsMeDirectly("@michalina no"), false);
  const me: string = chat.messageHtml(msg(state, 11), false, { threads: new Map() });
  const all: string = chat.messageHtml(msg(state, 12), false, { threads: new Map() });
  assert.match(me, /class="msg [^"]*mine-mention/);
  assert.doesNotMatch(all, /mine-mention/);
});

test("W1-C: the mention tint is Primer attention in the S12 block, not the danger/coral tint", () => {
  const css = readFileSync(CSS, "utf8");
  const block = css.slice(css.indexOf("/* === S12 === */"), css.indexOf("/* === S13 === */"));
  assert.match(block, /\.msg\.mine-mention\{[^}]*var\(--bgColor-attention-muted\)/);
  assert.match(block, /\.msg\.mine-mention\{[^}]*var\(--borderColor-attention-emphasis\)/);
  assert.doesNotMatch(block, /coral/);
  // Author and avatar buttons keep the look of the old spans (W4-S6-A).
  assert.match(block, /\.msg \.author\b/);
  assert.match(block, /\.msg \.av-btn\b/);
  // Spacing in the new rules uses Primer tokens, not literal rem.
  assert.doesNotMatch(block, /:\s*\.?\d+rem/);
});

test("deliveryHtml: the sentence right after a send, a small icon with the sentence as tooltip after 10 s", async () => {
  const { state, chat } = await seed();
  const m = msg(state, 13);
  const delivery = [{ handle: "nestor", online: true }, { handle: "milosz", online: false, wakeable: false }];
  state.lastDelivery = { conversationId: 1, messageId: 13, delivery, shownAt: Date.now() };
  const fresh: string = chat.deliveryHtml(m);
  assert.match(fresh, /class="delivery"/);
  assert.match(fresh, /@nestor is online now/);
  assert.match(fresh, /@milosz is offline/);
  state.lastDelivery.shownAt = Date.now() - 11_000;
  const later: string = chat.deliveryHtml(m);
  assert.match(later, /class="delivery compact"/);
  assert.match(later, /aria-label="Delivery: /);
  assert.match(later, /title="[^"]*@nestor is online now[^"]*@milosz is offline/);
  assert.doesNotMatch(later, />[^<]*@nestor is online now/, "the sentence is in the tooltip, not in the flow");
  assert.match(later, /<svg/);
});

test("W2-S7-A add-on: the divider gets the newest unread id as the fifth argument of dividerAfter", () => {
  const src = readFileSync(UI + "view-chat.js", "utf8");
  assert.match(src, /dividerAfter\(list, state\.readMark\[state\.activeId\] \|\| 0, state\.unread\[state\.activeId\], state\.actor\.id,\s*state\.lastUnread\[state\.activeId\]\)/);
});

test("older messages load as you scroll up (300 px before the top), without a click", () => {
  const src = readFileSync(UI + "view-chat.js", "utf8");
  const watch = src.slice(src.indexOf("function bindScrollWatch"), src.indexOf("function saveOpenEdit"));
  assert.match(watch, /el\.scrollTop < 300 && state\.activeId && state\.hasMore\[state\.activeId\]/);
  assert.match(watch, /loadOlderMessages\(state\.activeId\)/);
});
