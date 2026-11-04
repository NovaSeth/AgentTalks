import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { waitFor } from "../helpers.ts";
import { fakeAt } from "../plugin/fake-at.ts";

// T-MG-21 fix round 2, F2 / F6 / F3: ONE trust-list lock protocol for both writers (plugin
// login.mjs and `atalk login --local`); the same scenario table runs against both.
//  F2: (round 3 spec change) a lock is NEVER evicted automatically; a dead owner's lock times out with a message naming the fix.
//  F6: the lock is taken FIRST - a lock timeout leaves zero writes and an existing credential alone.
//  F3: a failing trust-list write leaves no *.tmp behind and rolls the credential back.

const LOGIN = fileURLToPath(new URL("../../integrations/claude-code-plugin/scripts/login.mjs", import.meta.url));
const ATALK = fileURLToPath(new URL("../../bin/atalk.js", import.meta.url));
const TOKEN = "atk_r2_synthetic_token_0001"; // SYNTH: a synthetic test value, not a credential

type Result = { code: number | null; err: string };
type Env = { home: string; project: string; conf: string; file: string; list: string; lock: string };
type Impl = { name: string; start(): Promise<{ run(e: Env, extra: Record<string, string>): Promise<Result>; close(): Promise<void> | void }> };

function newEnv(git = false): Env {
  const root = mkdtempSync(join(tmpdir(), "at-r2-lock-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  if (git) execFileSync("git", ["init", "-q", project]);
  const conf = join(home, ".config", "agenttalks");
  return { home, project, conf, file: join(project, ".agenttalks.json"), list: join(conf, "trusted-projects.json"), lock: join(conf, "trusted-projects.json.lock") };
}

/** Runs a command as a child process with the token on stdin; resolves with its exit code and stderr. */
async function spawnLogin(argv: string[], e: Env, extra: Record<string, string>): Promise<Result> {
  const child = spawn(process.execPath, argv, {
    cwd: e.project, env: { PATH: process.env.PATH ?? "", HOME: e.home, ...extra }, stdio: ["pipe", "pipe", "pipe"],
  });
  const out = { err: "", code: null as number | null, done: false };
  child.stderr.on("data", (c) => { out.err += c; });
  child.on("exit", (c) => { out.code = c; out.done = true; });
  child.stdin.end(TOKEN + "\n");
  await waitFor(() => out.done, 15_000);
  return { code: out.code, err: out.err };
}

const plugin: Impl = {
  name: "plugin login.mjs",
  async start() {
    const fake = await fakeAt();
    return {
      run: (e, extra) => spawnLogin([LOGIN, "--url", fake.url, "--token", "-"], e, extra),
      close: () => fake.close(),
    };
  },
};

const atalk: Impl = {
  name: "atalk login --local",
  async start() {
    const fake = await fakeAt();
    return {
      // AGENTTALKS_CONFIG_DIR: the same trust directory the plugin derives from HOME
      run: (e, extra) => spawnLogin([ATALK, "login", "--url", fake.url, "--token", "-", "--local"], e, { AGENTTALKS_CONFIG_DIR: e.conf, ...extra }),
      close: () => fake.close(),
    };
  },
};

/** A child that stays alive (the lock owner). */
function liveOwner(t: { after(fn: () => void): void }) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => { child.kill(); });
  return child;
}
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;
const tmpLeft = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []).filter((n) => n.endsWith(".tmp"));

