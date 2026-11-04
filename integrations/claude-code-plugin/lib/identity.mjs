// @ts-check
/**
 * Where the plugin finds its server URL and token: the same order as `atalk`
 * (src/cli/atalk.ts loadClientConfig), so "this directory = this agent" holds for the
 * channel server, the monitor and the hooks alike.
 *
 *   0. the plugin options (channel server only): AGENTTALKS_PLUGIN_URL / AGENTTALKS_PLUGIN_TOKEN,
 *      which plugin.json fills from `${user_config.url}` / `${user_config.token}`. They have
 *      their OWN names: an option left empty is substituted as "", and under the shared names
 *      that "" would overwrite the AGENTTALKS_* the session inherited before this code ran.
 *   1. AGENTTALKS_URL / AGENTTALKS_TOKEN (ATALKS_* aliases). An EMPTY value counts as unset.
 *   2. the nearest `.agenttalks.json`, walking up from the session's cwd - ONLY when the user
 *      vouched for it with `atalk login --local` (isTrustedProject). A cloned repository can
 *      ship one with its own token and url, which would attach the agent's live channel to a
 *      foreign server; an untrusted project file that would supply the token or the url makes
 *      resolveIdentity return null and report untrustedProjectNotice (stricter than atalk,
 *      which only refuses a mixed identity),
 *   3. `~/.config/agenttalks/atalk.json`.
 *
 * The token is returned to the caller and goes into an Authorization header only. Nothing
 * here prints it, and the plugin never writes it to a new place.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_URL = "http://127.0.0.1:8787";
const LOCAL_CONFIG_NAME = ".agenttalks.json";

/** @typedef {{ url: string, token: string, source: "env" | "project" | "global" }} Identity */

