/**
 * S8 (T-MG-3 wave 5): keyboard shortcuts, the help sheet, the all-unreads view and the Activity
 * copy. One table in `shortcuts.js` feeds both the key handler and the sheet; `view-unreads.js`
 * derives the unread groups from state alone; Activity rows read as one sentence and carry an
 * `aria-label`. Follow-ups: W2-S1-A (rail aria-label says Activity), W2-S1-C (DMs rail badge is
 * derived and repainted on unread changes), W2-S2-A (closeThread records the last side panel).
 *
 * Node, document stub: the pure helpers plus a few source checks for the wiring that only a
 * browser can run (the live checklist in the spec covers pixels and focus).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

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
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: (id: string) => (id === "main" ? main : el()), createElement: () => el(),
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
  return { main };
}

async function loadUi() {
  const { main } = stubBrowser();
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const shortcuts = await import(UI + "shortcuts.js");
  const unreads = await import(UI + "view-unreads.js");
  const notifications = await import(UI + "view-notifications.js");
  const store = await import(UI + "state.js");
  return { shortcuts, unreads, notifications, main, ...store };
}

type Key = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };
const ev = (key: string, mods: Partial<Key> = {}): Key => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

// ------------------------------------------------------------ matchShortcut (10 cases)
test("matchShortcut: Mod is the command key on a mac and Ctrl on windows", async () => {
  const { shortcuts: s } = await loadUi();
  assert.equal(s.matchShortcut(ev("k", { metaKey: true }), "mac"), "search");
  assert.equal(s.matchShortcut(ev("k", { ctrlKey: true }), "win"), "search");
  // The Windows key is not a modifier we listen to.
  assert.equal(s.matchShortcut(ev("k", { metaKey: true }), "win"), null);
  // Ctrl+K on a mac keeps working (that is what the handler accepted before S8).
  assert.equal(s.matchShortcut(ev("k", { ctrlKey: true }), "mac"), "search");
});

test("matchShortcut: the whole table from section 1 of the spec", async () => {
  const { shortcuts: s } = await loadUi();
  assert.equal(s.matchShortcut(ev("/", { metaKey: true }), "mac"), "help");
  assert.equal(s.matchShortcut(ev("ArrowUp", { altKey: true }), "mac"), "prevConversation");
  assert.equal(s.matchShortcut(ev("ArrowDown", { altKey: true }), "win"), "nextConversation");
  assert.equal(s.matchShortcut(ev("ArrowUp", { altKey: true, shiftKey: true }), "mac"), "prevUnread");
  assert.equal(s.matchShortcut(ev("ArrowDown", { altKey: true, shiftKey: true }), "win"), "nextUnread");
  assert.equal(s.matchShortcut(ev("A", { metaKey: true, shiftKey: true }), "mac"), "allUnreads");
  assert.equal(s.matchShortcut(ev("a", { ctrlKey: true, shiftKey: true }), "win"), "allUnreads");
  assert.equal(s.matchShortcut(ev(".", { metaKey: true }), "mac"), "sidePanel");
  assert.equal(s.matchShortcut(ev("K", { metaKey: true, shiftKey: true }), "mac"), "dms");
  assert.equal(s.matchShortcut(ev("[", { metaKey: true }), "mac"), "back");
  assert.equal(s.matchShortcut(ev("]", { ctrlKey: true }), "win"), "forward");
});

test("matchShortcut: a key without the right modifiers, or with extra ones, is nobody's shortcut", async () => {
  const { shortcuts: s } = await loadUi();
  assert.equal(s.matchShortcut(ev("k"), "mac"), null);
  assert.equal(s.matchShortcut(ev("ArrowUp"), "mac"), null);                       // plain Up belongs to the composer
  assert.equal(s.matchShortcut(ev("k", { metaKey: true, altKey: true }), "mac"), null);
  assert.equal(s.matchShortcut(ev("/", { metaKey: true, shiftKey: true }), "mac"), null);
  assert.equal(s.matchShortcut({ key: undefined } as unknown as Key, "mac"), null);
});

test("every shortcut in the table has a help line, and the sheet lists them all", async () => {
  const { shortcuts: s } = await loadUi();
  const names = Object.keys(s.SHORTCUTS);
  assert.ok(names.length >= 11, `only ${names.length} shortcuts`);
  const listed = s.SHORTCUT_HELP.map((h: { name: string }) => h.name);
  for (const n of names) assert.ok(listed.includes(n), `${n} missing from the help sheet`);
  for (const h of s.SHORTCUT_HELP) assert.equal(typeof h.label(), "string");
});

test("shortcutLabel prints symbols on a mac and words on windows", async () => {
  const { shortcuts: s } = await loadUi();
  assert.equal(s.shortcutLabel("Mod+Shift+A", "mac"), "⌘ ⇧ A");
  assert.equal(s.shortcutLabel("Mod+Shift+A", "win"), "Ctrl+Shift+A");
  assert.equal(s.shortcutLabel("Alt+ArrowUp", "mac"), "⌥ ↑");
  assert.equal(s.shortcutLabel("Alt+ArrowDown", "win"), "Alt+↓");
});

// ------------------------------------------------------------ stepping through conversations
test("stepConversation walks the list in order and wraps at both ends", async () => {
  const { shortcuts: s } = await loadUi();
  assert.equal(s.stepConversation([1, 2, 3], 2, 1), 3);
  assert.equal(s.stepConversation([1, 2, 3], 3, 1), 1);
  assert.equal(s.stepConversation([1, 2, 3], 1, -1), 3);
  assert.equal(s.stepConversation([1, 2, 3], null, 1), 1);
  assert.equal(s.stepConversation([], 1, 1), null);
});

test("stepUnread skips read conversations and returns null when nothing is unread", async () => {
  const { shortcuts: s } = await loadUi();
  const unread = { 1: 0, 2: 3, 3: 0, 4: 1 };
  assert.equal(s.stepUnread([1, 2, 3, 4], 1, unread, 1), 2);
  assert.equal(s.stepUnread([1, 2, 3, 4], 2, unread, 1), 4);
  assert.equal(s.stepUnread([1, 2, 3, 4], 4, unread, 1), 2);      // wraps past the end
  assert.equal(s.stepUnread([1, 2, 3, 4], 2, unread, -1), 4);     // wraps past the start
  assert.equal(s.stepUnread([1, 2, 3], 1, {}, 1), null);
});

// ------------------------------------------------------------ all-unreads view
const CONVS = [
  { id: 1, slug: "general", kind: "channel" },
  { id: 2, slug: "bugs", kind: "channel" },
  { id: 3, kind: "dm" },
  { id: 4, slug: "secret", kind: "channel" },
];
const m = (id: number, actorId: number, extra: Record<string, unknown> = {}) =>
  ({ id, actorId, ts: 1_700_000_000 + id, body: "m" + id, kind: "text", ...extra });

test("unreadGroups lists only conversations I belong to with unread > 0, newest activity first", async () => {
  const { unreads, state } = await loadUi();
  state.actor = { id: 1, handle: "michal" };
  state.conversations = CONVS;
  state.memberships = { 1: { lastReadMessageId: 10 }, 2: { lastReadMessageId: 20 }, 3: { lastReadMessageId: 0 } };
  state.unread = { 1: 2, 2: 0, 3: 1, 4: 5 };
  state.loaded = { 1: true, 3: true };
  state.msgs = {
    1: [m(9, 2), m(10, 2), m(11, 2), m(12, 1), m(13, 2)],
    3: [m(30, 2)],
  };
  const groups = unreads.unreadGroups(state);
  assert.deepEqual(groups.map((g: { conv: { id: number } }) => g.conv.id), [3, 1]);
  // In #general: ids above the read mark, by somebody else (12 is mine and does not count).
  assert.deepEqual(groups[1].messages.map((x: { id: number }) => x.id), [11, 13]);
  assert.equal(groups[1].count, 2);
  assert.equal(groups[1].pending, false);
});

test("unreadGroups marks a conversation whose history is not loaded as pending (lazy load)", async () => {
  const { unreads, state } = await loadUi();
  state.actor = { id: 1, handle: "michal" };
  state.conversations = CONVS;
  state.memberships = { 2: { lastReadMessageId: 20 } };
  state.unread = { 2: 3 };
  state.loaded = {};
  state.msgs = {};
  const [g] = unreads.unreadGroups(state);
  assert.equal(g.conv.id, 2);
  assert.equal(g.pending, true);
  assert.deepEqual(g.messages, []);
});

test("unreadDmCount sums unread in direct and group conversations I belong to", async () => {
  const { unreads } = await loadUi();
  const s = {
    conversations: [{ id: 1, kind: "channel" }, { id: 2, kind: "dm" }, { id: 3, kind: "group" }, { id: 4, kind: "dm" }],
    memberships: { 1: {}, 2: {}, 3: {} },
    unread: { 1: 9, 2: 2, 3: 3, 4: 7 },
  };
  assert.equal(unreads.unreadDmCount(s), 5);
  assert.equal(unreads.unreadDmCount({}), 0);
});

test("renderUnreadsMain writes grouped rows with screen reader names into #main", async () => {
  const { unreads, state, main } = await loadUi();
  state.actor = { id: 1, handle: "michal" };
  state.actorsCache = { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" } };
  state.conversations = CONVS;
  state.memberships = { 1: { lastReadMessageId: 10 } };
  state.unread = { 1: 1 };
  state.loaded = { 1: true };
  state.msgs = { 1: [m(11, 2, { body: "deploy window at 14:00" })] };
  state.view = "unreads";
  unreads.renderUnreadsMain();
  const html = String(main.innerHTML);
  assert.match(html, /id="unreads-list"/);
  assert.match(html, /data-open="1"/);
  assert.match(html, /data-goto="1" data-mid="11"/);
  assert.match(html, /aria-label="@nestor in #general: deploy window at 14:00"/);
  assert.match(html, /#general/);
});

test("renderUnreadsMain with nothing unread shows the caught-up empty state", async () => {
  const { unreads, state, main } = await loadUi();
  state.actor = { id: 1, handle: "michal" };
  state.conversations = CONVS;
  state.memberships = { 1: {} };
  state.unread = {};
  state.view = "unreads";
  unreads.renderUnreadsMain();
  assert.match(String(main.innerHTML), /You are all caught up/);
});

// ------------------------------------------------------------ Activity copy and labels
test("notifSentence names the place once: in #channel, in a thread in #channel, privately", async () => {
  const { notifications: n, state } = await loadUi();
  state.conversations = CONVS;
  state.msgs = { 2: [m(21, 2, { threadId: 20 })] };
  assert.equal(n.notifSentence({ kind: "mention", from: "nestor", conversationId: 1 }), "@nestor mentioned you in #general");
  assert.equal(n.notifSentence({ kind: "mention", from: "nestor", conversationId: 2, messageId: 21 }), "@nestor mentioned you in a thread in #bugs");
  assert.equal(n.notifSentence({ kind: "dm", from: "nestor", conversationId: 3 }), "@nestor wrote to you privately");
  assert.equal(n.notifSentence({ kind: "reaction", from: "anna", conversationId: 1 }), "@anna reacted to your post in #general");
});

test("notifLabel is the sentence plus the excerpt, for the row's aria-label", async () => {
  const { notifications: n, state } = await loadUi();
  state.conversations = CONVS;
  assert.equal(n.notifLabel({ kind: "mention", from: "nestor", conversationId: 1, excerpt: "see this" }),
    "@nestor mentioned you in #general: see this");
});

test("every Activity row button carries an aria-label and the view is titled Activity", async () => {
  const src = readFileSync(UI + "view-notifications.js", "utf8");
  assert.match(src, /<button class="notif[^>]*aria-label="\$\{escapeHtml\(notifLabel\(n\)\)\}"/);
  assert.match(src, /t\("Activity"\)/);
  assert.doesNotMatch(src, /<div class="t">\$\{iconBell\(\)\} \$\{t\("Notifications"\)\}/);
});

// ------------------------------------------------------------ follow-ups and wiring
test("W2-S1-A: refreshNotifications keeps the rail button named Activity", async () => {
  const src = readFileSync(UI + "data.js", "utf8");
  const line = src.split("\n").find((l) => l.includes('rail.setAttribute("aria-label"'));
  assert.ok(line, "the rail aria-label line is gone");
  assert.match(line!, /t\("Activity"\)/);
  assert.doesNotMatch(line!, /t\("Notifications"\)/);
});

test("W2-S1-C: the DMs rail badge is derived (unreadDmCount) and repainted when a row's unread changes", async () => {
  const src = readFileSync(UI + "app.js", "utf8");
  assert.match(src, /railBadges\(state\)\.dms/, "the DMs badge comes from counters.railBadges (W5-S8-B: one badge source)");
  assert.doesNotMatch(src, /const dmUnread = state\.conversations\s*\n?\s*\.filter/);
  assert.match(src, /function paintDmBadge/);
  assert.match(src, /conversationRow:[^\n]*paintDmBadge/);
});

test("W2-S2-A: closeThread records the thread as the last side panel so Mod+. reopens it", async () => {
  const src = readFileSync(UI + "view-chat.js", "utf8");
  const start = src.indexOf("export function closeThread()");
  const body = src.slice(start, src.indexOf("\n}", start));
  assert.match(body, /lastSidePanel = \{ kind: "thread", id: rootId \}/);
});

test("the key handler reads the shortcut table, the shell dispatches the unreads view, the module is served", async () => {
  const app = readFileSync(UI + "app.js", "utf8");
  assert.match(app, /matchShortcut\(e/);
  assert.match(app, /case "help": .*openShortcutHelp/);
  assert.match(app, /case "allUnreads": .*openUnreadsView/);
  assert.doesNotMatch(app, /e\.key\.toLowerCase\(\) === "k"/);
  assert.match(app, /state\.view === "unreads"/);
  const ui = readFileSync(fileURLToPath(new URL("../src/http/ui.ts", import.meta.url)), "utf8");
  assert.match(ui, /"view-unreads\.js"/);
  const pl = readFileSync(UI + "i18n-pl.js", "utf8");
  const s8 = pl.slice(pl.indexOf("// === S8 ==="), pl.indexOf("// === S9 ==="));
  assert.match(s8, /"Keyboard shortcuts":/);
  assert.match(s8, /"All unreads":/);
  const css = readFileSync(CSS, "utf8");
  const block = css.slice(css.indexOf("/* === S8 === */"), css.indexOf("/* === S9 === */"));
  assert.match(block, /\.unreads-list/);
  assert.match(block, /\.shortcut-sheet/);
  assert.doesNotMatch(block, /\d\.?\d*rem/, "S8 CSS uses Primer tokens, not literal rem");
});
