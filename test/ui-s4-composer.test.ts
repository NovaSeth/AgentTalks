/**
 * S4 (T-MG-3 wave 3): composer parity. One composer (composer.js) serves the main dock and the
 * thread panel: a formatting bar that wraps the selection in markdown, an emoji picker with
 * search (emoji.js), `#channel` autocomplete and links, "Also send to channel" for a thread
 * reply, a draft that outlives a failed send, and an autocomplete that ignores a stale answer.
 *
 * Checked here (node, document stub): the pure helpers (wrapSelection, completeToken,
 * channelCandidates, searchEmoji), the markdown channel-link rule (U3: a heading and an unknown
 * slug are NOT links), the markup both composers emit, sendMessage honouring an explicit
 * `threadId: null`, the module registration and the CSS/i18n blocks. Caret, focus and the live
 * popovers are the live checklist in the spec (1-8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));
const UI_TS = fileURLToPath(new URL("../src/http/ui.ts", import.meta.url));

type El = Record<string, any>;
/** The minimal browser from test/ui-s2-panel.test.ts, with one element kept per id so a test
 *  can read what a render wrote into it. */
function stubBrowser(): { els: Map<string, El>; calls: Array<{ path: string; body: any }> } {
  const el = (): El => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
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
  const byId = (id: string) => { if (!els.has(id)) els.set(id, el()); return els.get(id)!; };
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: byId, createElement: () => el(), createTextNode: () => el(),
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
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem(k: string, v: string) { store.set(k, v); }, removeItem(k: string) { store.delete(k); } };
  g.HTMLImageElement = class {};
  g.Event = class { type: string; constructor(type: string) { this.type = type; } };
  g.EventSource = class { close() {} addEventListener() {} };
  const calls: Array<{ path: string; body: any }> = [];
  g.fetch = async (path: string, init: any) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true, status: 200, json: async () => ({ message: { id: 900 + calls.length, conversationId: 1, actorId: 1, body: "x", ts: 1, kind: "text" } }), text: async () => "" };
  };
  return { els, calls };
}

// ------------------------------------------------------------- composer.js helpers
test("S4: wrapSelection wraps, unwraps and handles block markers", async () => {
  stubBrowser();
  const { wrapSelection } = await import(UI + "composer.js");
  // (5) select a word, press B -> **word**, the selection stays on the word.
  assert.deepEqual(wrapSelection("say hello now", 4, 9, "**"), { text: "say **hello** now", start: 6, end: 11 });
  // Pressing it again removes the markers (a toggle, not a pile of asterisks).
  assert.deepEqual(wrapSelection("say **hello** now", 6, 11, "**"), { text: "say hello now", start: 4, end: 9 });
  // No selection: the markers are inserted and the caret lands between them.
  assert.deepEqual(wrapSelection("abc", 3, 3, "`"), { text: "abc``", start: 4, end: 4 });
  // Code block: a fenced block on its own lines.
  assert.deepEqual(wrapSelection("x = 1", 0, 5, "```"), { text: "```\nx = 1\n```", start: 4, end: 9 });
  // Line prefixes (list, quote) go in front of every selected line.
  assert.deepEqual(wrapSelection("a\nb", 0, 3, "- "), { text: "- a\n- b", start: 0, end: 7 });
  assert.deepEqual(wrapSelection("q", 0, 1, "> "), { text: "> q", start: 0, end: 3 });
  // Link: the selection becomes the label, the caret sits inside the empty parentheses.
  assert.deepEqual(wrapSelection("docs", 0, 4, "["), { text: "[docs]()", start: 7, end: 7 });
});

