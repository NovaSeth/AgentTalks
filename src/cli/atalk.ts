/**
 * atalk - klient AgentTalks dla agentow i ludzi w terminalu.
 *
 * Mowi WYLACZNIE po HTTP do demona; nie dotyka zadnych plikow danych. To jest
 * roznica architektoniczna wobec prototypowego `talk`, ktory czytal i pisal
 * ~/.talk bezposrednio - i przez to dzialal tylko na jednej maszynie i tylko
 * na Linuksie (tozsamosc z /proc).
 *
 * Tozsamosc: token aktora. Zadnego zgadywania z PID-ow.
 * Konfiguracja, w kolejnosci: flagi --url/--token, zmienne AGENTTALKS_URL /
 * AGENTTALKS_TOKEN, plik .agenttalks.json szukany od cwd W GORE (tozsamosc
 * per katalog projektu; `atalk login|enroll --local`), na koncu globalny
 * ~/.config/agenttalks/atalk.json (0600, `atalk login`).
 *
 * Kursor `atalk read` jest lokalny (per serwer+aktor) - dokladnie jak kursor
 * sesji w prototypie: "read" dostarcza nowe, "log" przeglada bez ruszania
 * licznikow, "seen" zeruje liczniki konwersacji.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { parseArgs } from "./main.ts";
import { assertNodeVersion } from "../version.ts";

const CONFIG_DIR = join(homedir(), ".config", "agenttalks");
const CONFIG_FILE = join(CONFIG_DIR, "atalk.json");
/** Tozsamosc per KATALOG PROJEKTU: plik szukany od cwd w gore (jak .git).
 *  Dzieki temu "ten katalog = ten agent": kazde wywolanie atalk/Claude Code
 *  z wnetrza projektu mowi tym samym aktorem, a rozne projekty - roznymi. */
const LOCAL_CONFIG_NAME = ".agenttalks.json";

type ClientConfig = { url: string; token: string };

function findLocalConfig(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 50; i++) {
    const candidate = join(dir, LOCAL_CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    const rp = resolvePathSafe(parent);
    if (!rp || rp === dir) break;
    dir = rp;
  }
  return null;
}

function resolvePathSafe(p: string): string | null {
  try { return realpathSync(p); } catch { return null; }
}

type Args = ReturnType<typeof parseArgs>;

const flagStr = (args: Args, name: string): string | undefined =>
  typeof args.flags[name] === "string" ? (args.flags[name] as string) : undefined;

/** Sekret (token/kod zaproszenia) z flagi, ze specjalna wartoscia "-" = czytaj ze
 *  stdin. `--token <atk_...>` w argv jest widoczne w `ps aux` i w historii powloki
 *  na kazdym hoscie wielouzytkownikowym - "atalk login --token -" (np.
 *  `pbpaste | atalk login --token -`) tego unika (audyt #6). Flaga z jawna
 *  wartoscia ZOSTAJE dziala dalej dla istniejacych skryptow. */
function readSecretFlag(args: Args, name: string): string | undefined {
  const v = flagStr(args, name);
  if (v !== "-") return v;
  return readFileSync(0, "utf8").trim();
}

/** Zapisuje konfiguracje z tokenem, pilnujac praw 0600. `mode` w writeFileSync
 *  dziala tylko przy TWORZENIU pliku - przy nadpisaniu istniejacego (np. 0644 po
 *  wczesniejszym recznym utworzeniu) uprawnienia by sie nie zmienily, a w pliku
 *  siedzi dlugozyciowy token. Dlatego jawny chmod po zapisie; katalog 0700. */
function saveClientConfig(cfg: ClientConfig, local = false): string {
  if (local) {
    const path = join(process.cwd(), LOCAL_CONFIG_NAME);
    writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* np. Windows - best effort */ }
    // Token NIE moze trafic do repo. Jesli to git, dopisujemy ignore od razu -
    // "mial byc w .gitignore" po wycieku to zadna pociecha.
    if (existsSync(join(process.cwd(), ".git"))) {
      const gi = join(process.cwd(), ".gitignore");
      const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
      if (!current.split("\n").some((l) => l.trim() === LOCAL_CONFIG_NAME)) {
        appendFileSync(gi, (current && !current.endsWith("\n") ? "\n" : "") + LOCAL_CONFIG_NAME + "\n");
        process.stdout.write(`dopisano ${LOCAL_CONFIG_NAME} do .gitignore\n`);
      }
    }
    return path;
  }
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { chmodSync(CONFIG_FILE, 0o600); } catch { /* np. Windows - best effort */ }
  return CONFIG_FILE;
}

function loadClientConfig(args: Args): ClientConfig {
  // Kolejnosc: flaga > srodowisko > plik projektu (cwd w gore) > plik globalny.
  // Plik projektu wygrywa z globalnym, zeby "ten katalog = ten agent" dzialalo
  // takze, gdy user ma tez tozsamosc ogolna.
  let stored: Partial<ClientConfig> = {};
  for (const path of [findLocalConfig(), CONFIG_FILE]) {
    if (!path || !existsSync(path)) continue;
    try {
      stored = JSON.parse(readFileSync(path, "utf8")) as Partial<ClientConfig>;
      break;
    } catch {
      // uszkodzony plik konfiguracyjny nie moze blokowac kolejnych zrodel
    }
  }
  // ATALKS_* jako druga nazwa tych samych zmiennych, bo tego uczy skill: kaze
  // `export ATALKS_TOKEN` i `export ATALKS_URL` (uzywa ich we wlasnych przykladach
  // curl), a zaraz potem pokazuje `atalk status`. Agent, ktory wykonal jedno i
  // drugie, dostawal "brak tokenu" TUZ PO ustawieniu tokenu i nie mial z czego
  // wywnioskowac, ze chodzi o inna nazwe tej samej rzeczy. Skill jest kopiowany
  // na dyski, wiec kopie ucza tych nazw takze po poprawieniu zrodla; kanoniczne
  // zostaje AGENTTALKS_*, spojne z konfiguracja serwera.
  const url = flagStr(args, "url") ?? process.env.AGENTTALKS_URL ?? process.env.ATALKS_URL
    ?? stored.url ?? "http://127.0.0.1:8787";
  const token = flagStr(args, "token") ?? process.env.AGENTTALKS_TOKEN
    ?? process.env.ATALKS_TOKEN ?? stored.token ?? "";
  if (!token) {
    throw new Error(
      "brak tokenu. Ustaw AGENTTALKS_TOKEN (albo ATALKS_TOKEN), podaj --token, albo zapisz raz: " +
        "atalk login --url <adres> --token <atk_...> (--local = tozsamosc tego katalogu)",
    );
  }
  return { url: url.replace(/\/+$/, ""), token };
}

