/**
 * Actors: durable identities. A human or an agent.
 *
 * The difference from the prototype that drags half the rest of the project behind it: an
 * actor is NOT the same thing as a session. The prototype had one concept (`sid`), which
 * made two parallel sessions of the same agent two different participants to a human, or
 * gave them a "(2)" suffix. Here there is one actor and any number of sessions.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Ctx } from "./ctx.ts";
import { badRequest, conflict, notFound } from "./errors.ts";
import { normalizeHandle } from "./ids.ts";

export type ActorKind = "human" | "agent" | "system";

export type Actor = {
  id: number;
  kind: ActorKind;
  handle: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: number;
  disabledAt: number | null;
  /** The fingerprint of the avatar's content, or null. The client builds the image URL from
   *  it (`/api/actors/<id>/avatar?v=<avatar>`) - the fingerprint in the URL makes an avatar
   *  change visible immediately despite long caching. */
  avatar: string | null;
};

type ActorRow = {
  id: number;
  avatar_hash?: string | null;
  kind: ActorKind;
  handle: string;
  display_name: string;
  is_admin: number;
  created_at: number;
  disabled_at: number | null;
};

const toActor = (r: ActorRow): Actor => ({
  id: r.id,
  kind: r.kind,
  handle: r.handle,
  displayName: r.display_name,
  isAdmin: r.is_admin === 1,
  createdAt: r.created_at,
  disabledAt: r.disabled_at,
  avatar: r.avatar_hash ?? null,
});

export function createActor(
  ctx: Ctx,
  input: { kind: ActorKind; handle: string; displayName?: string; isAdmin?: boolean },
): Actor {
  const handle = normalizeHandle(input.handle);
  if (getActorByHandle(ctx, handle)) {
    throw conflict("handle_zajety", `handle "${handle}" jest juz zajety`);
  }
  const now = ctx.now();
  ctx.db
    .prepare(
      "INSERT INTO actors(kind, handle, display_name, is_admin, created_at) VALUES(?,?,?,?,?)",
    )
    .run(input.kind, handle, input.displayName?.trim() || handle, input.isAdmin ? 1 : 0, now);
  return getActorByHandle(ctx, handle)!;
}

export function getActor(ctx: Ctx, id: number): Actor | null {
  const row = ctx.db.prepare("SELECT * FROM actors WHERE id = ?").get(id) as ActorRow | undefined;
  return row ? toActor(row) : null;
}

export function getActorByHandle(ctx: Ctx, handle: string): Actor | null {
  // No normalizeHandle: this function is sometimes called with data from outside and should
  // answer "there is no such actor" rather than throw a validation error.
  const h = String(handle ?? "").trim().replace(/^@+/, "").toLowerCase();
  const row = ctx.db.prepare("SELECT * FROM actors WHERE handle = ?").get(h) as
    | ActorRow
    | undefined;
  return row ? toActor(row) : null;
}

/** A map id -> {handle, displayName, kind} for a set of messages. The consumer (an agent
 *  enforcing "approval for production only from a human", say) has to know CHEAPLY whether
 *  the author is human - feedback 332c7e42/claude-general. */
export function actorsByIds(
  ctx: Ctx,
  ids: readonly number[],
): Record<number, { handle: string; displayName: string; kind: ActorKind; avatar: string | null }> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return {};
  const marks = uniq.map(() => "?").join(",");
  // avatar_hash, not a path to a file: the client builds the URL itself, and the fingerprint
  // serves to invalidate the cache. The name of the file on disk is nobody's business.
  const rows = ctx.db
    .prepare(`SELECT id, handle, display_name, kind, avatar_hash FROM actors WHERE id IN (${marks})`)
    .all(...uniq) as Array<{ id: number; handle: string; display_name: string; kind: ActorKind;
                             avatar_hash: string | null }>;
  const out: Record<number, { handle: string; displayName: string; kind: ActorKind; avatar: string | null }> = {};
  for (const r of rows) {
    out[r.id] = { handle: r.handle, displayName: r.display_name, kind: r.kind, avatar: r.avatar_hash ?? null };
  }
  return out;
}

export function listActors(ctx: Ctx): Actor[] {
  const rows = ctx.db
    .prepare("SELECT * FROM actors WHERE disabled_at IS NULL ORDER BY handle")
    .all() as ActorRow[];
  return rows.map(toActor);
}

/** Disabling an account: the actor stops passing authentication (token, password, passkey),
 *  the history and the identity stay. Reversible. */
export function setDisabled(ctx: Ctx, actorId: number, disabled: boolean): Actor {
  const a = getActor(ctx, actorId);
  if (!a) throw notFound("aktor", `nie ma aktora ${actorId}`);
  ctx.db.prepare("UPDATE actors SET disabled_at = ? WHERE id = ?")
    .run(disabled ? ctx.now() : null, actorId);
  // Disabling an account has to close what is already open - otherwise "I disabled the
  // account" only means "it will not sign in again".
  if (disabled) bumpSessionEpoch(ctx, actorId);
  return getActor(ctx, actorId)!;
}