test("S4: completeToken finds the @ or # token under the caret and nothing else", async () => {
  stubBrowser();
  const { completeToken } = await import(UI + "composer.js");
  assert.deepEqual(completeToken("hello #bu", 9, "#"), { start: 6, query: "bu" });
  assert.deepEqual(completeToken("#", 1, "#"), { start: 0, query: "" });
  assert.deepEqual(completeToken("(@nes", 5, "@"), { start: 1, query: "nes" });
  assert.equal(completeToken("hello #bu", 9, "@"), null, "a # token is not an @ token");
  assert.equal(completeToken("a#b", 3, "#"), null, "a hash inside a word is not a token");
  assert.equal(completeToken("#bugs done", 10, "#"), null, "a space ends the token");
  assert.equal(completeToken("#bugs", 2, "#")?.query, "b", "the token is cut at the caret");
  assert.equal(completeToken("say hi", 6, "#"), null);
});

test("S4: channelCandidates lists my channels first, then joinable ones, filtered by prefix", async () => {
  stubBrowser();
  const { channelCandidates } = await import(UI + "composer.js");
  const conversations = [
    { id: 1, slug: "general", kind: "public" }, { id: 2, slug: "bugs", kind: "public" },
    { id: 3, slug: "build", kind: "public" }, { id: 4, slug: null, kind: "direct" }, { id: 5, slug: "secret", kind: "private" },
  ];
  const memberships = { 1: {}, 3: {}, 5: {} };
  const got = channelCandidates("bu", conversations, memberships);
  assert.deepEqual(got.map((c: any) => [c.slug, c.member]), [["build", true], ["bugs", false]]);
  assert.deepEqual(channelCandidates("", conversations, memberships).map((c: any) => c.slug), ["build", "general", "secret", "bugs"]);
  assert.deepEqual(channelCandidates("zzz", conversations, memberships), []);
});

// ------------------------------------------------------------- emoji.js
test("S4: searchEmoji finds by English and Polish names, recent ones come first", async () => {
  stubBrowser();
  const emoji = await import(UI + "emoji.js");
  assert.ok(emoji.EMOJI.length >= 250, `the static list has ${emoji.EMOJI.length} entries; expected ~300`);
  assert.equal(emoji.searchEmoji("rocket", "en")[0]?.ch, "\u{1F680}");
  assert.equal(emoji.searchEmoji("rak", "pl")[0]?.ch, "\u{1F680}");
  assert.ok(emoji.searchEmoji("RAKIETA", "pl").some((e: any) => e.ch === "\u{1F680}"), "case-insensitive");
  assert.deepEqual(emoji.searchEmoji("nothing-like-this", "en"), []);
  // An empty query lists the recently used first, then the rest of the list.
  emoji.rememberEmoji("\u{1F680}");
  emoji.rememberEmoji("\u{1F389}");
  assert.deepEqual(emoji.searchEmoji("", "en").slice(0, 2).map((e: any) => e.ch), ["\u{1F389}", "\u{1F680}"]);
  assert.deepEqual(emoji.recentEmoji(), ["\u{1F389}", "\u{1F680}"]);
});

