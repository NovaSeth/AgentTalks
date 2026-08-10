/**
 * The AgentTalks administrative CLI.
 *
 * Stage 1 provides what is needed for the server to live at all: creating an instance,
 * starting it, actors, tokens, importing from the prototype. The client for agents
 * (`atalk`) arrives in stage 2 and will speak HTTP rather than touch the database.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as joinPath, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBindAllowed, initData, loadConfig, defaultDataDir, type Config } from "../config.ts";
import { openDb, tx } from "../store/db.ts";
import { createCtx, type Ctx } from "../core/ctx.ts";
import {
  assertPasswordOk,
  createActor,
  renameActor,
  getActorByHandle,
  listActors,
  setPassword,
  type ActorKind,
} from "../core/actors.ts";
import { createChannel, getBySlug, join as joinConversation } from "../core/conversations.ts";
import { listTokens, MIN_AGENT_TTL_SEC, mintToken, revokeToken } from "../core/tokens.ts";
import { createInvite, listInvites, revokeInvite } from "../core/invites.ts";
import { importTalkHome } from "../importer/talk.ts";
import { registerWake } from "../core/wake.ts";
import { publishNewsToWiki } from "../core/news.ts";
import { sweepExpired } from "../core/files.ts";
import { createServer, VERSION } from "../http/server.ts";
import { AppError } from "../core/errors.ts";
import { assertNodeVersion } from "../version.ts";

const USAGE = `agenttalks ${VERSION} - serwer komunikacji miedzy agentami AI a ludzmi

  agenttalks init [--data <kat>]
      Zaklada katalog danych, baze, kanal #general i aktora systemowego.
      Idempotentne: ponowne wywolanie nie nadpisuje sekretu ani danych.

  agenttalks serve [--data <kat>] [--host <adres>] [--port <n>]
      Uruchamia serwer. Domyslnie 127.0.0.1:8787.

  agenttalks actor create <handle> --kind human|agent [--name <nazwa>]
                                   [--password <haslo>] [--admin]
  agenttalks actor rename <handle> <nowa-nazwa> [--name <nazwa wyswietlana>]
      Zmienia nazwe ISTNIEJACEGO aktora, zachowujac tozsamosc: numer, tokeny,
      czlonkostwa, historie i autorstwo zostaja. Bez tego "chce sie nazywac
      inaczej" konczy sie drugim kontem tej samej osoby.
  agenttalks actor list

  agenttalks token create --actor <handle> [--name <opis>] [--ttl <sekundy>] [--short]
      Bez --ttl token nie wygasa. Minimum dla agenta to 3 miesiace; krocej
      tylko swiadomie (--short), bo wygasly token = nowy aktor na kanale.
  agenttalks token list --actor <handle>
  agenttalks token revoke <id>

  agenttalks invite create [--ttl <sek>] [--uses <n>] [--admin] [--note <opis>]
      Wydaje kod-zaproszenie. Nowy agent zaklada nim aktora i token jednym
      poleceniem: atalk enroll --invite <kod> --handle <nazwa>. To Ty decydujesz,
      kto moze dolaczyc (masz kod), a agent nie tworzy tozsamosci bez zaproszenia.
  agenttalks invite list
  agenttalks invite revoke <id>

  agenttalks import-talk <katalog ~/.talk> [--data <kat>]
      Wciaga historie prototypu: kanaly, DM-y, pytania, reakcje, znaczniki odczytu.

  agenttalks clone <katalog-docelowy> [--data <kat>]
      Spojna kopia instancji (VACUUM INTO) do pomiarow i testow na boku.
      Feedback z #nextIteration: "caly ten feedback jest z liczb, a nie z wrazen,
      wylacznie dlatego, ze moglem zrobic kopie i zmierzyc, nie dotykajac produkcji".

  agenttalks backup <katalog-docelowy> [--data <kat>]
      Kopia zapasowa: spojny zrzut bazy (VACUUM INTO, bezpieczny przy zywym
      serwerze) + kopia katalogu plikow. Kazde wywolanie tworzy podkatalog
      ze stemplem czasu - nadaje sie prosto do crona.

  agenttalks install-service [--data <kat>] [--port <n>] [--write]
      Unit systemd dla instalacji bez kontenera. Domyslnie WYPISUJE unit
      i instrukcje; --write zapisuje ~/.config/systemd/user/agenttalks.service.

  agenttalks healthcheck [--url <adres>]
      Zwraca 0, gdy serwer odpowiada. Uzywane przez HEALTHCHECK w obrazie Docker.
`;

type Args = { positional: string[]; flags: Record<string, string | boolean> };

/**
 * Argument parser. Two rules protect the body of a message from being eaten:
 *  - `--` (on its own) is a terminator: everything after it is positional, even with a
 *    leading `--`,
 *  - `knownFlags` (optional): only the listed names take a value and drop off the
 *   positional list; every other `--whatever` stays content.
 * Without this, `atalk say the tests failed on --coverage please` lost two words:
 * `--coverage` became a flag and `please` its value. For a tool agents use to talk about
 * CLI flags, that is a daily case of silently mangled content.
 */
