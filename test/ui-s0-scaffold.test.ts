/**
 * S0 scaffolding (T-MG-3 wave 1): the files later slices own exist, are registered and are
 * served, so that S1-S14 do not collide in shared files.
 *
 * What is checked: the five new modules exist and export their public names, `state` carries
 * the three new fields, app.css ends with the per-slice section markers in order, the Polish
 * dictionary has a block per slice, and the server serves every new module under /js/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startTestServer } from "./http-helpers.ts";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
const CSS = fileURLToPath(new URL("../src/http/ui/app.css", import.meta.url));

const NEW_MODULES = ["router.js", "shortcuts.js", "composer.js", "view-people.js", "counters.js"];

test("S0: the new modules exist and export their public names", async () => {
  const router = await import(UI + "router.js");
  assert.equal(typeof router.parseRoute, "function");
  const shortcuts = await import(UI + "shortcuts.js");
  assert.equal(typeof shortcuts.SHORTCUTS, "object");
  // composer.js re-exports from view-chat.js, which touches `document` at load; the stubbed
  // browser in test/ui-start.test.ts executes it, here the re-export is checked textually.
  const composer = readFileSync(UI + "composer.js", "utf8");
  assert.match(composer, /export \{ renderComposer \} from "\.\/view-chat\.js"/, "composer.js re-exports renderComposer");
  // view-people.js (S6) imports dom.js, which touches `document` at load; its exports run with a
  // stubbed browser in test/ui-s6-people.test.ts, here the export is checked textually.
  const people = readFileSync(UI + "view-people.js", "utf8");
  assert.match(people, /export function renderPeople\(/, "view-people.js exports renderPeople");
  const counters = await import(UI + "counters.js");
  assert.equal(typeof counters.countUnread, "function");
});

test("S0: state carries route, sidePanel and sbCollapsed", async () => {
  const { state } = await import(UI + "state.js");
  assert.ok("route" in state, "state.route");
  assert.ok("sidePanel" in state, "state.sidePanel");
  assert.ok("sbCollapsed" in state, "state.sbCollapsed");
});

test("S0: app.css ends with the slice section markers S1..S14 in order", () => {
  const css = readFileSync(CSS, "utf8");
  const positions = [];
  for (let n = 1; n <= 14; n++) {
    const i = css.indexOf(`/* === S${n} === */`);
    assert.ok(i >= 0, `marker S${n} missing`);
    positions.push(i);
  }
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1], `S${i + 1} before S${i}`);
  // The markers are the LAST section: nothing but slice blocks follows S1.
  assert.ok(positions[0] > css.lastIndexOf("/* ----------"), "S1 marker is not after the existing sections");
});

test("S0: i18n-pl.js has a block per slice", () => {
  const pl = readFileSync(UI + "i18n-pl.js", "utf8");
  for (let n = 1; n <= 14; n++) assert.ok(pl.includes(`// === S${n} ===`), `i18n block S${n} missing`);
});

test("S0: the server serves every new module and the stamp covers them", async () => {
  const s = await startTestServer();
  try {
    for (const f of NEW_MODULES) {
      const r = await fetch(`${s.url}/js/${f}`);
      assert.equal(r.status, 200, `GET /js/${f}`);
      assert.match(r.headers.get("content-type") ?? "", /text\/javascript/);
    }
  } finally { await s.close(); }
  const uiTs = readFileSync(fileURLToPath(new URL("../src/http/ui.ts", import.meta.url)), "utf8");
  for (const f of NEW_MODULES) assert.ok(uiTs.includes(`"${f}"`), `${f} not in UI_MODULES`);
});
