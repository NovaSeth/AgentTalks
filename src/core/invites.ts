/**
 * Invites (enrollment).
 *
 * The tension to resolve: we want a new agent to join with one command ("I create a
 * directory, start Claude Code, it says hello"), but we do NOT want anybody on the network
 * creating an identity for themselves - because that is exactly the hole this project
 * closes.
 *
 * The resolution: an admin issues an invite CODE (once), and the agent redeems it for its
 * actor and token. The decision "who may join" belongs to the admin (who holds the code),
 * while the act of creation is a single command. A code can have an expiry (expires_at) and
 * a use limit (uses_left; NULL = no limit). The database holds a sha256, not the code.
 */
import { createHash, randomBytes } from "node:crypto";
import { tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { conflict, forbidden } from "./errors.ts";
import { type Actor, createActor, getActorByHandle } from "./actors.ts";
import { mintToken } from "./tokens.ts";
import { normalizeHandle } from "./ids.ts";

const PREFIX = "ati_";

export type InviteInfo = {
  id: number;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number | null;
  usesLeft: number | null;
  makeAdmin: boolean;
  note: string | null;
  revokedAt: number | null;
};

type InviteRow = {
  id: number; hash: string; created_by: number | null; created_at: number;
  expires_at: number | null; uses_left: number | null; make_admin: number;
  note: string | null; revoked_at: number | null;
};

const hashOf = (code: string): string => createHash("sha256").update(code).digest("hex");

const toInfo = (ctx: Ctx, r: InviteRow): InviteInfo => ({
  id: r.id,
  createdBy: r.created_by === null ? null
    : (ctx.db.prepare("SELECT handle FROM actors WHERE id = ?").get(r.created_by) as
        { handle: string } | undefined)?.handle ?? null,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  usesLeft: r.uses_left,
  makeAdmin: r.make_admin === 1,
  note: r.note,
  revokedAt: r.revoked_at,
});

export function createInvite(
  ctx: Ctx,
  input: { createdBy: number | null; ttlSec?: number | null; uses?: number | null;
           makeAdmin?: boolean; note?: string | null },
): { code: string; info: InviteInfo } {
  const code = PREFIX + randomBytes(24).toString("base64url");
  const now = ctx.now();
  const expiresAt = input.ttlSec && input.ttlSec > 0 ? now + Math.trunc(input.ttlSec) : null;
  const uses = input.uses && input.uses > 0 ? Math.trunc(input.uses) : null;
  ctx.db
    .prepare(
      `INSERT INTO invites(hash, created_by, created_at, expires_at, uses_left, make_admin, note)
       VALUES(?,?,?,?,?,?,?)`,
    )
    .run(hashOf(code), input.createdBy, now, expiresAt, uses, input.makeAdmin ? 1 : 0,
         input.note ?? null);
  const row = ctx.db.prepare("SELECT * FROM invites WHERE hash = ?").get(hashOf(code)) as InviteRow;
  return { code, info: toInfo(ctx, row) };
}

export function listInvites(ctx: Ctx): InviteInfo[] {
  const rows = ctx.db.prepare("SELECT * FROM invites ORDER BY id").all() as InviteRow[];
  return rows.map((r) => toInfo(ctx, r));
}

/** Returns true when an existing, not-yet-revoked invite really was revoked.
 *  false = there is no such id (or it was revoked already) - the caller must not report
 *  success, because "revoked" for an invite that does not exist is a false sense of
 *  security at exactly the moment somebody is putting out a leaked code. */
export function revokeInvite(ctx: Ctx, id: number): boolean {
  const info = ctx.db
    .prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(ctx.now(), id);
  return info.changes > 0;
}

/**
 * Redeeming an invite: creates an actor with the chosen name and mints it a token.
 * The whole thing in one transaction, so that using up the code and creating the identity
 * are atomic. A taken name does NOT consume a use (the agent can try another).
 */
export function redeemInvite(
  ctx: Ctx,
  input: { code: string; handle: string; tokenName?: string },
): { actor: Actor; token: string } {
  const raw = String(input.code ?? "").trim();
  if (!raw.startsWith(PREFIX)) throw forbidden("zle_zaproszenie", "nieprawidlowy kod zaproszenia");

  return tx(ctx.db, () => {
    const row = ctx.db.prepare("SELECT * FROM invites WHERE hash = ?").get(hashOf(raw)) as
      | InviteRow
      | undefined;
    // One message for "does not exist", "revoked", "expired" and "used up": a code must not be
    // an oracle for which invites existed.
    const bad = !row || row.revoked_at !== null
      || (row.expires_at !== null && row.expires_at <= ctx.now())
      || (row.uses_left !== null && row.uses_left <= 0);
    if (bad) throw forbidden("zle_zaproszenie", "zaproszenie nieprawidlowe, wygasle albo zuzyte");

    const handle = normalizeHandle(input.handle); // rzuci na zlej nazwie (400)
    if (getActorByHandle(ctx, handle)) {
      // A taken name does not consume the invite - the agent tries another.
      // But the most common reason an agent lands here is its OWN name plus a dead token.
      // "Pick another one" then pushes it towards creating @handle-2, that is, a second identity
      // for the same person - which is why we say so outright.
      throw conflict(
        "handle_zajety",
        `nazwa "${handle}" jest juz zajeta - wybierz inna. Jesli to Ty i stracil sie token: ` +
          `NIE zakladaj drugiej tozsamosci, popros admina o nowy token do @${handle} ` +
          `(agenttalks token create --actor ${handle}).`,
      );
    }
    // Always an agent: self-registration through a distributed code must not grant a human
    // identity. A human actor is created by an admin separately.
    const actor = createActor(ctx, {
      kind: "agent",
      handle,
      isAdmin: row!.make_admin === 1,
    });
    const { token } = mintToken(ctx, actor.id, input.tokenName || "z zaproszenia");
    if (row!.uses_left !== null) {
      ctx.db.prepare("UPDATE invites SET uses_left = uses_left - 1 WHERE id = ?").run(row!.id);
    }
    return { actor, token };
  });
}
