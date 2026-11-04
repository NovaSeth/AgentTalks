/** Deployment configuration selection must preserve existing VPS installations. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = () => readFileSync(new URL("../../deploy/deploy-production.sh", import.meta.url), "utf8");

test("deploy selects the new env file, falls back only for a missing default, and reports the selection", () => {
  const source = script();
  const helper = source.match(/^select_env_file\(\)\s*\{[\s\S]*?^\}/m)?.[0];
  assert.ok(helper, "the production script must define select_env_file");
  const dir = mkdtempSync(join(tmpdir(), "at-deploy-env-"));
  // Substitute only the deployment directory so the real helper runs without writing /etc.
  const isolated = helper.replaceAll("/etc/agenttalks/", dir + "/");
  const select = (override = "") => execFileSync("bash", ["-c", `${isolated}\nselect_env_file\nprintf '%s' "$ENV_FILE"`],
    { encoding: "utf8", env: { ...process.env, AGENTTALKS_ENV_FILE: override } });
  const current = join(dir, "instance.env"), legacy = join(dir, "instancja.env");
  try {
    writeFileSync(legacy, "AGENTTALKS_CONTAINER=existing\n");
    assert.equal(select(), `Using environment file: ${legacy}\n${legacy}`);
    writeFileSync(current, "AGENTTALKS_CONTAINER=current\n");
    assert.equal(select(), `Using environment file: ${current}\n${current}`);
    const custom = join(dir, "custom.env");
    assert.equal(select(custom), `Using environment file: ${custom}\n${custom}`);
    rmSync(current);
    assert.equal(select(custom), `Using environment file: ${custom}\n${custom}`, "a missing explicit override must never select production defaults");
    rmSync(legacy);
    assert.equal(select(), `Using environment file: ${current}\n${current}`, "without either file the new default is reported and readability validation fails later");
    assert.match(source, /^select_env_file$/m, "the helper must actually be called");
    assert.match(source, /if \[\[ ! -r \$ENV_FILE \]\]/, "an unreadable selection must fail before deploying");
    assert.doesNotMatch(source, /ENV_PLIK/, "one environment-file variable is the source of truth");
    assert.match(source, /docker compose --env-file "\$ENV_FILE"/);
    assert.match(source, /grep -E "\^\$1=" "\$ENV_FILE"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the push wrapper delegates remote env selection to the production script", () => {
  const source = readFileSync(new URL("../../deploy/push-and-deploy.sh", import.meta.url), "utf8");
  assert.match(source, /ssh "\$SSH_HOST" "cd \/home\/claude\/\$DEPLOY_DIR && sudo \.\/deploy\/deploy-production\.sh"/);
});
