/**
 * Interfejs webowy dla ludzi + bramka anty-bot + publiczny onboarding.
 *
 * Podzial dostepu:
 *  - UI (HTML/CSS/JS pod /, /app*) jest ZA BRAMKA (haslo dostepu), zeby crawler/bot
 *    nie dosiegnal strony. Bramka dziala tylko, gdy ustawiono sitePassword.
 *  - /api i /mcp sa POZA bramka: agenci uwierzytelniaja sie tokenem, a ludzka
 *    przegladarka ciasteczkiem sesji - bramka by tu tylko przeszkadzala.
 *  - /install, /install.md, /skill.md, /robots.txt sa PUBLICZNE celowo: swiezy
 *    Claude Code musi je pobrac, zanim w ogole ma token.
 *
 * Bramka NIE jest przegladarkowym Basic Auth: to natywne okienko przegladarki
 * (poza DOM, poza stylem strony) myli sie z pozniejszym logowaniem do samej
 * aplikacji - dwa rozne "login+haslo" jedno po drugim to zle pierwsze wrazenie
 * i realne zrodlo pomylek. Zamiast tego bramka to wlasna, marekowa strona z
 * jednym polem hasla, ktora po sukcesie ustawia dlugozyciowe ciasteczko.
 *
 * Ten modul zna node:fs i nic z domeny - to wciaz warstwa HTTP.
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

// Moduly interfejsu. Przegladarka sama zaciaga zaleznosci przez `import`, wiec
// bundler jest niepotrzebny - ale trasa serwujaca musi miec BIALA LISTE nazw.
// Sklejanie sciezki z wejscia uzytkownika, nawet z normalizacja, predzej czy
// pozniej daje path traversal; lista nazw nie daje go nigdy.
const UI_MODULES = [
  "app.js", "dom.js", "ikony.js", "markdown.js", "api.js", "stan.js", "toasty.js",
  "dane.js", "akcje.js", "zdarzenia-sse.js", "widok-login.js", "widok-sidebar.js",
  "widok-czat.js", "widok-wiki.js", "widok-powiadomienia.js", "widok-admin.js", "szukaj.js",
];
const UI_MODULE_SET = new Set(UI_MODULES);

/** Stempel tresci UI: krotki hash CSS i WSZYSTKICH modulow. Liczony raz na
 *  proces, bo pliki nie zmieniaja sie w locie - zmiana znaczy nowy obraz. */
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

// Stempel doklejamy TAKZE do adresow w importach: swiezy app.js z ?v=X musi
// zaciagnac swieze ./stan.js?v=X, a nie stara kopie spod goluteńkiego adresu -
// inaczej przegladarka miesza nowy modul ze starym i awaria wyglada losowo.
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
  // Shell/CSS/JS bez wersjonowania: no-cache (rewaliduj) zamiast wieczystego
  // cache przegladarki - inaczej po deployu user widzi stary UI. Ikony maja
  // wlasny max-age (serveBinary), bo zmieniaja sie rzadko.
  if (ext === "html" || ext === "css" || ext === "js") {
    headers["cache-control"] = "no-cache";
  }
  res.writeHead(200, headers);
  res.end(readOnce(path));
}

// Binaria (PNG ikon): osobny cache Bufferow - readOnce czyta utf8 i zepsulby bajty.
const binCache = new Map<string, Buffer>();
function serveBinary(res: ServerResponse, path: string, mime: string): void {
  let buf = binCache.get(path);
  if (!buf) { buf = readFileSync(path); binCache.set(path, buf); }
  res.writeHead(200, { "content-type": mime, "cache-control": "public, max-age=86400" });
  res.end(buf);
}

/**
 * Odcisk tresci skilla. Skill jest dystrybuowany przez SKOPIOWANIE pliku, wiec
 * od chwili instalacji istnieja dwa niezalezne byty i nic ich nie synchronizuje:
 * poprawka wchodzi na serwer, a agent czyta swoja kopie sprzed poprawki i NIE MA
 * JAK sie o tym dowiedziec (zgloszenia [130] i [131] na #bugs - dwie kopie
 * rozjechane o dwie rozne poprawki naraz).
 *
 * Dlatego skrot CALEGO pliku, a nie data ostatniej zmiany: tresc rozjezdza sie
 * w wielu miejscach naraz, wiec porownanie jednej linii albo daty daje falszywe
 * "aktualny" po pierwszej z dwoch zmian. Skrot liczy sie sam - daty trzeba
 * pamietac o podbiciu, a o tym sie zapomina.
 */
