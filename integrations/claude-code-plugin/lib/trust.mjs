// @ts-check
/**
 * Writes the trust list that `isTrustedProject` (lib/identity.mjs) and `atalk` read:
 * `trusted-projects.json` in AGENTTALKS_CONFIG_DIR, else ~/.config/agenttalks, holding
 * `{"projects":[{"path":<real path>,"sha256":<hex of the file's bytes>}]}`. The same format
 * and the same replace-by-path rule as `atalk login --local` (src/cli/atalk.ts trustProject).
 *
 * Only scripts/login.mjs calls this, after the server accepted the token; nothing here
 * vouches for a file the caller does not also hold the token for.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** @param {Record<string, string | undefined>} env @param {string} home */
export function trustDir(env, home) {
  const v = env.AGENTTALKS_CONFIG_DIR;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : join(home, ".config", "agenttalks");
}

/**
 * Records `path` (real path + content hash) in the trust list, replacing any entry for the
 * same path and keeping the others. The list is 0600, its directory 0700.
 * @param {string} path
 * @param {{ env?: Record<string, string | undefined>, home?: string }} [opts]
 */
export function trustProjectFile(path, opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? homedir();
  const real = realpathSync(path);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  const dir = trustDir(env, home);
  const file = join(dir, "trusted-projects.json");
  /** @type {Array<{ path?: unknown, sha256?: unknown }>} */
  let current = [];
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    if (Array.isArray(v?.projects)) current = v.projects.filter((/** @type {any} */ e) => e && typeof e === "object");
  } catch { /* missing or corrupt: start a fresh list */ }
  const projects = [...current.filter((e) => e.path !== real), { path: real, sha256 }];
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify({ projects }, null, 2), { mode: 0o600, flag: "wx" });
  try { chmodSync(tmp, 0o600); } catch { /* e.g. Windows - best effort */ }
  renameSync(tmp, file);
}