/**
 * Renaming (the handle of) an EXISTING actor - keeping the identity.
 *
 * It exists because the alternative is bad: without it, "I want a different name" ends in
 * redeeming a new invite, that is, a SECOND actor for the same person - and then the
 * history, mentions, memberships and tokens stay with the old one. The actor's number does
 * NOT change, so everything pointing at it keeps working: tokens, memberships,
 * notifications, authorship of messages and of wiki revisions.
 *
 * What this does NOT fix, and what has to be known: the text "@old-name" in messages
 * ALREADY written stays text - mentions were resolved to numbers at write time, so the
 * notifications arrived, but clicking the old text hits nobody. We do not rewrite other
 * people's messages, so that a rename does not change content somebody else authored.
 * zmieniala tresci, ktorej ktos inny jest autorem.
 */
export function renameActor(
  ctx: Ctx,
  actorId: number,
  newHandle: string,
  displayName?: string,
): Actor {
  const a = getActor(ctx, actorId);
  if (!a) throw notFound("aktor", `nie ma aktora ${actorId}`);
  const handle = normalizeHandle(newHandle);
  const zajety = getActorByHandle(ctx, handle);
  if (zajety && zajety.id !== actorId) {
    throw conflict("handle_zajety", `nazwa "${handle}" jest juz zajeta przez innego aktora`);
  }
  // displayName follows the handle by default ONLY when it was a copy of it before -
  // otherwise changing the technical name would wipe a manually set display name
  // ("Milosz / VPS").
  const nowaNazwa = displayName ?? (a.displayName === a.handle ? handle : a.displayName);
  ctx.db.prepare("UPDATE actors SET handle = ?, display_name = ? WHERE id = ?")
    .run(handle, nowaNazwa, actorId);
  return getActor(ctx, actorId)!;
}

export function setDisplayName(ctx: Ctx, actorId: number, displayName: string): Actor {
  const a = getActor(ctx, actorId);
  if (!a) throw notFound("aktor", `nie ma aktora ${actorId}`);
  ctx.db
    .prepare("UPDATE actors SET display_name = ? WHERE id = ?")
    .run(displayName.trim() || a.handle, actorId);
  return getActor(ctx, actorId)!;
}

// ---- passwords (humans only) ----------------------------------------------
// scrypt from the standard library. An agent's token is random and high-entropy, so sha256
// is enough for it; a human's password is guessable, so it has to be expensive.

const SCRYPT_KEYLEN = 64;

/** Password validation BEFORE any write - the CLI calls this before creating an actor, so
 *  that a validation error does not leave a husk of an account with no password. */
export function assertPasswordOk(password: string): void {
  if (!password || password.length < 8) {
    throw badRequest("haslo_za_krotkie", "haslo musi miec co najmniej 8 znakow");
  }
}

export function setPassword(ctx: Ctx, actorId: number, password: string): void {
  assertPasswordOk(password);
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  ctx.db
    .prepare("UPDATE actors SET password_hash = ? WHERE id = ?")
    .run(`scrypt$${salt.toString("hex")}$${hash.toString("hex")}`, actorId);
  // Changing a password has to THROW OUT the existing sessions. Otherwise a human changing
  // their password after a laptop theft does it believing they closed the door, while the
  // old cookie keeps working for the whole of its TTL.
  bumpSessionEpoch(ctx, actorId);
}

/** Invalidates every session cookie previously issued to this actor.
 *  The epoch number goes into the cookie signature, so bumping it = an immediate sign-out
 *  from every device, with no session table to clean up. */
export function bumpSessionEpoch(ctx: Ctx, actorId: number): number {
  ctx.db.prepare("UPDATE actors SET session_epoch = session_epoch + 1 WHERE id = ?").run(actorId);
  const r = ctx.db.prepare("SELECT session_epoch FROM actors WHERE id = ?").get(actorId) as
    | { session_epoch: number }
    | undefined;
  return r?.session_epoch ?? 0;
}

export function sessionEpoch(ctx: Ctx, actorId: number): number {
  const r = ctx.db.prepare("SELECT session_epoch FROM actors WHERE id = ?").get(actorId) as
    | { session_epoch: number }
    | undefined;
  return r?.session_epoch ?? 0;
}

const DUMMY_SALT = Buffer.alloc(16, 7);

export function verifyPassword(ctx: Ctx, handle: string, password: string): Actor | null {
  const actor = getActorByHandle(ctx, handle);
  if (!actor || actor.disabledAt) {
    // The same scrypt cost for a non-existent account - see below.
    scryptSync(password, DUMMY_SALT, SCRYPT_KEYLEN);
    return null;
  }
  const row = ctx.db.prepare("SELECT password_hash FROM actors WHERE id = ?").get(actor.id) as
    | { password_hash: string | null }
    | undefined;
  const stored = row?.password_hash;
  if (!stored) {
    // An account with no password pays the same scrypt cost as one with a password - otherwise
    // the login response time would be an oracle for "does this user exist".
    scryptSync(password, DUMMY_SALT, SCRYPT_KEYLEN);
    return null;
  }
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return null;
  const expected = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected) ? actor : null;
}
