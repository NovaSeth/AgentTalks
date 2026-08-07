/**
 * Uwierzytelnianie: bearer dla agentow, podpisane cookie dla ludzi.
 *
 * Klient NIGDY nie deklaruje, kim jest. To jest cala roznica wobec prototypu, gdzie
 * `execFile(TALK_BIN, args, { env: { TALK_SID: asSid } })` pozwalal serwerowi (i kazdemu
 * procesowi z dostepem do katalogu) pisac w cudzym imieniu.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import type { Actor } from "../core/actors.ts";
import { getActor } from "../core/actors.ts";
import { verifyToken } from "../core/tokens.ts";
import { forbidden, unauthorized } from "../core/errors.ts";
import type { Req, RouteCtx } from "./router.ts";

export type Auth = { actor: Actor; via: "token" | "cookie" };

export const COOKIE_NAME = "at_session";
export const CSRF_HEADER = "x-at-csrf";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Wartosc cookie: "<actorId>.<wygasa>.<hmac>". Bez stanu po stronie serwera, bo
 *  sesja czlowieka nie potrzebuje niczego wiecej, a tabela sesji HTTP to kolejna
 *  rzecz do sprzatania. */
export function makeCookie(config: Config, actorId: number, ttlSec: number): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${actorId}.${expiry}`;
  const value = `${payload}.${sign(config.secret, payload)}`;
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(ttlSec, 0)}`,
  ];
  if (config.trustProxy) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function actorFromCookie(ctx: Ctx, config: Config, raw: string | undefined): Actor | null {
  if (!raw) return null;
  const [idPart, expiryPart, mac] = raw.split(".");
  if (!idPart || !expiryPart || !mac) return null;
  const expected = sign(config.secret, `${idPart}.${expiryPart}`);
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expiryPart) <= Math.floor(Date.now() / 1000)) return null;
  const actor = getActor(ctx, Number(idPart));
  return actor && !actor.disabledAt ? actor : null;
}

export function authenticate(ctx: Ctx, config: Config, req: Req): Auth | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const actor = verifyToken(ctx, header.slice(7));
    return actor ? { actor, via: "token" } : null;
  }
  const cookies = parseCookies(req.headers.cookie);
  const actor = actorFromCookie(ctx, config, cookies[COOKIE_NAME]);
  return actor ? { actor, via: "cookie" } : null;
}

export function requireAuth(rc: RouteCtx): Auth {
  if (!rc.auth) throw unauthorized("nieuwierzytelniony", "zaloguj sie albo podaj token");
  return rc.auth;
}

export function requireAdmin(rc: RouteCtx): Auth {
  const auth = requireAuth(rc);
  if (!auth.actor.isAdmin) throw forbidden("nie_admin", "ta operacja wymaga uprawnien admina");
  return auth;
}

/**
 * CSRF dotyczy WYLACZNIE sesji na cookie: przegladarka dokleja cookie sama, wiec obca
 * strona moglaby wywolac mutacje. Zadanie z bearerem nie ma tego problemu, bo naglowka
 * Authorization nikt nie doklei za klienta.
 */
export function assertCsrf(rc: RouteCtx, req: Req): void {
  if (rc.auth?.via !== "cookie") return;
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  const presented = req.headers[CSRF_HEADER];
  if (!token || typeof presented !== "string" || presented !== csrfFor(token)) {
    throw forbidden("csrf", "brak albo nieprawidlowy naglowek X-AT-CSRF");
  }
}

/** Token CSRF wyprowadzony z wartosci cookie sesji. Cookie jest HttpOnly, wiec
 *  klient NIE liczy go sam - dostaje go w odpowiedzi logowania i odsyla w naglowku.
 *  Obca strona nie zna wartosci cookie, wiec nie policzy tokenu; wlasny frontend
 *  zna go z logowania. Jeden sekret wystarcza, bo wejscie juz jest tajne. */
export function csrfFor(sessionCookieValue: string): string {
  return createHmac("sha256", "at-csrf").update(sessionCookieValue).digest("hex").slice(0, 32);
}
