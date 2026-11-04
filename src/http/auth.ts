/**
 * Authentication: bearer for agents, a signed cookie for humans.
 *
 * A client NEVER declares who it is. That is the whole difference from the prototype, where
 * `execFile(TALK_BIN, args, { env: { TALK_SID: asSid } })` let the server (and any process
 * with access to the directory) write on somebody else's behalf.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import type { Actor } from "../core/actors.ts";
import { getActor, sessionEpoch } from "../core/actors.ts";
import { securityLog, tokenTrouble, verifyToken } from "../core/tokens.ts";
import { forbidden, unauthorized } from "../core/errors.ts";
import type { Req, RouteCtx } from "./router.ts";

export type Auth = { actor: Actor; via: "token" | "cookie" };

export const COOKIE_NAME = "at_session";
export const CSRF_HEADER = "x-at-csrf";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * The cookie value: "<actorId>.<expires>.<epoch>.<hmac>". Still with no session table on the
 * server side, but ALREADY REVOCABLE: `epoch` is a counter in the actor's row, bumped on a
 * password change and on disabling the account, so old cookies stop matching the signature.
 * Without it, "I changed my password" did not mean "I threw that session out".
 *
 * `secure` comes from outside, because only the caller knows whether the request arrived over
 * HTTPS: the trustProxy flag alone is not enough, and a session cookie without the Secure
 * attribute can leak through the first request over http.
 */
export function makeCookie(
  ctx: Ctx,
  config: Config,
  actorId: number,
  ttlSec: number,
  secure: boolean,
): string {
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${actorId}.${expiry}.${sessionEpoch(ctx, actorId)}`;
  const value = `${payload}.${sign(config.secret, payload)}`;
  const attrs = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(ttlSec, 0)}`,
  ];
  if (cookieIsSecure(config, secure)) attrs.push("Secure");
  return attrs.join("; ");
}

export const DEVICE_COOKIE = "at_dev";
const DEVICE_TTL_SEC = 180 * 24 * 3600;

function deviceMac(
  config: Config, actorId: number, nonce: string, issuedAt: number, epoch: number,
): string {
  return createHmac("sha256", config.secret)
    .update(`dev|${actorId}|${nonce}|${issuedAt}|${epoch}`).digest("hex");
}

/**
 * The device cookie (D-MG-14, OWASP Authentication Cheat Sheet):
 * "<hmac>.<nonce>.<actorId>.<issuedAt>.<epoch>", set after a successful login. It grants no
 * session, only an exemption from the per-account failure cap for THIS actor. Path is limited
 * to the password login endpoint. The issue time and the actor's session epoch are inside the
 * signed value: the 180-day expiry is enforced on the server, and a password change, a
 * disable or a logout-everywhere (all bump the epoch) revoke every device cookie of the actor.
 */
export function makeDeviceCookie(
  ctx: Ctx, config: Config, actorId: number, secure: boolean,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  const nonce = randomBytes(16).toString("hex");
  const epoch = sessionEpoch(ctx, actorId);
  const mac = deviceMac(config, actorId, nonce, nowSec, epoch);
  const attrs = [
    `${DEVICE_COOKIE}=${mac}.${nonce}.${actorId}.${nowSec}.${epoch}`,
    "Path=/api/login", "HttpOnly", "SameSite=Lax", `Max-Age=${DEVICE_TTL_SEC}`,
  ];
  if (cookieIsSecure(config, secure)) attrs.push("Secure");
  return attrs.join("; ");
}

/** Whether the request carries a valid, unexpired device cookie issued for exactly this actor
 *  under the actor's CURRENT session epoch. */
export function hasDeviceCookie(
  ctx: Ctx, config: Config, req: Req, actorId: number,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  const raw = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 5) return false;
  const [mac, nonce, idPart, issuedPart, epochPart] = parts;
  if (!mac || !nonce || Number(idPart) !== actorId) return false;
  if (!/^\d+$/.test(issuedPart) || !/^\d+$/.test(epochPart)) return false;
  const issuedAt = Number(issuedPart), epoch = Number(epochPart);
  if (issuedAt > nowSec + 60 || nowSec - issuedAt > DEVICE_TTL_SEC) return false;
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(deviceMac(config, actorId, nonce, issuedAt, epoch), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return epoch === sessionEpoch(ctx, actorId);
}

