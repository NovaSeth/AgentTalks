/**
 * The deploy script's local gate must show WHICH test failed (T-MG-36). It used to run
 * `npm test >/dev/null`, so a red gate said only "tests failed". These tests run the real
 * script in a throwaway git repo with stub npm/ssh/rsync/gh on PATH: no network, no remote,
 * no server. The script stops at the gate (failure) or at `git fetch origin` (no remote).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../deploy/push-and-deploy.sh", import.meta.url).pathname;

function runGate(npmBody: string) {
  const dir = mkdtempSync(join(tmpdir(), "at-gate-"));
  const bin = join(dir, "bin"), repo = join(dir, "repo");
  mkdirSync(bin); mkdirSync(repo);
  const stub = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  stub("npm", npmBody);
  for (const n of ["ssh", "rsync", "gh"]) stub(n, "echo STUB-REACHED-NETWORK >&2; exit 99");
  const git = (...a: string[]) => spawnSync("git", a, { cwd: repo, encoding: "utf8" });
  git("init", "-q"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  const r = spawnSync("bash", [SCRIPT], { cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: dir } });
  return { dir, out: `${r.stdout}${r.stderr}`, status: r.status };
}

test("a failing test gate prints the failing test name and failure, keeps the log, stops with exit 1 (T-MG-36)", () => {
  const { dir, out, status } = runGate(`
if [ "$1" = test ]; then
  echo "✔ passing one"
  echo "✖ digestFor on 300k unread rows is fast (B-MG-94)"
  echo "ℹ fail 1"
  echo
  echo "✖ failing tests:"
  echo
  echo "test/fixes/t-mg-11-hardening.test.ts:121:1"
  echo "✖ digestFor on 300k unread rows is fast (B-MG-94) (53.2ms)"
  echo "  AssertionError [ERR_ASSERTION]: digestFor took 61.0 ms"
  exit 1
fi`);
  try {
    assert.equal(status, 1);
    assert.match(out, /STOP: tests failed/);
    assert.match(out, /digestFor on 300k unread rows is fast \(B-MG-94\)/, "the failing test name reaches the output");
    assert.match(out, /digestFor took 61\.0 ms/, "the assertion message reaches the output");
    assert.match(out, /t-mg-11-hardening\.test\.ts/, "the file reaches the output");
    assert.doesNotMatch(out, /passing one/, "passing tests stay out of the failure report");
    assert.doesNotMatch(out, /STUB-REACHED-NETWORK/);
    const log = out.match(/full log: (\S+)/)?.[1];
    assert.ok(log && existsSync(log), "the printed log path exists");
    assert.match(readFileSync(log, "utf8"), /passing one/, "the full log keeps everything");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a failing typecheck gate prints the tsc errors and stops with exit 1 (T-MG-36)", () => {
  const { dir, out, status } = runGate(`
if [ "$1" = test ]; then exit 0; fi
echo "src/core/digest.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'."
exit 2`);
  try {
    assert.equal(status, 1);
    assert.match(out, /STOP: tsc reports errors/);
    assert.match(out, /error TS2322/);
    assert.match(out, /full log: \S+/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a green gate stays quiet: one OK line, no test output (T-MG-36)", () => {
  const { dir, out } = runGate(`echo "noisy passing output"; exit 0`);
  try {
    assert.match(out, /^ {2}OK$/m);
    assert.doesNotMatch(out, /noisy passing output/);
    assert.doesNotMatch(out, /STOP: (tests failed|tsc reports errors)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a failing-tests section longer than 150 lines still ends with the log path and STOP, exit 1 (T-MG-36)", () => {
  const { dir, out, status } = runGate(`
if [ "$1" = test ]; then
  echo "✖ failing tests:"
  i=0
  while [ $i -lt 100000 ]; do echo "detail line $i"; i=$((i+1)); done
  exit 1
fi`);
  try {
    assert.equal(status, 1);
    assert.match(out, /full log: \S+/, "the log path is printed even when the section is cut");
    assert.match(out, /STOP: tests failed/);
    assert.doesNotMatch(out, /detail line 99999/, "the report is capped");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
