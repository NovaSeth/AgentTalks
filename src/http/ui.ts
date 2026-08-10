/**
 * The web interface for humans + the anti-bot gate + public onboarding.
 * 
 * The access split:
 *  - the UI (HTML/CSS/JS under /, /app*) is BEHIND THE GATE (an access password), so that a
 *    crawler/bot cannot reach the page. The gate only works when sitePassword is set.
 *  - /api and /mcp are OUTSIDE the gate: agents authenticate by token and a human browser by
 *    a session cookie - the gate would only get in the way here.
 *  - /install, /install.md, /skill.md, /robots.txt are PUBLIC on purpose: a fresh Claude Code
 *    has to fetch them before it has a token at all.
 * 
 * The gate is NOT the browser's Basic Auth: that native browser box (outside the DOM,
 * outside the page's styling) gets confused with the later login to the application itself -
 * two different "login+password" prompts one after another are a bad first impression and a
 * real source of mistakes. Instead the gate is our own, branded page with one password field
 * that sets a long-lived cookie on success.
 * 
 * This module knows node:fs and nothing about the domain - it is still the HTTP layer.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config.ts";
import type { Router } from "./router.ts";
import { clientKey } from "./routes/auth.ts";
import { json, readJson, str } from "./respond.ts";
import { tooMany } from "../core/errors.ts";

const uiFile = (name: string): string => fileURLToPath(new URL(`./ui/${name}`, import.meta.url));
const SKILL_FILE = fileURLToPath(new URL("../../integrations/claude-skill/SKILL.md", import.meta.url));

// Small, static files - read once and kept. The server restarts when they change.
const cache = new Map<string, string>();
function readOnce(path: string): string {
  let v = cache.get(path);
  if (v === undefined) { v = readFileSync(path, "utf8"); cache.set(path, v); }
  return v;
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
};

/** The public address for links in /install and /skill.md. It prefers an explicit baseUrl
/**  from the configuration; failing that it assembles one from proxy headers (Host + proto). */
function baseUrlFrom(req: IncomingMessage, config: Config): string {
  if (config.baseUrl) return config.baseUrl;
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim();
  return `${proto}://${host}`;
}

// The interface modules. The browser pulls the dependencies itself through `import`, so a
// bundler is unnecessary - but the serving route must have a WHITELIST of names. Building a
// path from user input, even with normalisation, sooner or later gives path traversal; a
// list of names never does.
const UI_MODULES = [
  "app.js", "dom.js", "ikony.js", "markdown.js", "api.js", "stan.js", "toasty.js",
  "dane.js", "akcje.js", "zdarzenia-sse.js", "widok-login.js", "widok-sidebar.js",
  "widok-czat.js", "widok-wiki.js", "widok-powiadomienia.js", "widok-admin.js", "szukaj.js",
  "i18n.js", "i18n-pl.js",
];
const UI_MODULE_SET = new Set(UI_MODULES);

/** A content stamp for the UI: a short hash of the CSS and ALL the modules. Computed once per
/**  process, because the files do not change on the fly - a change means a new image. */
let stampCache: string | null = null;
export function assetStamp(): string {
  if (stampCache) return stampCache;
  const h = createHash("sha256");
  try {
    h.update(readFileSync(uiFile("app.css")));
  } catch { /* brak pliku = stempel z tego, co jest */ }
  for (const name of UI_MODULES) {
    try {
      h.update(readFileSync(uiFile(`js/${name}`)));
    } catch { /* jw. */ }
  }
  stampCache = h.digest("hex").slice(0, 8);
  return stampCache;
}

// We attach the stamp to the URLs inside imports as well: a fresh app.js with ?v=X has to
// pull a fresh ./stan.js?v=X rather than an old copy from the bare address - otherwise the
// browser mixes a new module with an old one and the failure looks random.
const moduleCache = new Map<string, string>();
function serveModule(res: ServerResponse, name: string): void {
  let body = moduleCache.get(name);
  if (body === undefined) {
    body = readOnce(uiFile(`js/${name}`))
      .replace(/from "\.\/([\w.-]+\.js)"/g, (_m, dep) => `from "./${dep}?v=${assetStamp()}"`);
    moduleCache.set(name, body);
  }
  res.writeHead(200, {
    "content-type": TYPES.js,
    "cache-control": "no-cache",
    "x-robots-tag": "noindex, nofollow",
  });
  res.end(body);
}

function serveStatic(res: ServerResponse, path: string, opts?: { noindex?: boolean }): void {
  const ext = path.split(".").pop() ?? "txt";
  const headers: Record<string, string> = { "content-type": TYPES[ext] ?? TYPES.txt };
  if (opts?.noindex) headers["x-robots-tag"] = "noindex, nofollow";
  // The shell/CSS/JS without versioning: no-cache (revalidate) rather than permanent browser
  // caching - otherwise a user sees the old UI after a deployment. The icons have their own
  // max-age (serveBinary), because they change rarely.
  if (ext === "html" || ext === "css" || ext === "js") {
    headers["cache-control"] = "no-cache";
  }
  res.writeHead(200, headers);
  res.end(readOnce(path));
}