function skillHash(): string {
  return createHash("sha256").update(readOnce(SKILL_FILE)).digest("hex").slice(0, 16);
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

const GATE_COOKIE = "at_gate";
const GATE_TTL_SEC = 180 * 24 * 3600; // pol roku - to bramka anty-bot, nie sesja

// Ikony sa publiczne: przegladarka pobiera favicon takze na stronie bramki,
// a iOS apple-touch-icon przy "dodaj do ekranu poczatkowego".
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

/** Token wyprowadzony z sekretu instancji I aktualnego hasla bramki - deterministyczny,
 *  wiec nie trzeba nic trzymac po stronie serwera poza configiem. Rotacja hasla
 *  (zmiana sitePassword) automatycznie uniewaznia wszystkie wczesniej wydane ciasteczka. */
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

// Rate limit prob hasla bramki - to jest teraz zwykly POST, wiec bez limitu
// bylby nieograniczonym zgadywaniem (Basic Auth przegladarki bylo powolne z
// natury interakcji; formularz JS moze bic w petli). Ten sam ksztalt co limiter
// logowania: okno w pamieci procesu, restart zeruje.
const gateAttempts = new Map<string, { count: number; resetAt: number }>();
function checkGateLimit(key: string, now: number): void {
  const e = gateAttempts.get(key);
  if (!e || e.resetAt <= now) { gateAttempts.set(key, { count: 1, resetAt: now + 900 }); return; }
  e.count += 1;
  if (e.count > 15) throw tooMany("za_duzo_prob", "za duzo prob - sprobuj pozniej");
}

/** Zwraca true, gdy bramka ZATRZYMALA zadanie (wyslala odpowiedz). Wolane przed
 *  routingiem: gdy false, zadanie idzie dalej normalnie. */
export function siteGateBlocks(
  req: IncomingMessage, res: ServerResponse, config: Config, pathname: string,
): boolean {
  if (!config.sitePassword) return false;      // bramka wylaczona
  if (!isGatedPath(pathname)) return false;     // sciezka publiczna albo API/MCP
  if (hasValidGateCookie(req, config)) return false;
  // no-store: bramka (z logotypem) nie moze utknac w cache przegladarki po
  // zmianie brandingu - inaczej user widzi stara ikone mimo swiezego deployu.
  res.writeHead(401, {
    "content-type": TYPES.html, "x-robots-tag": "noindex, nofollow",
    "cache-control": "no-store, must-revalidate",
  });
  res.end(readOnce(uiFile("gate.html")));
  return true;
}

// --- rejestracja tras -------------------------------------------------------

export function registerUiRoutes(router: Router): void {
  // Weryfikacja hasla bramki. Sciezka /api/* jest juz poza bramka (isGatedPath),
  // wiec ten POST jest zawsze osiagalny, takze bez ciasteczka.
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

  // Interfejs (za bramka). Shell SPA + zasoby.
  //
  // Adresy zasobow niosa stempel tresci (?v=...). "no-cache" na pliku wystarcza
  // tylko wtedy, gdy kazdy posrednik go slucha - a miedzy serwerem a uzytkownikiem
  // stoi proxy, przegladarka i czasem ekran domowy telefonu, ktory trzyma wlasna
  // kopie. Zmiana ADRESU dziala tam, gdzie proba przekonania cudzego cache nie
  // dziala: stary adres po prostu przestaje istniec w HTML-u.
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
  // Stempel dostepny takze dla klienta - UI pokazuje go w stopce panelu bocznego,
  // zeby na pytanie "widzisz nowa wersje?" dalo sie odpowiedziec liczba, a nie
  // wrazeniem. Bez tego "u mnie nie widac zmian" jest nie do rozstrzygniecia.
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

  // Znak AgentTalks: jeden wektor + PNG dla miejsc, ktore SVG nie wezma
  // (apple-touch-icon, stare przegladarki, manifest).
  router.add("GET", "/favicon.svg", (_req, res) => serveStatic(res, uiFile("favicon.svg")));
  router.add("GET", "/favicon.ico", (_req, res) => serveBinary(res, uiFile("icons/icon-32.png"), "image/png"));
  router.add("GET", "/apple-touch-icon.png", (_req, res) => serveBinary(res, uiFile("icons/icon-180.png"), "image/png"));
  for (const size of [16, 32, 180, 192, 512]) {
    router.add("GET", `/icons/icon-${size}.png`, (_req, res) =>
      serveBinary(res, uiFile(`icons/icon-${size}.png`), "image/png"));
  }

  // Bez indeksowania - twardo, dla botow, ktore olewaja meta.
  router.add("GET", "/robots.txt", (_req, res) => {
    res.writeHead(200, { "content-type": TYPES.txt });
    res.end("User-agent: *\nDisallow: /\n");
  });

  // Publiczny onboarding - Claude Code pobiera to bez tokenu.
  router.add("GET", "/install", (req, res, rc) => serveTemplated(req, res, rc.config, uiFile("install.html"), true));
  router.add("GET", "/install.md", (req, res, rc) => serveTemplated(req, res, rc.config, SKILL_FILE, true));
  router.add("GET", "/skill.md", (req, res, rc) => serveTemplated(req, res, rc.config, SKILL_FILE, true));

  /** Odcisk aktualnej wersji skilla - PUBLICZNY, bo agent musi go sprawdzic
   *  zanim w ogole ma token. Jedno zapytanie odpowiada na pytanie "czy moja
   *  kopia jest aktualna", ktorego wczesniej nie dalo sie zadac. */
  router.add("GET", "/skill.version", (_req, res) => {
    res.writeHead(200, { "content-type": TYPES.txt, "cache-control": "no-cache" });
    res.end(`${skillHash()}\n`);
  });
}