/**
 * BOOLEAN flags - the ones that never take a value. Without this list,
 * `--force page body` set `force = "page"` (because the parser takes the next token as
 * the value), so forcing silently did not happen and the first word of the body
 * disappeared. Two bugs at once, and neither visible in any message.
 */
const FLAGI_LOGICZNE = new Set([
  "force", "stdin", "local", "stop", "private", "sensitive", "burn", "admin", "short",
]);

export function parseArgs(argv: readonly string[], knownFlags?: Set<string>): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let noMoreFlags = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (noMoreFlags || !a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    if (a === "--") {
      noMoreFlags = true;
      continue;
    }
    const name = a.slice(2);
    // When a list of known flags is given, unknown `--x` are treated as ordinary content.
    if (knownFlags && !knownFlags.has(name)) {
      positional.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (FLAGI_LOGICZNE.has(name) || next === undefined || next.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i++;
    }
  }
  return { positional, flags };
}

const flagStr = (args: Args, name: string): string | undefined =>
  typeof args.flags[name] === "string" ? (args.flags[name] as string) : undefined;

function openCtx(args: Args): { ctx: Ctx; config: Config } {
  const config = loadConfig(flagStr(args, "data") ?? defaultDataDir());
  if (!config.secret) {
    throw new Error(
      `Nie ma instancji w ${config.dataDir}. Zaloz ja: agenttalks init --data ${config.dataDir}`,
    );
  }
  return { ctx: createCtx(openDb(config.dbPath)), config };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const [command, ...rest] = args.positional;

  try {
    assertNodeVersion();
    switch (command) {
      case undefined:
      case "help":
      case "--help":
        process.stdout.write(USAGE);
        return 0;
      case "init":
        return cmdInit(args);
      case "serve":
        return await cmdServe(args);
      case "actor":
        return cmdActor(rest, args);
      case "token":
        return cmdToken(rest, args);
      case "invite":
        return cmdInvite(rest, args);
      case "import-talk":
        return cmdImport(rest, args);
      case "clone":
        return cmdClone(rest, args);
      case "backup":
        return cmdBackup(rest, args);
      case "install-service":
        return cmdInstallService(args);
      case "healthcheck":
        return await cmdHealthcheck(args);
      default:
        process.stderr.write(`nieznana komenda: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    const msg = err instanceof AppError || err instanceof Error ? err.message : String(err);
    process.stderr.write(`blad: ${msg}\n`);
    return 1;
  }
}

function cmdInit(args: Args): number {
  const config = initData(flagStr(args, "data") ?? defaultDataDir());
  const ctx = createCtx(openDb(config.dbPath));

  // The system actor is the author of messages written by the server itself (for instance
  // a notice about a disabled delivery point). Without it such messages would have to
  // impersonate somebody - and impersonation is exactly what this project removes.
  const system = getActorByHandle(ctx, "system")
    ?? createActor(ctx, { kind: "system", handle: "system", displayName: "AgentTalks" });
  const general = getBySlug(ctx, "general")
    ?? createChannel(ctx, { slug: "general", kind: "public", topic: "Kanal ogolny",
                            createdBy: system.id });

  process.stdout.write(
    `Instancja gotowa w ${config.dataDir}\n` +
      `  baza:   ${config.dbPath}\n` +
      `  pliki:  ${config.filesDir}\n` +
      `  kanal:  #${general.slug}\n\n` +
      `Nastepny krok - konto dla siebie i token dla agenta:\n` +
      `  agenttalks actor create michal --kind human --password '...' --admin\n` +
      `  agenttalks actor create nestor --kind agent\n` +
      `  agenttalks token create --actor nestor --name vps\n`,
  );
  return 0;
}

async function cmdServe(args: Args): Promise<number> {
  const { ctx, config } = openCtx(args);
  const host = flagStr(args, "host") ?? config.host;
  const port = Number(flagStr(args, "port") ?? config.port);
  assertBindAllowed(config, host);

  // Wake (waking absent agents by webhook) and cleaning up expired files live only in the
  // server process - administrative CLI commands have no business firing webhooks on
  // somebody else's behalf.
  registerWake(ctx, undefined, config.allowLoopbackWake);
  const sweep = setInterval(() => {
    try {
      sweepExpired(ctx);
    } catch (err) {
      console.error("[files] sprzatanie wygaslych nie wyszlo:", err);
    }
  }, 60_000);
  sweep.unref();

  // The NEWS.md mirror on the wiki: content that until now lived once (delivered on first
  // contact) gets an address, a search index and a version history.
  try {
    publishNewsToWiki(ctx);
  } catch (err) {
    console.error("[news] nie udalo sie opublikowac NEWS.md na wiki:", err);
  }

  const server = createServer(ctx, config);
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  process.stdout.write(`AgentTalks ${VERSION} nasluchuje na http://${host}:${port}\n`);

  // Shut down on a signal, so the container does not have to wait for SIGKILL.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      process.stdout.write(`\n${sig}: zamykam\n`);
      server.closeAllConnections?.();
      server.close(() => process.exit(0));
    });
  }
  return await new Promise<number>(() => {}); // runs until a signal
}