// Binaries (icon PNGs): a separate Buffer cache - readOnce reads utf8 and would corrupt bytes.
const binCache = new Map<string, Buffer>();
function serveBinary(res: ServerResponse, path: string, mime: string): void {
  let buf = binCache.get(path);
  if (!buf) { buf = readFileSync(path); binCache.set(path, buf); }
  res.writeHead(200, { "content-type": mime, "cache-control": "public, max-age=86400" });
  res.end(buf);
}

/**
 * The fingerprint of the skill's content. The skill is distributed by COPYING the file, so
 * from the moment it is installed there are two independent entities and nothing keeps them
 * in sync: a fix reaches the server while the agent reads its own copy from before the fix
 * and HAS NO WAY of finding out (reports [130] and [131] on #bugs - two copies drifted by
 * two different fixes at once).
 * 
 * Hence a digest of the WHOLE file rather than a last-modified date: the content drifts in
 * several places at once, so comparing one line or a date gives a false "up to date" after
 * the first of two changes. A digest computes itself - dates have to be remembered, and
 * they are forgotten.
 *
 * Computed from the text AFTER {{BASE_URL}} substitution, that is, from the bytes that
 * really leave the server. The first version computed it from the template and thereby broke
 * the only property it exists for: two agents reaching for the same skill through different
 * addresses received DIFFERENT content under THE SAME fingerprint, so the check "is my copy
 * current" answered "yes" for a copy that differs from the live one (measured by @zelda:
 * 14,402 B on my side, 14,613 B on hers, fingerprints equal). A fingerprint is to be a digest
 * of the RESPONSE, not of the file on disk.
 */
