// Polish expected values verify the Polish UI translation and must remain in Polish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { siteGateBlocks, registerUiRoutes } from "../src/http/ui.ts";

const base = new URL("../src/http/ui/js/", import.meta.url);
const globals = globalThis as Record<string, any>;
globals.document = { documentElement: {}, getElementById: () => null, addEventListener() {} };
globals.sessionStorage = { getItem: () => null };
globals.localStorage = { getItem: () => null, setItem() {} };
globals.window = { matchMedia: () => ({ matches: false }) };
const { setLang } = await import(new URL("i18n.js", base).href);
const { state } = await import(new URL("state.js", base).href);
const { mdToHtml } = await import(new URL("markdown.js", base).href);

test("markdown copy and wiki tooltips follow the selected language", () => {
  state.wiki.pages = [{ slug: "known", title: "Known" }];
  for (const [language, copy, page, missing] of [
    ["en", "Copy", "Wiki page", "This page does not exist yet - click to create it"],
    ["pl", "Kopiuj", "strona wiki", "strona jeszcze nie istnieje - klik zaklada"],
  ]) {
    setLang(language);
    const html = mdToHtml("```\ntext\n```\n[[known]] [[missing]]", "page", "viewer");
    for (const title of [copy, page, missing]) assert.ok(html.includes(`title="${title}"`), title);
  }
  setLang("en");
});

test("the module route serves all UI files and relative imports without a listener", async () => {
  const routes = new Map<string, (...args: any[]) => any>();
  registerUiRoutes({ add: (method: string, path: string, handler: (...args: any[]) => any) => {
    routes.set(`${method} ${path}`, handler);
  } } as any);
  const files = readdirSync(base).filter((name) => name.endsWith(".js"));
  assert.ok(files.length >= 19);
  const names = new Set(files);
  for (const file of files) {
    const source = readFileSync(new URL(file, base), "utf8");
    for (const match of source.matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)) names.add(match[1]);
  }
  for (const file of names) {
    let status = 0;
    let body = "";
    const res = { writeHead: (value: number) => { status = value; }, end: (value: string) => { body = value; } };
    await routes.get("GET /js/:file")!({}, res, { params: { file } });
    assert.equal(status, 200, file);
    assert.ok(body.length > 0, file);
  }
});

test("gate translations load before authentication while application modules remain gated", () => {
  const req = { headers: {} } as any;
  const res = { writeHead() {}, end() {} } as any;
  const config = { sitePassword: "test-password", secret: "test-secret" } as any;
  for (const pathname of ["/js/gate.js", "/js/i18n.js", "/js/i18n-pl.js"]) {
    assert.equal(siteGateBlocks(req, res, config, pathname), false, pathname);
  }
  for (const pathname of ["/", "/js/app.js", "/js/state.js", "/app.css"]) {
    assert.equal(siteGateBlocks(req, res, config, pathname), true, pathname);
  }
});

test("gate errors restore the translated button and distinguish rate limits from wrong passwords", async () => {
  for (const [language, next, wrong, limited, unavailable] of [
    ["en", "Continue", "Wrong password. Try again.", "Too many attempts - wait a moment and try again.", "The server is not responding. Try again shortly."],
    ["pl", "Dalej", "Nieprawidłowe hasło. Spróbuj ponownie.", "Za dużo prób - poczekaj chwilę i spróbuj ponownie.", "Serwer nie odpowiada. Spróbuj ponownie za chwilę."],
  ]) {
    const elements = new Map<string, any>();
    let submit: (event: any) => Promise<void> = async () => {};
    for (const id of ["gate-form", "gate-sub", "gate-label", "gate-btn", "gate-pass", "gate-err"]) {
      elements.set(id, { textContent: "", value: "test-password", style: {}, disabled: false,
        focus() {}, addEventListener: (_: string, fn: typeof submit) => { submit = fn; } });
    }
    globals.document.getElementById = (id: string) => elements.get(id) ?? null;
    setLang(language);
    await import(new URL(`gate.js?test=${language}`, base).href);
    assert.equal(elements.get("gate-btn").textContent, next);
    for (const [status, expected] of [[429, limited], [401, wrong], [0, unavailable]] as const) {
      globals.fetch = async () => { if (!status) throw new Error("offline"); return { ok: false, status }; };
      await submit({ preventDefault() {} });
      assert.equal(elements.get("gate-err").textContent, expected);
      assert.equal(elements.get("gate-btn").textContent, next);
      assert.equal(elements.get("gate-btn").disabled, false);
    }
    let reloaded = false;
    globals.location = { reload() { reloaded = true; } };
    globals.fetch = async () => ({ ok: true, status: 200 });
    await submit({ preventDefault() {} });
    assert.equal(reloaded, true);
  }
  globals.document.getElementById = () => null;
  setLang("en");
});