for (const impl of [plugin, atalk]) {
  test(`R2-F2 [${impl.name}]: a lock is never evicted: not by age, not for a LIVE owner, not for a DEAD pid (round 3)`, async (t) => {
    const h = await impl.start();
    t.after(() => h.close());
    const owner = liveOwner(t);

    const a = newEnv();
    mkdirSync(a.conf, { recursive: true });
    const body = JSON.stringify({ pid: owner.pid, host: hostname(), at: Date.now() - 120_000 });
    writeFileSync(a.lock, body);
    const ra = await h.run(a, { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "400" });
    assert.equal(ra.code, 1, ra.err);
    assert.match(ra.err, /locked by pid \d+ on .*\(running\)/);
    assert.equal(existsSync(a.file), false, "no credential");
    assert.equal(existsSync(a.list), false, "no trust list");
    assert.equal(readFileSync(a.lock, "utf8"), body, "the live owner's lock is untouched");

    // round 3: a DEAD owner's lock is NOT evicted either; login times out, writes nothing, says "not running"
    const b = newEnv();
    mkdirSync(b.conf, { recursive: true });
    const other = { path: "/somewhere/else/.agenttalks.json", sha256: "ab".repeat(32) };
    const listBody = JSON.stringify({ projects: [other] });
    writeFileSync(b.list, listBody);
    const deadBody = JSON.stringify({ pid: deadPid(), host: hostname(), at: Date.now() });
    writeFileSync(b.lock, deadBody);
    const rb = await h.run(b, { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "400" });
    assert.equal(rb.code, 1, rb.err);
    assert.ok(rb.err.includes(b.lock), "the message names the lock path");
    assert.match(rb.err, /not running/);
    assert.equal(existsSync(b.file), false, "no credential");
    assert.equal(readFileSync(b.list, "utf8"), listBody, "trust list unchanged");
    assert.equal(readFileSync(b.lock, "utf8"), deadBody, "the lock is still there, untouched");

    // other host, and unreadable content: both count as held
    for (const content of [JSON.stringify({ pid: deadPid(), host: "some-other-host.invalid", at: 1 }), "not json {"]) {
      const c = newEnv();
      mkdirSync(c.conf, { recursive: true });
      writeFileSync(c.lock, content);
      const rc = await h.run(c, { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "300" });
      assert.equal(rc.code, 1, rc.err);
      assert.ok(rc.err.includes(c.lock), "the message names the lock path");
      assert.equal(existsSync(c.file), false);
      assert.equal(readFileSync(c.lock, "utf8"), content);
    }
  });

  test(`R2-F6 [${impl.name}]: a lock timeout in a git directory -> exit 1, zero writes, an existing credential untouched`, async (t) => {
    const h = await impl.start();
    t.after(() => h.close());
    const owner = liveOwner(t);

    // no credential yet
    const a = newEnv(true);
    mkdirSync(a.conf, { recursive: true });
    writeFileSync(a.lock, JSON.stringify({ pid: owner.pid, host: hostname(), at: Date.now() }));
    const ra = await h.run(a, { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "300" });
    assert.equal(ra.code, 1, ra.err);
    assert.equal(existsSync(a.file), false, "no credential created");
    assert.equal(existsSync(join(a.project, ".gitignore")), false, "no .gitignore change");
    assert.equal(existsSync(a.list), false);

    // an existing credential: byte for byte the same
    const b = newEnv(true);
    mkdirSync(b.conf, { recursive: true });
    writeFileSync(b.lock, JSON.stringify({ pid: owner.pid, host: hostname(), at: Date.now() }));
    const before = '{\n  "url": "http://old.example",\n  "token": "old"\n}\n';
    writeFileSync(b.file, before);
    const rb = await h.run(b, { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "300" });
    assert.equal(rb.code, 1, rb.err);
    assert.equal(readFileSync(b.file, "utf8"), before, "existing credential unchanged");
    assert.equal(existsSync(join(b.project, ".gitignore")), false, "no .gitignore change");
    assert.deepEqual(tmpLeft(b.project), []);
  });

  test(`R2-F3 [${impl.name}]: a failing trust-list rename leaves no *.tmp and rolls the credential back`, async (t) => {
    const h = await impl.start();
    t.after(() => h.close());

    const a = newEnv(true);
    const ra = await h.run(a, { AGENTTALKS_LOGIN_TEST_FAIL_TRUST_RENAME: "1" });
    assert.equal(ra.code, 1, ra.err);
    assert.equal(existsSync(a.file), false, "credential rolled back");
    assert.deepEqual(tmpLeft(a.conf), [], "no temp file in the trust dir");
    assert.deepEqual(tmpLeft(a.project), [], "no temp file in the project dir");
    assert.equal(existsSync(a.lock), false, "lock released");

    const b = newEnv(true);
    const before = '{\n  "url": "http://old.example",\n  "token": "old"\n}\n';
    writeFileSync(b.file, before);
    const rb = await h.run(b, { AGENTTALKS_LOGIN_TEST_FAIL_TRUST_RENAME: "1" });
    assert.equal(rb.code, 1, rb.err);
    assert.equal(readFileSync(b.file, "utf8"), before, "previous credential restored");
    assert.deepEqual(tmpLeft(b.conf), []);
    assert.deepEqual(tmpLeft(b.project), []);
  });
}