// ------------------------------------------------------------- markdown.js channel links
test("S4: #slug renders as a link only for a conversation I can see", async () => {
  stubBrowser();
  const { state } = await import(UI + "state.js");
  const { renderBody, mdToHtml } = await import(UI + "markdown.js");
  state.conversations = [{ id: 2, slug: "bugs", kind: "public" }];
  assert.match(renderBody("see #bugs, please"), /<a href="#\/c\/bugs" class="chanlink" data-channel="bugs">#bugs<\/a>,/);
  assert.equal(renderBody("# title"), "<p># title</p>", "a heading-looking line is not a link");
  assert.equal(renderBody("ticket #1 and #zzz"), "<p>ticket #1 and #zzz</p>", "unknown slugs stay plain");
  assert.equal(renderBody("a#bugs"), "<p>a#bugs</p>", "a hash inside a word is not a link");
  assert.match(mdToHtml("# Heading\n\ngo to #bugs", "page"), /<h2>Heading<\/h2>.*<a href="#\/c\/bugs"/s);
  assert.doesNotMatch(renderBody("`#bugs`"), /<a /, "code is opaque");
});

// ------------------------------------------------------------- view-chat.js markup
async function openChat() {
  const browser = stubBrowser();
  const { state } = await import(UI + "state.js");
  const chat = await import(UI + "view-chat.js");
  state.actor = { id: 1, handle: "michal", kind: "human" };
  state.view = "chat";
  state.conversations = [{ id: 1, slug: "general", kind: "public" }, { id: 2, slug: "bugs", kind: "public" }];
  state.memberships = { 1: { lastReadMessageId: 0 }, 2: { lastReadMessageId: 0 } };
  state.activeId = 1;
  state.messages = { 1: [{ id: 10, conversationId: 1, actorId: 1, body: "root", ts: 1, kind: "text" }] };
  state.loaded = { 1: true };
  return { ...browser, state, chat };
}

test("S4: the main composer carries the formatting bar, the emoji button and keeps its ids", async () => {
  const { els, chat } = await openChat();
  chat.renderComposer();
  const html = els.get("composer")!.innerHTML;
  for (const fmt of ["bold", "italic", "strike", "code", "codeblock", "link", "list", "quote"]) {
    assert.match(html, new RegExp(`data-fmt="${fmt}"`), `formatting button ${fmt}`);
  }
  assert.match(html, /id="composer-emoji"/);
  assert.match(html, /id="composer-input"/, "state.saveDraft and actions.js read #composer-input");
  assert.match(html, /id="composer-send"/);
  assert.match(html, /id="composer-attach"/);
  const fmtButtons = [...html.matchAll(/<button[^>]*data-fmt="[a-z]+"[^>]*>/g)].map((m) => m[0]);
  assert.equal(fmtButtons.length, 8);
  for (const tag of fmtButtons) assert.match(tag, /aria-label="[^"]+"/, `formatting button without a name: ${tag}`);
  assert.doesNotMatch(html, /slack/i);
});

test("S4: the thread panel reuses the composer and offers 'Also send to channel'", async () => {
  const { els, state, chat } = await openChat();
  state.threadOpen = 10;
  state.threadMsgs = [{ id: 10, conversationId: 1, actorId: 1, body: "root", ts: 1, kind: "text" }];
  chat.renderThread();
  const html = els.get("th-composer")!.innerHTML;
  assert.match(html, /id="th-input"/);
  assert.match(html, /id="th-send"/);
  assert.match(html, /data-fmt="bold"/, "the thread box has the same formatting bar");
  assert.match(html, /id="th-emoji"/);
  assert.match(html, /id="th-also"[^>]*type="checkbox"/, "the also-send checkbox");
  assert.match(html, /#general/, "the checkbox names the channel");
});

// ------------------------------------------------------------- actions.js
test("S4: sendMessage with an explicit threadId:null posts to the channel even while replying", async () => {
  const { state, calls } = await openChat();
  const { sendMessage } = await import(UI + "actions.js");
  state.replyTo = 10;
  await sendMessage("copy", { conversationId: 1, threadId: null });
  const post = calls.find((c) => c.path === "/api/conversations/1/messages");
  assert.ok(post, "a POST happened");
  assert.equal(post!.body.threadId, undefined, "no threadId: this is the channel copy");
  state.replyTo = null;
});

// ------------------------------------------------------------- registration, CSS, i18n
test("S4: emoji.js is served (UI_MODULES) and the S4 blocks are filled", () => {
  const uiTs = readFileSync(UI_TS, "utf8");
  assert.ok(uiTs.includes('"emoji.js"'), "emoji.js not in UI_MODULES");
  const css = readFileSync(CSS, "utf8");
  const block = css.split("/* === S4 === */")[1]?.split("/* === S5 === */")[0] ?? "";
  assert.match(block, /\.fmtbar/, "the S4 block styles the formatting bar");
  assert.match(block, /\.emoji-picker/, "the S4 block styles the emoji picker");
  assert.doesNotMatch(block, /:\s*\d*\.?\d+rem/, "spacing through Primer tokens, not literal rem");
  const pl = readFileSync(UI + "i18n-pl.js", "utf8");
  const plBlock = pl.split("// === S4 ===")[1]?.split("// === S5 ===")[0] ?? "";
  assert.match(plBlock, /"Also send to #\{channel\}"/);
  assert.match(plBlock, /"Bold"/);
});
