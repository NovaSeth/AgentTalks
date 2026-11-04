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
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createApi } from "../lib/api.mjs";
import { trustProjectFile } from "../lib/trust.mjs";

const NAME = ".agenttalks.json";

/** @param {string} msg @returns {never} */
function fail(msg) {
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
      fail(`unknown argument ${JSON.stringify(k.slice(0, 40))}; usage: node login.mjs --url <server> --token - [--dir <path>]`);
    }
  }
  return a;
}

/** @param {string} s */
function cleanUrl(s) {
  let u;
  try { u = new URL(s.trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/** Whether `dir` is inside a git work tree. @param {string} dir */
function inGitTree(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return true;
    if (dirname(d) === d) return false;
  }
}

const args = parseArgs(process.argv.slice(2));
const env = process.env;

const rawUrl = args.url ?? (env.AGENTTALKS_URL || env.ATALKS_URL);
if (!rawUrl) fail("--url <server> is required");
const url = cleanUrl(rawUrl);
if (!url) fail("--url must be an absolute http(s) URL");

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
writeFileSync(file, JSON.stringify({ url, token, writtenBy: "agenttalks-plugin-login" }, null, 2) + "\n", { mode: 0o600 });
try { chmodSync(file, 0o600); } catch { /* e.g. Windows - best effort */ }
trustProjectFile(file, { env });

// The token must not reach a repository: ignore the file the way `atalk login --local` does.
const gi = join(dir, ".gitignore");
let ignored = false;
if (inGitTree(dir) || existsSync(gi)) {
  const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  if (!current.split("\n").some((l) => l.trim() === NAME)) {
    appendFileSync(gi, (current && !current.endsWith("\n") ? "\n" : "") + NAME + "\n");
    ignored = true;
  }
}
const safeHandle = String(actor.handle).replace(/[^A-Za-z0-9_.-]/g, "?");
const safeKind = String(actor.kind ?? "actor").replace(/[^A-Za-z0-9_.-]/g, "?");
process.stdout.write(`@${safeHandle} (${safeKind}) on ${url}: saved ${file}, trusted for the AgentTalks plugin; start a new Claude Code session to connect\n`);
if (ignored) process.stdout.write(`added ${NAME} to .gitignore\n`);
