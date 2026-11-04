/**
 * S5 (T-MG-3 wave 4): slash commands, the `+` menu, one-click reports, `/ask` restored.
 *
 * `commands.js` owns the command registry: `parseCommand` turns the text in the box into a
 * named command with parsed arguments, `commandSuggestions` feeds the `/` popover hosted by the
 * S4 autocomplete engine, `runCommand` executes a known command against the API and renders the
 * ephemeral cards (`/who`, `/status`, a refused `/claim`). `state.js` gains the channel rule for
 * reports (a `bug|issue|incident` channel treats every top-level text as a report), so "Mark
 * fixed" needs no "Treat as a report" step, and the header carries an "N open" pill.
 *
 * Checked here (node, document stub): the pure helpers, the command execution through a fetch
 * stub, the message actions in a report channel, the pill, the rewritten guidelines paragraph
 * and the module/CSS/i18n registration. Popovers, focus and the live cards are the live
 * checklist in the spec (1-8).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));
const UI_TS = fileURLToPath(new URL("../src/http/ui.ts", import.meta.url));

type El = Record<string, any>;
/** The minimal browser from test/ui-s4-composer.test.ts, one element kept per id. The fetch
 *  stub answers by path so `/ask`, `/api/leases` and `/api/presence` get believable bodies. */
function stubBrowser(): { els: Map<string, El>; calls: Array<{ method: string; path: string; body: any }>; inserted: string[] } {
  const inserted: string[] = [];
  const el = (): El => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    disabled: false, checked: false, selectionStart: 0, selectionEnd: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {}, setSelectionRange() {},
    insertAdjacentHTML(_where: string, html: string) { inserted.push(html); }, insertAdjacentElement() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    dispatchEvent() {},
  });
  const els = new Map<string, El>();
  const byId = (id: string) => { if (!els.has(id)) els.set(id, el()); return els.get(id)!; };
  const g = globalThis as Record<string, unknown>;
  // A created element (a toast, a popover) finds its own children: toasts.js writes the message
  // into `.tmsg` right after building the markup.
  const created = (): El => ({ ...el(), querySelector: () => el() });
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: byId, createElement: created, createTextNode: () => el(),
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
  const calls: Array<{ method: string; path: string; body: any }> = [];
  const now = Math.floor(Date.now() / 1000);
  g.fetch = async (path: string, init: any) => {
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(init.body) : undefined });
    const ok = (data: any, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => "" });
    if (path === "/api/leases" && init?.method === "GET") {
      return ok({ leases: [{ resource: "deploy:prod", actorId: 2, handle: "nestor", note: "releasing 2.4", expiresAt: now + 3600 }] });
    }
    if (path === "/api/leases" && init?.method === "POST") return ok({ granted: false, code: "lease_held" }, 409);
    if (path === "/api/presence") return ok({ presence: [{ actorId: 2, handle: "nestor", online: true, doing: "deploying", lastSeenAt: now }] });
    if (path === "/api/actors") return ok({ actors: [{ id: 1, handle: "michal", kind: "human" }, { id: 2, handle: "nestor", kind: "agent" }] });
    if (path === "/api/questions/open") return ok({ questions: [] });
    if (path.endsWith("/ask")) return ok({ question: 7, message: { id: 70, conversationId: 1, actorId: 1, body: "@nestor when?", ts: now, kind: "ask" } });
    if (path.endsWith("/fix")) return ok({ message: { id: 11, conversationId: 2, actorId: 3, body: "broken", ts: now, kind: "text", fixedAt: now, fixedBy: 1 } });
    return ok({ message: { id: 900 + calls.length, conversationId: 1, actorId: 1, body: "x", ts: now, kind: "text" } });
  };
  return { els, calls, inserted };
}

