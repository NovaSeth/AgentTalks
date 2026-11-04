#!/usr/bin/env node
// @ts-check
/**
 * The monitor fallback: works without any launch flag. Claude Code starts it as a plugin
 * monitor (monitors/monitors.json) and turns every stdout line into a notification, so this
 * script prints exactly ONE line per relevant event - the same filter and the same quoting
 * as the channel, flattened to one line (lib/frame.mjs frameLine).
 *
 * It exits cleanly before its deadline (--max-seconds, 0 = no deadline): a watch has a
 * deadline in Claude Code, and an exit the script chose is better than a kill in the middle
 * of a write. The cursor (last event id and mention cursor) is saved in
 * ~/.config/agenttalks/state/, so a restart resumes where this run stopped, without loss
 * and without duplicates. The state file holds ids only, never the token.
 *
 * A monitor process gets no plugin user_config values, so the identity comes from the
 * environment or the .agenttalks.json / atalk.json files (lib/identity.mjs), like atalk.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveIdentity, describeIdentity } from "../lib/identity.mjs";
import { createFeed } from "../lib/feed.mjs";
import { frameLine } from "../lib/frame.mjs";
import {
  channelAlive, claudeAncestor, heartbeatFile, monitorMode, readHeartbeat, removeHeartbeat,
} from "../lib/launch.mjs";

const RESUME_MAX_AGE_MS = 60 * 60 * 1000;
const STARTED_AT = Date.now();

/** @param {string} line */
const log = (line) => process.stderr.write(`[agenttalks-monitor] ${line}\n`);

/** @param {string[]} argv */
function parseArgs(argv) {
  let maxSeconds = 280;
  let stateDir = join(homedir(), ".config", "agenttalks", "state");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-seconds") maxSeconds = Number(argv[++i]);
    else if (argv[i] === "--state-dir") stateDir = String(argv[++i]);
  }
  if (!Number.isFinite(maxSeconds) || maxSeconds < 0) maxSeconds = 280;
  return { maxSeconds, stateDir };
}

const { maxSeconds, stateDir } = parseArgs(process.argv.slice(2));
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const identity = resolveIdentity({ cwd, report: log });
if (!identity) {
  log("no AgentTalks identity (AGENTTALKS_TOKEN, .agenttalks.json or ~/.config/agenttalks/atalk.json): nothing to watch");
  process.exit(0);
}
log(describeIdentity(identity));
const mode = monitorMode();
if (mode === "off") {
  log("AGENTTALKS_MONITOR=off: the monitor stands down");
  process.exit(0);
}

// One state file per server + project directory: two projects on one machine are two agents.
const stateFile = join(stateDir,
  "monitor-" + createHash("sha256").update(`${identity.url}\n${cwd}`).digest("hex").slice(0, 16) + ".json");

/** @returns {{ lastEventId: number | null, mentionCursor: number | null }} */
function loadState() {
  try {
    const v = JSON.parse(readFileSync(stateFile, "utf8"));
    if (typeof v?.savedAt !== "number" || Date.now() - v.savedAt > RESUME_MAX_AGE_MS) {
      return { lastEventId: null, mentionCursor: null };
    }
    return {
      lastEventId: Number.isInteger(v.lastEventId) ? v.lastEventId : null,
      mentionCursor: Number.isInteger(v.mentionCursor) ? v.mentionCursor : null,
    };
  } catch {
    return { lastEventId: null, mentionCursor: null };
  }
}