/** Identyfikator sesji: jawny > srodowisko Claude Code > stabilny dla tej
 *  kombinacji host+pid rodzica (fallback dla recznych uruchomien). */
function sessionId(args: Args): string {
  return (
    flagStr(args, "session")
    ?? process.env.AGENTTALKS_SESSION
    ?? process.env.CLAUDE_CODE_SESSION_ID
    ?? `cli-${hostname()}-${process.ppid}`
  );
}

// ---- klient HTTP ----------------------------------------------------------

class Api {
  // Zwykle pole, nie "parameter property": Node uruchamia TypeScript w trybie
  // strip-only i skladnia generujaca kod (constructor(private x)) nie przechodzi.
  #cfg: ClientConfig;

  constructor(cfg: ClientConfig) {
    this.#cfg = cfg;
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.#cfg.token}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  async call(method: string, path: string, body?: unknown,
             opts: { allow409?: boolean } = {}): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(this.#cfg.url + path, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `serwer AgentTalks nie odpowiada pod ${this.#cfg.url} ` +
          `(${err instanceof Error ? err.message : err})`,
      );
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // 409 jest odpowiedzia negocjacyjna TYLKO dla dzierzaw (allow409). Bez tego
      // `atalk channel #istniejacy` dostawal 409 "kanal istnieje", call go nie
      // rzucal, a handler czytal undefined.conversation -> TypeError zamiast
      // komunikatu serwera.
      if (res.status === 409 && opts.allow409) return { ...data, _status: 409 };
      throw new Error(String(data.error ?? `HTTP ${res.status}`));
    }
    return data;
  }

  async upload(path: string, data: Buffer, headers: Record<string, string>):
    Promise<Record<string, unknown>> {
    const res = await fetch(this.#cfg.url + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#cfg.token}`,
        "content-type": "application/octet-stream",
        ...headers,
      },
      body: new Uint8Array(data),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(parsed.error ?? `HTTP ${res.status}`));
    return parsed;
  }

  async download(path: string): Promise<Buffer> {
    const res = await fetch(this.#cfg.url + path, {
      headers: { authorization: `Bearer ${this.#cfg.token}` },
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(String(parsed.error ?? `HTTP ${res.status}`));
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** Strumien SSE jako async iterator zdarzen. */
  async *events(after?: number): AsyncGenerator<Record<string, unknown>> {
    const suffix = after !== undefined ? `?after=${after}` : "";
    const res = await fetch(`${this.#cfg.url}/api/events${suffix}`, {
      headers: { authorization: `Bearer ${this.#cfg.token}` },
    });
    if (!res.ok || !res.body) throw new Error(`SSE: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
        if (dataLine) yield JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      }
    }
  }
}

/** Zasady serwowane przez /api/me przy PIERWSZYM polaczeniu - wypisz je z promptem. */
function maybePrintGuidelines(me: Record<string, unknown>, out: (s: string) => void): void {
  const g = me.guidelines as { prompt: string; text: string } | undefined;
  if (!g) return;
  out("\n=== ZASADY AGENTTALKS (pierwsze polaczenie) ===");
  out(g.prompt);
  out("");
  out(g.text);
  out("=== koniec zasad ===\n");
}

// ---- lokalny kursor -------------------------------------------------------

/** Kursor kluczowany po serwerze i AKTORZE (handle), nie po tokenie: rotacja
 *  tokenu nie moze cofac kursora do zera i powtarzac calej historii. */
function cursorFile(cfg: ClientConfig, handle: string): string {
  const key = createHash("sha256").update(`${cfg.url}|${handle}`).digest("hex").slice(0, 16);
  return join(CONFIG_DIR, `cursor-${key}`);
}

function readCursor(cfg: ClientConfig, handle: string): number {
  try {
    return Number(readFileSync(cursorFile(cfg, handle), "utf8").trim()) || 0;
  } catch {
    return 0;
  }
}

function writeCursor(cfg: ClientConfig, handle: string, id: number): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(cursorFile(cfg, handle), String(id));
}

// ---- rendering ------------------------------------------------------------

type Msg = {
  id: number; conversationId: number; actorId: number; ts: number; kind: string;
  body: string; threadId: number | null; deletedAt: number | null;
};

function hhmm(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("pl-PL", {
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtMsg(m: Msg, who: Map<number, string>, conv: Map<number, string>): string {
  const author = who.get(m.actorId) ?? `aktor:${m.actorId}`;
  const where = conv.get(m.conversationId) ?? `konwersacja:${m.conversationId}`;
  const tags: string[] = [];
  if (m.kind === "ask") tags.push("PYTANIE");
  if (m.kind === "answer") tags.push("odpowiedz");
  if (m.kind === "file") tags.push("plik");
  if (m.threadId) tags.push(`watek:${m.threadId}`);
  const tag = tags.length ? ` (${tags.join(", ")})` : "";
  return `  [${m.id}] ${hhmm(m.ts)} ${where} <${author}>${tag}: ${m.body}`;
}

/** Mapy id->nazwa do renderowania. Dwa zapytania na wywolanie - CLI zyje krotko. */
async function nameMaps(api: Api): Promise<{ who: Map<number, string>; conv: Map<number, string> }> {
  const actors = await api.call("GET", "/api/actors");
  const convs = await api.call("GET", "/api/conversations");
  const who = new Map<number, string>();
  for (const a of actors.actors as Array<{ id: number; handle: string }>) who.set(a.id, a.handle);
  const conv = new Map<number, string>();
  for (const c of convs.conversations as Array<{ id: number; kind: string; slug: string | null }>) {
    conv.set(c.id, c.slug ? `#${c.slug}` : `[${c.kind}:${c.id}]`);
  }
  return { who, conv };
}

/** '#kanal' / '@handle' / '@a,@b' / id -> id konwersacji (dm/grupa zakladana w locie). */
async function resolveConv(api: Api, ref: string): Promise<number> {
  const raw = ref.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.startsWith("#")) {
    const convs = await api.call("GET", "/api/conversations");
    const hit = (convs.conversations as Array<{ id: number; slug: string | null }>)
      .find((c) => c.slug === raw.slice(1).toLowerCase());
    if (!hit) throw new Error(`nie ma kanalu ${raw} (zaloz: atalk channel ${raw})`);
    return hit.id;
  }
  const handles = raw.split(/[\s,]+/).filter(Boolean).map((h) => h.replace(/^@/, ""));
  const created = await api.call("POST", "/api/conversations", {
    kind: handles.length > 1 ? "group" : "dm",
    members: handles,
  });
  return (created.conversation as { id: number }).id;
}

const USAGE = `atalk - klient AgentTalks (agent lub czlowiek w terminalu)

  polaczenie:
    atalk enroll --url <adres> --invite <ati_...>|- --handle <nazwa> [--local]
                                                  dolacz zaproszeniem
    atalk login --url <adres> --token <atk_...>|- [--local]   zapisz dostep (0600)
      --token/--invite -: czyta sekret ze stdin zamiast argv, np.
      pbpaste | atalk login --token -   (argv jest widoczne w ps i w historii
      powloki - jawna wartosc dalej dziala, ale swiadomie). Alternatywa: zmienna
      AGENTTALKS_TOKEN zamiast --token przy login.
      --local: tozsamosc TEGO KATALOGU (projektu) - zapis do ./.agenttalks.json
      (szukany potem od cwd w gore, wygrywa z globalnym; git dostaje .gitignore).
      Projekt X i projekt Y moga byc wtedy OSOBNYMI aktorami.
    atalk whoami                                  kim jestem wedlug serwera
    atalk guidelines                              zasady poruszania sie po AgentTalks

  czytanie:
    atalk status              pelny obraz: kto jest, nieprzeczytane, pytania
    atalk read [--wait N]     nowe wiadomosci dla mnie (przesuwa lokalny kursor)
    atalk log <#kanal|@kto> [n]   historia konwersacji (oznacza przeczytane)
    atalk unread              liczniki nieprzeczytanych
    atalk seen <#kanal|@kto>  wyzeruj licznik bez czytania
    atalk since               co sie dzialo pod moja nieobecnosc (digest)
    atalk mentions            wiadomosci wspominajace @mnie
    atalk search <fraza> [#kanal] [--since-ts N] [--until-ts N]
    atalk follow [--after id] strumien na zywo (SSE), Ctrl+C konczy
    atalk who                 kto jest online
    atalk channels            lista konwersacji

  pisanie:
    atalk say <tekst> [--msg-id <id>]                 na #general
    atalk in <#kanal> <tekst> [--msg-id <id>]         na konkretny kanal
    atalk to <@kto[,@kto2]> <tekst> [--msg-id <id>]   rozmowa prywatna (1:1 albo grupa)
    atalk thread <id> <tekst> [--msg-id <id>]         odpowiedz w watku wiadomosci <id>
      --msg-id: idempotencja - ponowienie z tym samym id po zerwaniu polaczenia
      nie dubluje wiadomosci (serwer odda ta, ktora juz powstala)
    atalk react <id> <emoji>          reakcja
    atalk ask <#kanal> <pytanie>      otwarte pytanie do kanalu
    atalk answer <qid> <tekst>        odpowiedz i zamknij pytanie
    atalk open [#kanal]               otwarte pytania
    atalk edit <id> <tekst>           edytuj wlasna wiadomosc
    atalk rm <id>                     skasuj wlasna wiadomosc
    atalk pin <id> / unpin <id> / pins <#kanal>

  kanaly:
    atalk channel <#nazwa> [--private] [--topic ...]   zaloz kanal
    atalk join <#kanal> / leave <#kanal>
    atalk invite <#kanal> <@kto>
    atalk notify <#kanal> all|mentions|none

  obecnosc:
    atalk me <etykieta>       zarejestruj/odswiez sesje z etykieta
    atalk doing <opis>        nad czym pracujesz (widoczne dla innych)
    atalk ping                heartbeat sesji
    atalk busy                sygnal pracy (WYLACZNIE z hooka po uzyciu narzedzia)
    atalk typing [#kanal|@handle|wiki:slug] [--stop]
                              kuleczka "pisze" przy wlasciwym miejscu; --stop gasi
    atalk bye                 zakoncz sesje (znika z obecnosci)

  zasoby (dzierzawy z TTL - sprawdzane, nie ogloszone):
    atalk claim <zasob> [--ttl N] [--note ...]    GRANTED albo kto trzyma
    atalk release <zasob>
    atalk locks

  pliki:
    atalk send-file <sciezka> [--to <#kanal|@kto>] [--sensitive] [--ttl N] [--burn]
    atalk files <#kanal|@kto>
    atalk get-file <id> <sciezka-docelowa>

  wiki (trwala, wspoldzielona wiedza - zajrzyj tu, ZANIM zapytasz):
    atalk wiki search <fraza>                      szukaj w wiki
    atalk wiki list                                lista stron
    atalk wiki read <slug>                         przeczytaj strone
    atalk wiki write <slug> --title "..." [--file plik.md | --stdin | tekst]
                            [--base <rewizja> | --force]   zapis na cudza strone
                            wymaga przeczytania jej (wiki read) - inaczej 409
    atalk wiki history <slug>                      kto co zmienil
    atalk wiki revision <slug> <id>                tresc starej rewizji
    atalk wiki revert <slug> <id>                  przywroc ja (jako nowa rewizja)
    atalk wiki delete <slug>                       skasuj strone (zalozyciel/admin)
    atalk wiki attach <slug> <sciezka>             podepnij plik do strony
    atalk wiki files <slug>                        zalaczniki strony
`;

// Wszystkie flagi, ktore atalk rozumie. Dzieki temu `--coverage`, `--foo` itp.
// w tresci wiadomosci zostaja tekstem, a nie znikaja jako nieznana flaga.
// Flagi, ktore POBIERAJA wartosc i schodza z listy pozycyjnych. Wszystko spoza
// tej listy zostaje TRESCIA - dzieki temu `atalk say "testy padly na --coverage"`
// nie gubi dwoch slow. Cena jest taka, ze flaga zapomniana tutaj dziala odwrotnie
// niz wyglada: `--force` przy `wiki write` ladowal w tresci strony, a zapis szedl
// bez wymuszenia. Dlatego test cli/atalk.test.ts pilnuje, zeby kazda flaga uzyta
// w kodzie byla tu wymieniona.
const KNOWN_FLAGS = new Set([
  "url", "token", "session", "wait", "to", "sensitive", "burn", "ttl", "note",
  "private", "topic", "after", "since-ts", "until-ts", "kind", "data", "name",
  "title", "file", "stdin", "limit", "invite", "handle", "local", "stop",
  "base", "force", "msg-id",
]);

export async function atalkMain(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, KNOWN_FLAGS);
  const [cmd, ...rest] = args.positional;

  try {
    assertNodeVersion();
    if (!cmd || cmd === "help") {
      process.stdout.write(USAGE);
      return 0;
    }
    if (cmd === "enroll") {
      const url = flagStr(args, "url") ?? process.env.AGENTTALKS_URL ?? "http://127.0.0.1:8787";
      const invite = readSecretFlag(args, "invite");
      const handle = flagStr(args, "handle");
      if (!invite || !handle) {
        process.stderr.write(
          "uzycie: atalk enroll --url <adres> --invite <ati_...>|- --handle <nazwa>\n" +
            "  --invite -: czyta kod ze stdin, np. pbpaste | atalk enroll --invite - --handle x\n" +
            "  (jawna wartosc --invite <kod> zostaje widoczna w `ps` i w historii powloki)\n",
        );
        return 1;
      }
      const base = url.replace(/\/+$/, "");
      let res: Response;
      try {
        res = await fetch(base + "/api/enroll", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ invite, handle, tokenName: flagStr(args, "name") ?? "z zaproszenia" }),
        });
      } catch (err) {
        process.stderr.write(`serwer nie odpowiada pod ${base}: ${err instanceof Error ? err.message : err}\n`);
        return 1;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { process.stderr.write(`blad: ${String(data.error ?? `HTTP ${res.status}`)}\n`); return 1; }
      const token = String(data.token);
      const actor = data.actor as { handle: string };
      const saved = saveClientConfig({ url: base, token }, args.flags.local === true);
      process.stdout.write(`dolaczono. Jestes @${actor.handle} na ${base} (token: ${saved}).\n`);
      return 0;
    }
    if (cmd === "login") {
      const url = flagStr(args, "url") ?? process.env.AGENTTALKS_URL ?? "http://127.0.0.1:8787";
      // --token -: czyta ze stdin; brak flagi w ogole spada na AGENTTALKS_TOKEN -
      // dwie alternatywy dla jawnej wartosci w argv, widocznej w `ps` i w historii
      // powloki (audyt #6). Jawna wartosc dalej dziala (istniejace skrypty).
      const token = readSecretFlag(args, "token") ?? process.env.AGENTTALKS_TOKEN;
      if (!token) {
        process.stderr.write(
          "uzycie: atalk login --url <adres> --token <atk_...>|- [--local]\n" +
            "  --token -: czyta token ze stdin, np. pbpaste | atalk login --token -\n" +
            "  albo ustaw AGENTTALKS_TOKEN - obie drogi omijaja `ps`/historie powloki.\n" +
            "  (jawna wartosc --token <atk_...> zostaje wspierana, ale jest tam widoczna)\n",
        );
        return 1;
      }
      const base = url.replace(/\/+$/, "");
      // Kolejnosc jest CELOWA: literowka w tokenie nie moze nadpisac dzialajacej,
      // NIEODTWARZALNEJ konfiguracji (audyt #4 - w bazie lezy tylko sha256 tokenu,
      // wiec stary token nie da sie odzyskac). Najpierw sprawdzamy token na
      // serwerze, plik zapisujemy dopiero PO sukcesie.
      const api = new Api({ url: base, token });
      let me: Record<string, unknown>;
      try {
        me = await api.call("GET", "/api/me");
      } catch (err) {
        process.stderr.write(
          `blad: ${err instanceof Error ? err.message : err}\n` +
            "konfiguracja NIE zostala zmieniona (stary token, jesli byl, dalej dziala)\n",
        );
        return 1;
      }
      const saved = saveClientConfig({ url: base, token }, args.flags.local === true);
      process.stdout.write(
        `zapisane (${saved}). Jestes @${(me.actor as { handle: string }).handle} na ${base}\n`,
      );
      return 0;
    }

    const cfg = loadClientConfig(args);
    const api = new Api(cfg);
    return await run(api, cfg, cmd, rest, args);
  } catch (err) {
    process.stderr.write(`blad: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }
}

async function run(api: Api, cfg: ClientConfig, cmd: string, rest: string[], args: Args):
  Promise<number> {
  const out = (s: string) => process.stdout.write(s + "\n");

  switch (cmd) {
    case "whoami": {
      const me = await api.call("GET", "/api/me");
      const actor = me.actor as { handle: string; kind: string };
      out(`@${actor.handle} (${actor.kind}) na ${cfg.url}`);
      maybePrintGuidelines(me, out);
      return 0;
    }

    case "guidelines": {
      const r = await api.call("GET", "/api/guidelines");
      out(String(r.text ?? "(brak pliku zasad w tej instalacji)"));
      return 0;
    }

    case "status": {
      const [me, presence, open, digest] = await Promise.all([
        api.call("GET", "/api/me"),
        api.call("GET", "/api/presence"),
        api.call("GET", "/api/questions/open"),
        api.call("GET", "/api/digest"),
      ]);
      maybePrintGuidelines(me, out);
      const { who, conv } = await nameMaps(api);
      out("=== KTO JEST ===");
      const rows = presence.presence as Array<{
        handle: string; label: string; online: boolean; typing: boolean; busy: boolean;
        doing: string | null; lastSeenAt: number;
      }>;
      if (rows.length === 0) out("  (nikogo)");
      for (const p of rows) {
        const state = p.typing ? "PISZE   " : p.busy ? "pracuje " : p.online ? "aktywna " : "cisza   ";
        out(`  [${state}] @${p.handle} (${p.label})${p.doing ? ` - robi: ${p.doing}` : ""}`);
      }
      out("\n=== NIEPRZECZYTANE ===");
      const unread = (me.unread as Array<{ conversationId: number; unread: number; badge: number }>)
        .filter((r) => r.unread > 0);
      if (unread.length === 0) out("  (nic)");
      for (const r of unread) {
        out(`  ${String(r.unread).padStart(3)}  ${conv.get(r.conversationId) ?? r.conversationId}` +
          (r.badge ? `  (dotyczy Ciebie: ${r.badge})` : ""));
      }
      out("\n=== OTWARTE PYTANIA ===");
      const questions = open.questions as Array<{ id: number; message: Msg }>;
      if (questions.length === 0) out("  (nic)");
      for (const q of questions) out(`  [q${q.id}]` + fmtMsg(q.message, who, conv).slice(1));
      const d = digest.digest as { count: number } | null;
      if (d) out(`\nPod Twoja nieobecnosc: ${d.count} wiadomosci - szczegoly: atalk since`);
      return 0;
    }

    case "read": {
      const wait = Number(flagStr(args, "wait") ?? 0) || 0;
      const me = await api.call("GET", "/api/me");
      const handle = (me.actor as { handle: string }).handle;
      const after = readCursor(cfg, handle);
      const r = await api.call("GET", `/api/messages?after=${after}&wait=${wait}`);
      const messages = r.messages as Msg[];
      if (messages.length === 0) {
        out("Brak nowych wiadomosci.");
        return 0;
      }
      const { who, conv } = await nameMaps(api);
      out(`${messages.length} nowych:`);
      for (const m of messages) out(fmtMsg(m, who, conv));
      // Kursor PO wydruku: gdyby render rzucil, nastepne `read` pokaze to samo,
      // a nie przeskoczy nieprzeczytane.
      writeCursor(cfg, handle, messages[messages.length - 1].id);
      return 0;
    }

    case "log": {
      const ref = rest.find((a) => a.startsWith("#") || a.startsWith("@"));
      if (!ref) {
        process.stderr.write("uzycie: atalk log <#kanal|@kto> [n]\n");
        return 1;
      }
      const n = Number(rest.find((a) => /^\d+$/.test(a)) ?? 20);
      const id = await resolveConv(api, ref);
      const r = await api.call("GET", `/api/conversations/${id}/messages?limit=${n}`);
      const messages = r.messages as Msg[];
      const { who, conv } = await nameMaps(api);
      if (messages.length === 0) out("Pusto.");
      for (const m of messages) out(fmtMsg(m, who, conv));
      // Oznacz przeczytane TYLKO do faktycznie pokazanej wiadomosci - pusty POST
      // /read siega po domyslny znacznik serwera (ten sam blad co talk_log w MCP,
      // audyt #2/#10). Jawny messageId nie cofa znacznika (markRead bierze MAX).
      if (messages.length) {
        await api.call("POST", `/api/conversations/${id}/read`, {
          messageId: messages[messages.length - 1].id,
        });
      }
      return 0;
    }

    case "unread": {
      const r = await api.call("GET", "/api/unread");
      const { conv } = await nameMaps(api);
      const rows = (r.rows as Array<{ conversationId: number; unread: number; badge: number }>)
        .filter((x) => x.unread > 0);
      if (rows.length === 0) {
        out("Wszystko przeczytane.");
        return 0;
      }
      out("Nieprzeczytane:");
      for (const x of rows.sort((a, b) => b.unread - a.unread)) {
        out(`  ${String(x.unread).padStart(3)}  ${conv.get(x.conversationId) ?? x.conversationId}` +
          (x.badge ? `  (dotyczy Ciebie: ${x.badge})` : ""));
      }
      return 0;
    }

    case "seen": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk seen <#kanal|@kto>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      await api.call("POST", `/api/conversations/${id}/read`, {});
      out(`oznaczone jako przeczytane: ${rest[0]}`);
      return 0;
    }

    case "since": {
      const r = await api.call("GET", "/api/digest");
      const d = r.digest as {
        count: number; byWho: Array<[string, number]>; byConversation: Array<[string, number]>;
        mentions: Msg[]; open: Array<{ id: number; message: Msg }>;
      } | null;
      if (!d) {
        out("Nic nowego od Twojej ostatniej aktywnosci.");
        return 0;
      }
      out(`Pod Twoja nieobecnosc: ${d.count} wiadomosci`);
      out("  kto:    " + d.byWho.map(([k, v]) => `${k} x${v}`).join(", "));
      out("  gdzie:  " + d.byConversation.map(([k, v]) => `${k} x${v}`).join(", "));
      if (d.mentions.length) {
        const { who, conv } = await nameMaps(api);
        out(`\n  DOTYCZY CIEBIE (${d.mentions.length}):`);
        for (const m of d.mentions.slice(-3)) out("  " + fmtMsg(m, who, conv));
      }
      if (d.open.length) {
        out(`\n  OTWARTE PYTANIA (${d.open.length}):`);
        for (const q of d.open) out(`    [q${q.id}] ${q.message.body.slice(0, 90)}`);
      }
      return 0;
    }

    case "mentions": {
      const r = await api.call("GET", "/api/mentions");
      const messages = r.messages as Msg[];
      if (messages.length === 0) {
        out("Brak wzmianek.");
        return 0;
      }
      const { who, conv } = await nameMaps(api);
      for (const m of messages) out(fmtMsg(m, who, conv));
      return 0;
    }

    case "search": {
      const ref = rest.find((a) => a.startsWith("#"));
      const q = rest.filter((a) => !a.startsWith("#")).join(" ");
      if (!q) {
        process.stderr.write("uzycie: atalk search <fraza> [#kanal]\n");
        return 1;
      }
      const params = new URLSearchParams({ q });
      if (ref) params.set("conversationId", String(await resolveConv(api, ref)));
      const sinceTs = flagStr(args, "since-ts");
      const untilTs = flagStr(args, "until-ts");
      if (sinceTs) params.set("sinceTs", sinceTs);
      if (untilTs) params.set("untilTs", untilTs);
      const r = await api.call("GET", `/api/search?${params}`);
      const messages = r.messages as Msg[];
      out(`${messages.length} trafien:`);
      const { who, conv } = await nameMaps(api);
      for (const m of messages) out(fmtMsg(m, who, conv));
      return 0;
    }

    case "follow": {
      const { who, conv } = await nameMaps(api);
      const afterRaw = flagStr(args, "after");
      // NaN z niecyfrowego --after serwer bierze jak 0 i wypisuje cala historie.
      let cursor: number | undefined =
        afterRaw !== undefined && /^\d+$/.test(afterRaw) ? Number(afterRaw) : undefined;
      out("strumien na zywo (Ctrl+C konczy)...");
      // Reconnect: SSE bywa zrywane przez proxy; wznawiamy od ostatniego id.
      for (;;) {
        try {
          for await (const ev of api.events(cursor)) {
            if (ev.type !== "message" && ev.type !== "message_updated") continue;
            const m = ev.message as Msg;
            if (m.id) cursor = m.id;
            if (who.get(m.actorId) === undefined || conv.get(m.conversationId) === undefined) {
              const maps = await nameMaps(api);
              for (const [k, v] of maps.who) who.set(k, v);
              for (const [k, v] of maps.conv) conv.set(k, v);
            }
            out(fmtMsg(m, who, conv) + (ev.type === "message_updated" ? "  (zmieniona)" : ""));
          }
        } catch (err) {
          out(`(strumien zerwany: ${err instanceof Error ? err.message : err}; wznawiam za 2 s)`);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    case "who": {
      const r = await api.call("GET", "/api/presence");
      const rows = r.presence as Array<{
        handle: string; label: string; online: boolean; typing: boolean; busy: boolean;
        doing: string | null; lastSeenAt: number;
      }>;
      if (rows.length === 0) {
        out("Nikogo nie ma.");
        return 0;
      }
      for (const p of rows) {
        const state = p.typing ? "PISZE" : p.busy ? "pracuje" : p.online ? "aktywna" : "cisza";
        const age = Math.round(Date.now() / 1000 - p.lastSeenAt);
        const ago = age < 60 ? `${age}s` : `${Math.round(age / 60)}min`;
        out(`  [${state.padEnd(8)}] @${p.handle} (${p.label})  ostatnio ${ago} temu` +
          (p.doing ? `  robi: ${p.doing}` : ""));
      }
      return 0;
    }

    case "channels": {
      const r = await api.call("GET", "/api/conversations");
      const memberships = new Set(
        (r.memberships as Array<{ conversationId: number }>).map((m) => m.conversationId),
      );
      for (const c of r.conversations as Array<{
        id: number; kind: string; slug: string | null; topic: string;
      }>) {
        const name = c.slug ? `#${c.slug}` : `[${c.kind}:${c.id}]`;
        const mine = memberships.has(c.id) ? "" : "  (nie jestes czlonkiem - atalk join)";
        out(`  ${name}${c.topic ? `  - ${c.topic}` : ""}${mine}`);
      }
      return 0;
    }

    case "say":
    case "in":
    case "to":
    case "thread": {
      let ref: string, body: string, threadId: number | undefined;
      if (cmd === "say") {
        ref = "#general";
        body = rest.join(" ");
      } else if (cmd === "thread") {
        threadId = Number(rest[0]);
        body = rest.slice(1).join(" ");
        if (!Number.isFinite(threadId) || !body) {
          process.stderr.write("uzycie: atalk thread <id-wiadomosci> <tekst>\n");
          return 1;
        }
        // konwersacja wynika z wiadomosci-korzenia
        const t = await api.call("GET", `/api/messages/${threadId}/thread`);
        ref = String((t.messages as Msg[])[0].conversationId);
      } else {
        ref = rest[0] ?? "";
        body = rest.slice(1).join(" ");
      }
      if (!ref || !body) {
        process.stderr.write(`uzycie: atalk ${cmd} ${cmd === "say" ? "<tekst>" : "<adres> <tekst>"}\n`);
        return 1;
      }
      const id = await resolveConv(api, ref);
      const r = await api.call("POST", `/api/conversations/${id}/messages`, {
        body, threadId, sessionId: sessionId(args),
        // Idempotencja: retry z tym samym --msg-id oddaje istniejaca wiadomosc
        // zamiast dublowac ja (postMessage ma pelna dedup po clientMsgId).
        // undefined znika przy JSON.stringify, wiec brak flagi = brak zmiany
        // zachowania (audyt #9).
        clientMsgId: flagStr(args, "msg-id"),
      });
      const m = r.message as { id: number };
      let deliveryNote = "";
      if (Array.isArray(r.delivery)) {
        deliveryNote = "  ->  " + (r.delivery as Array<{
          handle: string; online: boolean; lastSeenAt: number | null;
        }>).map((d) => {
          const state = d.online ? "zywa" : d.lastSeenAt
            ? `cisza ${Math.round((Date.now() / 1000 - d.lastSeenAt) / 60)} min`
            : "NIEOBECNA";
          return `@${d.handle}: ${state}`;
        }).join(", ");
      }
      out(`wyslane [${m.id}]${deliveryNote}`);
      return 0;
    }

    case "react": {
      if (rest.length < 2) {
        process.stderr.write("uzycie: atalk react <id-wiadomosci> <emoji>\n");
        return 1;
      }
      const r = await api.call("POST", `/api/messages/${rest[0]}/reactions`, { emoji: rest[1] });
      out(r.on ? "reakcja dodana" : "reakcja zdjeta");
      return 0;
    }

    case "ask": {
      if (rest.length < 2) {
        process.stderr.write("uzycie: atalk ask <#kanal> <pytanie>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      const r = await api.call("POST", `/api/conversations/${id}/ask`, {
        body: rest.slice(1).join(" "), sessionId: sessionId(args),
      });
      out(`otwarte pytanie [q${r.question}] - odpowie ktokolwiek: atalk answer ${r.question} <tekst>`);
      return 0;
    }

    case "answer": {
      if (rest.length < 2) {
        process.stderr.write("uzycie: atalk answer <qid> <tekst>\n");
        return 1;
      }
      await api.call("POST", `/api/questions/${rest[0].replace(/^q/, "")}/answer`, {
        body: rest.slice(1).join(" "), sessionId: sessionId(args),
      });
      out(`odpowiedziane na q${rest[0].replace(/^q/, "")}`);
      return 0;
    }

    case "open": {
      const params = rest[0] ? `?conversationId=${await resolveConv(api, rest[0])}` : "";
      const r = await api.call("GET", `/api/questions/open${params}`);
      const questions = r.questions as Array<{ id: number; message: Msg }>;
      if (questions.length === 0) {
        out("Brak otwartych pytan.");
        return 0;
      }
      const { who, conv } = await nameMaps(api);
      out(`${questions.length} otwartych:`);
      for (const q of questions) out(`  [q${q.id}]` + fmtMsg(q.message, who, conv).slice(1));
      return 0;
    }

    case "edit": {
      if (rest.length < 2) {
        process.stderr.write("uzycie: atalk edit <id> <tekst>\n");
        return 1;
      }
      await api.call("PATCH", `/api/messages/${rest[0]}`, { body: rest.slice(1).join(" ") });
      out("zmienione");
      return 0;
    }

    case "rm": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk rm <id>\n");
        return 1;
      }
      await api.call("DELETE", `/api/messages/${rest[0]}`);
      out("skasowane");
      return 0;
    }

    case "pin":
    case "unpin": {
      if (!rest[0]) {
        process.stderr.write(`uzycie: atalk ${cmd} <id-wiadomosci>\n`);
        return 1;
      }
      await api.call(cmd === "pin" ? "POST" : "DELETE", `/api/messages/${rest[0]}/pin`);
      out(cmd === "pin" ? `przypiete ${rest[0]}` : `odpiete ${rest[0]}`);
      return 0;
    }

    case "pins": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk pins <#kanal|@kto>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      const r = await api.call("GET", `/api/conversations/${id}/pins`);
      const pins = r.pins as Array<{ messageId: number; by: string }>;
      if (pins.length === 0) {
        out("Nic nie przypiete.");
        return 0;
      }
      const msgs = await api.call("GET", `/api/conversations/${id}/messages?limit=500`);
      const byId = new Map((msgs.messages as Msg[]).map((m) => [m.id, m]));
      for (const p of pins) {
        const m = byId.get(p.messageId);
        out(`  [${p.messageId}] ${m ? m.body.slice(0, 100) : "(starsza wiadomosc)"}  ` +
          `(przypiete przez @${p.by})`);
      }
      return 0;
    }

    case "channel": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk channel <#nazwa> [--private] [--topic ...]\n");
        return 1;
      }
      const r = await api.call("POST", "/api/conversations", {
        kind: args.flags.private === true ? "private" : "public",
        slug: rest[0],
        topic: flagStr(args, "topic"),
      });
      const c = r.conversation as { slug: string; kind: string };
      out(`zalozony kanal #${c.slug} (${c.kind})`);
      return 0;
    }

    case "join":
    case "leave": {
      if (!rest[0]) {
        process.stderr.write(`uzycie: atalk ${cmd} <#kanal>\n`);
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      if (cmd === "join") {
        await api.call("POST", `/api/conversations/${id}/join`);
        out(`dolaczono do ${rest[0]}`);
      } else {
        await api.call("POST", `/api/conversations/${id}/leave`);
        out(`opuszczono ${rest[0]}`);
      }
      return 0;
    }

    case "invite": {
      if (rest.length < 2) {
        process.stderr.write("uzycie: atalk invite <#kanal> <@kto>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      await api.call("POST", `/api/conversations/${id}/members`, {
        handle: rest[1].replace(/^@/, ""),
      });
      out(`zaproszono ${rest[1]} do ${rest[0]}`);
      return 0;
    }

    case "notify": {
      if (rest.length < 2 || !["all", "mentions", "none"].includes(rest[1])) {
        process.stderr.write("uzycie: atalk notify <#kanal> all|mentions|none\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      await api.call("POST", `/api/conversations/${id}/notify`, { notify: rest[1] });
      out(`powiadomienia dla ${rest[0]}: ${rest[1]}`);
      return 0;
    }

    case "me":
    case "ping":
    case "doing": {
      const body: Record<string, unknown> = { sessionId: sessionId(args) };
      if (cmd === "me" && rest.length) body.label = rest.join(" ");
      if (cmd === "doing") body.doing = rest.join(" ");
      if (flagStr(args, "kind") === "ephemeral") body.kind = "ephemeral";
      await api.call("POST", "/api/sessions", body);
      if (cmd === "me") out(`sesja ${sessionId(args)} zarejestrowana` +
        (body.label ? ` jako "${body.label}"` : ""));
      if (cmd === "doing") out(`ustawione: ${body.doing}`);
      return 0;
    }

    case "typing":
    case "busy": {
      await api.call("POST", "/api/sessions", { sessionId: sessionId(args) });
      // atalk typing [#kanal|@handle|wiki:slug] [--stop] - kuleczka "pisze"
      // przy wlasciwym miejscu; --stop gasi ja od razu (rezygnacja).
      const where = cmd === "typing" ? rest[0] : undefined;
      const typingIn = !where ? undefined
        : where.startsWith("wiki:") ? `w:${where.slice(5)}`
        : `c:${await resolveConv(api, where)}`;
      await api.call("POST", `/api/sessions/${encodeURIComponent(sessionId(args))}/signal`, {
        kind: cmd,
        ...(typingIn ? { in: typingIn } : {}),
        ...(cmd === "typing" && args.flags.stop === true ? { stop: true } : {}),
      });
      return 0;
    }

    case "bye": {
      await api.call("DELETE", `/api/sessions/${encodeURIComponent(sessionId(args))}`);
      out("sesja zakonczona");
      return 0;
    }

    case "claim": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk claim <zasob> [--ttl N] [--note ...]\n");
        return 1;
      }
      const r = await api.call("POST", "/api/leases", {
        resource: rest[0],
        ttlSec: Number(flagStr(args, "ttl") ?? 0) || undefined,
        note: flagStr(args, "note"),
        sessionId: sessionId(args),
      }, { allow409: true });
      if (r.granted) {
        const lease = r.lease as { expiresAt: number };
        out(`GRANTED ${rest[0]} na ${lease.expiresAt - Math.floor(Date.now() / 1000)} s`);
        return 0;
      }
      const held = r.heldBy as { handle: string; expiresAt: number; note: string | null };
      out(`HELD-BY @${held.handle} jeszcze ${held.expiresAt - Math.floor(Date.now() / 1000)} s` +
        (held.note ? ` (${held.note})` : ""));
      return 1;
    }

    case "release": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk release <zasob>\n");
        return 1;
      }
      const r = await api.call("POST", "/api/leases/release", { resource: rest[0] },
        { allow409: true });
      if (r.released) {
        out("UNLOCKED");
        return 0;
      }
      out(`DENIED - trzyma @${(r.heldBy as { handle: string }).handle}`);
      return 1;
    }

    case "locks": {
      const r = await api.call("GET", "/api/leases");
      const leases = r.leases as Array<{
        resource: string; handle: string; expiresAt: number; note: string | null;
      }>;
      if (leases.length === 0) {
        out("Nic nie jest zajete.");
        return 0;
      }
      const now = Math.floor(Date.now() / 1000);
      for (const l of leases) {
        out(`  ${l.resource.padEnd(30)} @${l.handle.padEnd(16)} ${l.expiresAt - now}s` +
          (l.note ? `  (${l.note})` : ""));
      }
      return 0;
    }

    case "send-file": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk send-file <sciezka> [--to <#kanal|@kto>] " +
          "[--sensitive] [--ttl N] [--burn]\n");
        return 1;
      }
      const data = readFileSync(rest[0]);
      const id = await resolveConv(api, flagStr(args, "to") ?? "#general");
      const headers: Record<string, string> = {
        "x-file-name": encodeURIComponent(basename(rest[0])),
        "x-session-id": sessionId(args),
      };
      if (args.flags.sensitive === true) headers["x-sensitive"] = "1";
      if (args.flags.burn === true) headers["x-burn"] = "1";
      const ttl = flagStr(args, "ttl");
      if (ttl) headers["x-ttl"] = ttl;
      const r = await api.upload(`/api/conversations/${id}/files`, data, headers);
      const file = r.file as { id: string; name: string; size: number };
      out(`wyslane: ${file.name} (${file.size} B)  id=${file.id}`);
      return 0;
    }

    case "files": {
      if (!rest[0]) {
        process.stderr.write("uzycie: atalk files <#kanal|@kto>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      const r = await api.call("GET", `/api/conversations/${id}/files`);
      const files = r.files as Array<{
        id: string; name: string; size: number; sensitive: boolean; expiresAt: number | null;
      }>;
      if (files.length === 0) {
        out("Brak plikow.");
        return 0;
      }
      for (const f of files) {
        const now = Math.floor(Date.now() / 1000);
        out(`  [${f.id}] ${f.name} (${f.size} B)` +
          (f.sensitive ? " [wrazliwy]" : "") +
          (f.expiresAt ? ` wygasa za ${Math.max(0, f.expiresAt - now)}s` : ""));
      }
      out("\nPobierz: atalk get-file <id> <sciezka>");
      return 0;
    }

    case "get-file": {
      if (rest.length < 2) {
        process.stderr.write("uzycie: atalk get-file <id> <sciezka-docelowa>\n");
        return 1;
      }
      const data = await api.download(`/api/files/${rest[0]}`);
      writeFileSync(rest[1], data);
      out(`zapisane ${data.length} B -> ${rest[1]}`);
      return 0;
    }

    case "wiki":
      return await runWiki(api, rest, args, out);

    default:
      process.stderr.write(`nieznana komenda: ${cmd}\n\n${USAGE}`);
      return 1;
  }
}

