/**
 * C2 (T-MG-3 wave 6): state, components and CSS clean-up. One test per follow-up the slice owns:
 * W2-S7-A (divider prefers the server's last unread id), W2-S7-B (the coral badge prints the
 * number the title counts), W2-S7-C (no caller toast on a lost session), W1-A (base CSS rules
 * use Primer tokens), W1-B (Counter/Label/tooltip look), W3-S4-A (Polish emoji names in a locale
 * file), W3-S4-C (thread box says where files go), W4-S6-B (square agent avatars everywhere),
 * W4-S6-D (dynamic state keys in initialState), W4-S5-A (one claim modal), W5-S8-B (railBadges
 * carries dms), W5-S9-A (dead caption rule removed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));
const UI_TS = fileURLToPath(new URL("../src/http/ui.ts", import.meta.url));
const ALLOWLIST = fileURLToPath(new URL("./language-allowlist.txt", import.meta.url));

const src = (name: string) => readFileSync(UI + name, "utf8");

type Stub = Record<string, unknown>;
const created: Stub[] = [];
function element(): Stub {
  const el: Stub = {
    className: "", innerHTML: "", textContent: "", children: [] as Stub[], attrs: {} as Record<string, string>,
    classList: { add() {}, toggle() {}, contains: () => false },
    setAttribute(k: string, v: string) { (el.attrs as Record<string, string>)[k] = v; },
    appendChild(c: Stub) { (el.children as Stub[]).push(c); return c; },
    querySelector: () => ({ textContent: "", addEventListener() {} }),
    addEventListener() {}, remove() {},
  };
  return el;
}

async function loadUi() {
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, getElementById: () => null, addEventListener() {},
    createElement() { const el = element(); created.push(el); return el; },
    body: { appendChild() {} }, title: "", visibilityState: "visible",
  };
  g.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null };
  g.HTMLImageElement = class {};
  const i18n = await import(UI + "i18n.js");
  i18n.setLang("en");
  const counters = await import(UI + "counters.js");
  const store = await import(UI + "state.js");
  const dom = await import(UI + "dom.js");
  const api = await import(UI + "api.js");
  const toasts = await import(UI + "toasts.js");
  return { counters, dom, api, toasts, ...store };
}

const ME = 1, OTHER = 2;
const msg = (id: number, actorId = OTHER) => ({ id, actorId, ts: 1_700_000_000 + id, body: "m" + id, kind: "text" });

// ------------------------------------------------------------ W2-S7-A
test("W2-S7-A: applyUnreadRows keeps the server's last unread id per conversation", async () => {
  const { applyUnreadRows, state, resetState } = await loadUi();
  resetState();
  applyUnreadRows([{ conversationId: 7, unread: 3, badge: 1, lastUnreadMessageId: 42 }]);
  assert.equal(state.lastUnread[7], 42);
  assert.deepEqual(Object.keys(state.lastUnread), ["7"]);
});

test("W2-S7-A: dividerAfter with no read mark does not count hidden thread replies above the last unread id", async () => {
  const { counters } = await loadUi();
  // The main list shows 10..13 by others; the server counted 4 unread, two of them replies that
  // live in a thread, and the newest unread in the main list is 13 while the newest unread
  // overall is 15 (a reply). Only the main-list messages up to 13 can carry the line.
  const list = [msg(10), msg(11), msg(12), msg(13)];
  assert.equal(counters.dividerAfter(list, 0, 4, ME, 15), 9, "every visible message is unread: line above 10");
  // Two unread, the last unread is 13 and visible: the line goes above 12, not above 10.
  assert.equal(counters.dividerAfter(list, 0, 2, ME, 13), 11);
  // Messages after the last unread id are not unread (a stale row): they do not count.
  assert.equal(counters.dividerAfter([msg(10), msg(11), msg(12), msg(13)], 0, 1, ME, 11), 10);
  // Without the hint the old estimate still works.
  assert.equal(counters.dividerAfter(list, 0, 2, ME), 11);
});

// ------------------------------------------------------------ W2-S7-B
test("W2-S7-B: the sidebar badge prints the weighted number the tab title counts", () => {
  const sidebar = src("view-sidebar.js");
  assert.match(sidebar, /import \{[^}]*\bbadgeText\b[^}]*\} from "\.\/counters\.js"/, "badge number through counters.badgeText");
  assert.doesNotMatch(sidebar, /unread > 99 \? "99\+" : (String\(unread\)|unread)/, "no local 99+ cap on the plain unread count");
  // The pointwise update and the list template both read unreadBadge for the number.
  assert.match(sidebar, /badge\.textContent = badgeText\(state\.unreadBadge\[convId\]/);
  assert.match(sidebar, /<span class="badge"[^>]*>\$\{badgeText\(state\.unreadBadge\[c\.id\]\)\}<\/span>/);
});

// ------------------------------------------------------------ W2-S7-C
test("W2-S7-C: a 401 marks the error sessionLost and showError stays silent for it", async () => {
  const { api, toasts } = await loadUi();
  const g = globalThis as Record<string, unknown>;
  g.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "nope", code: "session_invalid" }) });
  let err: Record<string, unknown> | null = null;
  try { await api.api("GET", "/api/conversations"); } catch (e) { err = e as Record<string, unknown>; }
  assert.ok(err, "the caller still gets its error");
  assert.equal(err!.sessionLost, true);
  created.length = 0;
  toasts.showError(err);
  assert.equal(created.length, 0, "no caller toast next to the session-ended toast");
  toasts.showError(Object.assign(new Error("x"), { status: 500 }));
  assert.ok(created.length > 0, "other errors still toast");
  // Signing in is session free: a wrong password is a normal error.
  err = null;
  try { await api.api("POST", "/api/login", {}); } catch (e) { err = e as Record<string, unknown>; }
  assert.equal(err!.sessionLost, undefined);
});

// ------------------------------------------------------------ W4-S6-D
test("W4-S6-D: profileHandle and convMembersFor are part of the initial state", async () => {
  const { state, resetState } = await loadUi();
  state.profileHandle = "x"; state.convMembersFor = 9;
  resetState();
  assert.equal(state.profileHandle, null);
  assert.equal(state.convMembersFor, null);
  assert.ok("lastUnread" in state);
});

// ------------------------------------------------------------ W4-S5-A
test("W4-S5-A: one claim modal: view-sidebar.js exports it and commands.js imports it", () => {
  const sidebar = src("view-sidebar.js"), commands = src("commands.js");
  assert.match(sidebar, /export function claimLeaseModal\(/);
  assert.match(commands, /import \{[^}]*\bclaimLeaseModal\b[^}]*\} from "\.\/view-sidebar\.js"/);
  assert.doesNotMatch(commands, /function openClaimModal\(/, "the duplicate body is gone");
  assert.equal((sidebar + commands).split('<h2 id="m-title">${t("Claim a resource")}</h2>').length - 1, 1, "the modal markup exists once");
});

// ------------------------------------------------------------ W5-S8-B
test("W5-S8-B: railBadges carries dms from the unread of my direct and group conversations", async () => {
  const { counters } = await loadUi();
  const state = {
    notifUnread: 2,
    conversations: [{ id: 1, kind: "channel" }, { id: 2, kind: "dm" }, { id: 3, kind: "group" }, { id: 4, kind: "dm" }],
    memberships: { 1: {}, 2: {}, 3: {} },
    unread: { 1: 5, 2: 3, 3: 4, 4: 9 },
  };
  assert.deepEqual(counters.railBadges(state), { activity: 2, dms: 7 });
  assert.deepEqual(counters.railBadges({}), { activity: 0, dms: 0 });
  assert.equal(counters.unreadDmCount(state), 7);
});

// ------------------------------------------------------------ W4-S6-B
test("W4-S6-B: avatarHtml marks agent faces so they are square-cornered everywhere", async () => {
  const { dom, mergeActors, resetState } = await loadUi();
  resetState();
  mergeActors({ 5: { handle: "builder", kind: "agent" }, 6: { handle: "ann", kind: "human" } });
  assert.match(dom.avatarHtml("builder", 28), /class="av sm agent"/);
  assert.match(dom.avatarHtml("@builder"), /class="av agent"/);
  assert.doesNotMatch(dom.avatarHtml("ann"), /\bagent\b/);
  assert.doesNotMatch(dom.avatarHtml("unknown-handle"), /\bagent\b/, "an unknown actor keeps the human default");
  const css = readFileSync(CSS, "utf8");
  assert.match(css, /\.av\.agent\{[^}]*border-radius:var\(--borderRadius-medium\)/);
});

// ------------------------------------------------------------ W3-S4-A
test("W3-S4-A: Polish emoji names live in emoji-names-pl.js, served and allowlisted with a reason", async () => {
  const emojiSrc = src("emoji.js");
  assert.doesNotMatch(emojiSrc, /rakieta|jablko|klaskanie/, "emoji.js carries English names only");
  assert.match(emojiSrc, /from "\.\/emoji-names-pl\.js"/);
  const pl = await import(UI + "emoji-names-pl.js");
  assert.ok(Object.keys(pl.EMOJI_NAMES_PL).length >= 250);
  assert.equal(pl.EMOJI_NAMES_PL["\u{1F680}"], "rakieta start wdrozenie");
  const uiTs = readFileSync(UI_TS, "utf8");
  assert.ok(uiTs.includes('"emoji-names-pl.js"'), "emoji-names-pl.js not in UI_MODULES");
  const allow = readFileSync(ALLOWLIST, "utf8").split("\n")
    .filter((l) => !l.startsWith("#") && l.includes("src/http/ui/js/emoji-names-pl.js"));
  assert.ok(allow.length >= 1, "the locale data file is allowlisted with a reason");
  for (const line of allow) assert.ok(line.split("\t")[3]?.trim().length > 20, "every entry explains itself");
  // The search still finds the rocket through its Polish name, whatever the UI language.
  const emoji = await import(UI + "emoji.js");
  assert.equal(emoji.searchEmoji("rak", "pl")[0]?.ch, "\u{1F680}");
  assert.ok(emoji.searchEmoji("rakieta", "en").some((e: { ch: string }) => e.ch === "\u{1F680}"));
  assert.equal(emoji.EMOJI.find((e: { ch: string }) => e.ch === "\u{1F680}")?.pl, "rakieta start wdrozenie");
});

// ------------------------------------------------------------ W3-S4-C
test("W3-S4-C: the thread box has no attach button and says where files go (Primer tooltip)", async () => {
  await loadUi();
  const { composerCardHtml } = await import(UI + "composer.js");
  const thread = composerCardHtml({ prefix: "th", placeholder: "p", label: "l", files: false });
  assert.doesNotMatch(thread, /id="th-attach"/);
  assert.match(thread, /class="attach-note tooltipped tooltipped-n"/);
  assert.match(thread, /aria-label="Files go to the conversation: attach them in the main message box"/);
  const main = composerCardHtml({ prefix: "composer", placeholder: "p", label: "l", files: true });
  assert.match(main, /id="composer-attach"/);
  assert.doesNotMatch(main, /attach-note/);
});

// ------------------------------------------------------------ W5-S9-A, W1-A, W1-B (app.css)
function baseRules(): string {
  const css = readFileSync(CSS, "utf8");
  const cut = css.indexOf("/* === S1 === */");
  assert.ok(cut > 0);
  return css.slice(0, cut).replace(/\/\*[\s\S]*?\*\//g, "");
}

