/**
 * Plugin onboarding (T-MG-21): a host that has only the plugin (no `atalk`) can make a project
 * `.agenttalks.json` trusted with scripts/login.mjs, which needs a token the caller HOLDS,
 * and the served skill no longer tells agents to hand-write a project file (the plugin
 * ignores such a file: see project-trust.test.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "../helpers.ts";
import { convs, fakeAt, type FakeAt } from "./fake-at.ts";

const PLUGIN = fileURLToPath(new URL("../../integrations/claude-code-plugin/", import.meta.url));
const LOGIN = join(PLUGIN, "scripts", "login.mjs");
const SKILL = fileURLToPath(new URL("../../integrations/claude-skill/SKILL.md", import.meta.url));
const TOKEN = "atk_onboarding_synthetic_token_0001"; // SYNTH: a synthetic test value, not a credential

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function setup() {
  const root = mkdtempSync(join(tmpdir(), "at-plugin-onboard-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  const conf = join(home, ".config", "agenttalks");
  return { home, project, conf, file: join(project, ".agenttalks.json"), trustFile: join(conf, "trusted-projects.json") };
}

function run(args: string[], cwd: string, env: Record<string, string>, input?: string) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const out = { stdout: "", stderr: "", code: null as number | null, exited: false };
  child.stdout.on("data", (c) => { out.stdout += c; });
  child.stderr.on("data", (c) => { out.stderr += c; });
  child.on("exit", (code) => { out.code = code; out.exited = true; });
  if (input !== undefined) child.stdin.write(input);
  child.stdin.end();
  return { child, out };
}

const baseEnv = (home: string, extra: Record<string, string> = {}) =>
  ({ PATH: process.env.PATH ?? "", HOME: home, AGENTTALKS_MONITOR: "on", ...extra });

async function login(s: ReturnType<typeof setup>, args: string[], input?: string, extra: Record<string, string> = {}) {
  const r = run([LOGIN, ...args], s.project, baseEnv(s.home, extra), input);
  await waitFor(() => r.out.exited, 10_000);
  return r.out;
}

/** The project file exactly as the OLD skill's printf wrote it. */
function oldSkillFile(url: string) {
  return `{\n  "url": "${url}",\n  "token": "${TOKEN}"\n}\n`;
}

test("S1: a project file hand-written like the old skill says -> the monitor stays offline and names login.mjs; login.mjs with the token on stdin -> the monitor delivers a mention", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  fake.conversations = convs([{ id: 3, kind: "public", slug: "general", notify: "mentions" }]);
  const s = setup();
  writeFileSync(s.file, oldSkillFile(fake.url));

  const mon = () => run([join(PLUGIN, "scripts", "monitor.mjs"), "--max-seconds", "4"], s.project,
    baseEnv(s.home, { CLAUDE_PROJECT_DIR: s.project }));
  const first = mon();
  await waitFor(() => first.out.exited, 10_000);
  assert.equal(first.out.code, 0, first.out.stderr);
  assert.equal(first.out.stdout, "", "0 stdout lines");
  assert.ok(first.out.stderr.includes(LOGIN), `names scripts/login.mjs: ${first.out.stderr}`);
  assert.equal(fake.requests.length, 0);

  // The token goes in on stdin; it appears in neither stdout nor stderr (G3).
  const l = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.equal(l.code, 0, l.stderr);
  assert.ok(!(l.stdout + l.stderr).includes(TOKEN), "token never printed");
  assert.match(l.stdout, new RegExp(`^@nestor \\(.*\\) on ${esc(fake.url)}: saved ${esc(realpathSync(s.file))}, trusted for the AgentTalks plugin; start a new Claude Code session to connect$`, "m"));

  const second = mon();
  t.after(() => second.child.kill());
  await waitFor(() => fake.streams() === 1, 6000);
  fake.emit({ id: 61, conversationId: 3, actorId: 8, actorHandle: "bob", body: "hello @nestor, are you there?", threadId: null });
  await waitFor(() => second.out.exited, 10_000);
  const events = second.out.stdout.split("\n").filter((x) => /^\[\d+\]/.test(x));
  assert.equal(events.length, 1, second.out.stdout + second.out.stderr);
  assert.ok(events[0].startsWith("[61] "), events[0]);
  assert.ok(!(second.out.stdout + second.out.stderr).includes(TOKEN));
});

