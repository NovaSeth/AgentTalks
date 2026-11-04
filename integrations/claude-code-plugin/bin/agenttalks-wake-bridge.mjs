#!/usr/bin/env node
// @ts-check
/**
 * agenttalks-wake-bridge: an opt-in local receiver for the AgentTalks wake webhook.
 *
 *   agenttalks-wake-bridge.mjs [--port 8790] [--host 127.0.0.1] [--allow-public]
 *                              [--secrets-file ~/.config/agenttalks/wake-bridge.json]
 *                              [--allowed-tools "mcp__plugin_agenttalks_agenttalks__*,mcp__agenttalks__*"]
 *                              [--claude claude]
 *                              [--server-url https://your-server]
 *
 * Secrets: the file maps actor handles to the wake secrets the server showed once at
 * `PUT /api/wake` ({ "secrets": { "my-agent": "..." } }) and must be mode 0600; or, for a
 * single actor, AGENTTALKS_WAKE_ACTOR + AGENTTALKS_WAKE_SECRET in the environment.
 * Sessions come from ~/.config/agenttalks/claude-sessions.json, written by the plugin's
 * SessionStart hook. See the plugin README for exposing the bridge to the server safely.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createWakeBridge, listenHost, DEFAULT_ALLOWED_TOOLS } from "../lib/wake.mjs";
import { sessionsFile } from "../lib/sessions.mjs";

/** @param {string} line */
const log = (line) => process.stderr.write(`[agenttalks-wake-bridge] ${line}\n`);

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-public") out["allow-public"] = true;
    else if (a.startsWith("--")) out[a.slice(2)] = argv[++i] ?? "";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const str = (/** @type {string} */ k) => (typeof args[k] === "string" ? /** @type {string} */ (args[k]) : undefined);

/** @returns {Map<string, string>} */
function loadSecrets() {
  const secrets = new Map();
  const envActor = process.env.AGENTTALKS_WAKE_ACTOR;
  const envSecret = process.env.AGENTTALKS_WAKE_SECRET;
  if (envActor && envSecret) secrets.set(envActor, envSecret);
  const file = str("secrets-file") ?? join(homedir(), ".config", "agenttalks", "wake-bridge.json");
  let st;
  try { st = statSync(file); } catch { st = null; }
  if (st) {
    if ((st.mode & 0o077) !== 0) {
      throw new Error(`${file} is readable by others (mode ${(st.mode & 0o777).toString(8)}): chmod 600 it first`);
    }
    const v = JSON.parse(readFileSync(file, "utf8"));
    for (const [handle, secret] of Object.entries(v?.secrets ?? {})) {
      if (typeof secret === "string" && secret) secrets.set(handle, secret);
    }
  }
  return secrets;
}

try {
  const secrets = loadSecrets();
  if (secrets.size === 0) throw new Error("no wake secret configured (secrets file or AGENTTALKS_WAKE_ACTOR/AGENTTALKS_WAKE_SECRET)");
  const host = listenHost(str("host"), args["allow-public"] === true);
  const port = Number(str("port") ?? 8790);
  const server = createWakeBridge({
    secrets,
    sessionsFile: sessionsFile(),
    serverUrl: str("server-url")?.replace(/\/+$/, ""),
    allowedTools: str("allowed-tools") ?? DEFAULT_ALLOWED_TOOLS,
    claudeBin: str("claude") ?? "claude",
    log,
  });
  server.listen(port, host, () => log(`listening on http://${host}:${port}/wake for ${[...secrets.keys()].map((h) => "@" + h).join(", ")}`));
} catch (err) {
  log(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
