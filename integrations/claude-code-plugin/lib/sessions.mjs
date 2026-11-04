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
import { chmodSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const RECORD_FILE = /^[0-9a-f]{32}\.json$/;
const TOMB_FILE = /^([0-9a-f]{32}\.json)\.(\d+)\.[0-9a-f]{8}\.tomb$/;

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
 *  prunes records past their age (pruneSessions).
 *  @param {string} dir @param {SessionRecord} rec */
export function recordSession(dir, rec) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, recordName(rec.sessionId));
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  pruneSessions(dir);
}

/** @param {number} pid */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return /** @type {any} */ (err)?.code === "EPERM"; }
}

/**
 * Drops records whose session has not started for SESSION_TTL_MS (30 days), by AGE only: a
 * count limit pushes out the record of a session that is still alive as soon as enough
 * newer ones exist, and then its wake target is gone.
 *
 * Several processes write and prune the store at once (each SessionStart hook prunes after
 * writing), so the prune never deletes what it has read: between "read: stale" and "unlink"
 * another hook can replace the file with a fresh record (codex r3 F7). Instead:
 *   1. CLAIM: rename the record to a tombstone name of our own
 *      (<record>.<pid>.<random>.tomb). The rename is atomic: the tombstone now holds
 *      whatever file had the name at that instant, the stale one or a concurrent refresh.
 *   2. CHECK the tombstone's CONTENT, not what was read before. Still stale: delete it.
 *      Fresh (refreshed in between): put it back with link(), which fails with EEXIST if a
 *      still newer record took the name meanwhile (that one wins); then drop the tombstone.
 * A pruner that dies between 1 and 2 leaves a tombstone whose owner pid is gone: every prune
 * settles such orphans the same way first, so a fresh record held by a dead pruner returns
 * at the next SessionStart. The cost: for the microseconds between claim and link a reader
 * does not see a record that is being put back (the bridge then answers woke:false once).
 * @param {string} dir
 * @param {{ now?: () => number, ttlMs?: number,
 *   hooks?: { afterSelect?: () => void, afterClaim?: () => void } }} [opts]
 *   hooks: test seams between the steps (two-process interleaving tests)
 */
export function pruneSessions(dir, opts = {}) {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? SESSION_TTL_MS;
  const hooks = opts.hooks ?? {};
  let names;
  try { names = readdirSync(dir); } catch { return; }
  /** @param {any} v */
  const fresh = (v) => isRecord(v) && now() - v.updatedAt <= ttl;
  /** @param {string} tomb @param {string} file */
  const settle = (tomb, file) => {
    let v = null;
    try { v = JSON.parse(readFileSync(tomb, "utf8")); } catch { /* corrupt: goes */ }
    if (fresh(v)) {
      try { linkSync(tomb, file); } catch { /* EEXIST: a newer record holds the name; it wins */ }
    }
    try { unlinkSync(tomb); } catch { /* already settled by another pruner */ }
  };
  for (const name of names) {
    const m = TOMB_FILE.exec(name);
    if (m && !alive(Number(m[2]))) settle(join(dir, name), join(dir, m[1]));
  }
  for (const name of names) {
    if (!RECORD_FILE.test(name)) continue;
    const file = join(dir, name);
    let v;
    try { v = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    if (!isRecord(v) || fresh(v)) continue;
    hooks.afterSelect?.();
    const tomb = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tomb`;
    try { renameSync(file, tomb); } catch { continue; /* gone: another pruner claimed it */ }
    hooks.afterClaim?.();
    settle(tomb, file);
  }
}

/** The most recent recorded session of an actor, optionally on a given server.
 *  @param {string} dir @param {string} handle @param {string} [url] */
export function latestSessionFor(dir, handle, url) {
  const strip = (/** @type {string} */ u) => u.replace(/\/+$/, "");
  return readSessions(dir).find((r) => r.handle === handle && (!url || strip(r.url) === strip(url))) ?? null;
}