test("S2: a token the server rejects (401) or a non-actor answer -> non-zero exit, no file written", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  fake.meStatus = 401;
  const s = setup();
  const r = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.notEqual(r.code, 0);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
  assert.equal(existsSync(s.conf), false, "no trust list, no config dir");
  assert.deepEqual(readdirSync(s.project), []);
  // A 200 that is not an actor writes nothing either.
  fake.meStatus = undefined;
  fake.meBody = "not an actor";
  const r2 = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.notEqual(r2.code, 0);
  assert.deepEqual(readdirSync(s.project), []);
  assert.equal(existsSync(s.conf), false);
});

test("S3: a literal token on argv is refused, nothing is written; AGENTTALKS_TOKEN works without --token", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  const r = await login(s, ["--url", fake.url, "--token", TOKEN]);
  assert.notEqual(r.code, 0);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN), "the refusal does not echo the token");
  assert.deepEqual(readdirSync(s.project), []);
  assert.equal(existsSync(s.conf), false);
  assert.equal(fake.requests.length, 0, "no request was made");

  const ok = await login(s, ["--url", fake.url], undefined, { AGENTTALKS_TOKEN: TOKEN });
  assert.equal(ok.code, 0, ok.stderr);
  assert.ok(existsSync(s.file));
  assert.ok(!(ok.stdout + ok.stderr).includes(TOKEN));
});

test("S4 + G4 + G6: login twice leaves one trust entry for the path, others survive, modes are 0600/0700, AGENTTALKS_CONFIG_DIR is honoured, --dir picks the directory", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  mkdirSync(s.conf, { recursive: true });
  const other = { path: "/somewhere/else/.agenttalks.json", sha256: "ab".repeat(32) };
  writeFileSync(s.trustFile, JSON.stringify({ projects: [other] }));

  assert.equal((await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n")).code, 0);
  assert.equal((await login(s, ["--url", fake.url + "/", "--token", "-"], TOKEN + "\n")).code, 0);
  const list = JSON.parse(readFileSync(s.trustFile, "utf8"));
  const real = realpathSync(s.file);
  const sha = createHash("sha256").update(readFileSync(s.file)).digest("hex");
  assert.deepEqual(Object.keys(list), ["projects"]);
  assert.deepEqual(list.projects, [other, { path: real, sha256: sha }]);
  assert.equal(statSync(s.file).mode & 0o777, 0o600);
  assert.equal(statSync(s.trustFile).mode & 0o777, 0o600);
  const cfg = JSON.parse(readFileSync(s.file, "utf8"));
  assert.equal(cfg.token, TOKEN);
  assert.equal(cfg.url, fake.url);

  const s2 = setup();
  const cdir = join(s2.home, "custom-conf");
  const target = join(s2.home, "target");
  mkdirSync(target);
  const r = await login(s2, ["--url", fake.url, "--token", "-", "--dir", target], TOKEN + "\n", { AGENTTALKS_CONFIG_DIR: cdir });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(target, ".agenttalks.json")));
  assert.equal(existsSync(s2.file), false, "cwd untouched");
  assert.equal(JSON.parse(readFileSync(join(cdir, "trusted-projects.json"), "utf8")).projects.length, 1);
  assert.equal(statSync(cdir).mode & 0o777, 0o700);
  assert.equal(existsSync(s2.conf), false);
});

test("S5: the served skill has no command that redirects into .agenttalks.json, and names the three routes in order", () => {
  const skill = readFileSync(SKILL, "utf8");
  assert.ok(!skill.includes("> .agenttalks.json"), "no '> .agenttalks.json'");
  assert.ok(!skill.includes(">.agenttalks.json"), "no '>.agenttalks.json'");
  assert.ok(!/printf[^\n]*\.agenttalks\.json/.test(skill));
  const a = skill.indexOf("atalk login --local --url");
  const b = skill.indexOf("scripts/login.mjs");
  const c = skill.indexOf("~/.config/agenttalks/atalk.json");
  assert.ok(a >= 0 && b > a && c > b, `order atalk(${a}) < plugin(${b}) < global file(${c})`);
  assert.match(skill, /hand-written PROJECT `\.agenttalks\.json` is ignored by the plugin/);
  assert.ok(skill.includes("{{BASE_URL}}"));
});

