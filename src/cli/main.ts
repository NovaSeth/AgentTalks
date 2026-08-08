/**
 * CLI administracyjne AgentTalks.
 *
 * Etap 1 daje to, co jest potrzebne, zeby serwer w ogole zyl: zalozenie instancji,
 * uruchomienie, aktorzy, tokeny, import z prototypu. Klient dla agentow (`atalk`)
 * przychodzi w etapie 2 i bedzie mowil HTTP, a nie dotykal bazy.
 */
import { existsSync, rmSync } from "node:fs";
import { assertBindAllowed, initData, loadConfig, defaultDataDir, type Config } from "../config.ts";
import { openDb, tx } from "../store/db.ts";
import { createCtx, type Ctx } from "../core/ctx.ts";
import {
  assertPasswordOk,
  createActor,
  getActorByHandle,
  listActors,
  setPassword,
  type ActorKind,
} from "../core/actors.ts";
import { createChannel, getBySlug, join as joinConversation } from "../core/conversations.ts";
import { listTokens, mintToken, revokeToken } from "../core/tokens.ts";
import { createInvite, listInvites, revokeInvite } from "../core/invites.ts";
import { importTalkHome } from "../importer/talk.ts";
import { registerWake } from "../core/wake.ts";
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
  agenttalks actor list

  agenttalks token create --actor <handle> [--name <opis>] [--ttl <sekundy>]
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

  agenttalks healthcheck [--url <adres>]
      Zwraca 0, gdy serwer odpowiada. Uzywane przez HEALTHCHECK w obrazie Docker.
`;

type Args = { positional: string[]; flags: Record<string, string | boolean> };

/**
 * Parser argumentów. Dwie zasady chronią treść wiadomości przed zjedzeniem:
 *  - `--` (samo) to terminator: wszystko po nim to pozycyjne, nawet z wiodącym `--`,
 *  - `knownFlags` (opcjonalne): tylko wymienione nazwy pobierają wartość i schodzą
 *    z pozycyjnych; reszta `--cokolwiek` zostaje treścią.
 *
 * Bez tego `atalk say testy padly na --coverage prosze` gubił dwa słowa: `--coverage`
 * stawał się flagą, a `prosze` jego wartością. Dla narzędzia, którym agenci rozmawiają
 * o flagach CLI, to codzienny przypadek cichego znieksztalcenia treści.
 */
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
    // Gdy podano liste znanych flag, nieznane `--x` sa traktowane jak zwykla tresc.
    if (knownFlags && !knownFlags.has(name)) {
      positional.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
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

  // Aktor systemowy jest autorem wiadomosci, ktore pisze sam serwer (np. informacja
  // o wylaczonym punkcie dostarczenia). Bez niego takie komunikaty musialyby udawac
  // kogos - a podszywanie sie jest dokladnie tym, co ten projekt usuwa.
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

  // Wake (budzenie nieobecnych agentow webhookiem) i sprzatanie wygaslych plikow
  // zyja wylacznie w procesie serwera - komendy administracyjne CLI nie maja
  // prawa strzelac webhookami w cudzym imieniu.
  registerWake(ctx, undefined, config.allowLoopbackWake);
  const sweep = setInterval(() => {
    try {
      sweepExpired(ctx);
    } catch (err) {
      console.error("[files] sprzatanie wygaslych nie wyszlo:", err);
    }
  }, 60_000);
  sweep.unref();

  const server = createServer(ctx, config);
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  process.stdout.write(`AgentTalks ${VERSION} nasluchuje na http://${host}:${port}\n`);

  // Zamkniecie na sygnal, zeby kontener nie musial czekac na SIGKILL.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      process.stdout.write(`\n${sig}: zamykam\n`);
      server.closeAllConnections?.();
      server.close(() => process.exit(0));
    });
  }
  return await new Promise<number>(() => {}); // dziala do sygnalu
}

function cmdActor(rest: string[], args: Args): number {
  const [sub, handle] = rest;
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
  // Walidacja hasla PRZED jakimkolwiek zapisem i calosc w jednej transakcji:
  // blad w polowie nie moze zostawic konta-wydmuszki, ktorego nie da sie
  // naprawic ("handle zajety" przy kazdej kolejnej probie).
  const password = flagStr(args, "password");
  if (password !== undefined) assertPasswordOk(password);
  const actor = tx(ctx.db, () => {
    const created = createActor(ctx, {
      kind,
      handle,
      displayName: flagStr(args, "name"),
      isAdmin: args.flags.admin === true,
    });
    // Nowy uczestnik laduje w #general od razu. Konto zalozone i "nic nie widze"
    // to zla pierwsza minuta z narzedziem; kazdy inny kanal wymaga swiadomego
    // dolaczenia.
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
    const { token, info } = mintToken(
      ctx, actor.id, flagStr(args, "name") ?? "bez nazwy",
      ttl ? Number(ttl) : null,
    );
    // Widoczny raz. W bazie lezy tylko sha256, wiec nikt (lacznie z adminem)
    // nie odczyta go pozniej.
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
      // "Odwolany" dla tokenu, ktorego nie ma, to falszywe poczucie bezpieczenstwa
      // dokladnie w chwili, gdy ktos rotuje wyciekniety token.
      process.stderr.write(`nie ma tokenu o id ${id} (sprawdz: token list --actor <handle>)\n`);
      return 1;
    }
    revokeToken(ctx, tokenId);
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
    revokeInvite(ctx, Number(id));
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
  // Pominiete rekordy sa WYPISYWANE, a nie tylko policzone. Cicho pominieta
  // wiadomosc byla konkretna wada prototypu i nie ma jej odtwarzac importer.
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
  // VACUUM INTO robi SPOJNA kopie takze przy dzialajacym serwerze (WAL) -
  // zwykle `cp` w trakcie zapisu potrafi zabrac baze z polowy transakcji.
  // Kopia dostaje WLASNY sekret (initData) - cookie produkcyjne nie moga
  // dzialac na instancji testowej.
  // VACUUM INTO wymaga NIEISTNIEJACEGO pliku docelowego; usuwamy tez -wal/-shm,
  // bo zostawione obok swiezej kopii naleza do starej bazy i psuja spojnosc.
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

async function cmdHealthcheck(args: Args): Promise<number> {
  // Port, w kolejnosci pewnosci: jawny --url, srodowisko (kontener ustawia
  // AGENTTALKS_PORT), konfiguracja instancji, dopiero na koncu domyslny.
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
