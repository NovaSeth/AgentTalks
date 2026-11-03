/**
 * Supply-chain and deploy guards (T-MG-9, findings B-MG-12, B-MG-16, B-MG-17, B-MG-22).
 *
 * These are gates in code: a CI workflow, an image definition and a deploy script are
 * configuration nobody rereads, so the only durable guard is a test that fails the day
 * someone writes `uses: x@v5` or `FROM node:latest` again. Each check below is paired
 * with a probe that proves the check itself can fire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/** Every `uses:` reference that is not pinned to a full 40-hex commit SHA. */
function unpinnedActions(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)]
    .map((m) => m[1])
    .filter((ref) => !/@[0-9a-f]{40}$/.test(ref));
}

test("CI: every action is pinned to a full commit SHA (B-MG-12, B-MG-16)", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.ok(/uses:/.test(ci), "the probe sees no `uses:` line at all - the pattern stopped matching");
  assert.deepEqual(unpinnedActions(ci), []);
});

test("CI: the pin check can fire (a tag reference is reported)", () => {
  assert.deepEqual(unpinnedActions("      - uses: actions/checkout@v4\n"), ["actions/checkout@v4"]);
  assert.deepEqual(unpinnedActions("      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n"), []);
});

test("CI: the workflow token is read-only by default (B-MG-16)", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
});

test("Docker: the base image is pinned by digest and only /data is owned by the runtime user (B-MG-17)", () => {
  const df = read("Dockerfile");
  const from = df.match(/^FROM\s+(\S+)/m)?.[1] ?? "";
  assert.match(from, /@sha256:[0-9a-f]{64}$/, `FROM is not pinned by digest: ${from}`);
  const chown = df.match(/chown[^\n]*/)?.[0] ?? "";
  assert.ok(chown.includes("/data"), "the data directory must stay writable for the node user");
  assert.ok(!/\s\/app\b/.test(chown), `application code must not be writable by the runtime user: ${chown}`);
});

test("deploy: the site password becomes valid JSON even with quotes and backslashes (B-MG-22)", () => {
  const script = read("deploy/uruchom-produkcje.sh");
  const fn = script.match(/^password_json\(\)\s*\{[\s\S]*?^\}/m)?.[0];
  assert.ok(fn, "deploy/uruchom-produkcje.sh defines no password_json() function");
  const dir = mkdtempSync(join(tmpdir(), "at-t-mg-9-"));
  const file = join(dir, "site-password");
  const tricky = 'pa"ss\\word with spaces'; // SYNTH test value
  writeFileSync(file, tricky + "\n");
  const out = execFileSync("bash", ["-c", `${fn}\npassword_json "$1"`, "probe", file], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(out), { password: tricky });
});
