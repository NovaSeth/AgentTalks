/**
 * Dzierzawy zasobow z TTL - nastepca talk-lock.py z prototypu.
 *
 * Trzy nieodstepowalne wlasnosci, sformulowane przez deploy-runnera i przeniesione
 * doslownie, bo sa trafne:
 *  (a) TTL obowiazkowy - wlasciciel, ktory nie istnieje miedzy wywolaniami,
 *      nie moze trzymac blokady bezterminowo,
 *  (b) odpowiedz synchroniczna - w tym samym wywolaniu, zero czekania na czlowieka,
 *  (c) blokada SPRAWDZANA, nie ogloszona - "biore X" napisane na kanale nie wyklucza
 *      niczego; dowodem byl podwojny claim m335/m336.
 *
 * Feedback 332c7e42 nazwal to "najwiekszym zyskiem konceptualnym: kanarki/kontrole
 * PRZED dzialaniem". Atomowosc daje pojedynczy UPSERT wykonywany pod lockiem
 * zapisu SQLite - w odroznieniu od talk-lock.py nie ma tu okna miedzy sprawdzeniem
 * a zajeciem, nawet miedzy procesami.
 */
import type { Ctx } from "./ctx.ts";
import { badRequest } from "./errors.ts";

export const DEFAULT_LEASE_TTL = 120;
export const MAX_LEASE_TTL = 24 * 3600;

export type Lease = {
  resource: string;
  actorId: number;
  handle: string;
  sessionId: string | null;
  note: string | null;
  acquiredAt: number;
  expiresAt: number;
};

export type AcquireResult =
  | { granted: true; lease: Lease }
  | { granted: false; heldBy: Lease };

function normalizeResource(raw: string): string {
  const r = String(raw ?? "").trim();
  if (!r || r.length > 128 || /\s/.test(r)) {
    throw badRequest("zly_zasob", "nazwa zasobu: niepusta, bez spacji, do 128 znakow");
  }
  return r;
}

function clampTtl(ttl: number | undefined): number {
  const t = Number(ttl ?? DEFAULT_LEASE_TTL);
  if (!Number.isFinite(t) || t <= 0) return DEFAULT_LEASE_TTL;
  return Math.min(Math.trunc(t), MAX_LEASE_TTL);
}

function rowToLease(ctx: Ctx, r: Record<string, unknown>): Lease {
  const actor = ctx.db.prepare("SELECT handle FROM actors WHERE id = ?").get(r.actor_id) as
    | { handle: string }
    | undefined;
  return {
    resource: r.resource as string,
    actorId: r.actor_id as number,
    handle: actor?.handle ?? "?",
    sessionId: (r.session_id as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    acquiredAt: r.acquired_at as number,
    expiresAt: r.expires_at as number,
  };
}

/**
 * Atomowe zajecie: jeden UPSERT, ktory nadpisuje wpis TYLKO gdy wygasl albo nalezy
 * juz do tego samego aktora (wtedy dziala jak renew). changes=0 znaczy "trzymane
 * przez kogos innego" - i wtedy zwracamy KTO i na jak dlugo, bo sama odmowa bez
 * tej informacji zmusza do osobnego zapytania.
 */
export function acquire(
  ctx: Ctx,
  input: { resource: string; actorId: number; ttlSec?: number; sessionId?: string | null;
           note?: string | null },
): AcquireResult {
  const resource = normalizeResource(input.resource);
  const now = ctx.now();
  const expires = now + clampTtl(input.ttlSec);
  const res = ctx.db
    .prepare(
      `INSERT INTO leases(resource, actor_id, session_id, note, acquired_at, expires_at)
       VALUES(:res, :actor, :sess, :note, :now, :exp)
       ON CONFLICT(resource) DO UPDATE SET
         actor_id = excluded.actor_id,
         session_id = excluded.session_id,
         note = excluded.note,
         acquired_at = CASE WHEN leases.actor_id = excluded.actor_id
                            THEN leases.acquired_at ELSE excluded.acquired_at END,
         expires_at = excluded.expires_at
       WHERE leases.expires_at <= :now OR leases.actor_id = excluded.actor_id`,
    )
    .run({ res: resource, actor: input.actorId, sess: input.sessionId ?? null,
           note: input.note ?? null, now, exp: expires });

  const row = ctx.db.prepare("SELECT * FROM leases WHERE resource = ?").get(resource) as
    Record<string, unknown>;
  const lease = rowToLease(ctx, row);
  if (res.changes > 0) return { granted: true, lease };
  return { granted: false, heldBy: lease };
}

/** Zwolnienie: tylko wlasciciel. Zwolnienie nieistniejacej dzierzawy jest OK
 *  (cel osiagniety), cudzej - odmowa z podaniem wlasciciela. */
export function release(
  ctx: Ctx,
  input: { resource: string; actorId: number },
): { released: boolean; heldBy?: Lease } {
  const resource = normalizeResource(input.resource);
  const row = ctx.db.prepare("SELECT * FROM leases WHERE resource = ?").get(resource) as
    | Record<string, unknown>
    | undefined;
  if (!row) return { released: true };
  const lease = rowToLease(ctx, row);
  if (lease.actorId !== input.actorId && lease.expiresAt > ctx.now()) {
    return { released: false, heldBy: lease };
  }
  ctx.db.prepare("DELETE FROM leases WHERE resource = ?").run(resource);
  return { released: true };
}

/** Aktywne dzierzawy. Wygasle sa przy okazji sprzatane - lista ma mowic prawde. */
export function listLeases(ctx: Ctx): Lease[] {
  ctx.db.prepare("DELETE FROM leases WHERE expires_at <= ?").run(ctx.now());
  const rows = ctx.db.prepare("SELECT * FROM leases ORDER BY resource").all() as
    Array<Record<string, unknown>>;
  return rows.map((r) => rowToLease(ctx, r));
}