test("S5b: the installer page does not tell agents to write a project file by hand", () => {
  const html = readFileSync(fileURLToPath(new URL("../../src/http/ui/install.html", import.meta.url)), "utf8");
  assert.ok(!/(&gt;|[^a-z/"]>)\s*\.agenttalks\.json/.test(html));
});

test("S7: login.mjs never writes through a symlink (the project file, the temp name, .gitignore): refuses, the link target is untouched", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  const victim = join(s.home, "victim.txt");
  writeFileSync(victim, "precious\n");
  symlinkSync(victim, s.file);
  const r = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.notEqual(r.code, 0);
  assert.equal(readFileSync(victim, "utf8"), "precious\n");
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
  assert.equal(existsSync(s.conf), false, "nothing trusted");

  // A symlinked .gitignore is refused too, and the already-written token file is not trusted.
  const s2 = setup();
  mkdirSync(join(s2.project, ".git"));
  const victim2 = join(s2.home, "victim2.txt");
  writeFileSync(victim2, "keep\n");
  symlinkSync(victim2, join(s2.project, ".gitignore"));
  const r2 = await login(s2, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.notEqual(r2.code, 0);
  assert.equal(readFileSync(victim2, "utf8"), "keep\n");
  assert.equal(existsSync(s2.conf), false);
  assert.equal(existsSync(s2.file), false, "no token file left behind");
});

test("S8: login.mjs refuses when .agenttalks.json is tracked by git (the token would be committed)", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: s.project, stdio: "pipe" });
  git("init", "-q");
  const shipped = oldSkillFile("https://foreign.example");
  writeFileSync(s.file, shipped);
  git("add", ".agenttalks.json");
  git("commit", "-qm", "ships a token file");
  const r = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /tracked by git/);
  assert.equal(readFileSync(s.file, "utf8"), shipped, "file untouched");
  assert.equal(existsSync(s.conf), false);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
});

test("S9: login's git calls run no repository-configured program (core.fsmonitor in .git/config) and the repo's config is not consulted from the project cwd", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: s.project, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(s.project, "other.txt"), "x\n");
  git("add", "other.txt");
  git("commit", "-qm", "init");
  const marker = join(s.home, "fsmonitor-ran");
  const script = join(s.home, "fsmon.sh");
  writeFileSync(script, `#!/bin/sh\ntouch ${marker}\nprintf '\\0'\n`, { mode: 0o755 });
  git("config", "core.fsmonitor", script);
  git("config", "core.hooksPath", join(s.home, "hooks"));
  const r = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.equal(r.code, 0, r.stderr);
  assert.equal(existsSync(marker), false, "the repository's fsmonitor program must not run");
});

test("S11: an ignore line that git does not honour (a later negation in the same .gitignore) -> refuse, no credential on disk, .gitignore unchanged, nothing trusted", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  execFileSync("git", ["init", "-q"], { cwd: s.project, stdio: "pipe" });
  const gi = join(s.project, ".gitignore");
  const body = ".agenttalks.json\n!.agenttalks.json\n";
  writeFileSync(gi, body);
  const r = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /nothing was written$/m);
  assert.equal(existsSync(s.file), false, "no credential on disk");
  assert.equal(readFileSync(gi, "utf8"), body);
  assert.equal(existsSync(s.trustFile), false, "nothing trusted");
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
});

