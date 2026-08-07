/**
 * Konfiguracja i katalog danych.
 *
 * Prototyp mial sciezki wpisane na sztywno ("/home/claude/second-brain/bin/talk",
 * "~/.talk", "~/lowmem-sample.log"), przez co dawal sie uruchomic na dokladnie
 * jednej maszynie jednego uzytkownika. Tutaj wszystko idzie przez ten modul.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  maxMessageBytes: number;
  maxFileBytes: number;
  sessionTtlSec: number;
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
    if (existsSync(system) && statSync(system).isDirectory()) return system;
  } catch { /* brak dostepu - schodzimy do katalogu uzytkownika */ }
  return join(homedir(), ".local", "share", "agenttalks");
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
  trustProxy: false,
  allowPublicBind: false,
  maxMessageBytes: 65536,
  maxFileBytes: 32 * 1024 * 1024,
  sessionTtlSec: 30 * 24 * 3600,
};

/** Zaklada katalog danych, baze i plik konfiguracji. Idempotentne: ponowne wywolanie
 *  NIE nadpisuje sekretu (to wylogowaloby wszystkich ludzi bez powodu). */
export function initData(dataDir: string = defaultDataDir()): Config {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "files"), { recursive: true });
  const cfgPath = join(dataDir, CONFIG_NAME);
  if (!existsSync(cfgPath)) {
    const fresh = { ...DEFAULTS, secret: randomBytes(32).toString("hex") };
    writeFileSync(cfgPath, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  }
  return loadConfig(dataDir);
}

export function loadConfig(dataDir: string = defaultDataDir()): Config {
  const cfgPath = join(dataDir, CONFIG_NAME);
  let stored: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    stored = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  }
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const bool = (v: unknown, d: boolean) => (v === undefined ? d : v === true || v === "1");

  return {
    dataDir,
    dbPath: join(dataDir, DB_NAME),
    filesDir: join(dataDir, "files"),
    host: String(process.env.AGENTTALKS_HOST ?? stored.host ?? DEFAULTS.host),
    port: num(process.env.AGENTTALKS_PORT ?? stored.port, DEFAULTS.port),
    secret: String(stored.secret ?? ""),
    trustProxy: bool(process.env.AGENTTALKS_TRUST_PROXY ?? stored.trustProxy, DEFAULTS.trustProxy),
    allowPublicBind: bool(stored.allowPublicBind, DEFAULTS.allowPublicBind),
    maxMessageBytes: num(stored.maxMessageBytes, DEFAULTS.maxMessageBytes),
    maxFileBytes: num(stored.maxFileBytes, DEFAULTS.maxFileBytes),
    sessionTtlSec: num(stored.sessionTtlSec, DEFAULTS.sessionTtlSec),
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