function cmdActorRename(rest: string[], args: Args): number {
  const [stary, nowy] = rest;
  if (!stary || !nowy) {
    process.stderr.write("uzycie: agenttalks actor rename <handle> <nowa-nazwa> [--name <nazwa>]\n");
    return 1;
  }
  const { ctx } = openCtx(args);
  const a = getActorByHandle(ctx, stary);
  if (!a) {
    process.stderr.write(`nie ma aktora @${stary}\n`);
    return 1;
  }
  const po = renameActor(ctx, a.id, nowy, flagStr(args, "name"));
  process.stdout.write(
    `@${stary} -> @${po.handle} (id ${po.id} bez zmian, wiec tokeny i historia dzialaja dalej)\n`,
  );
  return 0;
}

function cmdActor(rest: string[], args: Args): number {
  const [sub, handle] = rest;
  if (sub === "rename") return cmdActorRename(rest.slice(1), args);
  const { ctx } = openCtx(args);

  if (sub === "list") {
    for (const a of listActors(ctx)) {
      process.stdout.write(
        `  ${a.handle.padEnd(24)} ${a.kind.padEnd(7)} ${a.isAdmin ? "admin " : "      "} ${a.displayName}\n`,
      );
    }
    return 0;
  }
  if (sub !== "create" || !handle) {
    process.stderr.write("uzycie: agenttalks actor create <handle> --kind human|agent\n");
    return 1;
  }
  const kind = (flagStr(args, "kind") ?? "agent") as ActorKind;
  if (kind !== "human" && kind !== "agent") {
    process.stderr.write("--kind musi byc 'human' albo 'agent'\n");
    return 1;
  }
  // Password validation BEFORE any write, and the whole thing in one transaction: an error
  // halfway through must not leave a husk of an account that cannot be repaired ("handle
  // taken" on every further attempt).
  const password = flagStr(args, "password");
  if (password !== undefined) assertPasswordOk(password);
  const actor = tx(ctx.db, () => {
    const created = createActor(ctx, {
      kind,
      handle,
      displayName: flagStr(args, "name"),
      isAdmin: args.flags.admin === true,
    });
    // A new participant lands in #general straight away. An account created and "I cannot
    // see anything" is a bad first minute with a tool; every other channel requires a
    // deliberate join.
    const general = getBySlug(ctx, "general");
    if (general) joinConversation(ctx, general.id, created.id);
    if (password) setPassword(ctx, created.id, password);
    return created;
  });
  if (!password && kind === "human") {
    process.stdout.write("uwaga: konto czlowieka bez hasla nie zaloguje sie do UI\n");
  }
  process.stdout.write(`utworzony aktor @${actor.handle} (${actor.kind})\n`);
  return 0;
}

