// @ts-check
/**
 * Writes the trust list that `isTrustedProject` (lib/identity.mjs) and `atalk` read:
 * `trusted-projects.json` in AGENTTALKS_CONFIG_DIR, else ~/.config/agenttalks, holding
 * `{"projects":[{"path":<real path>,"sha256":<hex of the file's bytes>}]}`. The same format
 * and the same replace-by-path rule as `atalk login --local` (src/cli/atalk.ts), and the same
 * lock (withTrustLock below; atalk imports it from here, so there is one implementation).
 *
 * Only scripts/login.mjs and `atalk login --local` call this, after the server accepted the
 * token; nothing here vouches for a file the caller does not also hold the token for.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

/** @param {Record<string, string | undefined>} env @param {string} home */
export function trustDir(env, home) {
  const v = env.AGENTTALKS_CONFIG_DIR;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : join(home, ".config", "agenttalks");
}

const POLL_MS = 50;
const LOCK_NAME = "trusted-projects.json.lock";

/** @param {number} ms */
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Whether the lock's owner is provably gone: same host AND no such process (ESRCH).
 *  Anything else (other host, unreadable content, EPERM, a live pid) counts as held.
 *  @param {string} lockPath */
function ownerIsDead(lockPath) {
  let owner;
  try { owner = JSON.parse(readFileSync(lockPath, "utf8")); } catch { return false; }
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  if (owner.host !== hostname()) return false;
  try { process.kill(owner.pid, 0); return false; } catch (err) { return /** @type {any} */ (err)?.code === "ESRCH"; }
}

/**
 * Runs `fn` while holding `<dir>/trusted-projects.json.lock` (created with wx, 0600, content
 * {"pid","host","at"}). The one lock for every writer of the trust list. It is evicted ONLY
 * when its owner is provably dead (same host, pid gone); never by age. Retried every 50 ms up
 * to `timeoutMs` (default 5000, or AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS); then throws
 * Error("trust list is locked by another login (lock: <path>) ..."). Released in a finally,
 * only while the file still holds our pid+host+at.
 * @template T
 * @param {string} dir @param {() => T} fn @param {{ timeoutMs?: number }} [opts] @returns {T}
 */
export function withTrustLock(dir, fn, opts = {}) {
  const envT = Number(process.env.AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS);
  const timeoutMs = opts.timeoutMs ?? (Number.isFinite(envT) && envT > 0 ? envT : 5000);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = join(dir, LOCK_NAME);
  const mine = { pid: process.pid, host: hostname(), at: Date.now() };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify(mine), { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== "EEXIST") throw err;
      if (ownerIsDead(lockPath)) {
        try { unlinkSync(lockPath); } catch { /* raced away */ }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`trust list is locked by another login (lock: ${lockPath}); try again, or remove that file if no login is running`);
      }
      sleep(POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      const now = JSON.parse(readFileSync(lockPath, "utf8"));
      if (now?.pid === mine.pid && now?.at === mine.at && now?.host === mine.host) unlinkSync(lockPath);
    } catch { /* gone or not ours */ }
  }
}

/**
 * Records `path` (real path + hash of `bytes`, the bytes the caller verified) in the trust
 * list, replacing any entry for the same path and keeping the others. The list is 0600, its
 * directory 0700; the read-modify-write runs under the lock.
 * @param {string} path
 * @param {Buffer | string} bytes
 * @param {{ env?: Record<string, string | undefined>, home?: string, alreadyLocked?: boolean }} [opts]
 *   alreadyLocked: the caller already holds withTrustLock(trustDir(env, home))
 */
export function trustProjectFile(path, bytes, opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const real = realpathSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = trustDir(env, home);
  const file = join(dir, "trusted-projects.json");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = () => {
    /** @type {Array<{ path?: unknown, sha256?: unknown }>} */
    let current = [];
    try {
      const v = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(v?.projects)) current = v.projects.filter((/** @type {any} */ e) => e && typeof e === "object");
    } catch { /* missing or corrupt: start a fresh list */ }
    const projects = [...current.filter((e) => e.path !== real), { path: real, sha256 }];
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify({ projects }, null, 2), { mode: 0o600, flag: "wx" });
      try { chmodSync(tmp, 0o600); } catch { /* e.g. Windows - best effort */ }
      // Test seam (never set in production): the rename fails.
      if (env.AGENTTALKS_LOGIN_TEST_FAIL_TRUST_RENAME === "1") throw new Error("injected rename failure");
      renameSync(tmp, file);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* not created, or already renamed */ }
      throw err;
    }
  };
  if (opts.alreadyLocked) body(); else withTrustLock(dir, body);
}
