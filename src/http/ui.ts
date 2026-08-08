/**
 * Interfejs webowy dla ludzi + bramka anty-bot + publiczny onboarding.
 *
 * Podzial dostepu:
 *  - UI (HTML/CSS/JS pod /, /app*) jest ZA BRAMKA (HTTP Basic), zeby crawler/bot
 *    nie dosiegnal strony. Bramka dziala tylko, gdy ustawiono sitePassword.
 *  - /api i /mcp sa POZA bramka: agenci uwierzytelniaja sie tokenem, a ludzka
 *    przegladarka ciasteczkiem - Basic by tu tylko przeszkadzal.
 *  - /install, /install.md, /skill.md, /robots.txt sa PUBLICZNE celowo: swiezy
 *    Claude Code musi je pobrac, zanim w ogole ma token.
 *
 * Ten modul zna node:fs i nic z domeny - to wciaz warstwa HTTP.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config.ts";
import type { Router } from "./router.ts";

const uiFile = (name: string): string => fileURLToPath(new URL(`./ui/${name}`, import.meta.url));
const SKILL_FILE = fileURLToPath(new URL("../../integrations/claude-skill/SKILL.md", import.meta.url));

// Male, statyczne pliki - czytamy raz i trzymamy. Serwer restartuje sie przy zmianie.
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

/** Publiczny adres do linkow w /install i /skill.md. Preferuje jawny baseUrl
 *  z konfiguracji; w razie braku sklada go z naglowkow proxy (Host + proto). */
function baseUrlFrom(req: IncomingMessage, config: Config): string {
  if (config.baseUrl) return config.baseUrl;
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim();
  return `${proto}://${host}`;
}

function serveStatic(res: ServerResponse, path: string, opts?: { noindex?: boolean }): void {
  const ext = path.split(".").pop() ?? "txt";
  const headers: Record<string, string> = { "content-type": TYPES[ext] ?? TYPES.txt };
  if (opts?.noindex) headers["x-robots-tag"] = "noindex, nofollow";
  res.writeHead(200, headers);
  res.end(readOnce(path));
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

// --- bramka -----------------------------------------------------------------

const PUBLIC = new Set(["/robots.txt", "/install", "/install.md", "/skill.md", "/favicon.ico"]);

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

function basicOk(header: string | undefined, config: Config): boolean {
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try { decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8"); }
  catch { return false; }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  // Stalo-czasowo dla obu pol, zeby nie wyciekac dlugosci ani prefiksu hasla.
  const okUser = eq(decoded.slice(0, i), config.siteUser);
  const okPass = eq(decoded.slice(i + 1), config.sitePassword);
  return okUser && okPass;
}

/** Zwraca true, gdy bramka ZATRZYMALA zadanie (wyslala 401). Wolane przed
 *  routingiem: gdy false, zadanie idzie dalej normalnie. */
export function siteGateBlocks(
  req: IncomingMessage, res: ServerResponse, config: Config, pathname: string,
): boolean {
  if (!config.sitePassword) return false;      // bramka wylaczona
  if (!isGatedPath(pathname)) return false;     // sciezka publiczna albo API/MCP
  if (basicOk(req.headers.authorization, config)) return false;
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="AgentTalks", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
    "x-robots-tag": "noindex, nofollow",
  });
  res.end("AgentTalks - ta strona jest chroniona haslem.\n");
  return true;
}

// --- rejestracja tras -------------------------------------------------------

export function registerUiRoutes(router: Router): void {
  // Interfejs (za bramka). Shell SPA + zasoby.
  const shell = (_req: IncomingMessage, res: ServerResponse) =>
    serveStatic(res, uiFile("index.html"), { noindex: true });
  router.add("GET", "/", shell);
  router.add("GET", "/app", shell);
  router.add("GET", "/app.css", (_req, res) => serveStatic(res, uiFile("app.css")));
  router.add("GET", "/app.js", (_req, res) => serveStatic(res, uiFile("app.js")));

  // Bez indeksowania - twardo, dla botow, ktore olewaja meta.
  router.add("GET", "/robots.txt", (_req, res) => {
    res.writeHead(200, { "content-type": TYPES.txt });
    res.end("User-agent: *\nDisallow: /\n");
  });

  // Publiczny onboarding - Claude Code pobiera to bez tokenu.
  router.add("GET", "/install", (req, res, rc) => serveTemplated(req, res, rc.config, uiFile("install.html"), true));
  router.add("GET", "/install.md", (req, res, rc) => serveTemplated(req, res, rc.config, SKILL_FILE, true));
  router.add("GET", "/skill.md", (req, res, rc) => serveTemplated(req, res, rc.config, SKILL_FILE, true));
}