function cmdToken(rest: string[], args: Args): number {
  const [sub, id] = rest;
  const { ctx } = openCtx(args);

  if (sub === "create") {
    const handle = flagStr(args, "actor");
    if (!handle) {
      process.stderr.write("uzycie: agenttalks token create --actor <handle> [--name <opis>]\n");
      return 1;
    }
    const actor = getActorByHandle(ctx, handle);
    if (!actor) {
      process.stderr.write(`nie ma aktora @${handle}\n`);
      return 1;
    }
    const ttl = flagStr(args, "ttl");
    // A short token for an agent comes back to us as a cost, not as security: an expired
    // token cannot be renewed by the agent itself, so the agent redeems a NEW invite and the
    // channel gains another actor for the same person. That is why anything below
    // MIN_AGENT_TTL_SEC has to be said out loud (--short).
    if (ttl && Number(ttl) > 0 && Number(ttl) < MIN_AGENT_TTL_SEC && args.flags.short !== true) {
      process.stderr.write(
        `--ttl ${ttl} s to mniej niz ${MIN_AGENT_TTL_SEC} s (3 miesiace), a tyle wynosi minimum ` +
          `dla tokenu agenta.\nKrotki token ma sens dla CI i niezaufanego hosta - wtedy dodaj --short. ` +
          `Bez --ttl token nie wygasa.\n`,
      );
      return 1;
    }
    const { token, info } = mintToken(
      ctx, actor.id, flagStr(args, "name") ?? "bez nazwy",
      ttl ? Number(ttl) : null,
    );
    // Visible once. Only the sha256 is in the database, so nobody (the admin included) can
    // read it later.
    process.stdout.write(`${token}\n`);
    const expiryNote = info.expiresAt
      ? ` (wygasa za ${ttl} s)`
      : " (bez wygasniecia - dla CI/niezaufanych hostow rozwaz --ttl <sek>)";
    process.stderr.write(`^ zapisz teraz: ta wartosc nie da sie odtworzyc${expiryNote}\n`);
    return 0;
  }
  if (sub === "list") {
    const actor = getActorByHandle(ctx, flagStr(args, "actor") ?? "");
    if (!actor) {
      process.stderr.write("uzycie: agenttalks token list --actor <handle>\n");
      return 1;
    }
    const now = Math.floor(Date.now() / 1000);
    for (const t of listTokens(ctx, actor.id)) {
      const stan = t.revokedAt ? "ODWOLANY"
        : (t.expiresAt !== null && t.expiresAt <= now) ? "WYGASL"
        : "aktywny";
      const exp = t.expiresAt ? `  wygasa ${new Date(t.expiresAt * 1000).toISOString().slice(0, 16)}` : "";
      process.stdout.write(`  ${String(t.id).padStart(4)}  ${stan.padEnd(9)} ${t.name}${exp}\n`);
    }
    return 0;
  }
  if (sub === "revoke" && id) {
    const tokenId = Number(id);
    const exists = Number.isFinite(tokenId)
      && ctx.db.prepare("SELECT 1 FROM tokens WHERE id = ?").get(tokenId);
    if (!exists) {
      // "Revoked" for a token that does not exist is a false sense of security at exactly the
      // moment somebody is rotating a leaked token.
      process.stderr.write(`nie ma tokenu o id ${id} (sprawdz: token list --actor <handle>)\n`);
      return 1;
    }
    if (!revokeToken(ctx, tokenId)) {
      process.stderr.write(`token ${id} byl juz odwolany - nic nie zmieniono\n`);
      return 1;
    }
    process.stdout.write(`token ${id} odwolany\n`);
    return 0;
  }
  process.stderr.write("uzycie: agenttalks token create|list|revoke\n");
  return 1;
}

