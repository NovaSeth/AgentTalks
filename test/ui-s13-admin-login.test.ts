/**
 * S13 (T-MG-3 wave 6): admin and login polish.
 *
 * M18: account rows in the admin panel are labelled buttons (a screen reader hears who the row
 * is and whether it is open), the stats on the row carry their labels, and a token for an
 * EXISTING account can be issued from the panel through `POST /api/admin/tokens` (the route
 * already exists on the server: src/http/routes/admin.ts). The panel no longer says that it
 * "still needs server access".
 * M17: the passkey button on the login screen shows only after a passkey was enrolled or used in
 * this browser (a localStorage flag), not whenever the device merely has an authenticator.
 *
 * Node, document stub: the pure HTML builders of `view-admin.js` and the pure flag helpers of
 * `view-login.js`. The pixel truth is the live checklist in the report.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

/** The minimal browser from test/ui-s10-threads.test.ts. */
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
    open() {}, confirm: () => false, location: { origin: "https://test.local", hash: "" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", hash: "", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.HTMLImageElement = class {};
  g.EventSource = class { close() {} addEventListener() {} };
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
}

/** The assertions read English: Node's navigator follows the OS, so the language is pinned. */
async function english(): Promise<void> {
  const { setLang } = await import(UI + "i18n.js");
  setLang("en");
}

/** An in-memory Storage for the passkey flag. */
function memStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

const tok = (id: number, revokedAt: number | null = null) =>
  ({ id, name: `t${id}`, createdAt: 1700000000, lastUsedAt: null, expiresAt: null, revokedAt });
const HUMAN = { id: 1, handle: "michal", kind: "human", isAdmin: true, disabledAt: null, online: true, idleSec: 0, messageCount: 12, tokens: [tok(1), tok(2, 1700000500)] };
const AGENT = { id: 2, handle: "nestor", kind: "agent", isAdmin: false, disabledAt: null, online: false, idleSec: 4000, messageCount: 3, tokens: [] };
const SYSTEM = { id: 3, handle: "system", kind: "system", isAdmin: false, disabledAt: null, online: false, idleSec: null, messageCount: 0, tokens: [] };

test("M18: a collapsed account row is a button named after the account, with labelled stats", async () => {
  stubBrowser(); await english();
  const { accountRowHtml } = await import(UI + "view-admin.js");
  const html: string = accountRowHtml(HUMAN, false);
  const head = /<button class="u-head"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(head, "the row head is a button");
  assert.match(head, /aria-label="[^"]*@michal[^"]*"/, "the button is named after the account");
  assert.match(head, /aria-label="[^"]*human[^"]*"/, "the name says the kind");
  assert.match(head, /aria-expanded="false"/);
  // The stats stop being "12 msg. · 1 tok.": each number is labelled for eyes and readers alike.
  assert.doesNotMatch(html, /\btok\.\b/, "no cryptic token abbreviation");
  assert.match(html, /class="u-stat"[^>]*>[\s\S]*?12[\s\S]*?<\/span>/, "message count is a labelled stat");
  assert.match(html, /class="u-stat"[^>]*>[\s\S]*?1[\s\S]*?<\/span>/, "active token count is a labelled stat (revoked ones not counted)");
});

test("M18: an open row offers a new token for the account and no longer sends the admin to the server", async () => {
  stubBrowser(); await english();
  const { accountRowHtml } = await import(UI + "view-admin.js");
  const open: string = accountRowHtml(AGENT, true);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /data-newtoken="2"/, "a 'New token' button for this account");
  assert.doesNotMatch(open, /still needs server access/, "the apology for a missing route is gone");
  // Every token row carries a name for its revoke button and the state of the token.
  const human: string = accountRowHtml(HUMAN, true);
  assert.match(human, /data-revtoken="1"/);
  assert.match(human, /aria-label="Revoke token t1"/);
  assert.match(human, /class="u-token dead"/, "the revoked token is shown as dead");
  // The system account gets no token and no disable button.
  const sys: string = accountRowHtml(SYSTEM, true);
  assert.doesNotMatch(sys, /data-newtoken=/);
  assert.doesNotMatch(sys, /data-udisable=/);
});

test("M18: the token paste text names the server, the account and the token exactly once", async () => {
  stubBrowser(); await english();
  const { tokenPasteText } = await import(UI + "view-admin.js");
  const text: string = tokenPasteText("https://talk.example", "nestor", "at_secret123");
  assert.match(text, /https:\/\/talk\.example/);
  assert.match(text, /@nestor/);
  assert.equal(text.split("at_secret123").length, 2, "the token appears once");
  assert.doesNotMatch(text, /undefined/);
});

test("M18: the panel calls the existing admin token route and refreshes the list afterwards", () => {
  const src = readFileSync(UI + "view-admin.js", "utf8");
  assert.match(src, /api\("POST", "\/api\/admin\/tokens"/, "POST /api/admin/tokens with actorId");
  assert.match(src, /actorId:/);
  assert.doesNotMatch(src, /Swapping the token of an existing account still needs server access/);
});

test("M17: the passkey button is offered only after a passkey was enrolled or used in this browser", async () => {
  stubBrowser(); await english();
  const { passkeyKnownHere, markPasskeyKnownHere, PASSKEY_KNOWN_KEY } = await import(UI + "view-login.js");
  const store = memStorage();
  assert.equal(passkeyKnownHere(store), false, "a fresh browser: no button, even with an authenticator");
  markPasskeyKnownHere(store);
  assert.equal(store.getItem(PASSKEY_KNOWN_KEY), "1");
  assert.equal(passkeyKnownHere(store), true, "after enrolment or a successful passkey login");
  // A storage that throws (private mode) means "not known", never a crash.
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} };
  assert.equal(passkeyKnownHere(broken), false);
  assert.doesNotThrow(() => markPasskeyKnownHere(broken));
});

test("M17: renderLogin consults the flag before unhiding the button; enrol and passkey login set it", () => {
  const src = readFileSync(UI + "view-login.js", "utf8");
  const render = src.slice(src.indexOf("export function renderLogin"), src.indexOf("// ---", src.indexOf("export function renderLogin")));
  assert.match(render, /passkeyKnownHere\(/, "the login screen asks the flag");
  assert.match(render, /isUserVerifyingPlatformAuthenticatorAvailable/, "and still asks the device");
  const login = src.slice(src.indexOf("async function passkeyLogin"), src.indexOf("async function passkeyEnroll"));
  assert.match(login, /markPasskeyKnownHere\(/, "a passkey login proves a passkey exists here");
  const enroll = src.slice(src.indexOf("async function passkeyEnroll"), src.indexOf("export async function maybeOfferPasskey"));
  assert.match(enroll, /markPasskeyKnownHere\(/, "enrolment sets the flag");
  // The drafts owner fix stays: every path that sets state.actor claims the local data.
  assert.equal((src.match(/claimLocalData\(/g) || []).length, 3, "tryRestoreSession + doLogin + passkeyLogin");
});

test("S13 CSS block exists, styles the labelled stats and uses Primer tokens, not literal rem", () => {
  const css = readFileSync(CSS, "utf8");
  const start = css.indexOf("/* === S13 === */");
  const end = css.indexOf("/* === S14 === */");
  assert.ok(start > 0 && end > start, "S13 block between its markers");
  const block = css.slice(start, end);
  assert.match(block, /\.u-stat\b/);
  assert.match(block, /\.u-head\b/);
  assert.doesNotMatch(block, /\d(\.\d+)?rem\b/, "spacing and type through Primer tokens");
  assert.match(block, /var\(--base-size-|var\(--text-/);
});