test("W5-S9-A: the dead S1 caption scaling rule is gone", () => {
  const css = readFileSync(CSS, "utf8");
  assert.doesNotMatch(css, /calc\(var\(--text-caption-size\) \* \.9\)/);
  assert.doesNotMatch(css, /3\.4rem rail column/);
});

test("W1-A: base rules use Primer tokens for spacing and type, not literal rem", () => {
  const base = baseRules();
  const literal = /(?:^|[;{\s])(font-size|padding|margin|gap|row-gap|column-gap|min-width|min-height|top|right|bottom|left)(?:-[a-z]+)?:[^;}]*\b\d*\.?\d+rem\b/g;
  const hits = base.match(literal) || [];
  assert.deepEqual(hits, [], `literal rem in base rules:\n${hits.join("\n")}`);
  // Boxes and sizes: a literal rem survives only where no token reaches (above 8rem).
  const sizes = [...base.matchAll(/\b(width|height|max-width|max-height):\s*(\d*\.?\d+)rem\b/g)]
    .filter((m) => Number(m[2]) <= 8).map((m) => m[0]);
  assert.deepEqual(sizes, [], `literal rem sizes within token reach:\n${sizes.join("\n")}`);
});

test("W1-B: the badge and the kind tag follow Primer Counter and Label metrics", () => {
  const base = baseRules();
  const badge = base.match(/\.conv \.badge\{[^}]*\}/)?.[0] ?? "";
  assert.match(badge, /min-width:var\(--base-size-20\)/);
  assert.match(badge, /height:var\(--base-size-20\)/);
  assert.match(badge, /font-size:var\(--text-body-size-small\)/);
  assert.match(badge, /font-weight:var\(--base-text-weight-medium\)/);
  assert.match(badge, /border-radius:var\(--borderRadius-full\)/);
  const kind = base.match(/\.msg \.kindtag\{[^}]*\}/)?.[0] ?? "";
  assert.match(kind, /font-size:var\(--text-body-size-small\)/);
  assert.match(kind, /border-radius:var\(--borderRadius-full\)/);
  assert.match(kind, /border:1px solid/);
});