test("S9b: login.mjs spawns git only with the hardening flags, a neutral cwd and a minimal env", () => {
  // The git calls live in lib/credguard.mjs, shared with atalk; login.mjs must import it.
  assert.ok(readFileSync(LOGIN, "utf8").includes("../lib/credguard.mjs"));
  const src = readFileSync(join(PLUGIN, "lib", "credguard.mjs"), "utf8");
  assert.ok(src.includes('"core.fsmonitor=false"'));
  assert.ok(src.includes('"core.hooksPath=/dev/null"'));
  assert.ok(src.includes("GIT_CONFIG_NOSYSTEM"));
  assert.ok(src.includes("tmpdir()"));
  assert.ok(/"-C", dir/.test(src));
  assert.ok(src.includes('"check-ignore"'));
});

test("S10: the tracked-file check fails closed: git exiting 128 (or anything but 1) inside a git tree -> refuse, nothing written; exit 1 = untracked -> proceeds; no .git upward -> git is not asked", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const bin = mkdtempSync(join(tmpdir(), "at-fakegit-"));
  const fakeGit = (code: number) => {
    // check-ignore (exit 1 = NOT ignored) answers 0: this test is about the tracked-file check.
    writeFileSync(join(bin, "git"), `#!/bin/sh\ncase "$*" in *check-ignore*) exit 0;; esac\nexit ${code}\n`, { mode: 0o755 });
    return { PATH: `${bin}:${process.env.PATH ?? ""}` };
  };

  const s = setup();
  mkdirSync(join(s.project, ".git"));
  const r = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n", fakeGit(128));
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /tracked|git/);
  assert.equal(existsSync(s.file), false);
  assert.equal(existsSync(s.conf), false);
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN));

  const r2 = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n", fakeGit(2));
  assert.notEqual(r2.code, 0, "any status but 1 refuses");
  assert.equal(existsSync(s.file), false);

  const r3 = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n", fakeGit(1));
  assert.equal(r3.code, 0, r3.stderr);
  assert.ok(existsSync(s.file));

  // No .git anywhere upward: git is never consulted, a broken git does not block.
  const s2 = setup();
  const r4 = await login(s2, ["--url", fake.url, "--token", "-"], TOKEN + "\n", fakeGit(128));
  assert.equal(r4.code, 0, r4.stderr);
});

test("S10b: the git call passes safe.directory", () => {
  assert.ok(readFileSync(join(PLUGIN, "lib", "credguard.mjs"), "utf8").includes("safe.directory="));
});

// ---- Fix round 1 (T-MG-21 review findings F1-F5) ----

// Fix round 2 (spec change): a lock is evicted only when its owner is provably dead (same host,
// pid gone), never by age. A "held" lock names a live pid (this test process); a "dead" one an
// exited child.
const lockBody = (at: number) => JSON.stringify({ pid: process.pid, host: hostname(), at });
const deadLockBody = (at: number) => JSON.stringify({ pid: spawnSync(process.execPath, ["-e", ""]).pid, host: hostname(), at });

test("R1-F1: a file swapped in between login's rename and the trust step -> exit 1, nothing trusted for the replacement", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  const swap = join(s.home, "swap.mjs");
  writeFileSync(swap, 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], \'{"url":"http://evil.example","token":"x"}\\n\');\n');
  const r = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n", { AGENTTALKS_LOGIN_TEST_AFTER_RENAME: swap });
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /changed while saving; nothing trusted/);
  const sha = createHash("sha256").update(readFileSync(s.file)).digest("hex");
  const list = existsSync(s.trustFile) ? JSON.parse(readFileSync(s.trustFile, "utf8")).projects : [];
  assert.equal(list.some((e: { sha256: string }) => e.sha256 === sha), false);
  assert.equal(list.length, 0);
});

