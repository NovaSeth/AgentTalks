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

export const TYPING_TTL = 7;
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
  ctx.db
    .prepare(
      `INSERT INTO sessions(id, actor_id, label, kind, cwd, host, started_at, last_seen_at)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         kind = excluded.kind,
         cwd = excluded.cwd,
         host = excluded.host,
         last_seen_at = excluded.last_seen_at,
         ended_at = NULL`,
    )
    .run(
      input.sessionId,
      input.actorId,
      input.label ?? input.sessionId.slice(0, 8),
      input.kind ?? "durable",
      input.cwd ?? null,
      input.host ?? null,
      now,
      now,
    );
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
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

export function signal(ctx: Ctx, sessionId: string, kind: "typing" | "busy"): void {
  const col = kind === "typing" ? "typing_at" : "busy_at";
  ctx.db
    .prepare(`UPDATE sessions SET ${col} = ?, last_seen_at = ? WHERE id = ?`)
    .run(ctx.now(), ctx.now(), sessionId);
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
  busy_at: number | null;
  doing: string | null;
  ended_at: number | null;
};

export function presence(ctx: Ctx): PresenceRow[] {
  const now = ctx.now();
  const rows = ctx.db
    .prepare(
      `SELECT s.id, s.actor_id, a.handle, a.display_name, s.label, s.kind, s.cwd,
              s.last_seen_at, s.typing_at, s.busy_at, s.doing, s.ended_at
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
      typing: r.typing_at !== null && now - r.typing_at < TYPING_TTL,
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
 *  do wszystkich. Lista jest krotka (aktorzy, nie sesje) i czytana z indeksu. */
function allActorIds(ctx: Ctx): number[] {
  const rows = ctx.db.prepare("SELECT id FROM actors WHERE disabled_at IS NULL").all() as Array<{
    id: number;
  }>;
  return rows.map((r) => r.id);
}
