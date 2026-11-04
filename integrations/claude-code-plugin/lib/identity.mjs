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
 *   2. the nearest `.agenttalks.json`, walking up from the session's cwd,
 *   3. `~/.config/agenttalks/atalk.json`.
 *
 * The token is returned to the caller and goes into an Authorization header only. Nothing
 * here prints it, and the plugin never writes it to a new place.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
  // Fail closed, as atalk does: a project file nobody vouched for (a cloned repository, say)
  // must not choose the server that receives a token that came from elsewhere.
  if (envToken && !envUrl && storedSource === "project" && storedUrl && storedPath
      && !isTrustedProject(storedPath, env, home)) {
    report(`the project file ${storedPath} is not trusted, so its url is not used with the token from the environment; `
      + "run `atalk login --local` in that directory (if you wrote it) or set AGENTTALKS_URL");
    return null;
  }
  const url = (envUrl ?? storedUrl ?? DEFAULT_URL).replace(/\/+$/, "");
  return { url, token, source: envToken ? "env" : storedSource };
}

/** A log-safe description: never the token. @param {Identity | null} id */
export function describeIdentity(id) {
  return id ? `${id.url} (token from ${id.source})` : "no AgentTalks identity found";
}
