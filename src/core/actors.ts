/**
 * Aktorzy: trwale tozsamosci. Czlowiek albo agent.
 *
 * Roznica wobec prototypu, ktora pociaga za soba polowe reszty projektu: aktor NIE jest
 * tym samym co sesja. Prototyp mial jedno pojecie (`sid`) i przez to dwie rownolegle
 * sesje tego samego agenta byly dla czlowieka dwoma roznymi rozmowcami albo dostawaly
 * sufiks "(2)". Tutaj aktor jest jeden, sesji moze byc dowolnie wiele.
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
};

type ActorRow = {
  id: number;
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
  // Bez normalizeHandle: ta funkcja bywa wolana danymi z zewnatrz i ma odpowiadac
  // "nie ma takiego", a nie rzucac bledem walidacji.
  const h = String(handle ?? "").trim().replace(/^@+/, "").toLowerCase();
  const row = ctx.db.prepare("SELECT * FROM actors WHERE handle = ?").get(h) as
    | ActorRow
    | undefined;
  return row ? toActor(row) : null;
}

export function listActors(ctx: Ctx): Actor[] {
  const rows = ctx.db
    .prepare("SELECT * FROM actors WHERE disabled_at IS NULL ORDER BY handle")
    .all() as ActorRow[];
  return rows.map(toActor);
}

export function setDisplayName(ctx: Ctx, actorId: number, displayName: string): Actor {
  const a = getActor(ctx, actorId);
  if (!a) throw notFound("aktor", `nie ma aktora ${actorId}`);
  ctx.db
    .prepare("UPDATE actors SET display_name = ? WHERE id = ?")
    .run(displayName.trim() || a.handle, actorId);
  return getActor(ctx, actorId)!;
}

// ---- hasla (tylko dla ludzi) ---------------------------------------------
// scrypt z biblioteki standardowej. Token agenta jest losowy i wysokoentropijny,
// wiec wystarcza mu sha256; haslo czlowieka jest zgadywalne, wiec musi byc drogie.

const SCRYPT_KEYLEN = 64;

export function setPassword(ctx: Ctx, actorId: number, password: string): void {
  if (!password || password.length < 8) {
    throw badRequest("haslo_za_krotkie", "haslo musi miec co najmniej 8 znakow");
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  ctx.db
    .prepare("UPDATE actors SET password_hash = ? WHERE id = ?")
    .run(`scrypt$${salt.toString("hex")}$${hash.toString("hex")}`, actorId);
}

export function verifyPassword(ctx: Ctx, handle: string, password: string): Actor | null {
  const actor = getActorByHandle(ctx, handle);
  if (!actor || actor.disabledAt) return null;
  const row = ctx.db.prepare("SELECT password_hash FROM actors WHERE id = ?").get(actor.id) as
    | { password_hash: string | null }
    | undefined;
  const stored = row?.password_hash;
  if (!stored) return null;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return null;
  const expected = Buffer.from(hashHex, "hex");
  const got = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected) ? actor : null;
}