function cmdInvite(rest: string[], args: Args): number {
  const [sub, id] = rest;
  const { ctx } = openCtx(args);
  if (sub === "create") {
    const { code, info } = createInvite(ctx, {
      createdBy: null,
      ttlSec: flagStr(args, "ttl") ? Number(flagStr(args, "ttl")) : null,
      uses: flagStr(args, "uses") ? Number(flagStr(args, "uses")) : null,
      makeAdmin: args.flags.admin === true,
      note: flagStr(args, "note"),
    });
    process.stdout.write(`${code}\n`);
    const lim = [
      info.usesLeft === null ? "bez limitu uzyc" : `${info.usesLeft} uzyc`,
      info.expiresAt ? `wygasa ${new Date(info.expiresAt * 1000).toISOString().slice(0, 16)}` : "bez terminu",
      info.makeAdmin ? "nadaje ADMINA" : null,
    ].filter(Boolean).join(", ");
    process.stderr.write(`^ przekaz ten kod agentowi. ${lim}. Uzycie:\n` +
      `  atalk enroll --url <adres> --invite ${code} --handle <nazwa>\n`);
    return 0;
  }
  if (sub === "list") {
    const now = Math.floor(Date.now() / 1000);
    for (const i of listInvites(ctx)) {
      const stan = i.revokedAt ? "ODWOLANE"
        : (i.expiresAt !== null && i.expiresAt <= now) ? "WYGASLE"
        : (i.usesLeft !== null && i.usesLeft <= 0) ? "ZUZYTE" : "aktywne";
      const uses = i.usesLeft === null ? "inf" : String(i.usesLeft);
      process.stdout.write(`  ${String(i.id).padStart(4)}  ${stan.padEnd(9)} uzyc:${uses}` +
        `${i.makeAdmin ? " admin" : ""}${i.note ? `  ${i.note}` : ""}\n`);
    }
    return 0;
  }
  if (sub === "revoke" && id) {
    // Confirm success only when an existing code really was revoked - otherwise a typo in an
    // id yields a false "revoked" while the leaked code keeps working.
    if (!revokeInvite(ctx, Number(id))) {
      process.stderr.write(`nie ma aktywnego zaproszenia o id ${id}\n`);
      return 1;
    }
    process.stdout.write(`zaproszenie ${id} odwolane\n`);
    return 0;
  }
  process.stderr.write("uzycie: agenttalks invite create|list|revoke\n");
  return 1;
}

function cmdImport(rest: string[], args: Args): number {
  const [talkHome] = rest;
  if (!talkHome) {
    process.stderr.write("uzycie: agenttalks import-talk <katalog ~/.talk>\n");
    return 1;
  }
  const { ctx } = openCtx(args);
  const r = importTalkHome(ctx, talkHome);
  process.stdout.write(
    `Import z ${talkHome}:\n` +
      `  aktorzy       ${r.actors}\n` +
      `  konwersacje   ${r.conversations}\n` +
      `  wiadomosci    ${r.messages}\n` +
      `  reakcje       ${r.reactions}\n` +
      `  pytania       ${r.questions}\n` +
      `  znaczniki     ${r.reads}\n` +
      `  pominiete     ${r.skipped}\n`,
  );
  // Skipped records are PRINTED, not merely counted. A silently skipped message was a
  // concrete flaw of the prototype and the importer is not to reproduce it.
  for (const p of r.problems.slice(0, 20)) process.stdout.write(`    - ${p}\n`);
  if (r.problems.length > 20) {
    process.stdout.write(`    ... i ${r.problems.length - 20} wiecej\n`);
  }
  return 0;
}

function cmdClone(rest: string[], args: Args): number {
  const [dest] = rest;
  if (!dest) {
    process.stderr.write("uzycie: agenttalks clone <katalog-docelowy>\n");
    return 1;
  }
  const { ctx, config } = openCtx(args);
  const destConfig = initData(dest);
  // VACUUM INTO makes a CONSISTENT copy even with the server running (WAL) - an ordinary
  // `cp` during a write can take the database from the middle of a transaction.
  // The copy gets its OWN secret (initData) - production cookies must not work on a test
  // instance.
  // VACUUM INTO requires a target file that does NOT exist; we also remove -wal/-shm,
  // because left next to a fresh copy they belong to the old database and break consistency.
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(destConfig.dbPath + suffix)) rmSync(destConfig.dbPath + suffix);
  }
  ctx.db.prepare("VACUUM INTO ?").run(destConfig.dbPath);
  process.stdout.write(
    `sklonowane do ${dest}\n` +
      `  uruchom:   agenttalks serve --data ${dest} --port 8788\n` +
      `  po tescie: rm -rf ${dest}\n` +
      `Uwaga: katalog plikow (${config.filesDir}) NIE jest kopiowany - metadane\n` +
      `plikow wskazuja na oryginalne sciezki; do pomiarow wiadomosci to bez znaczenia.\n`,
  );
  return 0;
}

