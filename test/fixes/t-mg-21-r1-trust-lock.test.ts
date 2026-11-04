import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { atalkMain } from "../../src/cli/atalk.ts";
import { startTestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";

// T-MG-21 fix round 1, F2: `atalk login --local` takes the same trust-list lock as the
// plugin's login.mjs (trusted-projects.json.lock, O_EXCL, retried, stale after 30 s).

const KEYS = ["AGENTTALKS_URL", "ATALKS_URL", "AGENTTALKS_TOKEN", "ATALKS_TOKEN", "AGENTTALKS_CONFIG_DIR"];

async function run(argv: string[], env: Record<string, string>, cwd: string) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const oldCwd = process.cwd();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  process.chdir(cwd);
  const realErr = process.stderr.write.bind(process.stderr);
  const realOut = process.stdout.write.bind(process.stdout);
  let err = "";
  (process.stderr as { write: unknown }).write = (c: string | Uint8Array) => { err += String(c); return true; };
  (process.stdout as { write: unknown }).write = (() => true) as never;
  try {
    return { code: await atalkMain(argv), err };
  } finally {
    (process.stderr as { write: unknown }).write = realErr;
    (process.stdout as { write: unknown }).write = realOut;
    process.chdir(oldCwd);
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

async function setup() {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  return { s, token: mintToken(s.ctx, ala.id, "t").token };
}

test("R1-F2: atalk login --local waits for a held trust-list lock and keeps the other entries; a lock whose owner is dead is cleared", async () => {
  const { s, token } = await setup();
  const cfg = mkdtempSync(join(tmpdir(), "atalk-lock-cfg-"));
  const dir = mkdtempSync(join(tmpdir(), "atalk-lock-dir-"));
  const list = join(cfg, "trusted-projects.json");
  const lock = `${list}.lock`;
  const other = { path: "/somewhere/else/.agenttalks.json", sha256: "cd".repeat(32) };
  writeFileSync(list, JSON.stringify({ projects: [other] }));
  // A separate process releases the lock after ~400 ms: this process blocks while it waits.
  // Fix round 2 (spec change): the lock names that LIVE process (a dead owner would be evicted).
  const releaser = spawn(process.execPath, ["-e",
    `setTimeout(() => require("fs").unlinkSync(${JSON.stringify(lock)}), 400)`], { stdio: "ignore" });
  writeFileSync(lock, JSON.stringify({ pid: releaser.pid, host: hostname(), at: Date.now() }));
  const started = Date.now();
  const r = await run(["login", "--url", s.url, "--token", token, "--local"], { AGENTTALKS_CONFIG_DIR: cfg }, dir);
  assert.equal(r.code, 0, r.err);
  assert.ok(Date.now() - started >= 300, "waited for the lock");
  const projects = JSON.parse(readFileSync(list, "utf8")).projects;
  assert.equal(projects.length, 2);
  assert.deepEqual(projects[0], other);
  assert.equal(existsSync(lock), false, "lock released");
  releaser.kill();

  // stale: at = now - 60 s
  const dir2 = mkdtempSync(join(tmpdir(), "atalk-lock-dir-"));
  const cfg2 = mkdtempSync(join(tmpdir(), "atalk-lock-cfg-"));
  mkdirSync(cfg2, { recursive: true });
  writeFileSync(join(cfg2, "trusted-projects.json.lock"), JSON.stringify({ pid: spawnSync(process.execPath, ["-e", ""]).pid, host: hostname(), at: Date.now() }));
  const r2 = await run(["login", "--url", s.url, "--token", token, "--local"], { AGENTTALKS_CONFIG_DIR: cfg2 }, dir2);
  assert.equal(r2.code, 0, r2.err);
  assert.equal(JSON.parse(readFileSync(join(cfg2, "trusted-projects.json"), "utf8")).projects.length, 1);
});
