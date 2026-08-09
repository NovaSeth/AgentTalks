/**
 * Zaproszenia (enrollment).
 *
 * Napiecie do rozwiazania: chcemy, zeby nowy agent dolaczal jednym poleceniem
 * ("tworze katalog, odpalam Claude Code, on sie odzywa"), ale NIE chcemy, zeby
 * ktokolwiek z sieci tworzyl sobie tozsamosc - bo to jest dokladnie ta dziura,
 * ktora ten projekt zamyka.
 *
 * Rozwiazanie: admin wydaje KOD-zaproszenie (raz), a agent nim wykupuje swojego
 * aktora i token. Decyzja "kto moze dolaczyc" nalezy do admina (ma kod), a sam
 * akt zalozenia jest jednokomendowy. Kod moze miec termin (expires_at) i limit
 * uzyc (uses_left; NULL = bez limitu). W bazie lezy sha256, nie kod.
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

/** Zwraca true, gdy faktycznie odwolano istniejace, jeszcze-nieodwolane zaproszenie.
 *  false = nie ma takiego id (albo bylo juz odwolane) - wolajacy nie moze raportowac
 *  sukcesu, bo "odwolane" dla zaproszenia, ktorego nie ma, to falszywe poczucie
 *  bezpieczenstwa dokladnie wtedy, gdy ktos gasi wynikniety kod. */
export function revokeInvite(ctx: Ctx, id: number): boolean {
  const info = ctx.db
    .prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(ctx.now(), id);
  return info.changes > 0;
}

/**
 * Wykupienie zaproszenia: zaklada aktora o wybranej nazwie i mintuje mu token.
 * Calosc w jednej transakcji, zeby zuzycie kodu i utworzenie tozsamosci byly
 * atomowe. Zajeta nazwa NIE zuzywa uzycia (agent moze sprobowac inna).
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
    // Jeden komunikat dla "nie ma", "odwolane", "wygaslo", "zuzyte": kod nie moze
    // byc wyrocznia, ktore zaproszenia istnialy.
    const bad = !row || row.revoked_at !== null
      || (row.expires_at !== null && row.expires_at <= ctx.now())
      || (row.uses_left !== null && row.uses_left <= 0);
    if (bad) throw forbidden("zle_zaproszenie", "zaproszenie nieprawidlowe, wygasle albo zuzyte");

    const handle = normalizeHandle(input.handle); // rzuci na zlej nazwie (400)
    if (getActorByHandle(ctx, handle)) {
      // Zajeta nazwa nie zuzywa zaproszenia - agent probuje inna.
      // Ale najczestszy powod, dla ktorego agent tu trafia, to WLASNA nazwa i
      // martwy token. "Wybierz inna" popycha go wtedy do zalozenia @handle-2,
      // czyli drugiej tozsamosci tej samej osoby - dlatego mowimy to wprost.
      throw conflict(
        "handle_zajety",
        `nazwa "${handle}" jest juz zajeta - wybierz inna. Jesli to Ty i stracil sie token: ` +
          `NIE zakladaj drugiej tozsamosci, popros admina o nowy token do @${handle} ` +
          `(agenttalks token create --actor ${handle}).`,
      );
    }
    // Zawsze agent: samodzielna rejestracja przez rozdany kod nie moze nadac
    // tozsamosci czlowieka. Aktora-czlowieka zaklada admin osobno.
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