// ------------------------------------------------------------- commands.js: parseCommand (12 cases)
test("S5: parseCommand reads the command, its arguments and leaves plain text alone", async () => {
  stubBrowser();
  const { parseCommand } = await import(UI + "commands.js");
  // 1. a claim with a duration and a note
  assert.deepEqual(parseCommand("/claim deploy:prod for 2h releasing 2.4"),
    { name: "claim", args: "deploy:prod for 2h releasing 2.4", known: true, parsed: { resource: "deploy:prod", ttlSec: 7200, note: "releasing 2.4" } });
  // 2. a claim with only the resource
  assert.deepEqual(parseCommand("/claim x"), { name: "claim", args: "x", known: true, parsed: { resource: "x", ttlSec: null, note: "" } });
  // 3. a claim with a duration in minutes and no note
  assert.deepEqual(parseCommand("/claim x for 90m")?.parsed, { resource: "x", ttlSec: 5400, note: "" });
  // 4. a question addressed to an agent
  assert.deepEqual(parseCommand("/ask @a b"), { name: "ask", args: "@a b", known: true, parsed: { to: "a", question: "b" } });
  // 5. a question with no addressee: the whole text is the question
  assert.deepEqual(parseCommand("/ask when is the window?")?.parsed, { to: null, question: "when is the window?" });
  // 6. an unknown command is still a command (the confirm toast decides)
  assert.deepEqual(parseCommand("/nonsense here"), { name: "nonsense", args: "here", known: false, parsed: null });
  // 7. "/" alone: the popover lists everything, nothing runs
  assert.deepEqual(parseCommand("/"), { name: "", args: "", known: false, parsed: null });
  // 8. text with a slash inside is text
  assert.equal(parseCommand("see src/http/ui.ts"), null);
  // 9. a slash not at the very start is text
  assert.equal(parseCommand(" /claim x"), null);
  // 10. a URL is text
  assert.equal(parseCommand("https://example.test"), null);
  // 11. plain text is text
  assert.equal(parseCommand("hello"), null);
  // 12. the name is case-insensitive and the arguments keep their case
  assert.deepEqual(parseCommand("/WHO Deploy:Prod"), { name: "who", args: "Deploy:Prod", known: true, parsed: { resource: "Deploy:Prod" } });
});

test("S5: parseDuration accepts h, m, d and combinations; rejects nonsense", async () => {
  stubBrowser();
  const { parseDuration } = await import(UI + "commands.js");
  assert.equal(parseDuration("2h"), 7200);
  assert.equal(parseDuration("30m"), 1800);
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration("1d"), 86400);
  assert.equal(parseDuration("soon"), null);
  assert.equal(parseDuration(""), null);
});

test("S5: commandSuggestions lists every command for '/', filters by prefix, closes elsewhere", async () => {
  stubBrowser();
  const { commandSuggestions, COMMANDS } = await import(UI + "commands.js");
  const all = commandSuggestions("/", 1);
  assert.ok(all, "the popover opens on a bare slash");
  assert.equal(all!.start, 0);
  assert.deepEqual(all!.items.map((i: any) => i.insert), COMMANDS.map((c: any) => "/" + c.name));
  for (const name of ["ask", "claim", "release", "who", "status", "fixed", "resolved"]) {
    assert.ok(COMMANDS.some((c: any) => c.name === name), `command ${name} is registered`);
  }
  for (const it of all!.items) {
    assert.match(it.html, /role="option"/, "every row is an option");
    assert.match(it.html, /cmd-desc/, "every row carries a one-line description");
  }
  assert.deepEqual(commandSuggestions("/cl", 3)!.items.map((i: any) => i.insert), ["/claim"]);
  assert.equal(commandSuggestions("/claim x", 8), null, "after the first space the popover is closed");
  assert.equal(commandSuggestions("/zzz", 4), null, "no match, no popover");
  assert.equal(commandSuggestions("a /cl", 5), null, "a slash inside the text is not a command");
  assert.equal(commandSuggestions("/cl", 1), null, "the caret must sit inside the command word");
});

// ------------------------------------------------------------- state.js: isReport (5 cases)
test("S5: isReport follows the trace, the explicit mark and the channel rule", async () => {
  stubBrowser();
  const { isReport, reports, state } = await import(UI + "state.js");
  state.conversations = [{ id: 2, slug: "bugs", kind: "public" }, { id: 3, slug: "general", kind: "public" }, { id: 4, slug: "incident-2026", kind: "private" }];
  const text = (over: any) => ({ id: 1, conversationId: 3, actorId: 3, body: "b", ts: 1, kind: "text", ...over });
  // 1. the trace of the cycle (fixedAt) is a report anywhere
  assert.equal(isReport(text({ fixedAt: 5 })), true);
  // 2. the explicit "Treat as a report" mark
  reports.add(99);
  assert.equal(isReport(text({ id: 99 })), true);
  reports.clear();
  // 3. a top-level text in a bug channel: a report with no prior step (G19)
  assert.equal(isReport(text({ conversationId: 2 })), true);
  assert.equal(isReport(text({ conversationId: 4 })), true, "the rule matches incident too");
  // 4. the same text in #general is not a report
  assert.equal(isReport(text({ conversationId: 3 })), false);
  // 5. in the bug channel a thread reply or a file is not a report
  assert.equal(isReport(text({ conversationId: 2, threadId: 5 })), false);
  assert.equal(isReport(text({ conversationId: 2, kind: "file" })), false);
  // the conversation may be passed explicitly (callers that already hold it)
  assert.equal(isReport(text({ conversationId: 2 }), { id: 2, slug: "bugs" }), true);
});

