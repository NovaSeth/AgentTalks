/**
 * T-MG-10 review round 2, F7: when mktemp fails the hook falls back to /dev/null for its
 * stderr capture; the EXIT trap must then NOT run `rm -f /dev/null` (a hook running with
 * privileges would delete the device node). Stubs in PATH: mktemp fails, rm logs its argv.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../../integrations/claude-code/hooks/atalk-hook.sh", import.meta.url));

test("hook: a failed mktemp never makes the EXIT trap remove /dev/null (review F7)", () => {
  const dir = mkdtempSync(join(tmpdir(), "at-hook-f7-"));
  const bin = join(dir, "bin");
  execFileSync("mkdir", ["-p", bin]);
  const rmLog = join(dir, "rm.log");
  const stub = (name: string, body: string) => {
    const p = join(bin, name);
    writeFileSync(p, `#!/bin/bash\n${body}\n`);
    chmodSync(p, 0o755);
  };
  stub("mktemp", "exit 1");
  stub("rm", `echo "$*" >> "${rmLog}"`);
  stub("atalks", "exit 0");
  execFileSync("/bin/bash", [HOOK, "tick"], {
    input: "{}",
    env: { PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin`, HOME: dir, AGENTTALKS_TOKEN: "atk_synthetic" }, // SYNTH
    stdio: ["pipe", "pipe", "pipe"],
  });
  const calls = existsSync(rmLog) ? readFileSync(rmLog, "utf8") : "";
  assert.ok(!calls.includes("/dev/null"), `the trap removed /dev/null: ${calls}`);
});
