import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { bin } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

test("atalks and the atalk compatibility alias resolve to the same installed implementation", () => {
  assert.equal(typeof bin.atalks, "string", "the canonical client command must be installed");
  assert.equal(typeof bin.atalk, "string", "existing scripts must keep working");
  assert.equal(realpathSync(join(root, bin.atalks)), realpathSync(join(root, bin.atalk)));
  assert.equal(bin.agenttalks, "bin/agenttalks.js", "the server admin command stays unchanged");
});

test("both client names print identical atalks help, usage and error hints", (t) => {
  const home = mkdtempSync(join(tmpdir(), "atalks-naming-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, AGENTTALKS_CONFIG_DIR: home, NODE_NO_WARNINGS: "1" };
  for (const key of ["AGENTTALKS_URL", "AGENTTALKS_TOKEN", "ATALKS_URL", "ATALKS_TOKEN"]) {
    delete (env as NodeJS.ProcessEnv)[key];
  }
  const cases = [
    { args: [], status: 0, text: /^atalks - the AgentTalks client/ },
    { args: ["help"], status: 0, text: /^atalks - the AgentTalks client/ },
    { args: ["--help"], status: 0, text: /^atalks - the AgentTalks client/ },
    { args: ["login"], status: 1, text: /usage: atalks login/ },
    { args: ["enroll"], status: 1, text: /usage: atalks enroll/ },
    { args: ["whoami"], status: 1, text: /no token[\s\S]*atalks login/ },
    { args: ["log"], status: 1, text: /usage: atalks log/, token: "atk_synthetic" },
    { args: ["unknown-command"], status: 1, text: /unknown command:[\s\S]*atalks -/, token: "atk_synthetic" },
  ];
  for (const scenario of cases) {
    const results = ["atalks", "atalk"].map((name) => {
      assert.equal(typeof bin[name], "string", `${name} must be installed`);
      const result = spawnSync(process.execPath, [join(root, bin[name]), ...scenario.args], {
        cwd: home,
        env: { ...env, AGENTTALKS_TOKEN: scenario.token ?? "" },
        encoding: "utf8",
        timeout: 5000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, scenario.status, `${name} ${scenario.args.join(" ")}: ${result.stderr}`);
      assert.match(result.stdout + result.stderr, scenario.text);
      assert.doesNotMatch(result.stdout + result.stderr, /\batalk\b/);
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    });
    assert.deepEqual(results[0], results[1], `alias parity for ${scenario.args.join(" ") || "bare invocation"}`);
  }
});
