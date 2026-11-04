// @ts-check
/**
 * Is the AgentTalks channel enabled in this Claude Code session?
 *
 * The plugin ships both delivery paths: the channel (needs a launch flag) and the monitor
 * (always starts). With both running, every event would reach the session twice, so the
 * monitor stands down when the session was started with the channel flag. Claude Code does
 * not tell a plugin process which channels it registered, so this reads the command line of
 * the `claude` process among the monitor's ancestors.
 *
 * Detection can fail (no `ps`, an unusual process tree). The fallback is to RUN the monitor:
 * a duplicate is a nuisance, a missing delivery path is a silent failure. AGENTTALKS_MONITOR
 * overrides the guess: "off" never runs the monitor, "on" always does.
 */
import { execFileSync } from "node:child_process";

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

/** Walks up to 12 ancestors looking for a claude process with the channel flag.
 *  @param {number} [pid] @returns {boolean | null} null = could not tell */
export function channelEnabledInAncestors(pid = process.ppid) {
  try {
    let cur = pid;
    for (let depth = 0; depth < 12 && cur > 1; depth++) {
      const out = execFileSync("ps", ["-o", "ppid=", "-o", "command=", "-p", String(cur)], {
        encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const m = /^(\d+)\s+(.*)$/s.exec(out);
      if (!m) return null;
      // `claude ...` or `node /path/to/claude ...` (an npm install runs the CLI through node).
      const head = m[2].split(/\s+/).slice(0, 2).map((t) => t.split("/").pop());
      if (head.includes("claude")) return hasChannelFlag(m[2]);
      cur = Number(m[1]);
    }
    return null;
  } catch {
    return null;
  }
}

/** @param {Record<string, string | undefined>} [env] */
export function monitorShouldRun(env = process.env) {
  const force = (env.AGENTTALKS_MONITOR ?? "").toLowerCase();
  if (force === "off" || force === "0") return false;
  if (force === "on" || force === "1") return true;
  return channelEnabledInAncestors() !== true;
}
