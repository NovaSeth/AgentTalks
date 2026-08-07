/** Logowanie ludzi i "kim jestem". Agenci nie loguja sie - maja token. */
import { createActor, listActors, verifyPassword } from "../../core/actors.ts";
import { listForActor } from "../../core/conversations.ts";
import { unreadFor } from "../../core/unread.ts";
import { unauthorized, badRequest, tooMany } from "../../core/errors.ts";
import { assertCsrf, clearCookie, COOKIE_NAME, csrfFor, makeCookie, requireAdmin, requireAuth }
  from "../auth.ts";
import { json, readJson, str } from "../respond.ts";
import type { Router } from "../router.ts";

// Rate limit logowania: scrypt jest drogi CELOWO (hasla), wiec bez limitu
// endpoint logowania jest jednoczesnie wyrocznia hasel i generatorem obciazenia.
// Okno w pamieci procesu wystarcza - limit ma powstrzymac zgadywanie, nie byc
// ksiegowoscia; restart serwera zeruje okno i to jest akceptowalne.
const LOGIN_WINDOW_SEC = 900;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginLimit(key: string, now: number): void {
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_SEC });
    return;
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    throw tooMany("za_duzo_prob",
      `za duzo prob logowania; sprobuj za ${Math.ceil((entry.resetAt - now) / 60)} min`);
  }
}

export function registerAuthRoutes(router: Router): void {
  router.add("POST", "/api/login", async (req, res, rc) => {
    const body = await readJson(req, 4096);
    const handle = str(body.handle) ?? "";
    const password = str(body.password) ?? "";
    // Klucz per adres zrodlowy; za proxy bierzemy pierwszy X-Forwarded-For tylko
    // przy trustProxy, bo bez proxy ten naglowek jest w calosci w rekach klienta.
    const fwd = rc.config.trustProxy ? str(req.headers["x-forwarded-for"])?.split(",")[0] : null;
    checkLoginLimit(fwd?.trim() || req.socket.remoteAddress || "?", Math.floor(Date.now() / 1000));
    const actor = verifyPassword(rc.ctx, handle, password);
    // Jeden komunikat dla zlego handle i zlego hasla: inaczej odpowiedz serwera
    // jest wyrocznia "czy taki uzytkownik istnieje".
    if (!actor) throw unauthorized("zle_dane", "nieprawidlowy uzytkownik lub haslo");
    const cookie = makeCookie(rc.config, actor.id, rc.config.sessionTtlSec);
    res.setHeader("set-cookie", cookie);
    json(res, 200, {
      actor,
      csrf: csrfFor(cookie.split(";")[0].slice(COOKIE_NAME.length + 1)),
    });
  });

  router.add("POST", "/api/logout", (_req, res) => {
    res.setHeader("set-cookie", clearCookie());
    json(res, 200, { ok: true });
  });

  /** Jedno wywolanie = pelny obraz, tak jak `talk status` w prototypie.
   *  Agent nie moze pracowac z mniejsza wiedza niz czlowiek patrzacy w UI. */
  router.add("GET", "/api/me", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, {
      actor,
      conversations: listForActor(rc.ctx, actor.id),
      unread: unreadFor(rc.ctx, actor.id),
    });
  });

  router.add("GET", "/api/actors", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { actors: listActors(rc.ctx) });
  });

  router.add("POST", "/api/actors", async (req, res, rc) => {
    requireAdmin(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const kind = str(body.kind);
    if (kind !== "human" && kind !== "agent") {
      throw badRequest("zly_rodzaj", "kind musi byc 'human' albo 'agent'");
    }
    const actor = createActor(rc.ctx, {
      kind,
      handle: str(body.handle) ?? "",
      displayName: str(body.displayName),
    });
    json(res, 201, { actor });
  });
}
