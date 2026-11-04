#!/usr/bin/env node
// @ts-check
/**
 * agenttalks-wake-bridge: an opt-in local receiver for the AgentTalks wake webhook.
 *
 *   agenttalks-wake-bridge.mjs [--port 8790] [--host 127.0.0.1] [--allow-public]
 *                              [--secrets-file ~/.config/agenttalks/wake-bridge.json]
 *                              [--allowed-tools "mcp__atwake__read_conversation,mcp__atwake__read_thread,mcp__atwake__reply,mcp__atwake__mark_read"]
 *                              [--claude claude]
 *                              [--server-url https://your-server]   (for the env pair)
 *
 * Secrets: the file lists the wake secrets the server showed once at `PUT /api/wake`, each
 * bound to the server that issued it:
 *   { "secrets": [{ "serverUrl": "https://your-server", "actor": "my-agent", "secret": "..." }] }
 * and must be mode 0600; or, for a single actor, AGENTTALKS_WAKE_ACTOR +
 * AGENTTALKS_WAKE_SECRET + AGENTTALKS_WAKE_SERVER_URL (or --server-url) in the environment.
 * A secret without a server URL is a startup error: the bridge never guesses which server a
 * secret belongs to.
 * Sessions come from ~/.config/agenttalks/claude-sessions/ (one file per session), written by the plugin's
 * SessionStart hook. See the plugin README for exposing the bridge to the server safely.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createWakeBridge, listenHost, DEFAULT_ALLOWED_TOOLS, checkWakeConfig, normalizeSecrets,
} from "../lib/wake.mjs";
import { configDir, sessionsDir } from "../lib/sessions.mjs";

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

/** Every secret bound to the server that issued it: each file entry carries its own
 *  serverUrl; the environment pair takes AGENTTALKS_WAKE_SERVER_URL (or --server-url). The
 *  older handle -> secret map names no server and is refused by checkWakeConfig.
 *  @returns {import("../lib/wake.mjs").WakeSecret[]} */
function loadSecrets() {
  /** @type {import("../lib/wake.mjs").WakeSecret[]} */
  const secrets = [];
  const envActor = process.env.AGENTTALKS_WAKE_ACTOR;
  const envSecret = process.env.AGENTTALKS_WAKE_SECRET;
  if (envActor && envSecret) {
    const url = str("server-url") ?? process.env.AGENTTALKS_WAKE_SERVER_URL;
    secrets.push(...normalizeSecrets([{ actor: envActor, secret: envSecret, serverUrl: url }]));
  }
  const file = str("secrets-file") ?? join(homedir(), ".config", "agenttalks", "wake-bridge.json");
  let st;
  try { st = statSync(file); } catch { st = null; }
  if (st) {
    if ((st.mode & 0o077) !== 0) {
      throw new Error(`${file} is readable by others (mode ${(st.mode & 0o777).toString(8)}): chmod 600 it first`);
    }
    const v = JSON.parse(readFileSync(file, "utf8"));
    secrets.push(...normalizeSecrets(v?.secrets));
  }
  return secrets;
}

try {
  const secrets = loadSecrets();
  const store = sessionsDir();
  const problem = checkWakeConfig(secrets);
  if (problem) throw new Error(`${problem} (secrets file or AGENTTALKS_WAKE_ACTOR/AGENTTALKS_WAKE_SECRET/AGENTTALKS_WAKE_SERVER_URL)`);
  const host = listenHost(str("host"), args["allow-public"] === true);
  const port = Number(str("port") ?? 8790);
  const server = createWakeBridge({
    secrets,
    sessionsDir: store,
    allowedTools: str("allowed-tools") ?? DEFAULT_ALLOWED_TOOLS,
    claudeBin: str("claude") ?? "claude",
    // Seen nonces and body hashes, kept until their freshness window ends (0600).
    replayFile: join(configDir(), "state", "wake-replay.json"),
    log,
  });
  const who = secrets.map((s) => `@${s.actor} on ${s.serverUrl}`).join(", ");
  server.listen(port, host, () => log(`listening on http://${host}:${port}/wake for ${who}`));
} catch (err) {
  log(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
