// @ts-check
/**
 * The guard around writing a project-local credential (`.agenttalks.json`, a bearer token),
 * shared by scripts/login.mjs and `atalk login|enroll --local` (src/cli/atalk.ts imports it
 * from here, like lib/trust.mjs, so the two cannot drift; it imports nothing from src/, so the
 * plugin still installs on its own).
 *
 * Every git call is hardened: the repository is untrusted input, so no program its config
 * names runs (fsmonitor, hooks), the config of the cwd and the global/system config are not
 * read, and the env is minimal.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const NAME = ".agenttalks.json";

/** The kind of p without following a final link: "none" | "file" | "dir" | "link" | "other".
 *  @param {string} p */
export function kindOf(p) {
  let st;
  try { st = lstatSync(p); } catch { return "none"; }
  return st.isSymbolicLink() ? "link" : st.isFile() ? "file" : st.isDirectory() ? "dir" : "other";
}

/** The top of the git work tree `dir` is in (the nearest ancestor with a .git: a directory, or
 *  the file of a worktree), or null.
 *  @param {string} dir @returns {string | null} */
export function gitTop(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return null;
  }
}

/** Runs hardened git in `dir`; returns the exit status (0, 1, ...) or null when git could not
 *  be run to completion (absent, killed, timeout).
 *  @param {string} dir @param {string} top @param {string[]} gitArgs @returns {number | null} */
function git(dir, top, gitArgs) {
  try {
    execFileSync("git", [
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.excludesFile=/dev/null",
      "-c", `safe.directory=${top}`,
      "-C", dir, ...gitArgs,
    ], {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      stdio: "ignore",
      timeout: 5000,
    });
    return 0;
  } catch (err) {
    const e = /** @type {any} */ (err);
    return typeof e?.status === "number" ? e.status : null;
  }
}

/** Whether git tracks NAME in `dir`: "tracked", "untracked" (exit status 1 = not in the index)
 *  or "unknown" (git absent, status 128, timeout, anything else) - callers fail closed on
 *  "unknown". Only a directory with no .git upward is "untracked" without asking git.
 *  @param {string} dir @returns {"tracked" | "untracked" | "unknown"} */
export function trackedState(dir) {
  const top = gitTop(dir);
  if (top === null) return "untracked";
  const s = git(dir, top, ["ls-files", "--error-unmatch", "--", NAME]);
  return s === 0 ? "tracked" : s === 1 ? "untracked" : "unknown";
}

/** Whether git ignores NAME in `dir` (check-ignore: 0 = ignored, 1 = not ignored, 128 = error).
 *  Outside a git tree: "ignored" is not asked, the answer is "none".
 *  @param {string} dir @returns {"ignored" | "not-ignored" | "unknown" | "none"} */
export function ignoreState(dir) {
  const top = gitTop(dir);
  if (top === null) return "none";
  const s = git(dir, top, ["check-ignore", "-q", "--", NAME]);
  return s === 0 ? "ignored" : s === 1 ? "not-ignored" : "unknown";
}

/** A new file under a fresh name (flag wx), then a rename over the target; the temp file is
 *  removed when the write or the rename fails.
 *  @param {string} path @param {string | Buffer} data @param {number} mode */
export function writeFileAtomic(path, data, mode) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, data, { mode, flag: "wx" });
    try { chmodSync(tmp, mode); } catch { /* e.g. Windows - best effort */ }
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* not created, or already renamed */ }
    throw err;
  }
}

/** The refusals that must come before ANY write: NAME or .gitignore (when it will be touched)
 *  is a link/directory/special file; git tracks NAME; git cannot tell. Returns the message
 *  (ending "nothing was written") or null.
 *  @param {string} dir @param {boolean} touchGi @returns {string | null} */
export function credentialPreflight(dir, touchGi) {
  const file = join(dir, NAME);
  const gi = join(dir, ".gitignore");
  if (kindOf(file) !== "none" && kindOf(file) !== "file") return `${NAME} in the target directory is not a regular file (link, directory or special file); refusing to write; nothing was written`;
  if (touchGi && kindOf(gi) !== "none" && kindOf(gi) !== "file") return ".gitignore in the target directory is not a regular file (link, directory or special file); refusing to write; nothing was written";
  const tracked = trackedState(dir);
  if (tracked === "tracked") {
    return `${NAME} is tracked by git here: writing the token into it would put the token in the repository. `
      + "Remove it from the index (git rm --cached) first; nothing was written";
  }
  if (tracked === "unknown") {
    return `could not tell whether git tracks ${NAME} here (git is missing, failed or timed out); `
      + "refusing to write a token into a possible repository; nothing was written";
  }
  return null;
}

/** Puts NAME in `dir`'s .gitignore (when `touchGi`) and CONFIRMS with git that it is ignored,
 *  before the credential exists. In a git tree that is not ignored (a later negation, another
 *  rule wins) or unknown: the .gitignore this call changed is restored and an Error whose
 *  message ends "nothing was written" is thrown. Returns whether a line was added.
 *  @param {string} dir @param {boolean} touchGi @returns {boolean} */
export function ensureIgnored(dir, touchGi) {
  const gi = join(dir, ".gitignore");
  let added = false;
  /** @type {Buffer | null} */
  let before = null;
  let mode = 0o644;
  if (touchGi) {
    const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
    if (!current.split("\n").some((l) => l.trim() === NAME)) {
      if (existsSync(gi)) { before = readFileSync(gi); mode = lstatSync(gi).mode & 0o777; }
      writeFileAtomic(gi, current + (current && !current.endsWith("\n") ? "\n" : "") + NAME + "\n", mode);
      added = true;
    }
  }
  const state = ignoreState(dir);
  if (state === "ignored" || state === "none") return added;
  let undone = "";
  if (added) {
    try {
      if (before !== null) writeFileAtomic(gi, before, mode); else unlinkSync(gi);
    } catch { undone = " (could not restore .gitignore: remove the line yourself)"; }
  }
  throw new Error(state === "not-ignored"
    ? `git does not ignore ${NAME} here even with it listed in .gitignore (a negation or another rule wins); `
      + `refusing to write a token that could be committed${undone}; nothing was written`
    : `could not confirm with git that ${NAME} is ignored (git failed or timed out); `
      + `refusing to write a token that could be committed${undone}; nothing was written`);
}
