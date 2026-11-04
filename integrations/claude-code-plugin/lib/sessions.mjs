// @ts-check
/**
 * Session bookkeeping shared by the hooks, the channel server and the wake bridge.
 *
 * - The AgentTalks presence session id is DERIVED from the Claude Code session id (a hash),
 *   so the same Claude Code session always maps to the same presence row, across a resume,
 *   and the raw Claude Code id is not published on the server.
 * - ~/.config/agenttalks/claude-sessions.json (0600) records, per Claude Code session, the
 *   cwd and the session id the wake bridge needs for `claude -p --resume`. It holds no token.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_RECORDS = 50;

/** @param {string} claudeSessionId */
export function deriveSessionId(claudeSessionId) {
  return "cc-" + createHash("sha256").update(String(claudeSessionId)).digest("hex").slice(0, 24);
}

/** @param {string} [home] */
export function configDir(home = homedir()) {
  return join(home, ".config", "agenttalks");
}

/** @param {string} [home] */
export function sessionsFile(home = homedir()) {
  return join(configDir(home), "claude-sessions.json");
}

/**
 * @typedef {{ sessionId: string, cwd: string, handle: string, url: string, updatedAt: number }} SessionRecord
 */

/** @param {string} file @returns {SessionRecord[]} */
export function readSessions(file) {
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(v?.sessions) ? v.sessions.filter(isRecord) : [];
  } catch {
    return [];
  }
}

/** @param {any} r @returns {r is SessionRecord} */
function isRecord(r) {
  return r && typeof r.sessionId === "string" && typeof r.cwd === "string"
    && typeof r.handle === "string" && typeof r.url === "string" && typeof r.updatedAt === "number";
}

/** Atomic write with mode 0600 (a temp file in the same directory, then rename), and an
 *  explicit chmod: `mode` applies only when a file is created.
 *  @param {string} file @param {SessionRecord} rec */
export function recordSession(file, rec) {
  const dir = join(file, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const list = readSessions(file).filter((r) => r.sessionId !== rec.sessionId);
  list.push(rec);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify({ sessions: list.slice(0, MAX_RECORDS) }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

/** The most recent recorded session of an actor, optionally on a given server.
 *  @param {string} file @param {string} handle @param {string} [url] */
export function latestSessionFor(file, handle, url) {
  const strip = (/** @type {string} */ u) => u.replace(/\/+$/, "");
  return readSessions(file)
    .filter((r) => r.handle === handle && (!url || strip(r.url) === strip(url)))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}