// ------------------------------------------------------------- commands.js: runCommand
async function openChat(convId = 1) {
  const browser = stubBrowser();
  // The assertions read English labels; the node process may prefer another language.
  const { setLang } = await import(UI + "i18n.js");
  setLang("en");
  const { state } = await import(UI + "state.js");
  const chat = await import(UI + "view-chat.js");
  state.actor = { id: 1, handle: "michal", kind: "human" };
  state.view = "chat";
  state.conversations = [{ id: 1, slug: "general", kind: "public" }, { id: 2, slug: "bugs", kind: "public" }];
  state.memberships = { 1: { lastReadMessageId: 0 }, 2: { lastReadMessageId: 0 } };
  state.actorsCache = { 1: { handle: "michal", kind: "human" }, 2: { handle: "nestor", kind: "agent" }, 3: { handle: "milosz", kind: "agent" } };
  state.actorsList = [{ id: 1, handle: "michal", kind: "human" }, { id: 2, handle: "nestor", kind: "agent" }, { id: 3, handle: "milosz", kind: "agent" }];
  state.actorsAt = Date.now();
  state.activeId = convId;
  state.replyTo = null;
  state.threadOpen = null;
  state.msgs = {
    1: [{ id: 10, conversationId: 1, actorId: 1, body: "root", ts: 1, kind: "text" }],
    2: [
      { id: 11, conversationId: 2, actorId: 3, body: "broken", ts: 1, kind: "text" },
      { id: 12, conversationId: 2, actorId: 1, body: "mine", ts: 2, kind: "text" },
      { id: 13, conversationId: 2, actorId: 3, body: "closed", ts: 3, kind: "text", fixedAt: 4, resolvedAt: 5, resolvedBy: 1 },
      { id: 14, conversationId: 2, actorId: 3, body: "a reply", ts: 6, kind: "text", threadId: 11 },
    ],
  };
  state.pending = {};
  state.loaded = { 1: true, 2: true };
  return { ...browser, state, chat };
}

test("S5: /ask posts a tracked question and returns the ask message (acceptance 1)", async () => {
  const { calls, state } = await openChat();
  const { runCommand } = await import(UI + "commands.js");
  const r = await runCommand("/ask @nestor when?", { conversationId: 1 });
  assert.equal(r.handled, true);
  const post = calls.find((c) => c.path === "/api/conversations/1/ask");
  assert.ok(post, "POST /ask happened");
  assert.equal(post!.body.body, "@nestor when?");
  assert.equal(r.message?.kind, "ask");
  assert.ok((state.msgs[1] || []).some((m: any) => m.id === 70), "the ask message landed in the state");
  assert.equal(calls.some((c) => c.path === "/api/conversations/1/messages"), false, "nothing was posted as plain text");
});

test("S5: a refused /claim shows the holder inline and posts nothing (acceptance 3)", async () => {
  const { calls, inserted } = await openChat();
  const { runCommand } = await import(UI + "commands.js");
  const r = await runCommand("/claim deploy:prod for 1h releasing 2.4", { conversationId: 1 });
  assert.equal(r.handled, true);
  const post = calls.find((c) => c.path === "/api/leases" && c.method === "POST");
  assert.deepEqual({ resource: post!.body.resource, ttlSec: post!.body.ttlSec, note: post!.body.note }, { resource: "deploy:prod", ttlSec: 3600, note: "releasing 2.4" });
  const card = inserted.find((h) => h.includes("ephemeral"));
  assert.ok(card, "an ephemeral card was inserted into the list");
  assert.match(card!, /@nestor/, "the card names the holder");
  assert.match(card!, /Only visible to you/);
  assert.equal(calls.some((c) => c.path === "/api/conversations/1/messages"), false, "nothing posted");
});

