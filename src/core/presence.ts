/**
 * Obecnosc.
 *
 * Dwa sygnaly, celowo rozdzielone - to jedna z lepszych decyzji prototypu:
 *
 *   typing - czlowiek faktycznie stuka w klawiature w UI (gasnie po 7 s)
 *   busy   - sesja uzyla narzedzia (gasnie po 30 s)
 *
 * Sygnal "pracuje" MUSI pochodzic z uzycia narzedzia, nigdy z pollowania API.
 * Inaczej otwarta karta przegladarki udaje prace, a wtedy wskaznik nie niesie
 * zadnej informacji.
 *
 * Rodzaj sesji jest DEKLAROWANY przy rejestracji, nie zgadywany z ksztaltu nazwy.
 * Prototyp zgadywal po prefiksie ("bs/") i sufiksie ("/oneshot"), przez co wcielenia
 * subagentow swiecily sie jako aktywne dziesiec minut po smierci.
 */
import type { Ctx } from "./ctx.ts";
import { notFound } from "./errors.ts";

/**
 * Ile sekund zyje sygnal "pisze" bez odswiezenia.
 *
 * Siedem sekund jest dobre dla CZLOWIEKA: kazde uderzenie w klawisz odswieza
 * sygnal, wiec bak nika chwile po tym, jak ktos przestal pisac. Dla AGENTA jest
 * bezuzyteczne - agent "pisze" jednym ruchem, ktory trwa kilkadziesiat sekund
 * albo minute, i nie ma czego odswiezac po drodze. Zmierzone na tej instancji:
 * 8 z 26 sesji ustawilo sygnal KIEDYKOLWIEK, wiekszosc z nich to moje proby.
 * Funkcja istniala i byla nieuzywalna dla polowy uczestnikow tego kanalu.
 *
 * Dlatego sygnal moze nieść WLASNY czas zycia (do TYPING_MAX). Nie grozi to
 * wiszacymi bakami, bo wyslanie wiadomosci gasi sygnal natychmiast - a stop
 * jest jednym wywolaniem.
 */
export const TYPING_TTL = 7;
export const TYPING_MAX = 300;
export const BUSY_TTL = 30;
export const ONLINE_WINDOW = 900;
export const STALE_DURABLE = 600;
export const STALE_EPHEMERAL = 60;
// Sesja trwala bez heartbeatu dluzej niz to znika z obecnosci. Feedback z
// #nextIteration: lista uczestnikow prototypu rosla monotonicznie i nowa sesja
// czytala 14 martwych rozmowcow przy 3 zywych. Klucz do bezpieczenstwa tej
// operacji: znika WPIS OBECNOSCI, nie tozsamosc - aktor zostaje w rosterze
// (tabela actors) i jego etykieta nie ma jak sie "wyprowadzic", co bylo bledem
// prototypu przy kasowaniu po bezczynnosci.
export const PRESENCE_RETENTION = 7 * 24 * 3600;

export type SessionKind = "durable" | "ephemeral";

export type PresenceRow = {
  sessionId: string;
  actorId: number;
  handle: string;
  displayName: string;
  label: string;
  kind: SessionKind;
  doing: string | null;
  cwd: string | null;
  lastSeenAt: number;
  online: boolean;
  stale: boolean;
  typing: boolean;
  /** Gdzie pisze: "c:<convId>" / "w:<slug wiki>" / null (sygnal bez miejsca). */
  typingIn: string | null;
  busy: boolean;
};

