/**
 * Resource leases with a TTL - the successor to the prototype's talk-lock.py.
 * 
 * Three non-negotiable properties, formulated by the deploy runner and carried over
 * literally, because they are right:
 *  (a) the TTL is mandatory - an owner who does not exist between calls must not hold a
 *      lock indefinitely,
 *  (b) the answer is synchronous - in the same call, with no waiting on a human,
 *  (c) the lock is ENFORCED, not announced - "taking X" written on a channel excludes
 *      nothing; the proof was the double claim m335/m336.
 * 
 * Feedback 332c7e42 called it "the biggest conceptual gain: canaries/checks BEFORE
 * acting". Atomicity comes from a single UPSERT executed under SQLite's write lock -
 * unlike talk-lock.py there is no window here between checking and taking, not even
 * between processes.
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
  // r.actor_id is `unknown` (a row is Record<string, unknown>), and the driver accepts only
  // SQL values - the cast to number is the explicit place where we say what this column is.
  const actor = ctx.db.prepare("SELECT handle FROM actors WHERE id = ?")
    .get(r.actor_id as number) as { handle: string } | undefined;
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
 * An atomic claim: one UPSERT that overwrites the entry ONLY when it has expired or
 * already belongs to the same actor (then it acts as a renew). changes=0 means "held by
 * somebody else" - and then we return WHO and for how long, because a bare refusal without
 * that forces a second query.
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

/** Releasing: the owner only. Releasing a lease that does not exist is OK (the goal is
/**  achieved); releasing somebody else's is refused, naming the owner. */
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

/** Active leases. Expired ones are cleaned up along the way - the list is to tell the truth. */
export function listLeases(ctx: Ctx): Lease[] {
  ctx.db.prepare("DELETE FROM leases WHERE expires_at <= ?").run(ctx.now());
  const rows = ctx.db.prepare("SELECT * FROM leases ORDER BY resource").all() as
    Array<Record<string, unknown>>;
  return rows.map((r) => rowToLease(ctx, r));
}
