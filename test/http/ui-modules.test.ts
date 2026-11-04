/**
 * Is every UI module actually SERVED?
 *
 * This test exists because of a failure it would have caught in one second, and
 * that instead reached production and stayed there for hours: `i18n.js` and
 * `i18n-pl.js` were added to the interface and NOT added to the UI_MODULES
 * whitelist in http/ui.ts. The browser fetched them, got a 404, and the whole
 * module graph died on load - a blank page for every human, with no error
 * anywhere on the server.
 *
 * Every gate the project had was green while this was true: 316 tests, tsc, CI on
 * two Node versions, the deployment script's healthcheck and its gate check. Not
 * one of them loads the interface. The list of modules is a hand-maintained
 * criterion next to a directory that grows - exactly the shape we had spent the
 * day naming on the channel, and the sharpest instance of it was mine.
 *
 * Two directions, because they fail differently:
 *  - a file in the directory that is not on the list: a 404 at load time (this bug),
 *  - a name on the list with no file: a 500 on request, or a stamp computed over
 *    a file that does not exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startTestServer } from "../http-helpers.ts";

const UI_DIR = fileURLToPath(new URL("../../src/http/ui/js/", import.meta.url));

function files(): string[] {
  return readdirSync(UI_DIR).filter((f) => f.endsWith(".js")).sort();
}

test("every UI module in the directory is served under /js/", async () => {
  const list = files();
  assert.ok(list.length >= 15, `the check sees only ${list.length} modules; did the directory move?`);

  const s = await startTestServer();
  try {
    const codes = await Promise.all(list.map(async (f) => ({
      f, status: (await fetch(`${s.url}/js/${f}`)).status,
    })));
    const missingEntries = codes.filter((k) => k.status !== 200);
    assert.deepEqual(missingEntries, [],
      `modules the server will NOT serve (the browser gets 404 and the ENTIRE graph fails):\n`
      + missingEntries.map((k) => `  ${k.f} -> ${k.status}`).join("\n"));
  } finally { await s.close(); }
});

test("every UI module import points to a file the server serves", async () => {
  // The other side of the same pair: even when a file exists and is on the list, an
  // import can point at a name the directory does not have - and the symptom is identical.
  const imports = new Set<string>();
  for (const f of files()) {
    const src = readFileSync(UI_DIR + f, "utf8");
    for (const m of src.matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)) imports.add(m[1]);
  }
  assert.ok(imports.size >= 10, `only ${imports.size} imports extracted; the pattern no longer matches`);

  const s = await startTestServer();
  try {
    const codes = await Promise.all([...imports].map(async (f) => ({
      f, status: (await fetch(`${s.url}/js/${f}`)).status,
    })));
    const invalid = codes.filter((k) => k.status !== 200);
    assert.deepEqual(invalid, [], invalid.map((k) => `  import "./${k.f}" -> ${k.status}`).join("\n"));
  } finally { await s.close(); }
});
