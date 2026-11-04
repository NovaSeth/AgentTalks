// @ts-check
/**
 * Session bookkeeping shared by the hooks, the channel server and the wake bridge.
 *
 * - The AgentTalks presence session id is DERIVED from the Claude Code session id (a hash),
 *   so the same Claude Code session always maps to the same presence row, across a resume,
 *   and the raw Claude Code id is not published on the server.
 * - ~/.config/agenttalks/claude-sessions/ (0700) holds ONE file per Claude Code session
 *   (<sha256 of the session id>.json, 0600) with the cwd and the session id the wake bridge
 *   needs for `claude -p --resume`. No token. One file per session, because several hooks
 *   run at once (sessions starting together): a shared file updated by read-modify-write
 *   loses records even with an atomic rename, while a write to a file of one's own cannot
 *   clobber anybody else's record. The bridge reads the whole directory.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_RECORDS = 50;
const RECORD_FILE = /^[0-9a-f]{32}\.json$/;

/** @param {string} claudeSessionId */
export function deriveSessionId(claudeSessionId) {
  return "cc-" + createHash("sha256").update(String(claudeSessionId)).digest("hex").slice(0, 24);
}

/** @param {string} [home] */
export function configDir(home = homedir()) {
  return join(home, ".config", "agenttalks");
}

/** The session store (a directory). @param {string} [home] */
export function sessionsDir(home = homedir()) {
  return join(configDir(home), "claude-sessions");
}

/**
 * @typedef {{ sessionId: string, cwd: string, handle: string, url: string, updatedAt: number }} SessionRecord
 */

/** @param {any} r @returns {r is SessionRecord} */
function isRecord(r) {
  return r && typeof r.sessionId === "string" && typeof r.cwd === "string"
    && typeof r.handle === "string" && typeof r.url === "string" && typeof r.updatedAt === "number";
}

/** @param {string} sessionId */
function recordName(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32) + ".json";
}

/** Every record in the store, newest first. A corrupt or foreign file is skipped.
 *  @param {string} dir @returns {SessionRecord[]} */
export function readSessions(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  /** @type {SessionRecord[]} */
  const out = [];
  for (const name of names) {
    if (!RECORD_FILE.test(name)) continue;
    try {
      const v = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (isRecord(v) && recordName(v.sessionId) === name) out.push(v);
    } catch { /* being replaced right now, or corrupt: skip */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Writes the session's own file atomically (a temp file in the same directory, then rename)
 *  with mode 0600 (an explicit chmod too: `mode` applies only when a file is created), then
 *  drops the oldest records past MAX_RECORDS.
 *  @param {string} dir @param {SessionRecord} rec */
export function recordSession(dir, rec) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, recordName(rec.sessionId));
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  for (const old of readSessions(dir).slice(MAX_RECORDS)) {
    try { unlinkSync(join(dir, recordName(old.sessionId))); } catch { /* another hook pruned it */ }
  }
}

/** The most recent recorded session of an actor, optionally on a given server.
 *  @param {string} dir @param {string} handle @param {string} [url] */
export function latestSessionFor(dir, handle, url) {
  const strip = (/** @type {string} */ u) => u.replace(/\/+$/, "");
  return readSessions(dir).find((r) => r.handle === handle && (!url || strip(r.url) === strip(url))) ?? null;
}