test("R1-F2: a fresh lock held by someone else -> login waits, then both the old and the new entry are present; a dead owner's lock is not cleared", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  mkdirSync(s.conf, { recursive: true });
  const other = { path: "/somewhere/else/.agenttalks.json", sha256: "ab".repeat(32) };
  writeFileSync(s.trustFile, JSON.stringify({ projects: [other] }));
  const lock = s.trustFile + ".lock";
  writeFileSync(lock, lockBody(Date.now()));
  const p = login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(JSON.parse(readFileSync(s.trustFile, "utf8")).projects.length, 1, "not trusted while the lock is held");
  unlinkSync(lock);
  const r = await p;
  assert.equal(r.code, 0, r.stderr);
  const list = JSON.parse(readFileSync(s.trustFile, "utf8")).projects;
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], other);
  assert.equal(existsSync(lock), false, "lock released");

  const s2 = setup();
  mkdirSync(s2.conf, { recursive: true });
  writeFileSync(s2.trustFile + ".lock", deadLockBody(Date.now()));
  const r2 = await login(s2, ["--url", fake.url, "--token", "-"], TOKEN + "\n", { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "300" });
  assert.equal(r2.code, 1, r2.stderr); // round 3 (spec change): never evicted
  assert.match(r2.stderr, /not running/);
  assert.ok(existsSync(s2.trustFile + ".lock"), "lock still there");
});

test("R1-F3: non-regular outputs are refused before any write; a failing trust step leaves no new credential", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const a = setup();
  mkdirSync(join(a.project, ".gitignore"));
  const ra = await login(a, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.equal(ra.code, 1);
  assert.equal(existsSync(a.file), false);
  assert.equal(existsSync(a.trustFile), false);

  const b = setup();
  execFileSync("mkfifo", [b.file]);
  const rb = await login(b, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.equal(rb.code, 1);
  assert.ok(lstatSync(b.file).isFIFO());
  assert.equal(existsSync(b.trustFile), false);

  const c = setup();
  mkdirSync(c.conf, { recursive: true });
  const victim = join(c.home, "victim.json");
  writeFileSync(victim, "KEEP");
  symlinkSync(victim, c.trustFile);
  const rc = await login(c, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.equal(rc.code, 1);
  assert.equal(readFileSync(victim, "utf8"), "KEEP");
  assert.equal(existsSync(c.file), false);

  const d = setup();
  mkdirSync(d.conf, { recursive: true });
  writeFileSync(d.trustFile + ".lock", lockBody(Date.now()));
  const rd = await login(d, ["--url", fake.url, "--token", "-"], TOKEN + "\n", { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "200" });
  assert.equal(rd.code, 1);
  assert.match(rd.stderr, /locked by pid \d+ on .*\(running\)/);
  assert.equal(existsSync(d.file), false, "no credential left behind");

  const e = setup();
  mkdirSync(e.conf, { recursive: true });
  writeFileSync(e.trustFile + ".lock", lockBody(Date.now()));
  writeFileSync(e.file, oldSkillFile(fake.url));
  const before = readFileSync(e.file, "utf8");
  const re = await login(e, ["--url", fake.url, "--token", "-"], TOKEN + "\n", { AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS: "200" });
  assert.equal(re.code, 1);
  assert.equal(readFileSync(e.file, "utf8"), before, "previous credential restored");
});

test("R1-F4: http to a remote host and credentials in the URL are refused before any request; loopback http works", async (t) => {
  const fake: FakeAt = await fakeAt();
  t.after(() => fake.close());
  const s = setup();
  const r = await login(s, ["--url", "http://remote.example", "--token", "-"], TOKEN + "\n");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /https/);
  const r2 = await login(s, ["--url", "https://u:p@x.example", "--token", "-"], TOKEN + "\n");
  assert.equal(r2.code, 1);
  assert.match(r2.stderr, /credentials in the URL/);
  for (const o of [r, r2]) assert.ok(!(o.stdout + o.stderr).includes(TOKEN));
  assert.equal(existsSync(s.file), false);
  assert.equal(existsSync(s.trustFile), false);
  const ok = await login(s, ["--url", fake.url, "--token", "-"], TOKEN + "\n");
  assert.equal(ok.code, 0, ok.stderr);
});

test("R1-F5: login never echoes argument values", async () => {
  const s = setup();
  const r = await login(s, ["--token=atk_synthetic_fix_0001"]); // SYNTH: a synthetic test value
  const r2 = await login(s, ["atk_synthetic_fix_0002"]); // SYNTH: a synthetic test value
  for (const o of [r, r2]) {
    assert.equal(o.code, 1);
    assert.ok(!(o.stdout + o.stderr).includes("atk_synthetic_fix_000"), o.stderr);
  }
});