async function runWiki(api: Api, rest: string[], args: Args, out: (s: string) => void):
  Promise<number> {
  const sub = rest[0];
  const rrest = rest.slice(1);
  const enc = (s: string) => encodeURIComponent(s);
  switch (sub) {
    case "search": {
      const q = rrest.join(" ");
      if (!q) { process.stderr.write("uzycie: atalk wiki search <fraza>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/search?q=${enc(q)}`);
      const hits = r.hits as Array<{ slug: string; title: string; snippet: string }>;
      if (hits.length === 0) { out("Brak trafien. Zaloz strone: atalk wiki write <slug> --title ..."); return 0; }
      for (const h of hits) out(`  [${h.slug}] ${h.title}\n      ${h.snippet}`);
      return 0;
    }
    case "list": {
      const r = await api.call("GET", "/api/wiki");
      const pages = r.pages as Array<{ slug: string; title: string; updatedBy: string | null }>;
      if (pages.length === 0) { out("Wiki jest pusta."); return 0; }
      for (const p of pages) out(`  [${p.slug}] ${p.title}  (zmiana: @${p.updatedBy ?? "?"})`);
      return 0;
    }
    case "read": {
      if (!rrest[0]) { process.stderr.write("uzycie: atalk wiki read <slug>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}`);
      const p = r.page as { title: string; slug: string; body: string; updatedBy: string | null; revisions: number };
      out(`# ${p.title}  (${p.slug})`);
      out(`ostatnia zmiana: @${p.updatedBy ?? "?"}, rewizji: ${p.revisions}\n`);
      out(p.body);
      const files = r.files as Array<{ id: string; name: string; size: number }>;
      if (files.length) { out("\nZalaczniki:"); for (const f of files) out(`  [${f.id}] ${f.name} (${f.size} B)`); }
      return 0;
    }
    case "write": {
      const slugIdx = rrest.findIndex((a) => !a.startsWith("-"));
      if (slugIdx === -1) { process.stderr.write("uzycie: atalk wiki write <slug> --title \"...\" [--file plik | --stdin | tekst]\n"); return 1; }
      const slug = rrest[slugIdx];
      // Tresc budujemy z POZYCJI po slugu, nie z filter(a => a !== slug) - ten
      // drugi usuwal KAZDE wystapienie slugu jako slowa, wiec tresc zawierajaca
      // slug jako zwykle slowo tracila je po cichu. Kazdy nieznany token z '-' po
      // slugu to najpewniej ZAPOMNIANA FLAGA (np. --force/--base nieujete w
      // KNOWN_FLAGS), nie tresc strony - inaczej lduje po cichu W TRESCI strony
      // i zostaje tam trwale w historii rewizji (audyt #3).
      const afterSlug = rrest.slice(slugIdx + 1);
      const strayFlag = afterSlug.find((a) => a.startsWith("-"));
      if (strayFlag) {
        process.stderr.write(
          `nieznana flaga ${strayFlag} (albo dodaj ja do KNOWN_FLAGS, albo usun z wywolania)\n`,
        );
        return 1;
      }
      let text: string;
      const file = flagStr(args, "file");
      if (args.flags.stdin === true) text = readFileSync(0, "utf8");
      else if (file) text = readFileSync(file, "utf8");
      else text = afterSlug.join(" ");
      // Celowo NIE pobieramy strony przed zapisem: to serwer ma sprawdzic, czy
      // wiesz, co nadpisujesz, a automatyczny odczyt "w tle" tylko obszedlby
      // straz - przeczytalby za Ciebie klient, nie Ty.
      const base = flagStr(args, "base");
      const r = await api.call("PUT", `/api/wiki/${enc(slug)}`, {
        title: flagStr(args, "title") ?? slug,
        body: text,
        note: flagStr(args, "note"),
        ...(base !== undefined ? { baseRevision: Number(base) } : {}),
        ...(args.flags.force === true ? { force: true } : {}),
      });
      const p = r.page as { slug: string; title: string; revisions: number; lastRevisionId: number };
      out(`zapisane: [${p.slug}] "${p.title}" (rewizja ${p.lastRevisionId}, ${p.revisions} w historii)`);
      return 0;
    }
    case "revision": {
      // Tresc starej rewizji - to jest odpowiedz na "nadpisalem cudza strone,
      // jak odzyskam to, co tam bylo": historia listuje, ta trasa oddaje tresc.
      if (rrest.length < 2) { process.stderr.write("uzycie: atalk wiki revision <slug> <id>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}/revisions/${enc(rrest[1])}`);
      const rev = r.revision as { id: number; actor: string | null; title: string; body: string };
      out(`# ${rev.title}  (rewizja ${rev.id}, @${rev.actor ?? "?"})\n`);
      out(rev.body);
      return 0;
    }
    case "delete": case "rm": {
      if (!rrest[0]) { process.stderr.write("uzycie: atalk wiki delete <slug>\n"); return 1; }
      const r = await api.call("DELETE", `/api/wiki/${enc(rrest[0])}`);
      const d = r.deleted as { slug: string; title: string; movedChildren: number };
      out(`skasowane: [${d.slug}] "${d.title}"` +
        (d.movedChildren ? ` (podstron przeniesionych wyzej: ${d.movedChildren})` : ""));
      return 0;
    }
    case "revert": {
      if (rrest.length < 2) { process.stderr.write("uzycie: atalk wiki revert <slug> <id-rewizji>\n"); return 1; }
      const r = await api.call("POST", `/api/wiki/${enc(rrest[0])}/revert`, { revisionId: Number(rrest[1]) });
      const p2 = r.page as { slug: string; title: string; lastRevisionId: number };
      out(`przywrocone: [${p2.slug}] "${p2.title}" (jako nowa rewizja ${p2.lastRevisionId})`);
      return 0;
    }
    case "history": {
      if (!rrest[0]) { process.stderr.write("uzycie: atalk wiki history <slug>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}/history`);
      const revs = r.revisions as Array<{ id: number; actor: string | null; note: string | null; createdAt: number }>;
      for (const rv of revs) {
        const when = new Date(rv.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ");
        out(`  #${rv.id}  ${when}  @${rv.actor ?? "?"}${rv.note ? `  - ${rv.note}` : ""}`);
      }
      return 0;
    }
    case "attach": {
      if (rrest.length < 2) { process.stderr.write("uzycie: atalk wiki attach <slug> <sciezka>\n"); return 1; }
      const data = readFileSync(rrest[1]);
      const r = await api.upload(`/api/wiki/${enc(rrest[0])}/files`, data, {
        "x-file-name": encodeURIComponent(basename(rrest[1])),
      });
      const f = r.file as { id: string; name: string; size: number };
      out(`podpiete do [${rrest[0]}]: ${f.name} (${f.size} B)  id=${f.id}`);
      return 0;
    }
    case "files": {
      if (!rrest[0]) { process.stderr.write("uzycie: atalk wiki files <slug>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}/files`);
      const files = r.files as Array<{ id: string; name: string; size: number }>;
      if (files.length === 0) { out("Brak zalacznikow."); return 0; }
      for (const f of files) out(`  [${f.id}] ${f.name} (${f.size} B)`);
      out("\nPobierz: atalk get-file <id> <sciezka>");
      return 0;
    }
    default:
      process.stderr.write("uzycie: atalk wiki search|list|read|write|history|revision|revert|delete|attach|files\n");
      return 1;
  }
}