export function registerSession(
  ctx: Ctx,
  input: {
    sessionId: string;
    actorId: number;
    label?: string;
    kind?: SessionKind;
    cwd?: string | null;
    host?: string | null;
  },
): void {
  const exists = ctx.db.prepare("SELECT id FROM actors WHERE id = ?").get(input.actorId);
  if (!exists) throw notFound("aktor", `nie ma aktora ${input.actorId}`);
  const now = ctx.now();
  // Stan PRZED zapisem - do rozstrzygniecia, czy ktokolwiek zobaczy roznice.
  const przed = ctx.db
    .prepare("SELECT label, kind, ended_at FROM sessions WHERE id = ?")
    .get(input.sessionId) as { label: string; kind: string; ended_at: number | null } | undefined;
  // COALESCE(excluded, sessions): pola PODANE nadpisuja, POMINIETE zostaja.
  // `atalk ping`/`busy`/`typing` wolaja to samo POST /api/sessions z samym
  // sessionId - bez tego heartbeat kasowal etykiete ustawiona przez `atalk me`
  // (label spadal do sessionId.slice(0,8), kind/cwd/host do domyslnych), przez
  // co rozmowca co chwile zmienial nazwe w obecnosci.
  ctx.db
    .prepare(
      `INSERT INTO sessions(id, actor_id, label, kind, cwd, host, started_at, last_seen_at)
       VALUES(:id, :actor, :label, :kind, :cwd, :host, :now, :now)
       ON CONFLICT(id) DO UPDATE SET
         label = COALESCE(:labelOrNull, sessions.label),
         kind = COALESCE(:kindOrNull, sessions.kind),
         cwd = COALESCE(:cwd, sessions.cwd),
         host = COALESCE(:host, sessions.host),
         last_seen_at = :now,
         ended_at = NULL`,
    )
    .run({
      id: input.sessionId,
      actor: input.actorId,
      label: input.label ?? input.sessionId.slice(0, 8),
      kind: input.kind ?? "durable",
      cwd: input.cwd ?? null,
      host: input.host ?? null,
      now,
      // przy UPDATE: null = "nie ruszaj tego pola"
      labelOrNull: input.label ?? null,
      kindOrNull: input.kind ?? null,
    });
  sprzatnijMartweSesje(ctx);

  // Rozgloszenie TYLKO przy realnej zmianie. Interfejs bije heartbeat co 30 s
  // tym samym wywolaniem, wiec bezwarunkowa publikacja oznaczala, ze przy N
  // otwartych sesjach kazda z nich co 30 s budzila wszystkie pozostale: ruch
  // rosnie z kwadratem liczby uczestnikow, a tresc zdarzenia jest za kazdym
  // razem ta sama ("cos w obecnosci"). Samo odswiezenie znacznika czasu nie
  // zmienia niczego, co ktokolwiek widzi - przez pierwsze 60 s od ostatniego
  // kontaktu sesja i tak jest "online".
  const nowaSesja = przed === undefined;
  const wrocila = przed?.ended_at != null;
  const zmienionaEtykieta = input.label !== undefined && input.label !== przed?.label;
  const zmienionyRodzaj = input.kind !== undefined && input.kind !== przed?.kind;
  if (nowaSesja || wrocila || zmienionaEtykieta || zmienionyRodzaj) {
    ctx.bus.publish(allActorIds(ctx), { type: "presence" });
  }
}

/** Sprzatanie martwych sesji. Tabela `sessions` rosla bez konca (kazde
 *  uruchomienie CLI zostawialo wiersz), a `presence()` czyta ja W CALOSCI przy
 *  kazdym odczycie - wiec koszt listy obecnych rosl z historia uruchomien, a nie
 *  z liczba obecnych. Zamiast osobnego zadania: sprzatamy leniwie, przy zapisie. */
const MARTWA_SESJA_SEK = 7 * 24 * 3600;
function sprzatnijMartweSesje(ctx: Ctx): void {
  ctx.db.prepare("DELETE FROM sessions WHERE COALESCE(ended_at, last_seen_at) < ?")
    .run(ctx.now() - MARTWA_SESJA_SEK);
}

export function heartbeat(ctx: Ctx, sessionId: string): void {
  ctx.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(ctx.now(), sessionId);
}

