// @ts-check
/**
 * Is the AgentTalks channel enabled in this Claude Code session?
 *
 * The plugin ships both delivery paths: the channel (needs a launch flag) and the monitor
 * (always starts). With both running, every event would reach the session twice. Claude Code
 * does not tell a plugin process which channels it registered, so the monitor reads the
 * command line of the `claude` process among its ancestors: with the channel flag it goes on
 * STANDBY, and stands down only while the channel server proves alive (the heartbeat below);
 * without the flag it runs.
 *
 * Detection can fail (no `ps`, an unusual process tree). The fallback is to RUN the monitor:
 * a duplicate is a nuisance, a missing delivery path is a silent failure. AGENTTALKS_MONITOR
 * overrides the guess: "off" never runs the monitor, "on" always does.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Whether a command line enables this plugin's channel. @param {string} cmdline */
export function hasChannelFlag(cmdline) {
  const args = String(cmdline).split(/\s+/);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let value = null;
    if (a === "--channels" || a === "--dangerously-load-development-channels") value = args[i + 1] ?? "";
    else if (a.startsWith("--channels=")) value = a.slice("--channels=".length);
    else if (a.startsWith("--dangerously-load-development-channels=")) value = a.slice(a.indexOf("=") + 1);
    if (value !== null && /(^|,)plugin:agenttalks@/.test(value)) return true;
  }
  return false;
}

/** @param {number} pid @returns {{ ppid: number, cmdline: string } | null} */
function psLine(pid) {
  const out = execFileSync("ps", ["-o", "ppid=", "-o", "command=", "-p", String(pid)], {
    encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const m = /^(\d+)\s+(.*)$/s.exec(out);
  return m ? { ppid: Number(m[1]), cmdline: m[2] } : null;
}

/**
 * The claude process this plugin process belongs to: the nearest ancestor (up to 12 levels)
 * whose command is `claude ...` or `node /path/to/claude ...` (an npm install runs the CLI
 * through node). AGENTTALKS_CLAUDE_PID names it directly (tests, unusual process trees).
 * @param {Record<string, string | undefined>} [env] @param {number} [pid]
 * @returns {{ pid: number, cmdline: string } | null} null = could not tell
 */
export function claudeAncestor(env = process.env, pid = process.ppid) {
  try {
    const forced = Number(env.AGENTTALKS_CLAUDE_PID);
    if (Number.isInteger(forced) && forced > 1) {
      const line = psLine(forced);
      return line ? { pid: forced, cmdline: line.cmdline } : null;
    }
    let cur = pid;
    for (let depth = 0; depth < 12 && cur > 1; depth++) {
      const line = psLine(cur);
      if (!line) return null;
      const head = line.cmdline.split(/\s+/).slice(0, 2).map((t) => t.split("/").pop());
      if (head.includes("claude")) return { pid: cur, cmdline: line.cmdline };
      cur = line.ppid;
    }
    return null;
  } catch {
    return null;
  }
}

/** Whether the claude command line asked for the agenttalks channel.
 *  @param {number} [pid] @returns {boolean | null} null = could not tell */
export function channelEnabledInAncestors(pid = process.ppid) {
  const c = claudeAncestor({}, pid);
  return c ? hasChannelFlag(c.cmdline) : null;
}

// ------------------------------------------------------------------ channel heartbeat
//
// The channel flag is a REQUEST, not proof: Claude Code ignores a channel that is not on the
// allowlist or that org policy blocks, and it acknowledges no channel notification. What can
// be observed is the channel server: started by this claude, initialized over MCP, and
// holding an open AgentTalks stream. While that is true it refreshes a heartbeat file named
// after the claude pid; the monitor stands by only while the heartbeat is fresh and its
// writer is alive, and takes over otherwise.

export const HEARTBEAT_REFRESH_MS = 15_000;
export const HEARTBEAT_STALE_MS = 45_000;

/** @param {string} stateDir @param {number} claudePid */
export function heartbeatFile(stateDir, claudePid) {
  return join(stateDir, `channel-${claudePid}.json`);
}

/** @param {number} pid */
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return /** @type {any} */ (err)?.code === "EPERM"; }
}

/**
 * @typedef {{ pid: number, at: number, state: "open" | "closed",
 *   lastEventId: number | null, mentionCursor: number | null }} Heartbeat
 */

/** @param {string} file @returns {Heartbeat | null} */
export function readHeartbeat(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (!v || !Number.isInteger(v.pid) || typeof v.at !== "number") return null;
    return {
      pid: v.pid, at: v.at, state: v.state === "open" ? "open" : "closed",
      lastEventId: Number.isInteger(v.lastEventId) ? v.lastEventId : null,
      mentionCursor: Number.isInteger(v.mentionCursor) ? v.mentionCursor : null,
    };
  } catch {
    return null;
  }
}

/** Is the channel alive? A fresh "open" heartbeat whose writer still runs.
 *  @param {string} file @param {{ now?: () => number }} [opts] */
export function channelAlive(file, opts = {}) {
  const now = opts.now ?? Date.now;
  const hb = readHeartbeat(file);
  return !!hb && hb.state === "open" && now() - hb.at < HEARTBEAT_STALE_MS && processAlive(hb.pid);
}

/** The channel server's side (0600, atomic). The handled cursors ride along, so a monitor
 *  that takes over resumes where the channel stopped instead of from its own old cursor.
 *  @param {string} file @param {"open" | "closed"} state
 *  @param {{ lastEventId?: number | null, mentionCursor?: number | null }} [cursors] */
export function writeHeartbeat(file, state, cursors = {}) {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      pid: process.pid, at: Date.now(), state,
      lastEventId: cursors.lastEventId ?? null, mentionCursor: cursors.mentionCursor ?? null,
    }) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
  } catch { /* best effort: without a heartbeat the monitor delivers, which is the safe side */ }
}

/** What a stream state means for the heartbeat. Only a rejected token is final ("down"): a
 *  reconnect, or the feed closing its stream to reopen it from the cursor after a full queue,
 *  just stops the refresh ("pause"), and the heartbeat goes stale only if that lasts.
 *  @param {string} streamState @returns {"open" | "pause" | "down"} */
export function heartbeatFor(streamState) {
  if (streamState === "open") return "open";
  if (streamState === "unauthorized") return "down";
  return "pause";
}

/** @param {string} file */
export function removeHeartbeat(file) {
  try { rmSync(file, { force: true }); } catch { /* already gone */ }
}

/**
 * What the monitor does: "off" (AGENTTALKS_MONITOR=off), "run" (deliver), or "standby"
 * (the session asked for the channel: deliver only while the channel does not prove alive).
 * Detection that fails means "run": a duplicate is a nuisance, a missing delivery path is a
 * silent failure.
 * @param {Record<string, string | undefined>} [env]
 * @returns {"off" | "run" | "standby"}
 */
export function monitorMode(env = process.env) {
  const force = (env.AGENTTALKS_MONITOR ?? "").toLowerCase();
  if (force === "off" || force === "0") return "off";
  if (force === "on" || force === "1") return "run";
  const c = claudeAncestor(env);
  return c && hasChannelFlag(c.cmdline) ? "standby" : "run";
}

/** @param {Record<string, string | undefined>} [env] */
export function monitorShouldRun(env = process.env) {
  return monitorMode(env) !== "off";
}