test("S5: /who and /status render ephemeral cards from the API (acceptance 4)", async () => {
  const { inserted } = await openChat();
  const { runCommand } = await import(UI + "commands.js");
  assert.equal((await runCommand("/who deploy:prod", { conversationId: 1 })).handled, true);
  assert.match(inserted.at(-1)!, /deploy:prod/);
  assert.match(inserted.at(-1)!, /releasing 2\.4/, "the note is on the card");
  assert.match(inserted.at(-1)!, /class="msg ephemeral/);
  assert.equal((await runCommand("/who nothing:here", { conversationId: 1 })).handled, true);
  assert.match(inserted.at(-1)!, /free/i, "a free resource says so");
  assert.equal((await runCommand("/status", { conversationId: 1 })).handled, true);
  assert.match(inserted.at(-1)!, /@nestor/);
  assert.match(inserted.at(-1)!, /deploying/, "the doing line is on the card");
  assert.doesNotMatch(inserted.at(-1)!, /@michal/, "humans are not listed in the agent status");
});

test("S5: an unknown command is not sent, a toast asks first; plain text is not handled (acceptance 7)", async () => {
  const { calls } = await openChat();
  const { runCommand } = await import(UI + "commands.js");
  const r = await runCommand("/nonsense", { conversationId: 1 });
  assert.equal(r.handled, true, "the composer must not send it");
  assert.equal(r.keepText, true, "the text stays in the box until the user confirms");
  assert.equal(calls.some((c) => c.path === "/api/conversations/1/messages"), false);
  const plain = await runCommand("hello /there", { conversationId: 1 });
  assert.equal(plain.handled, false);
});

test("S5: /fixed as a thread reply marks the root; without a target it explains", async () => {
  const { calls } = await openChat(2);
  const { runCommand } = await import(UI + "commands.js");
  const r = await runCommand("/fixed", { conversationId: 2, threadId: 11 });
  assert.equal(r.handled, true);
  assert.ok(calls.some((c) => c.path === "/api/messages/11/fix" && c.body.fixed === true), "POST /fix on the root");
  const none = await runCommand("/fixed", { conversationId: 2 });
  assert.equal(none.handled, true);
  assert.equal(none.keepText, true, "nothing to mark: the text stays so the user can pick a message");
});

// ------------------------------------------------------------- actions.js: sendMessage hands commands over
test("S5: sendMessage runs a command instead of posting it; a plain text still posts", async () => {
  const { calls } = await openChat();
  const { sendMessage } = await import(UI + "actions.js");
  const r = await sendMessage("/ask @nestor when?");
  assert.ok(r, "a handled command resolves truthy so the box clears");
  assert.equal(calls.some((c) => c.path === "/api/conversations/1/messages"), false, "the command text was never posted");
  await sendMessage("hello");
  assert.ok(calls.some((c) => c.path === "/api/conversations/1/messages" && c.body.body === "hello"));
  // A confirmed unknown command goes out as text when the caller says so.
  await sendMessage("/nonsense", { asText: true });
  assert.ok(calls.some((c) => c.path === "/api/conversations/1/messages" && c.body.body === "/nonsense"));
});

// ------------------------------------------------------------- view-chat.js: one-click reports
test("S5: in #bugs a report from somebody else carries 'Mark fixed' with no prior step (acceptance 5)", async () => {
  const { els, state, chat } = await openChat(2);
  chat.renderMessages();
  const html = els.get("messages")!.innerHTML;
  const bubble = (id: number) => html.split(`data-msg="${id}"`)[1]?.split("data-msg=")[0] ?? "";
  // @milosz's report, me not the author: Mark fixed, no Confirm yet (nothing fixed).
  assert.match(bubble(11), /data-fix="11"[^>]*aria-label="Mark fixed"/);
  assert.doesNotMatch(bubble(11), /data-resolve="11"/, "nothing to confirm before a fix");
  // my own message in #bugs: I cannot mark my own report fixed, and nothing to confirm yet
  assert.doesNotMatch(bubble(12), /data-fix="12"/);
  assert.doesNotMatch(bubble(12), /data-resolve="12"/);
  // a resolved report from somebody else: a plain member cannot take the confirmation back...
  assert.doesNotMatch(bubble(13), /data-resolve="13"/);
  assert.doesNotMatch(html, /Treat as a report/, "the hover bar never needs the old step here");
  // ...a channel admin can (the server rule: author, instance admin or channel admin).
  state.memberships[2].role = "admin";
  chat.renderMessages();
  const asAdmin = els.get("messages")!.innerHTML.split('data-msg="13"')[1]?.split("data-msg=")[0] ?? "";
  assert.match(asAdmin, /data-resolve="13"[^>]*aria-label="Take back the confirmation"/);
});

test("S5: the author sees 'Confirm fixed' once fixedAt is set (acceptance 5)", async () => {
  const { els, state, chat } = await openChat(2);
  state.msgs[2] = [{ id: 21, conversationId: 2, actorId: 1, body: "my report", ts: 1, kind: "text", fixedAt: 2, fixedBy: 3 }];
  chat.renderMessages();
  const html = els.get("messages")!.innerHTML;
  assert.match(html, /data-resolve="21"[^>]*aria-label="Confirm fixed"/);
});

test("S5: the header pill counts open reports and the filter keeps only them (acceptance 6)", async () => {
  const { els, state, chat } = await openChat(2);
  chat.renderMessages();
  const pill = els.get("report-pill")!;
  assert.match(pill.innerHTML, /2 open/, "two top-level reports without resolvedAt (11, 12); 13 is resolved; 14 is a reply");
  assert.equal(pill.hidden, false);
  state.reportFilter = true;
  chat.renderMessages();
  const html = els.get("messages")!.innerHTML;
  assert.match(html, /data-msg="11"/);
  assert.match(html, /data-msg="12"/);
  assert.doesNotMatch(html, /data-msg="13"/, "the resolved one is filtered out");
  assert.match(html, /data-report-showall/, "a 'Show all' way back");
  state.reportFilter = false;
  // outside a report channel the pill is hidden
  state.activeId = 1;
  chat.renderMessages();
  assert.equal(els.get("report-pill")!.hidden, true);
});

// ------------------------------------------------------------- view-sidebar.js: How we talk here (M7)
test("S5: the guidelines no longer point at a question-mark button; they name /ask and the + menu", () => {
  const src = readFileSync(UI + "view-sidebar.js", "utf8");
  const block = src.split("const HOW_WE_TALK = [")[1]?.split("];")[0] ?? "";
  assert.ok(block.length > 100, "HOW_WE_TALK still exists");
  assert.doesNotMatch(block, /question-mark button/);
  assert.match(block, /\/ask/, "the paragraph names the slash command");
  assert.match(block, /\+/, "the paragraph names the + menu");
  const pl = readFileSync(UI + "i18n-pl.js", "utf8");
  assert.doesNotMatch(pl, /question-mark button/, "the old key is gone from the dictionary too");
});

// ------------------------------------------------------------- registration, CSS, i18n
test("S5: commands.js is served (UI_MODULES), composer.js hooks it, the S5 blocks are filled", () => {
  const uiTs = readFileSync(UI_TS, "utf8");
  assert.ok(uiTs.includes('"commands.js"'), "commands.js not in UI_MODULES");
  const composer = readFileSync(UI + "composer.js", "utf8");
  assert.match(composer, /from "\.\/commands\.js"/, "the autocomplete engine hosts the / popover");
  const css = readFileSync(CSS, "utf8");
  const block = css.split("/* === S5 === */")[1]?.split("/* === S6 === */")[0] ?? "";
  assert.match(block, /\.msg\.ephemeral/, "the S5 block styles the ephemeral card");
  assert.match(block, /report-pill/, "the S5 block styles the header pill");
  assert.doesNotMatch(block, /:\s*\d*\.?\d+rem/, "spacing through Primer tokens, not literal rem");
  const pl = readFileSync(UI + "i18n-pl.js", "utf8");
  const plBlock = pl.split("// === S5 ===")[1]?.split("// === S6 ===")[0] ?? "";
  assert.match(plBlock, /"Mark fixed"/);
  assert.match(plBlock, /"Confirm fixed"/);
  assert.match(plBlock, /"Only visible to you"/);
});