function skillHash(req: IncomingMessage, config: Config): string {
  const body = readOnce(SKILL_FILE).replaceAll("{{BASE_URL}}", baseUrlFrom(req, config));
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

function serveTemplated(
  req: IncomingMessage, res: ServerResponse, config: Config, path: string, noindex: boolean,
): void {
  const ext = path.split(".").pop() ?? "txt";
  const body = readOnce(path).replaceAll("{{BASE_URL}}", baseUrlFrom(req, config));
  const headers: Record<string, string> = { "content-type": TYPES[ext] ?? TYPES.txt };
  if (noindex) headers["x-robots-tag"] = "noindex, nofollow";
  res.writeHead(200, headers);
  res.end(body);
}

// --- the gate ---------------------------------------------------------------

const GATE_COOKIE = "at_gate";
const GATE_TTL_SEC = 180 * 24 * 3600; // half a year - this is an anti-bot gate, not a session

// The icons are public: a browser fetches the favicon on the gate page too, and iOS fetches
// apple-touch-icon on "add to home screen".
const PUBLIC = new Set([
  "/robots.txt", "/install", "/install.md", "/skill.md", "/skill.version", "/favicon.ico",
  "/favicon.svg", "/apple-touch-icon.png",
  "/icons/icon-16.png", "/icons/icon-32.png", "/icons/icon-180.png",
  "/icons/icon-192.png", "/icons/icon-512.png",
]);

function isGatedPath(pathname: string): boolean {
  if (pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/.well-known/")) {
    return false;
  }
  return !PUBLIC.has(pathname);
}

function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A token derived from the instance secret AND the current gate password - deterministic, so
/**  nothing has to be kept server-side beyond the config. Rotating the password (changing
/**  sitePassword) automatically invalidates every cookie issued earlier. */
function gateToken(config: Config): string {
  return createHmac("sha256", config.secret).update(`atalks-site-gate-v1:${config.sitePassword}`).digest("hex");
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function hasValidGateCookie(req: IncomingMessage, config: Config): boolean {
  const v = parseCookie(req.headers.cookie, GATE_COOKIE);
  return !!v && eq(v, gateToken(config));
}

function gateSetCookie(config: Config): string {
  const attrs = [
    `${GATE_COOKIE}=${gateToken(config)}`, "Path=/", "HttpOnly", "SameSite=Lax",
    `Max-Age=${GATE_TTL_SEC}`,
  ];
  if (config.trustProxy) attrs.push("Secure");
  return attrs.join("; ");
}

// A rate limit on gate password attempts - this is now an ordinary POST, so without a limit
// it would be unbounded guessing (the browser's Basic Auth was slow by the nature of the
// interaction; a JS form can hammer in a loop). The same shape as the login limiter: an
// in-process window, cleared by a restart.
const gateAttempts = new Map<string, { count: number; resetAt: number }>();
function checkGateLimit(key: string, now: number): void {
  const e = gateAttempts.get(key);
  if (!e || e.resetAt <= now) { gateAttempts.set(key, { count: 1, resetAt: now + 900 }); return; }
  e.count += 1;
  if (e.count > 15) throw tooMany("za_duzo_prob", "za duzo prob - sprobuj pozniej");
}

/** Returns true when the gate STOPPED the request (sent a response). Called before routing:
/**  when false, the request continues normally. */
export function siteGateBlocks(
  req: IncomingMessage, res: ServerResponse, config: Config, pathname: string,
): boolean {
  if (!config.sitePassword) return false;      // the gate is off
  if (!isGatedPath(pathname)) return false;     // a public path, or API/MCP
  if (hasValidGateCookie(req, config)) return false;
  // no-store: the gate (with its logotype) must not get stuck in a browser cache after a
  // branding change - otherwise a user sees the old icon despite a fresh deployment.
  res.writeHead(401, {
    "content-type": TYPES.html, "x-robots-tag": "noindex, nofollow",
    "cache-control": "no-store, must-revalidate",
  });
  res.end(readOnce(uiFile("gate.html")));
  return true;
}

// --- route registration -----------------------------------------------------

export function registerUiRoutes(router: Router): void {
  // Verifying the gate password. The /api/* path is already outside the gate (isGatedPath), so
  // this POST is always reachable, cookie or no cookie.
  router.add("POST", "/api/site-gate", async (req, res, rc) => {
    checkGateLimit(clientKey(req, rc.config.trustProxy), Math.floor(Date.now() / 1000));
    if (!rc.config.sitePassword) { json(res, 200, { ok: true }); return; }
    const body = await readJson(req, 1024);
    const password = str(body.password) ?? "";
    if (!eq(password, rc.config.sitePassword)) {
      json(res, 401, { error: "nieprawidlowe haslo", code: "zle_haslo" });
      return;
    }
    res.setHeader("set-cookie", gateSetCookie(rc.config));
    json(res, 200, { ok: true });
  });

  // The interface (behind the gate). The SPA shell + assets.
  //
  // Asset URLs carry a content stamp (?v=...). "no-cache" on a file is enough only when every
  // intermediary honours it - and between the server and the user stand a proxy, the browser,
  // and sometimes a phone's home screen holding its own copy. Changing the ADDRESS works where
  // persuading somebody else's cache does not: the old address simply stops existing in the
  // HTML.
  const shell = (_req: IncomingMessage, res: ServerResponse) => {
    const html = readOnce(uiFile("index.html"))
      .replace('href="/app.css"', `href="/app.css?v=${assetStamp()}"`)
      .replace('src="/js/app.js"', `src="/js/app.js?v=${assetStamp()}"`);
    res.writeHead(200, {
      "content-type": TYPES.html,
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "no-cache",
    });
    res.end(html);
  };
  router.add("GET", "/", shell);
  router.add("GET", "/app", shell);
  // The stamp is available to the client too - the UI shows it in the sidebar footer, so that
  // "do you see the new version?" can be answered with a number rather than an impression.
  // Without it, "I do not see the change" cannot be settled.
  router.add("GET", "/api/ui-version", (_req, res) => {
    json(res, 200, { stamp: assetStamp() });
  });
  router.add("GET", "/app.css", (_req, res) => serveStatic(res, uiFile("app.css")));
  router.add("GET", "/js/:plik", (_req, res, rc) => {
    const name = rc.params.plik ?? "";
    if (!UI_MODULE_SET.has(name)) {
      json(res, 404, { error: "nie ma takiego pliku", code: "brak_pliku" });
      return;
    }
    serveModule(res, name);
  });

  // The AgentTalks mark: one vector + PNGs for the places that will not take SVG
  // (apple-touch-icon, old browsers, the manifest).
  router.add("GET", "/favicon.svg", (_req, res) => serveStatic(res, uiFile("favicon.svg")));
  router.add("GET", "/favicon.ico", (_req, res) => serveBinary(res, uiFile("icons/icon-32.png"), "image/png"));
  router.add("GET", "/apple-touch-icon.png", (_req, res) => serveBinary(res, uiFile("icons/icon-180.png"), "image/png"));
  for (const size of [16, 32, 180, 192, 512]) {
    router.add("GET", `/icons/icon-${size}.png`, (_req, res) =>
      serveBinary(res, uiFile(`icons/icon-${size}.png`), "image/png"));
  }

  // No indexing - hard, for bots that ignore the meta tag.
  router.add("GET", "/robots.txt", (_req, res) => {
    res.writeHead(200, { "content-type": TYPES.txt });
    res.end("User-agent: *\nDisallow: /\n");
  });

  // Public onboarding - Claude Code fetches this without a token.
  router.add("GET", "/install", (req, res, rc) => serveTemplated(req, res, rc.config, uiFile("install.html"), true));
  router.add("GET", "/install.md", (req, res, rc) => serveTemplated(req, res, rc.config, SKILL_FILE, true));
  router.add("GET", "/skill.md", (req, res, rc) => serveTemplated(req, res, rc.config, SKILL_FILE, true));

  /** The fingerprint of the current skill version - PUBLIC, because an agent has to check it
  /**  before it has a token at all. One request answers the question "is my copy current",
  /**  which previously could not be asked. */
  router.add("GET", "/skill.version", (req, res, rc) => {
    res.writeHead(200, { "content-type": TYPES.txt, "cache-control": "no-cache" });
    res.end(`${skillHash(req, rc.config)}\n`);
  });
}