/** Whether this request arrived over HTTPS. Behind a proxy the truth is in X-Forwarded-Proto;
/**  directly - the presence of a TLS socket. */
export function requestIsSecure(req: Req): boolean {
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim();
  if (proto) return proto === "https";
  return !!(req.socket as { encrypted?: boolean }).encrypted;
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
  const [idPart, expiryPart, epochPart, mac] = raw.split(".");
  if (!idPart || !expiryPart || !epochPart || !mac) return null;
  const expected = sign(config.secret, `${idPart}.${expiryPart}.${epochPart}`);
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expiryPart) <= Math.floor(Date.now() / 1000)) return null;
  const actor = getActor(ctx, Number(idPart));
  if (!actor || actor.disabledAt) return null;
  // The epoch from the signature has to match the current one: a mismatch means the actor
  // changed their password or was disabled after this cookie was issued.
  if (Number(epochPart) !== sessionEpoch(ctx, actor.id)) return null;
  return actor;
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

/**
 * A diagnosis for a REJECTED bearer that was once valid. Without it a dead token gives the
 * same 401 as no token at all, and an agent with no session memory draws the worst possible
 * conclusion from that: "I will redeem a new invite" - and the channel gains a second
 * identity of the same person (and a third one next time).
 */
export function authFailureNote(
  ctx: Ctx,
  req: Req,
): { code: string; message: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const t = tokenTrouble(ctx, header.slice(7));
  if (!t) return null;
  const who = t.handle ? `@${t.handle}` : "tego aktora";
  if (t.reason === "aktor_wylaczony") {
    return { code: "actor_disabled", message: `aktor ${who} jest wylaczony - odezwij sie do admina` };
  }
  const co = t.reason === "wygasl" ? "wygasl" : "zostal odwolany";
  return {
    code: t.reason === "wygasl" ? "token_expired" : "token_revoked",
    message:
      `token dla ${who} ${co}. Popros admina o NOWY TOKEN DO TEGO SAMEGO aktora ` +
      `(agenttalks token create --actor ${t.handle ?? "<handle>"}), a nie o nowe zaproszenie: ` +
      `zaproszenie zaklada KOLEJNEGO aktora, wiec Twoja historia, wzmianki i czlonkostwa zostalyby przy starym.`,
  };
}

export function requireAuth(rc: RouteCtx): Auth {
  if (!rc.auth) {
    const note = rc.authNote;
    throw unauthorized(note?.code ?? "unauthenticated", note?.message ?? "zaloguj sie albo podaj token");
  }
  return rc.auth;
}

export function requireAdmin(rc: RouteCtx): Auth {
  const auth = requireAuth(rc);
  if (!auth.actor.isAdmin) {
    securityLog("admin_denied", { actorId: auth.actor.id, guard: "admin" });
    throw forbidden("not_admin", "ta operacja wymaga uprawnien admina");
  }
  return auth;
}

/** Admin operations that create or change HUMAN accounts: an admin flag on an agent is not
 *  enough, the caller has to be a human admin (the same guard as /api/admin). */
export function requireHumanAdmin(rc: RouteCtx): Auth {
  const auth = requireAuth(rc);
  if (!auth.actor.isAdmin || auth.actor.kind !== "human") {
    securityLog("admin_denied", { actorId: auth.actor.id, guard: "human_admin" });
    throw forbidden("human_admin_only", "ta operacja jest dla zalogowanego czlowieka-admina");
  }
  return auth;
}

/**
 * Re-checks, right before something private is delivered, that the credential which started a
 * long wait still holds: the same check SSE does on every ping. Returns null when the request
 * no longer authenticates, or authenticates as somebody else. The long-poll uses it, and so
 * can the MCP talk_read wait.
 */
export function stillAuthenticated(ctx: Ctx, config: Config, req: Req, actorId: number): Auth | null {
  const now = authenticate(ctx, config, req);
  return now && now.actor.id === actorId ? now : null;
}

/**
 * CSRF applies ONLY to cookie sessions: a browser attaches the cookie itself, so another site
 * could trigger a mutation. A request with a bearer does not have that problem, because
 * nobody attaches the Authorization header on the client's behalf.
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

/** A CSRF token derived from the session cookie's value. The cookie is HttpOnly, so the client
/**  does NOT compute it itself - it receives it in the login response and sends it back in a
/**  header. Another site does not know the cookie's value, so it cannot compute the token; our
/**  own frontend knows it from login. One secret is enough, because the input is already secret. */
export function csrfFor(sessionCookieValue: string): string {
  return createHmac("sha256", "at-csrf").update(sessionCookieValue).digest("hex").slice(0, 32);
}

/** A cookie is Secure when the request is secure, behind a trusted proxy, or when the
 *  deployment's public address is https (so it never travels over plain http). */
function cookieIsSecure(config: Config, secure: boolean): boolean {
  return secure || config.trustProxy || /^https:\/\//i.test(config.baseUrl ?? "");
}
