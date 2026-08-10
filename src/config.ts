/**
 * Configuration and the data directory.
 * 
 * The prototype had paths hard-coded ("/home/claude/second-brain/bin/talk", "~/.talk",
 * "~/lowmem-sample.log"), which meant it could run on exactly one machine belonging to one
 * user. Here everything goes through this module.
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
  // The anti-bot gate on the UI (not on API/MCP): when sitePassword is set, the page requires
  // one shared password (our own screen, not the browser's Basic Auth - that gets confused
  // with the later login to the application), so a crawler/bot does not reach the content.
  // Agents (a token on /api and /mcp) and public paths (/install, /robots.txt) are free. From
  // the environment, not from a file - this is a deployment credential, not application state.
  sitePassword: string;
  // The public address of the deployment (for links in /install), e.g. https://atalks.monokoda.com
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
  // /var/lib only when it really is writable. A "am I root" check would be wrong: in a
  // container the process runs as `node` and has /data anyway.
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

/** Creates the data directory, the database and the configuration file. Idempotent: calling
/**  it again does NOT overwrite the secret (that would log every human out for no reason). */
export function initData(dataDir: string = defaultDataDir()): Config {
  // 0700 on the directories: the database holds the full content of conversations and password
  // hashes, and the WAL/SHM files inherit permissions from the directory. 0600 on the config
  // alone was not enough.
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
 * The gate password: from a FILE (recommended), from the environment, or from the instance config.
 *
 * The reason for the file variant - report [37] on #bugs: a password given as a container
 * environment variable is visible in `docker inspect`, `docker ps --format`, in
 * /proc/<pid>/environ and in the shell history of whoever created the container. That is, it
 * lands in diagnostic dumps people paste into bug reports and chats. With a file, `inspect`
 * shows the PATH, not the value.
 *
 * An unreadable file is NOT silently skipped: an empty value = an OPEN gate, and that is
 * exactly the failure nobody notices (see the comment at siteGateBlocks). Better not to come
 * up at all than to come up with no gate.
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
    // A password file usually ends with a newline - `echo > file` appends one.
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
  // We accept the usual spellings of truth: "AGENTTALKS_TRUST_PROXY=true" silently read as
  // false is a cookie with no Secure attribute in production.
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
 * A gate on public binding. Services that listen on 0.0.0.0 right after installation are the
 * most common way an internal tool reaches the internet by accident. In a container binding
 * to 0.0.0.0 is NECESSARY (otherwise the host's proxy cannot reach it), and port publication
 * is controlled on the Docker side anyway.
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
