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
import { monitorShouldRun } from "../lib/launch.mjs";

const RESUME_MAX_AGE_MS = 60 * 60 * 1000;

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
if (!monitorShouldRun()) {
  // The channel delivers the same events; a second copy of each would only be noise.
  log("the agenttalks channel is enabled in this session: the monitor stands down");
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

const resumed = loadState();
const feed = createFeed({
  identity,
  log,
  lastEventId: resumed.lastEventId,
  mentionCursor: resumed.mentionCursor,
  onItem: (item) => { process.stdout.write(frameLine(item) + "\n"); },
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
  // Let events already received be printed, then save. Both cursors are HANDLED cursors
  // (lib/feed.mjs): when the wait runs out with events still undecided (a lookup that hangs),
  // the saved ids stay before them and the next run gets them again by replay. The SSE
  // receive cursor is never saved.
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
  }, Math.max(1, maxSeconds) * 1000);
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