function cmdBackup(rest: string[], args: Args): number {
  const [destRoot] = rest;
  if (!destRoot) {
    process.stderr.write("uzycie: agenttalks backup <katalog-docelowy>\n");
    return 1;
  }
  const { ctx, config } = openCtx(args);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const dest = joinPath(resolvePath(destRoot), `agenttalks-${stamp}`);
  mkdirSync(dest, { recursive: true });
  const dbCopy = joinPath(dest, "agenttalks.sqlite");
  // VACUUM INTO gives a CONSISTENT copy even with a live server (WAL) - an ordinary cp can
  // take the database from the middle of a transaction. It requires a non-existent target.
  if (existsSync(dbCopy)) rmSync(dbCopy);
  ctx.db.prepare("VACUUM INTO ?").run(dbCopy);
  let filesNote = "  plikow: katalog pusty albo nieobecny\n";
  if (existsSync(config.filesDir)) {
    cpSync(config.filesDir, joinPath(dest, "files"), { recursive: true });
    filesNote = `  pliki:  ${joinPath(dest, "files")}\n`;
  }
  process.stdout.write(
    `kopia zapasowa gotowa: ${dest}\n  baza:   ${dbCopy}\n${filesNote}` +
      `Odtworzenie: zatrzymaj serwer, podmien ${config.dbPath} (usun tez -wal/-shm)\n` +
      `i katalog plikow, uruchom ponownie. Migracje doprowadza baze do biezacej wersji.\n`,
  );
  return 0;
}

function cmdInstallService(args: Args): number {
  const dataDir = resolvePath(flagStr(args, "data") ?? defaultDataDir());
  const port = flagStr(args, "port") ?? "8787";
  const binPath = resolvePath(fileURLToPath(new URL("../../bin/agenttalks.js", import.meta.url)));
  const unit = `[Unit]
Description=AgentTalks - serwer komunikacji agentow AI i ludzi
After=network.target

[Service]
ExecStart=${process.execPath} ${binPath} serve --data ${dataDir} --port ${port}
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
  if (args.flags.write === true) {
    const unitDir = joinPath(homedir(), ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    const unitPath = joinPath(unitDir, "agenttalks.service");
    writeFileSync(unitPath, unit);
    process.stdout.write(
      `zapisane: ${unitPath}\nWlacz:\n  systemctl --user daemon-reload\n` +
        `  systemctl --user enable --now agenttalks\n` +
        `Zeby unit user-level dzialal bez zalogowania: sudo loginctl enable-linger $USER\n`,
    );
    return 0;
  }
  process.stdout.write(
    `${unit}\n# Zapis do ~/.config/systemd/user: agenttalks install-service --write\n` +
      `# Instalacja systemowa: zapisz powyzsze do /etc/systemd/system/agenttalks.service\n` +
      `# (User=..., WantedBy=multi-user.target), potem: sudo systemctl enable --now agenttalks\n` +
      `# Docker pozostaje glowna droga wdrozenia - patrz docs/docker.md.\n`,
  );
  return 0;
}

async function cmdHealthcheck(args: Args): Promise<number> {
  // The port, in order of certainty: an explicit --url, the environment (the container sets
  // AGENTTALKS_PORT), the instance configuration, and only then the default.
  let port = process.env.AGENTTALKS_PORT;
  if (!port) {
    try {
      port = String(loadConfig(flagStr(args, "data") ?? defaultDataDir()).port);
    } catch { /* brak instancji - zostaje domyslny */ }
  }
  const url = flagStr(args, "url") ?? `http://127.0.0.1:${port ?? 8787}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return 1;
    const body = await res.json() as { ok?: boolean };
    return body.ok ? 0 : 1;
  } catch {
    return 1;
  }
}
