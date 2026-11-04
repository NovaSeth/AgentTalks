// @ts-check
/**
 * Writes the trust list that `isTrustedProject` (lib/identity.mjs) and `atalk` read:
 * `trusted-projects.json` in AGENTTALKS_CONFIG_DIR, else ~/.config/agenttalks, holding
 * `{"projects":[{"path":<real path>,"sha256":<hex of the file's bytes>}]}`. The same format
 * and the same replace-by-path rule as `atalk login --local` (src/cli/atalk.ts trustProject),
 * and the same lock: `trusted-projects.json.lock` (O_EXCL, 0600, {"pid","at"}), retried every
 * 50 ms for up to 5 s, stale after 30 s.
 *
 * Only scripts/login.mjs calls this, after the server accepted the token; nothing here
 * vouches for a file the caller does not also hold the token for.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** @param {Record<string, string | undefined>} env @param {string} home */
export function trustDir(env, home) {
  const v = env.AGENTTALKS_CONFIG_DIR;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : join(home, ".config", "agenttalks");
}

const STALE_MS = 30_000;
const POLL_MS = 50;

/** @param {number} ms */
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/**
 * Runs `fn` while holding `<lockPath>`. Throws Error("trust list is locked") on timeout.
 * @template T
 * @param {string} lockPath @param {number} timeoutMs @param {() => T} fn @returns {T}
 */
export function withLock(lockPath, timeoutMs, fn) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== "EEXIST") throw err;
      let at = NaN;
      try { at = Number(JSON.parse(readFileSync(lockPath, "utf8"))?.at); } catch { /* unreadable */ }
      if (!Number.isFinite(at)) { try { at = statSync(lockPath).mtimeMs; } catch { at = NaN; } }
      if (Number.isFinite(at) && Date.now() - at > STALE_MS) {
        try { unlinkSync(lockPath); } catch { /* raced away */ }
        continue;
      }
      if (Date.now() >= deadline) throw new Error("trust list is locked");
      sleep(POLL_MS);
    }
  }
  try { return fn(); } finally { try { unlinkSync(lockPath); } catch { /* gone */ } }
}

/**
 * Records `path` (real path + hash of `bytes`, the bytes the caller verified) in the trust
 * list, replacing any entry for the same path and keeping the others. The list is 0600, its
 * directory 0700; the read-modify-write runs under the lock.
 * @param {string} path
 * @param {Buffer | string} bytes
 * @param {{ env?: Record<string, string | undefined>, home?: string }} [opts]
 */
export function trustProjectFile(path, bytes, opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const real = realpathSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = trustDir(env, home);
  const file = join(dir, "trusted-projects.json");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const t = Number(env.AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS);
  withLock(`${file}.lock`, Number.isFinite(t) && t > 0 ? t : 5000, () => {
    /** @type {Array<{ path?: unknown, sha256?: unknown }>} */
    let current = [];
    try {
      const v = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(v?.projects)) current = v.projects.filter((/** @type {any} */ e) => e && typeof e === "object");
    } catch { /* missing or corrupt: start a fresh list */ }
    const projects = [...current.filter((e) => e.path !== real), { path: real, sha256 }];
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(tmp, JSON.stringify({ projects }, null, 2), { mode: 0o600, flag: "wx" });
    try { chmodSync(tmp, 0o600); } catch { /* e.g. Windows - best effort */ }
    renameSync(tmp, file);
  });
}
