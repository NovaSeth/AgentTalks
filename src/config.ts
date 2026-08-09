/**
 * Konfiguracja i katalog danych.
 *
 * Prototyp mial sciezki wpisane na sztywno ("/home/claude/second-brain/bin/talk",
 * "~/.talk", "~/lowmem-sample.log"), przez co dawal sie uruchomic na dokladnie
 * jednej maszynie jednego uzytkownika. Tutaj wszystko idzie przez ten modul.
 */
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type Config = {
  dataDir: string;
  dbPath: string;
  filesDir: string;
  host: string;
  port: number;
  secret: string;
  trustProxy: boolean;
  allowPublicBind: boolean;
  allowLoopbackWake: boolean;
  maxMessageBytes: number;
  maxFileBytes: number;
  sessionTtlSec: number;
  // Bramka anty-bot na UI (nie na API/MCP): gdy sitePassword ustawione, strona
  // wymaga jednego wspolnego hasla (wlasny ekran, nie przegladarkowy Basic Auth -
  // ten miesza sie z pozniejszym logowaniem do aplikacji), wiec crawler/bot nie
  // dosiegnie tresci. Agenci (token na /api i /mcp) i sciezki publiczne
  // (/install, /robots.txt) sa wolne. Z env, nie z pliku - to poswiadczenie
  // wdrozenia, nie stan aplikacji.
  sitePassword: string;
  // Publiczny adres wystawienia (do linkow w /install), np. https://atalks.monokoda.com
  baseUrl: string;
};

const CONFIG_NAME = "agenttalks.json";
const DB_NAME = "agenttalks.sqlite";

export function inContainer(): boolean {
  return process.env.AGENTTALKS_IN_CONTAINER === "1";
}

export function defaultDataDir(): string {
  const fromEnv = process.env.AGENTTALKS_DATA?.trim();
  if (fromEnv) return fromEnv;
  // /var/lib tylko wtedy, gdy naprawde da sie tam pisac. Sprawdzenie "czy jestem
  // rootem" byloby zle: w kontenerze proces chodzi jako `node` i i tak ma /data.
  const system = "/var/lib/agenttalks";
  try {
    if (existsSync(system) && statSync(system).isDirectory()) {
      accessSync(system, constants.W_OK);
      return system;
    }
  } catch { /* nie istnieje albo nie da sie pisac - katalog uzytkownika */ }
  return join(homedir(), ".local", "share", "agenttalks");
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
  trustProxy: false,
  allowPublicBind: false,
  allowLoopbackWake: false,
  maxMessageBytes: 65536,
  maxFileBytes: 32 * 1024 * 1024,
  sessionTtlSec: 30 * 24 * 3600,
};

/** Zaklada katalog danych, baze i plik konfiguracji. Idempotentne: ponowne wywolanie
 *  NIE nadpisuje sekretu (to wylogowaloby wszystkich ludzi bez powodu). */
export function initData(dataDir: string = defaultDataDir()): Config {
  // 0700 na katalogach: baza zawiera pelna tresc rozmow i hashe hasel, a pliki
  // WAL/SHM dziedzicza prawa z katalogu. Sam config 0600 nie wystarczal.
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dataDir, "files"), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dataDir, 0o700);
    chmodSync(join(dataDir, "files"), 0o700);
  } catch { /* np. wolumen dockera z innym wlascicielem - nie blokujemy startu */ }
  const cfgPath = join(dataDir, CONFIG_NAME);
  if (!existsSync(cfgPath)) {
    const fresh = { ...DEFAULTS, secret: randomBytes(32).toString("hex") };
    writeFileSync(cfgPath, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  }
  return loadConfig(dataDir);
}

/**
 * Haslo bramki: z PLIKU (zalecane), z env, albo z konfiguracji instancji.
 *
 * Powod dla wariantu z plikiem - zgloszenie [37] na #bugs: haslo podane jako
 * zmienna srodowiskowa kontenera widac w `docker inspect`, `docker ps --format`,
 * w /proc/<pid>/environ i w historii powloki tego, kto kontener tworzyl. Czyli
 * trafia do wydrukow diagnostycznych, ktore ludzie wklejaja do zgloszen i czatow.
 * Z plikiem `inspect` pokazuje SCIEZKE, a nie wartosc.
 *
 * Nieczytelny plik NIE jest cicho pomijany: pusta wartosc = OTWARTA bramka, a to
 * jest dokladnie ta awaria, ktorej nikt nie zauwaza (patrz komentarz przy
 * siteGateBlocks). Lepiej nie wstac, niz wstac bez bramki.
 */