/** @param {Record<string, string | undefined>} env @param {string[]} names */
function firstSet(env, names) {
  for (const n of names) {
    const v = env[n];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

/** The nearest project file from `cwd` upwards, or null. @param {string} cwd */
export function findLocalConfig(cwd) {
  let dir;
  try { dir = realpathSync(cwd); } catch { dir = cwd; }
  for (let i = 0; i < 64; i++) {
    const candidate = join(dir, LOCAL_CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** @param {string} path @returns {{ url?: unknown, token?: unknown } | null} */
function readJson(path) {
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    return v && typeof v === "object" ? v : null;
  } catch {
    // A corrupt file must not block the remaining sources (the same rule as atalk).
    return null;
  }
}

/**
 * Whether the user vouched for this project file with `atalk login --local`: the trust list
 * (`trusted-projects.json` in AGENTTALKS_CONFIG_DIR, else ~/.config/agenttalks) names its
 * real path and the SHA-256 of its content. The same rule as atalk (src/cli/atalk.ts): a
 * marker inside the file proves nothing, since whoever wrote the file could write the marker.
 * @param {string} path @param {Record<string, string | undefined>} env @param {string} home
 */
export function isTrustedProject(path, env, home) {
  let real, sha;
  try {
    real = realpathSync(path);
    sha = createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return false;
  }
  const dir = firstSet(env, ["AGENTTALKS_CONFIG_DIR"]) ?? join(home, ".config", "agenttalks");
  const list = /** @type {any} */ (readJson(join(dir, "trusted-projects.json")));
  return Array.isArray(list?.projects)
    && list.projects.some((/** @type {any} */ e) => e?.path === real && e?.sha256 === sha);
}

/**
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, home?: string,
 *   report?: (reason: string) => void }} [opts]
 * @returns {Identity | null}
 */
export function resolveIdentity(opts = {}) {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const report = opts.report ?? (() => {});
  const envUrl = firstSet(env, ["AGENTTALKS_PLUGIN_URL", "AGENTTALKS_URL", "ATALKS_URL"]);
  const envToken = firstSet(env, ["AGENTTALKS_PLUGIN_TOKEN", "AGENTTALKS_TOKEN", "ATALKS_TOKEN"]);

  /** @type {{ url?: unknown, token?: unknown } | null} */
  let stored = null;
  /** @type {"project" | "global"} */
  let storedSource = "global";
  /** @type {string | null} */
  let storedPath = null;
  const local = findLocalConfig(cwd);
  for (const [path, src] of /** @type {Array<[string | null, "project" | "global"]>} */ ([
    [local, "project"],
    [join(home, ".config", "agenttalks", "atalk.json"), "global"],
  ])) {
    if (!path || !existsSync(path)) continue;
    const v = readJson(path);
    if (v) { stored = v; storedSource = src; storedPath = path; break; }
  }
  const storedToken = typeof stored?.token === "string" && stored.token.trim() !== ""
    ? stored.token.trim() : undefined;
  const storedUrl = typeof stored?.url === "string" && stored.url.trim() !== ""
    ? stored.url.trim() : undefined;

  const token = envToken ?? storedToken;
  if (!token) return null;
  // Fail closed: a project file nobody vouched for (a cloned repository, say) supplies
  // nothing - neither the server nor the token. An identity wholly from the environment (or
  // the plugin options) does not use the file, and the global file is not a project file.
  const usesProject = storedSource === "project" && storedPath
    && ((!envToken && storedToken) || (!envUrl && storedUrl));
  if (usesProject && storedPath && !isTrustedProject(storedPath, env, home)) {
    report(untrustedProjectNotice(storedPath));
    return null;
  }
  const url = (envUrl ?? storedUrl ?? DEFAULT_URL).replace(/\/+$/, "");
  return { url, token, source: envToken ? "env" : storedSource };
}

/** A log-safe description: never the token. @param {Identity | null} id */
export function describeIdentity(id) {
  return id ? `${id.url} (token from ${id.source})` : "no AgentTalks identity found";
}

/** The plugin's own login script, as an absolute path from where THIS module is installed
 *  (installation-controlled; the repository being opened has no say in it). */
const LOGIN_SCRIPT = fileURLToPath(new URL("../scripts/login.mjs", import.meta.url));

/** Shown in MODEL context (the SessionStart hook's additionalContext): a fixed sentence with
 *  no path of the PROJECT, because a cloned repository controls its own path (a directory
 *  name can hold newlines or text that looks like an instruction). The only path in it is
 *  the plugin's login script. */
export const UNTRUSTED_PROJECT_CONTEXT = "This project's .agenttalks.json is not trusted, so AgentTalks is not connected. "
  + "If you hold the agent's token, run `atalk login --local --url <server> --token -` in the project directory "
  + `or, without atalk, \`node ${LOGIN_SCRIPT} --url <server> --token -\` there, and pipe the token on stdin.`;

/** The one line the entry points print on STDERR (never model context) when a project file
 *  they would use is not trusted: the fixed sentence, then the file's path as one quoted
 *  JSON string with control and line-separator characters replaced, so a crafted directory
 *  name cannot add a line of its own.
 *  @param {string} path */
export function untrustedProjectNotice(path) {
  const safe = (/** @type {string} */ s) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?");
  return `${UNTRUSTED_PROJECT_CONTEXT} File: ${JSON.stringify(safe(path))}`;
}

/**
 * A server URL in one comparable form: scheme and host lowercased, the default port dropped
 * (the URL parser does both), the path kept without trailing slashes (two servers can share
 * an origin under different paths), query and fragment dropped. null for anything that is
 * not an absolute http(s) URL.
 * @param {unknown} url @returns {string | null}
 */
export function normalizeUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/**
 * The principal a woken run must act as (codex T-MG-14 r1 F1): the wake bridge verified it
 * and names it in AGENTTALKS_EXPECT_SERVER_URL / AGENTTALKS_EXPECT_ACTOR (not secrets).
 * Claude Code substitutes the plugin options into the channel server's env at launch, which
 * the bridge cannot scrub, so every entry point checks its own resolved identity against
 * this. null when neither is set (an ordinary session). Either one set makes it binding; a
 * missing or invalid half never matches.
 * @param {Record<string, string | undefined>} env
 * @returns {{ serverUrl: string | null, actor: string | null } | null}
 */
export function expectedPrincipal(env) {
  const url = firstSet(env, ["AGENTTALKS_EXPECT_SERVER_URL"]);
  const actor = firstSet(env, ["AGENTTALKS_EXPECT_ACTOR"]);
  if (url === undefined && actor === undefined) return null;
  return { serverUrl: normalizeUrl(url), actor: actor ?? null };
}

/**
 * Null when `identity` (and, once known, the token's actor `handle`) is the expected
 * principal; else ONE line saying why the entry point does not connect.
 * @param {Identity | null} identity
 * @param {{ serverUrl: string | null, actor: string | null }} expect
 * @param {string} [handle]
 */
export function principalProblem(identity, expect, handle) {
  const who = `@${String(expect.actor ?? "?").replace(/[^A-Za-z0-9_.-]/g, "?")}`;
  const where = expect.serverUrl ?? "an invalid server URL";
  const lead = `AgentTalks is not connected: this run was woken for ${who} on ${where}, but`;
  if (!expect.serverUrl || !expect.actor) return `${lead} the expectation is incomplete.`;
  if (!identity) return `${lead} no AgentTalks identity resolves here.`;
  if (normalizeUrl(identity.url) !== expect.serverUrl) return `${lead} the identity here is for another server.`;
  if (handle !== undefined && handle !== expect.actor) return `${lead} the identity here is another actor.`;
  return null;
}
