#!/usr/bin/env node
// @ts-check
/**
 * The plugin's own `atalk login --local`, for a host that has the plugin but not `atalk`:
 *
 *   node login.mjs --url <server> --token - [--dir <path>]      (the token on stdin)
 *   AGENTTALKS_TOKEN=... node login.mjs --url <server> [--dir <path>]
 *
 * It verifies the token with GET /api/me and only then writes `.agenttalks.json` (0600) in the
 * target directory (--dir, else the current one; it does not search upwards) and lists that
 * file in the trust list (lib/trust.mjs), so the plugin will use it. Whoever runs it must HOLD
 * a token the server accepts, and the file then contains that token: this cannot be used to
 * vouch for a file a cloned repository shipped with a token the user does not have.
 *
 * The token comes from stdin or the environment, never from argv (visible in `ps` and shell
 * history), and is never printed. Exit 0 on success, 1 on any refusal, nothing written then.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createApi } from "../lib/api.mjs";
import { trustDir, trustProjectFile, withTrustLock } from "../lib/trust.mjs";

const NAME = ".agenttalks.json";

/** Undoes the credential write when a later step fails (set once the credential is written).
 *  @type {(() => void) | null} */
let undo = null;

/** A refusal raised while the trust lock is held: the lock is released (finally) before
 *  the process exits, then it is reported through fail(). */
class Refusal extends Error {}

/** @param {string} msg @returns {never} */
function fail(msg) {
  if (undo) { const u = undo; undo = null; try { u(); } catch { /* best effort */ } }
  process.stderr.write(`[agenttalks-login] ${msg}\n`);
  process.exit(1);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ url?: string, token?: string, dir?: string }} */
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--url" || k === "--token" || k === "--dir") {
      const v = argv[++i];
      if (v === undefined) fail(`${k} needs a value`);
      a[/** @type {"url" | "token" | "dir"} */ (k.slice(2))] = v;
    } else {
      fail("unknown argument; usage: node login.mjs --url <server> --token - [--dir <path>]");
    }
  }
  return a;
}

/** The server URL, or a refusal: https anywhere, http only for a loopback host (the token is
 *  sent as a bearer), and no user:pass@ in the URL.
 *  @param {string} s @returns {string} */
function cleanUrl(s) {
  let u;
  try { u = new URL(s.trim()); } catch { return fail("--url must be an absolute http(s) URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") return fail("--url must be an absolute http(s) URL");
  if (u.username || u.password) return fail("--url must not carry credentials in the URL (user:pass@)");
  const h = u.hostname;
  const loopback = h === "localhost" || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
  if (u.protocol === "http:" && !loopback) return fail("use https:// for a remote server (http:// is only accepted for localhost)");
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/** The kind of p without following a final link: "none" | "file" | "dir" | "link" | "other".
 *  @param {string} p */
function kindOf(p) {
  let st;
  try { st = lstatSync(p); } catch { return "none"; }
  return st.isSymbolicLink() ? "link" : st.isFile() ? "file" : st.isDirectory() ? "dir" : "other";
}

/** The top of the git work tree `dir` is in (the nearest ancestor with a .git), or null.
 *  @param {string} dir @returns {string | null} */
function gitTop(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return null;
  }
}
const inGitTree = (/** @type {string} */ dir) => gitTop(dir) !== null;

/** @param {string} p */
function isLink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** Whether git tracks .agenttalks.json in `dir`: "tracked", "untracked" (git answered with
 *  exit status 1 = not in the index) or "unknown" (git absent, status 128, timeout, anything
 *  else) - the caller fails closed on "unknown". Only a directory with no .git upward is
 *  "untracked" without asking git.
 *  @param {string} dir @returns {"tracked" | "untracked" | "unknown"} */
function trackedState(dir) {
  const top = gitTop(dir);
  if (top === null) return "untracked";
  try {
    // The repository is untrusted input: no program its config names may run (fsmonitor,
    // hooks), the config of the cwd is not consulted, and the env is minimal.
    execFileSync("git", [
      "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", `safe.directory=${top}`,
      "-C", dir, "ls-files", "--error-unmatch", "--", NAME,
    ], {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH ?? "", HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      stdio: "ignore",
      timeout: 5000,
    });
    return "tracked";
  } catch (err) {
    return /** @type {any} */ (err)?.status === 1 ? "untracked" : "unknown";
  }
}

/** A new file under a fresh name (flag wx: never follows or reuses an existing path), then a
 *  rename over the target, so a link planted at the target is replaced, not written through.
 *  @param {string} path @param {string | Buffer} data @param {number} mode @param {boolean} [quiet] */
function writeAtomic(path, data, mode, quiet = false) {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, data, { mode, flag: "wx" });
    try { chmodSync(tmp, mode); } catch { /* e.g. Windows - best effort */ }
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* not created */ }
    if (quiet) throw err;
    throw new Refusal(`could not write ${path} (${err instanceof Error ? err.name : "error"})`);
  }
}

const args = parseArgs(process.argv.slice(2));
const env = process.env;

const rawUrl = args.url ?? (env.AGENTTALKS_URL || env.ATALKS_URL);
if (!rawUrl) fail("--url <server> is required");
const url = cleanUrl(rawUrl);

let token;
if (args.token === undefined) {
  token = (env.AGENTTALKS_TOKEN ?? "").trim();
  if (!token) fail("no token: pipe it on stdin with `--token -`, or set AGENTTALKS_TOKEN");
} else if (args.token === "-") {
  try { token = readFileSync(0, "utf8").trim(); } catch { token = ""; }
  if (!token) fail("no token on stdin");
} else {
  fail("refusing a token on the command line (it shows in `ps` and shell history); use `--token -` and pipe it on stdin, or set AGENTTALKS_TOKEN");
}