function loadSitePassword(stored: Record<string, unknown>): string {
  const file = process.env.AGENTTALKS_SITE_PASSWORD_FILE;
  if (file) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (err) {
      throw new Error(
        `AGENTTALKS_SITE_PASSWORD_FILE wskazuje na ${file}, ktorego nie da sie odczytac ` +
          `(${(err as Error).message}). Odmawiam startu: puste haslo znaczy OTWARTA bramka.`,
      );
    }
    // Plik z hasla konczy sie zwykle znakiem nowej linii - `echo > plik` go dokleja.
    const value = raw.replace(/\r?\n$/, "");
    if (!value) {
      throw new Error(`plik ${file} jest pusty - to wylaczyloby bramke publiczna`);
    }
    return value;
  }
  return String(process.env.AGENTTALKS_SITE_PASSWORD ?? stored.sitePassword ?? "");
}

export function loadConfig(dataDir: string = defaultDataDir()): Config {
  const cfgPath = join(dataDir, CONFIG_NAME);
  let stored: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    stored = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  }
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  // Przyjmujemy typowe zapisy prawdy: "AGENTTALKS_TRUST_PROXY=true" ciche
  // zinterpretowane jako falsz to cookie bez atrybutu Secure na produkcji.
  const bool = (v: unknown, d: boolean) => {
    if (v === undefined || v === null) return d;
    if (typeof v === "boolean") return v;
    return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
  };

  return {
    dataDir,
    dbPath: join(dataDir, DB_NAME),
    filesDir: join(dataDir, "files"),
    host: String(process.env.AGENTTALKS_HOST ?? stored.host ?? DEFAULTS.host),
    port: num(process.env.AGENTTALKS_PORT ?? stored.port, DEFAULTS.port),
    secret: String(stored.secret ?? ""),
    trustProxy: bool(process.env.AGENTTALKS_TRUST_PROXY ?? stored.trustProxy, DEFAULTS.trustProxy),
    allowPublicBind: bool(stored.allowPublicBind, DEFAULTS.allowPublicBind),
    allowLoopbackWake: bool(stored.allowLoopbackWake, DEFAULTS.allowLoopbackWake),
    maxMessageBytes: num(stored.maxMessageBytes, DEFAULTS.maxMessageBytes),
    maxFileBytes: num(stored.maxFileBytes, DEFAULTS.maxFileBytes),
    sessionTtlSec: num(stored.sessionTtlSec, DEFAULTS.sessionTtlSec),
    sitePassword: loadSitePassword(stored),
    baseUrl: String(process.env.AGENTTALKS_BASE_URL ?? stored.baseUrl ?? "").replace(/\/+$/, ""),
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Bramka publicznego bindowania. Uslugi, ktore po instalacji nasluchuja na 0.0.0.0,
 * to najczestszy sposob, w jaki narzedzie wewnetrzne trafia do internetu przez pomylke.
 * W kontenerze bind na 0.0.0.0 jest KONIECZNY (inaczej proxy hosta nie dosiegnie),
 * a publikacja portu i tak jest kontrolowana po stronie Dockera.
 */
export function assertBindAllowed(config: Config, host: string): void {
  if (LOOPBACK.has(host) || inContainer() || config.allowPublicBind) return;
  throw new Error(
    `Odmawiam nasluchiwania na ${host}: to wystawiloby AgentTalks poza te maszyne.\n` +
      `Wlasciwa droga to reverse proxy z TLS przed 127.0.0.1, albo kontener.\n` +
      `Jesli naprawde chcesz bind publiczny, ustaw "allowPublicBind": true w ` +
      `${join(config.dataDir, CONFIG_NAME)}.`,
  );
}