test("notification refresh uses the current language and plural form for its accessible label", async (context) => {
  const { refreshNotifications } = await import(new URL("data.js", base).href);
  let label = "";
  let unread = 0;
  context.mock.method(globals.document, "getElementById", (id: string) => id === "rail-notif"
    ? { setAttribute: (_: string, value: string) => { label = value; } } : null);
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ notifications: [], unread })));
  for (const [language, count, expected] of [
    // The rail place is called Activity (T-MG-3 S1; follow-up W2-S1-A keeps the refresh in step).
    ["en", 0, "Activity"], ["en", 2, "Activity, 2 new"],
    ["pl", 1, "Aktywność, 1 nowa"], ["pl", 2, "Aktywność, 2 nowe"],
    ["pl", 5, "Aktywność, 5 nowych"],
  ] as const) {
    setLang(language);
    unread = count;
    await refreshNotifications();
    assert.equal(label, expected);
  }
  setLang("en");
});

test("toast close controls follow the current language", async (context) => {
  const { showToast } = await import(new URL("toasts.js", base).href);
  const toasts: any[] = [];
  globals.document.body = { appendChild() {} };
  globals.document.createElement = () => ({
    innerHTML: "", className: "", setAttribute() {}, addEventListener() {},
    appendChild: (el: any) => { toasts.push(el); },
    querySelector: () => ({ textContent: "", addEventListener() {} }),
  });
  context.mock.method(globalThis, "setTimeout", (() => 0) as any);
  for (const [language, label, title] of [
    ["en", "Close notification", "Close"], ["pl", "Zamknij powiadomienie", "Zamknij"],
  ]) {
    setLang(language);
    showToast("Message");
    const html = toasts.at(-1).innerHTML;
    assert.ok(html.includes(`aria-label="${label}"`));
    assert.ok(html.includes(`title="${title}"`));
  }
  setLang("en");
});

test("pasted screenshot filenames follow the selected language and keep named files intact", async (context) => {
  const { renderComposer } = await import(new URL("view-chat.js", base).href);
  const elements = new Map<string, any>();
  const makeElement = () => ({
    innerHTML: "", value: "", style: {}, scrollHeight: 20, classList: { toggle() {} },
    listeners: new Map<string, (event: any) => void>(),
    addEventListener(type: string, callback: (event: any) => void) { this.listeners.set(type, callback); },
    querySelectorAll: () => [],
  });
  for (const id of ["composer", "composer-input", "composer-send", "composer-attach", "composer-file", "composer-previews"]) {
    elements.set(id, makeElement());
  }
  context.mock.method(globals.document, "getElementById", (id: string) => elements.get(id) ?? null);
  context.mock.method(URL, "createObjectURL", () => "blob:test");
  state.activeId = 7;
  state.drafts = {};
  state.replyTo = null;
  for (const [language, prefix] of [["en", "pasted-"], ["pl", "wklejone-"]]) {
    setLang(language);
    state.pendingFiles = [];
    renderComposer();
    const named = new File(["image"], "screenshot.png", { type: "image/png" });
    elements.get("composer-input").listeners.get("paste")({
      preventDefault() {}, clipboardData: { files: [new File(["image"], "image.png", { type: "image/png" }), named] },
    });
    assert.ok(state.pendingFiles[0].file.name.startsWith(prefix));
    assert.ok(state.pendingFiles[0].file.name.endsWith(".png"));
    assert.equal(state.pendingFiles[1].file, named);
  }
  state.pendingFiles = [];
  setLang("en");
});
