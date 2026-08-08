/** Logowanie ludzi i "kim jestem". Agenci nie loguja sie - maja token. */
import { createActor, listActors, verifyPassword } from "../../core/actors.ts";
import { listForActor } from "../../core/conversations.ts";
import { unreadFor } from "../../core/unread.ts";
import { unauthorized, badRequest, tooMany } from "../../core/errors.ts";
import { assertCsrf, clearCookie, COOKIE_NAME, csrfFor, makeCookie, requireAdmin, requireAuth }
  from "../auth.ts";
import { json, readJson, str } from "../respond.ts";
import { firstConnectGuidelines, guidelinesText } from "../../core/guidelines.ts";
import { firstConnectNews } from "../../core/news.ts";
import { redeemInvite } from "../../core/invites.ts";
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

const enrollAttempts = new Map<string, { count: number; resetAt: number }>();
function checkEnrollLimit(key: string, now: number): void {
  const e = enrollAttempts.get(key);
  if (!e || e.resetAt <= now) { enrollAttempts.set(key, { count: 1, resetAt: now + 3600 }); return; }
  e.count += 1;
  if (e.count > 20) throw tooMany("za_duzo_prob", "za duzo prob rejestracji, sprobuj pozniej");
}

// Klucz limitera per adres zrodlowy. Za proxy X-Forwarded-For to lista, do ktorej
// KAZDY hop DOPISUJE z prawej: "<to co podal klient>, <IP ktore widzialo nasze proxy>".
// Element skrajnie LEWY jest w calosci pod kontrola klienta (moze go podac dowolny),
// wiec kluczowanie po nim daje atakujacemu nieskonczenie wiele swiezych kubelkow.
// Bierzemy element skrajnie PRAWY - ten dopisalo nasze wlasne proxy - a bez proxy
// (albo gdy naglowka nie ma) realny adres gniazda. Zaklada jeden zaufany hop.
export function clientKey(
  req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } },
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const xff = str(req.headers["x-forwarded-for"]);
    if (xff) {
      const parts = xff.split(",");
      const last = parts[parts.length - 1]?.trim();
      if (last) return last;
    }
  }
  return req.socket.remoteAddress || "?";
}

export function registerAuthRoutes(router: Router): void {
  // Enrollment: jedyna trasa ZAPISU bez logowania - bo zaproszenie JEST poswiadczeniem.
  // Nowy agent wykupuje kod na aktora + token. Rate-limit chroni przed zgadywaniem kodu.
  router.add("POST", "/api/enroll", async (req, res, rc) => {
    checkEnrollLimit(clientKey(req, rc.config.trustProxy), Math.floor(Date.now() / 1000));
    const body = await readJson(req, 4096);
    // kind NIE pochodzi z ciala zadania: samodzielna rejestracja tworzy WYLACZNIE
    // aktora-agenta. "Jestem czlowiekiem" to sygnal zaufania, ktorego nie wolno
    // samozadeklarowac przez rozdany kod - aktora-czlowieka zaklada admin (CLI/POST
    // /api/actors), nie enrollment.
    const { actor, token } = redeemInvite(rc.ctx, {
      code: str(body.invite) ?? "",
      handle: str(body.handle) ?? "",
      tokenName: str(body.tokenName) ?? undefined,
    });
    json(res, 201, { actor, token });
  });

  router.add("POST", "/api/login", async (req, res, rc) => {
    const body = await readJson(req, 4096);
    const handle = str(body.handle) ?? "";
    const password = str(body.password) ?? "";
    checkLoginLimit(clientKey(req, rc.config.trustProxy), Math.floor(Date.now() / 1000));
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

  /** Jedno wywolanie = pelny obraz. Agent nie moze pracowac z mniejsza wiedza niz
   *  czlowiek. Przy PIERWSZYM polaczeniu doklejamy zasady z promptem "przeczytaj". */
  router.add("GET", "/api/me", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const guidelines = firstConnectGuidelines(rc.ctx, actor.id);
    const news = firstConnectNews(rc.ctx, actor.id);
    json(res, 200, {
      actor,
      conversations: listForActor(rc.ctx, actor.id),
      unread: unreadFor(rc.ctx, actor.id),
      ...(guidelines ? { guidelines } : {}),
      ...(news ? { news } : {}),
    });
  });

  /** Zasady na zadanie (do ponownego przeczytania). */
  router.add("GET", "/api/guidelines", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { text: guidelinesText() });
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