/** @param {number | null} lastEventId @param {number} mentionCursor */
function saveState(lastEventId, mentionCursor) {
  try {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const tmp = `${stateFile}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lastEventId, mentionCursor, savedAt: Date.now() }) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, stateFile);
  } catch (err) {
    log(`could not save the cursor: ${err instanceof Error ? err.message : err}`);
  }
}

// Standby: the session asked for the channel. Deliver nothing while the channel proves alive
// (its heartbeat, lib/launch.mjs); take over when it never shows up within the grace period
// (not allowlisted, blocked by policy, no identity, crashed at start) or stops delivering.
const env = process.env;
/** @type {import("../lib/launch.mjs").Heartbeat | null} */
let handover = null;
if (mode === "standby") {
  // Nothing to save while standing by: a stop or the deadline just ends the process.
  const quit = () => process.exit(0);
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
  const deadline = maxSeconds > 0 ? setTimeout(quit, Math.max(1, maxSeconds) * 1000) : null;
  const claude = claudeAncestor();
  const hb = claude ? heartbeatFile(join(homedir(), ".config", "agenttalks", "state"), claude.pid) : null;
  const poll = Number(env.AGENTTALKS_CHANNEL_POLL_MS) > 0 ? Number(env.AGENTTALKS_CHANNEL_POLL_MS) : 2000;
  const grace = Number(env.AGENTTALKS_CHANNEL_GRACE_MS) > 0 ? Number(env.AGENTTALKS_CHANNEL_GRACE_MS) : 30_000;
  const since = Date.now();
  let seenAlive = false;
  while (hb) {
    if (channelAlive(hb)) {
      if (!seenAlive) log("the agenttalks channel delivers in this session: the monitor is standing by");
      seenAlive = true;
    } else if (seenAlive || Date.now() - since >= grace) {
      log(seenAlive
        ? "the agenttalks channel stopped delivering: the monitor is taking over"
        : "the session has the channel flag but no agenttalks channel proved alive (not allowlisted, blocked by policy, or not started): the monitor is taking over");
      handover = readHeartbeat(hb);
      removeHeartbeat(hb);
      break;
    }
    await new Promise((r) => setTimeout(r, poll));
  }
  if (deadline) clearTimeout(deadline);
  process.off("SIGTERM", quit);
  process.off("SIGINT", quit);
}

const resumed = loadState();
// Taking over from the channel: resume where IT stopped, not from an older monitor cursor.
// A null event cursor with a mention cursor is real delivered state too (the channel stopped
// before its stream floor was safe to report, codex r4 F10).
if (handover && (handover.lastEventId !== null || handover.mentionCursor !== null)) {
  resumed.lastEventId = handover.lastEventId;
  resumed.mentionCursor = handover.mentionCursor;
}
const feed = createFeed({
  identity,
  log,
  lastEventId: resumed.lastEventId,
  mentionCursor: resumed.mentionCursor,
  // Delivered = the line is handed to stdout (its write callback): only then may the cursor
  // pass it.
  onItem: (item) => new Promise((resolve, reject) => {
    process.stdout.write(frameLine(item) + "\n", (err) => (err ? reject(err) : resolve(undefined)));
  }),
  onCursor: (id) => saveState(id, feed.mentionCursor),
  onState: (state) => {
    if (state === "unauthorized") {
      log("the server rejected the token (401/403): stopping");
      void finish(1);
    }
  },
});

let finishing = false;
/** @param {number} code @param {string} [notice] */
async function finish(code, notice) {
  if (finishing) return;
  finishing = true;
  feed.stop();
  // Let events already received be printed, then save. Both cursors are DELIVERED cursors
  // (lib/feed.mjs): when the wait runs out with events still undecided (a lookup that hangs)
  // or lines not yet written, the saved ids stay before them and the next run gets them
  // again by replay. The SSE receive cursor is never saved.
  await Promise.race([feed.idle(), new Promise((r) => setTimeout(r, 2000))]);
  saveState(feed.lastEventId, feed.mentionCursor);
  if (notice) process.stdout.write(notice + "\n");
  process.exit(code);
}

process.on("SIGTERM", () => { void finish(0); });
process.on("SIGINT", () => { void finish(0); });

if (maxSeconds > 0) {
  setTimeout(() => {
    void finish(0, "[agenttalks monitor] stopping before the watch deadline; the cursor is saved, "
      + "start the agenttalks monitor again to keep receiving AgentTalks events");
  }, Math.max(1000, maxSeconds * 1000 - (Date.now() - STARTED_AT)));
}

for (let delay = 1000; ; delay = Math.min(delay * 2, 60_000)) {
  try {
    await feed.start();
    break;
  } catch (err) {
    log(`start failed (${err instanceof Error ? err.message : "error"}), retrying in ${delay} ms`);
    await new Promise((r) => setTimeout(r, delay));
  }
}
