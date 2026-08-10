/**
 * Agent tokens.
 *
 * A token belongs to an ACTOR, not to a session, and is revocable one at a time - one agent
 * can have a separate token for a VPS, a laptop and CI, and a leak of one does not force
 * rotation of the rest. Only the sha256 is in the database; the plain value is seen once,
 *when it is issued.
 * This is where the prototype's most dangerous property disappears: there, any process with
 * access to the directory could pass itself off as any participant through `TALK_SID`.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "./ctx.ts";
import { type Actor, getActor } from "./actors.ts";
import { notFound } from "./errors.ts";

export type TokenInfo = {
  id: number;
  actorId: number;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  expiresAt: number | null;
};

type TokenRow = {
  id: number;
  actor_id: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  expires_at: number | null;
};

const PREFIX = "atk_";

const toInfo = (r: TokenRow): TokenInfo => ({
  id: r.id,
  actorId: r.actor_id,
  name: r.name,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
  expiresAt: r.expires_at,
});

const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");

/**
 * The minimum sensible lifetime for an AGENT's token: 3 months.
 *
 * This is not a number from security but from watching the channel: an agent cannot renew
 * its own expired token, so instead of a rotation we get a new invite and a NEW actor next
 * to the old one - that is, a growing list of identities for the same person. A short token
 * makes sense where the secret sits on somebody else's machine (CI, a host executing
 * instructions from the network) - and there it is given deliberately.
 */
export const MIN_AGENT_TTL_SEC = 90 * 24 * 3600;

export function mintToken(
  ctx: Ctx,
  actorId: number,
  name: string,
  ttlSec?: number | null,
): { token: string; info: TokenInfo } {
  if (!getActor(ctx, actorId)) throw notFound("aktor", `nie ma aktora ${actorId}`);
  const token = PREFIX + randomBytes(32).toString("base64url");
  const now = ctx.now();
  // A short-lived token for an untrusted host (CI, a VPS executing instructions from public
  // HTTPS) - feedback 332c7e42: "a secret on a machine executing instructions from public
  // HTTPS is today's wound".
  const expiresAt = ttlSec && ttlSec > 0 ? now + Math.trunc(ttlSec) : null;
  ctx.db
    .prepare("INSERT INTO tokens(actor_id, hash, name, created_at, expires_at) VALUES(?,?,?,?,?)")
    .run(actorId, hashOf(token), name || "bez nazwy", now, expiresAt);
  const row = ctx.db
    .prepare("SELECT * FROM tokens WHERE hash = ?")
    .get(hashOf(token)) as TokenRow;
  return { token, info: toInfo(row) };
}

/**
 * Why a token was rejected - ONLY for a token that exists in the database.
 * It serves one purpose: so that an agent with a dead token hears "ask for a new token for
 * @X" instead of guessing "create a new identity". An unknown token gets no answer beyond
 * a generic 401 - an answer of "there is no such thing" must not be an oracle for which
 * tokens existed.
 */
export function tokenTrouble(
  ctx: Ctx,
  token: string,
): { reason: "wygasl" | "odwolany" | "aktor_wylaczony"; handle: string | null } | null {
  const raw = String(token ?? "").trim();
  if (!raw.startsWith(PREFIX)) return null;
  const row = ctx.db.prepare("SELECT * FROM tokens WHERE hash = ?").get(hashOf(raw)) as
    | TokenRow
    | undefined;
  if (!row) return null;
  const handle = getActor(ctx, row.actor_id)?.handle ?? null;
  if (row.revoked_at !== null) return { reason: "odwolany", handle };
  if (row.expires_at !== null && row.expires_at <= ctx.now()) return { reason: "wygasl", handle };
  if (getActor(ctx, row.actor_id)?.disabledAt) return { reason: "aktor_wylaczony", handle };
  return null;
}

/** Returns an actor or null. It does NOT throw - a bad token is ordinary network traffic,
 *  not an exceptional situation, and there is no reason for it to produce a stack trace. */
export function verifyToken(ctx: Ctx, token: string): Actor | null {
  const raw = String(token ?? "").trim();
  if (!raw.startsWith(PREFIX)) return null;
  // A lookup by sha256 in a UNIQUE column is the whole verification: a token has 256 bits of
  // entropy, so collisions and guessing are not real vectors, and extra "constant-time"
  // comparisons of a hash against itself would be theatre.
  const row = ctx.db
    .prepare("SELECT * FROM tokens WHERE hash = ? AND revoked_at IS NULL")
    .get(hashOf(raw)) as TokenRow | undefined;
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= ctx.now()) return null; // expired
  const actor = getActor(ctx, row.actor_id);
  if (!actor || actor.disabledAt) return null;
  // last_used_at is telemetry, so: (a) throttled to one write per minute, (b) best-effort -
  // when another process (a CLI import) is holding the write lock, authentication must NOT
  // fall over because of it, because that would take down every agent's GETs as well.
  // to takze wszystkie GET-y agentow.
  if (row.last_used_at === null || ctx.now() - row.last_used_at >= 60) {
    try {
      ctx.db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(ctx.now(), row.id);
    } catch {
      // a telemetry write - the next request will try again
    }
  }
  return actor;
}

/**
 * Revoking a token. Returns whether ANYTHING CHANGED - and that is not cosmetic: you revoke
 * a token at the moment you suspect a leak, and an "ok" in response to a typo in the id
 * looks exactly like an "ok" for a real revocation. The operator then stops looking, with
 * the leak still live.
 */
export function revokeToken(ctx: Ctx, tokenId: number): boolean {
  const r = ctx.db
    .prepare("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(ctx.now(), tokenId);
  return Number(r.changes ?? 0) > 0;
}

export function listTokens(ctx: Ctx, actorId: number): TokenInfo[] {
  const rows = ctx.db
    .prepare("SELECT * FROM tokens WHERE actor_id = ? ORDER BY id")
    .all(actorId) as TokenRow[];
  return rows.map(toInfo);
}
