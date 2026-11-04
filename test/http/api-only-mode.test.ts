// T-MG-19: the API-only mode switch (AGENTTALKS_UI=0 / serve --no-ui).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initData, loadConfig } from "../../src/config.ts";
import { parseArgs } from "../../src/cli/main.ts";
import { bearer, startTestServer } from "../http-helpers.ts";

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const old = process.env.AGENTTALKS_UI;
  if (value === undefined) delete process.env.AGENTTALKS_UI;
  else process.env.AGENTTALKS_UI = value;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.AGENTTALKS_UI;
    else process.env.AGENTTALKS_UI = old;
  }
}

test("AGENTTALKS_UI parsing: default on; 0/false/no/off turn it off; 1/true/yes/on keep it on", () => {
  const dir = mkdtempSync(join(tmpdir(), "agenttalks-ui-"));
  initData(dir);
  assert.equal(withEnv(undefined, () => loadConfig(dir).ui), true);
  assert.equal(withEnv("", () => loadConfig(dir).ui), true, "an empty value is the default");
  for (const v of ["0", "false", "no", "off", "OFF", "False"]) {
    assert.equal(withEnv(v, () => loadConfig(dir).ui), false, v);
  }
  for (const v of ["1", "true", "yes", "on"]) {
    assert.equal(withEnv(v, () => loadConfig(dir).ui), true, v);
  }
});

test("--no-ui is a boolean flag and does not eat the next argument", () => {
  const a = parseArgs(["serve", "--no-ui", "--port", "9000"]);
  assert.equal(a.flags["no-ui"], true);
  assert.equal(a.flags.port, "9000");
});

test("UI on (default): the shell, assets and health work as before", async () => {
  const t = await startTestServer();
  try {
    assert.equal((await fetch(`${t.url}/`)).status, 200);
    assert.equal((await fetch(`${t.url}/app.css`)).status, 200);
    const health = await (await fetch(`${t.url}/api/health`)).json() as { ui?: boolean };
    assert.equal(health.ui, true);
  } finally { await t.close(); }
});

test("UI off: the web UI paths answer 404 ui_disabled; API, MCP and onboarding keep working", async () => {
  const t = await startTestServer({ ui: false });
  try {
    for (const p of ["/", "/app", "/app.css", "/js/app.js", "/vendor/primer/x/y.css", "/favicon.svg", "/icons/icon-32.png", "/api/ui-version"]) {
      const r = await fetch(`${t.url}${p}`);
      assert.equal(r.status, 404, p);
      const body = await r.json() as { code: string; error: string };
      assert.equal(body.code, "ui_disabled", p);
      assert.match(body.error, /web UI is disabled/);
    }
    const gate = await fetch(`${t.url}/api/site-gate`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    assert.equal(gate.status, 404);

    const health = await fetch(`${t.url}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { ui: boolean }).ui, false);
    assert.equal((await fetch(`${t.url}/skill.md`)).status, 200);
    assert.equal((await fetch(`${t.url}/skill.version`)).status, 200);
    assert.equal((await fetch(`${t.url}/install`)).status, 200);
    // /mcp is reachable: without a token it is a 401 from the handler, not a 404.
    const mcp = await fetch(`${t.url}/mcp`, { method: "POST", headers: bearer("nope"), body: "{}" });
    assert.notEqual(mcp.status, 404);
    assert.equal((await fetch(`${t.url}/api/events`)).status, 401);
  } finally { await t.close(); }
});

test("UI off: the site gate does not apply (there is no UI to gate), the API stays open to tokens", async () => {
  const t = await startTestServer({ ui: false, sitePassword: "secret-gate" });
  try {
    const r = await fetch(`${t.url}/`);
    assert.equal(r.status, 404, "not the 401 gate page");
    assert.equal((await fetch(`${t.url}/api/health`)).status, 200);
  } finally { await t.close(); }
});
