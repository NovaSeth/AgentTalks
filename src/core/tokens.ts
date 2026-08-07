/**
 * Tokeny agentow.
 *
 * Token nalezy do AKTORA, nie do sesji, i jest odwolywalny pojedynczo - jeden agent
 * moze miec osobny token na VPS, na laptopa i do CI, a wyciek jednego nie zmusza do
 * rotacji reszty. W bazie lezy wylacznie sha256; wartosc jawna widac raz, przy nadaniu.
 *
 * To jest miejsce, w ktorym znika najgrozniejsza wlasnosc prototypu: tam kazdy proces
 * majacy dostep do katalogu mogl podac sie za dowolnego uczestnika przez `TALK_SID`.
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
};

type TokenRow = {
  id: number;
  actor_id: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

const PREFIX = "atk_";

const toInfo = (r: TokenRow): TokenInfo => ({
  id: r.id,
  actorId: r.actor_id,
  name: r.name,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");

export function mintToken(
  ctx: Ctx,
  actorId: number,
  name: string,
): { token: string; info: TokenInfo } {
  if (!getActor(ctx, actorId)) throw notFound("aktor", `nie ma aktora ${actorId}`);
  const token = PREFIX + randomBytes(32).toString("base64url");
  const now = ctx.now();
  ctx.db
    .prepare("INSERT INTO tokens(actor_id, hash, name, created_at) VALUES(?,?,?,?)")
    .run(actorId, hashOf(token), name || "bez nazwy", now);
  const row = ctx.db
    .prepare("SELECT * FROM tokens WHERE hash = ?")
    .get(hashOf(token)) as TokenRow;
  return { token, info: toInfo(row) };
}

/** Zwraca aktora albo null. NIE rzuca - zly token to normalny ruch sieciowy,
 *  a nie sytuacja wyjatkowa, i nie ma powodu, zeby generowal slad stosu. */
export function verifyToken(ctx: Ctx, token: string): Actor | null {
  const raw = String(token ?? "").trim();
  if (!raw.startsWith(PREFIX)) return null;
  // Wyszukanie po sha256 w kolumnie UNIQUE jest cala weryfikacja: token ma
  // 256 bitow entropii, wiec kolizje i zgadywanie nie sa realnymi wektorami,
  // a dodatkowe porownania "stalo-czasowe" hasza z nim samym bylyby teatrem.
  const row = ctx.db
    .prepare("SELECT * FROM tokens WHERE hash = ? AND revoked_at IS NULL")
    .get(hashOf(raw)) as TokenRow | undefined;
  if (!row) return null;
  const actor = getActor(ctx, row.actor_id);
  if (!actor || actor.disabledAt) return null;
  // last_used_at jest telemetryczne, wiec: (a) dlawione do jednego zapisu na
  // minute, (b) best-effort - gdy inny proces (import CLI) trzyma wlasnie
  // write-lock, uwierzytelnienie NIE moze sie od tego wywracac, bo polozyloby
  // to takze wszystkie GET-y agentow.
  if (row.last_used_at === null || ctx.now() - row.last_used_at >= 60) {
    try {
      ctx.db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").run(ctx.now(), row.id);
    } catch {
      // zapis telemetryczny - nastepne zadanie sprobuje jeszcze raz
    }
  }
  return actor;
}

export function revokeToken(ctx: Ctx, tokenId: number): void {
  ctx.db.prepare("UPDATE tokens SET revoked_at = ? WHERE id = ?").run(ctx.now(), tokenId);
}

export function listTokens(ctx: Ctx, actorId: number): TokenInfo[] {
  const rows = ctx.db
    .prepare("SELECT * FROM tokens WHERE actor_id = ? ORDER BY id")
    .all(actorId) as TokenRow[];
  return rows.map(toInfo);
}