export function setDoing(ctx: Ctx, sessionId: string, doing: string | null): void {
  ctx.db
    .prepare("UPDATE sessions SET doing = ?, last_seen_at = ? WHERE id = ?")
    .run(doing, ctx.now(), sessionId);
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

/** Sygnal typing/busy. Dla typing mozna podac MIEJSCE ("c:<convId>" / "w:<slug>")
 *  oraz stop=true, gdy autor rozmyslil sie i kuleczka ma zniknac od razu
 *  (zamiast czekac na TTL). */
export function signal(
  ctx: Ctx,
  sessionId: string,
  kind: "typing" | "busy",
  opts?: { typingIn?: string | null; stop?: boolean; sec?: number | null },
): void {
  const now = ctx.now();
  if (kind === "typing") {
    if (opts?.stop) {
      ctx.db
        .prepare("UPDATE sessions SET typing_at = NULL, typing_in = NULL, typing_sec = NULL, last_seen_at = ? WHERE id = ?")
        .run(now, sessionId);
    } else {
      // Wlasny czas zycia zapisujemy OBOK znacznika, nie przez przesuniecie
      // znacznika w przyszlosc: inaczej "kiedy zaczal pisac" i "jak dlugo to
      // wazne" bylyby ta sama liczba i nie dalo by sie odroznic swiezego
      // sygnalu od dlugiego.
      const sec = opts?.sec == null ? null
        : Math.min(Math.max(Math.trunc(Number(opts.sec) || 0), 1), TYPING_MAX);
      ctx.db
        .prepare("UPDATE sessions SET typing_at = ?, typing_in = ?, typing_sec = ?, last_seen_at = ? WHERE id = ?")
        .run(now, opts?.typingIn ? String(opts.typingIn).slice(0, 100) : null, sec, now, sessionId);
    }
  } else {
    ctx.db
      .prepare("UPDATE sessions SET busy_at = ?, last_seen_at = ? WHERE id = ?")
      .run(now, now, sessionId);
  }
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

/** Wyslanie wiadomosci konczy pisanie - kuleczka znika bez czekania na TTL. */
export function clearTyping(ctx: Ctx, sessionId: string): void {
  ctx.db
    .prepare("UPDATE sessions SET typing_at = NULL, typing_in = NULL WHERE id = ?")
    .run(sessionId);
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

export function endSession(ctx: Ctx, sessionId: string): void {
  ctx.db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(ctx.now(), sessionId);
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

type SessionRow = {
  id: string;
  actor_id: number;
  handle: string;
  display_name: string;
  label: string;
  kind: SessionKind;
  cwd: string | null;
  last_seen_at: number;
  typing_at: number | null;
  typing_sec: number | null;
  typing_in: string | null;
  busy_at: number | null;
  doing: string | null;
  ended_at: number | null;
};

export function presence(ctx: Ctx): PresenceRow[] {
  const now = ctx.now();
  const rows = ctx.db
    .prepare(
      `SELECT s.id, s.actor_id, a.handle, a.display_name, s.label, s.kind, s.cwd,
              s.last_seen_at, s.typing_at, s.typing_in, s.typing_sec, s.busy_at, s.doing, s.ended_at
         FROM sessions s JOIN actors a ON a.id = s.actor_id
        ORDER BY a.handle, s.label, s.id`,
    )
    .all() as SessionRow[];

  const out: PresenceRow[] = [];
  for (const r of rows) {
    const age = now - r.last_seen_at;
    const staleAfter = r.kind === "ephemeral" ? STALE_EPHEMERAL : STALE_DURABLE;
    const stale = age > staleAfter;
    // Sesja ZAKONCZONA (sygnal konca, np. hook SessionEnd) znika z obecnosci
    // niezaleznie od rodzaju - obecnosc pokazuje, z kim mozna rozmawiac TERAZ,
    // a tozsamosc trzyma roster aktorow. Martwa efemeryda znika tez po ciszy,
    // sesja trwala dopiero po PRESENCE_RETENTION - bo bezczynnosc nie znaczy
    // koniec, a dla sesji bez petli jest stanem normalnym.
    if (r.ended_at) continue;
    if (r.kind === "ephemeral" && stale) continue;
    if (r.kind === "durable" && age > PRESENCE_RETENTION) continue;
    out.push({
      sessionId: r.id,
      actorId: r.actor_id,
      handle: r.handle,
      displayName: r.display_name,
      label: r.label,
      kind: r.kind,
      doing: r.doing,
      cwd: r.cwd,
      lastSeenAt: r.last_seen_at,
      online: !r.ended_at && age < ONLINE_WINDOW,
      stale,
      typing: r.typing_at !== null && now - r.typing_at < (r.typing_sec ?? TYPING_TTL),
      typingIn: r.typing_in,
      busy: r.busy_at !== null && now - r.busy_at < BUSY_TTL,
    });
  }
  return out;
}

/**
 * Zywotnosc AKTORA (naj-swiezsza z jego niezakonczonych sesji). Feedback
 * z #nextIteration: `talk to <ktokolwiek>` zawsze mowilo "wyslane" i nadawca
 * dowiadywal sie o martwym adresacie z braku odpowiedzi, po godzinie. Ta funkcja
 * zasila jedna linie potwierdzenia przy zapisie: zywy / cisza N min / nieobecny.
 */
export function actorLiveness(
  ctx: Ctx,
  actorId: number,
): { online: boolean; lastSeenAt: number | null } {
  const row = ctx.db
    .prepare(
      "SELECT MAX(last_seen_at) AS seen FROM sessions WHERE actor_id = ? AND ended_at IS NULL",
    )
    .get(actorId) as { seen: number | null };
  if (row.seen === null) return { online: false, lastSeenAt: null };
  return { online: ctx.now() - row.seen < ONLINE_WINDOW, lastSeenAt: row.seen };
}

/** Obecnosc jest informacja publiczna w obrebie instancji, wiec zdarzenie idzie
 *  do wszystkich. Lista jest krotka (aktorzy, nie sesje) i czytana z indeksu.
 *  Eksport: wiki (tez publiczna) uzywa tej samej listy odbiorcow. */
export function allActorIds(ctx: Ctx): number[] {
  const rows = ctx.db.prepare("SELECT id FROM actors WHERE disabled_at IS NULL").all() as Array<{
    id: number;
  }>;
  return rows.map((r) => r.id);
}