let dir;
try { dir = realpathSync(resolve(args.dir ?? process.cwd())); } catch { fail("the target directory does not exist"); }

/** @type {any} */
let me;
try {
  me = await createApi({ url: /** @type {string} */ (url), token: /** @type {string} */ (token) }, { timeoutMs: 10_000 }).get("/api/me");
} catch (err) {
  fail(`the server did not accept the token (${err instanceof Error ? err.message : "error"}); nothing was written`);
}
const actor = me?.actor;
if (!actor || typeof actor.handle !== "string" || actor.handle === "") {
  fail("the server answered, but not with an actor; nothing was written");
}

const file = join(dir, NAME);
const gi = join(dir, ".gitignore");
const tdir = trustDir(env, homedir());
const tfile = join(tdir, "trusted-projects.json");

// Preflight: every refusal comes before the first write. Every existing output must be what
// it should be: a regular file (the trust directory: a real directory), never a link, FIFO,
// device or directory.
const willTouchGi = inGitTree(dir) || existsSync(gi);
if (kindOf(file) !== "none" && kindOf(file) !== "file") fail(`${NAME} in the target directory is not a regular file (link, directory or special file); refusing to write; nothing was written`);
if (willTouchGi && kindOf(gi) !== "none" && kindOf(gi) !== "file") fail(".gitignore in the target directory is not a regular file (link, directory or special file); refusing to write; nothing was written");
if (kindOf(tdir) !== "none" && kindOf(tdir) !== "dir") fail("the trust directory is not a real directory; refusing to write; nothing was written");
if (kindOf(tfile) !== "none" && kindOf(tfile) !== "file") fail("the trust list is not a regular file (link or special file); refusing to write; nothing was written");
const tracked = trackedState(dir);
if (tracked === "tracked") {
  fail(`${NAME} is tracked by git here: writing the token into it would put the token in the repository. `
    + "Remove it from the index (git rm --cached) first; nothing was written");
}
if (tracked === "unknown") {
  fail(`could not tell whether git tracks ${NAME} here (git is missing, failed or timed out); `
    + "refusing to write a token into a possible repository; nothing was written");
}

// Everything that writes runs under the trust-list lock, taken FIRST: a lock timeout leaves
// zero writes and an existing credential untouched.
let ignored = false;
const content = Buffer.from(JSON.stringify({ url, token, writtenBy: "agenttalks-plugin-login" }, null, 2) + "\n");
try {
  withTrustLock(tdir, () => {
    try {
      // 1. The ignore line first, so the credential is never unignored.
      if (willTouchGi) {
        const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
        if (!current.split("\n").some((l) => l.trim() === NAME)) {
          writeAtomic(gi, current + (current && !current.endsWith("\n") ? "\n" : "") + NAME + "\n",
            existsSync(gi) ? lstatSync(gi).mode & 0o777 : 0o644);
          ignored = true;
        }
      }

      // 2. The credential. A failure from here on restores the previous bytes or removes it.
      const previous = kindOf(file) === "file" ? readFileSync(file) : null;
      writeAtomic(file, content, 0o600);
      undo = () => {
        // Only while the file is still what this run wrote: never clobber someone else's file.
        let now = null;
        try { now = readFileSync(file); } catch { /* gone */ }
        if (now !== null && !now.equals(content)) return;
        if (previous !== null) writeAtomic(file, previous, 0o600, true);
        else unlinkSync(file);
      };

      // Test seam (never set in production): runs a script between the rename and the verify.
      const seam = env.AGENTTALKS_LOGIN_TEST_AFTER_RENAME;
      if (seam) { try { execFileSync(process.execPath, [seam, file], { stdio: "ignore" }); } catch { /* the script's own failure is not login's */ } }

      // 3. Trust binds to the bytes this run wrote: if the file is not exactly those, trust nothing.
      let onDisk = null;
      try { onDisk = readFileSync(file); } catch { /* gone */ }
      if (onDisk === null || !onDisk.equals(content)) {
        undo = null;
        throw new Refusal("the file changed while saving; nothing trusted");
      }
      try {
        trustProjectFile(file, content, { env, alreadyLocked: true });
      } catch (err) {
        throw new Refusal(`could not update the trust list (${err instanceof Error ? err.name : "error"}); nothing was trusted`);
      }
      undo = null;
    } catch (err) {
      // Roll back while the lock is still held.
      if (undo) { const u = undo; undo = null; try { u(); } catch { /* best effort */ } }
      throw err;
    }
  });
} catch (err) {
  if (err instanceof Refusal) fail(err.message);
  fail(/locked/.test(String(/** @type {any} */ (err)?.message))
    ? `${/** @type {Error} */ (err).message}; nothing was written`
    : `could not update the trust list (${err instanceof Error ? err.name : "error"}); nothing was written`);
}

const safeHandle = String(actor.handle).replace(/[^A-Za-z0-9_.-]/g, "?");
const safeKind = String(actor.kind ?? "actor").replace(/[^A-Za-z0-9_.-]/g, "?");
process.stdout.write(`@${safeHandle} (${safeKind}) on ${url}: saved ${file}, trusted for the AgentTalks plugin; start a new Claude Code session to connect\n`);
if (ignored) process.stdout.write(`added ${NAME} to .gitignore\n`);
