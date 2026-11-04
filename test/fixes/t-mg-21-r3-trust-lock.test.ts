import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { waitFor } from "../helpers.ts";
import { fakeAt } from "../plugin/fake-at.ts";

// T-MG-21 fix round 3, F2 (codex): no automatic lock eviction. Two logins that both see a
// dead-owner lock must not both proceed (the old evict race lost an entry).

const LOGIN = fileURLToPath(new URL("../../integrations/claude-code-plugin/scripts/login.mjs", import.meta.url));
const TOKEN = "atk_r3_synthetic_token_0001"; // SYNTH: a synthetic test value, not a credential

function login(url: string, home: string, dir: string, extra: Record<string, string>) {
  const child = spawn(process.execPath, [LOGIN, "--url", url, "--token", "-"], {
    cwd: dir, env: { PATH: process.env.PATH ?? "", HOME: home, ...extra }, stdio: ["pipe", "pipe", "pipe"],
  });
  const out = { err: "", code: null as number | null, done: false };
  child.stderr.on("data", (c) => { out.err += c; });
  child.on("exit", (c) => { out.code = c; out.done = true; });
  child.stdin.end(TOKEN + "\n");
  return waitFor(() => out.done, 15_000).then(() => out);
}

test("R3-F2: two concurrent logins against a dead-owner lock both fail closed; after the human removes it both succeed", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  const root = mkdtempSync(join(tmpdir(), "at-r3-lock-"));
  const home = join(root, "home");
  const conf = join(home, ".config", "agenttalks");
  mkdirSync(conf, { recursive: true });
  const list = join(conf, "trusted-projects.json");
  const lock = join(conf, "trusted-projects.json.lock");
  const other = { path: "/somewhere/else/.agenttalks.json", sha256: "ab".repeat(32) };
  const listBody = JSON.stringify({ projects: [other] });
  writeFileSync(list, listBody);
  const lockBody = JSON.stringify({ pid: spawnSync(process.execPath, ["-e", ""]).pid, host: hostname(), at: Date.now() });
  writeFileSync(lock, lockBody);
  const dirs = ["a", "b"].map((n) => { const d = join(root, n); mkdirSync(d); return d; });

  const env = { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "600" };
  const res = await Promise.all(dirs.map((d) => login(fake.url, home, d, env)));
  for (const r of res) {
    assert.equal(r.code, 1, r.err);
    assert.ok(r.err.includes(lock), "names the lock path");
    assert.match(r.err, /not running/);
  }
  assert.equal(readFileSync(list, "utf8"), listBody, "trust list unchanged");
  assert.equal(readFileSync(lock, "utf8"), lockBody, "lock unchanged");

  unlinkSync(lock); // what the human does
  const res2 = await Promise.all(dirs.map((d) => login(fake.url, home, d, {})));
  for (const r of res2) assert.equal(r.code, 0, r.err);
  const projects = JSON.parse(readFileSync(list, "utf8")).projects;
  assert.equal(projects.length, 3, "the old entry and both new ones");
  assert.deepEqual(projects[0], other);
  assert.equal(existsSync(lock), false);
});
