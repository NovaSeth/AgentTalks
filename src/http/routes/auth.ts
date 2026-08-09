/** Logowanie ludzi i "kim jestem". Agenci nie loguja sie - maja token. */
import { createActor, listActors, verifyPassword } from "../../core/actors.ts";
import { whoIsTyping } from "../../core/presence.ts";
import { listForActor, myMemberships } from "../../core/conversations.ts";
import { unreadFor } from "../../core/unread.ts";
import { unauthorized, badRequest, tooMany } from "../../core/errors.ts";
import { assertCsrf, clearCookie, COOKIE_NAME, csrfFor, makeCookie, requestIsSecure, requireAdmin, requireAuth }
  from "../auth.ts";
import { json, readJson, str } from "../respond.ts";
import { firstConnectGuidelines, guidelinesText } from "../../core/guidelines.ts";
import { firstConnectNews } from "../../core/news.ts";
import { unreadNotificationCount } from "../../core/notifications.ts";
import { MAX_WIKI_BYTES } from "../../core/wiki.ts";
import { redeemInvite } from "../../core/invites.ts";
import { getActor, getActorByHandle } from "../../core/actors.ts";
import {
  hasCredentials,
  issueChallenge,
  listCredentials,
  registerCredential,
  verifyAssertion,
} from "../../core/webauthn.ts";
import type { IncomingMessage } from "node:http";
import { createHmac } from "node:crypto";
import type { Config } from "../../config.ts";
import type { Router } from "../router.ts";

/**
 * rpId (domena) i dozwolone originy dla WebAuthn.
 *
 * Produkcja bierze je z AGENTTALKS_BASE_URL. Bez niego zrodlem jest naglowek
 * Host, ktory podaje KLIENT - a rpId decyduje o tym, dla jakiej domeny klucz
 * zostanie zapisany i przyjety. Dlatego droga "z Hosta" jest dozwolona TYLKO
 * lokalnie (dev): na wystawionej instancji brak baseUrl konczy sie jasnym
 * bledem konfiguracji zamiast cicha zgoda na cudza domene.
 */
function webauthnParams(req: IncomingMessage, config: Config): { rpId: string; origins: string[] } {
  if (config.baseUrl) {
    const u = new URL(config.baseUrl);
    return { rpId: u.hostname, origins: [u.origin] };
  }
  const host = String(req.headers.host ?? "localhost");
  const hostname = host.replace(/:\d+$/, "");
  const lokalnie = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!lokalnie) {
    throw badRequest(
      "brak_base_url",
      "logowanie kluczem (passkey) wymaga ustawionego AGENTTALKS_BASE_URL - bez niego " +
        "domena klucza pochodzilaby z naglowka podanego przez klienta",
    );
  }
  return { rpId: hostname, origins: [`http://${host}`, `https://${host}`] };
}

/**
 * Atrapy dla nieznanego konta. Endpoint opcji logowania odpowiadal pusta lista
 * dla nieistniejacego handle i niepusta dla istniejacego - czyli byl wyrocznia
 * "czy takie konto tu jest", mimo komentarza, ktory twierdzil, ze nia nie jest.
 * Deterministyczne atrapy (te same dla tego samego handle) sprawiaja, ze ksztalt
 * odpowiedzi nie zdradza niczego, a powtorne pytanie nie ujawnia losowosci.
 */
function atrapaCredentials(secret: string, handle: string): string[] {
  const mac = createHmac("sha256", secret).update(`webauthn-atrapa:${handle.toLowerCase()}`).digest();
  return [mac.toString("base64url")];
}

// Rate limit logowania: scrypt jest drogi CELOWO (hasla), wiec bez limitu
// endpoint logowania jest jednoczesnie wyrocznia hasel i generatorem obciazenia.
// Okno w pamieci procesu wystarcza - limit ma powstrzymac zgadywanie, nie byc
// ksiegowoscia; restart serwera zeruje okno i to jest akceptowalne.
const LOGIN_WINDOW_SEC = 900;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/** Mapy limiterow rosna wraz z liczba roznych adresow zrodlowych i nic ich nie
 *  zmniejsza - przy skanie z tysiecy IP to wyciek pamieci procesu. Sprzatamy
 *  wygasle okna przy okazji, bez osobnego timera. */
function sprzatniecieOkien(mapa: Map<string, { count: number; resetAt: number }>, now: number): void {
  if (mapa.size < 1000) return;
  for (const [k, v] of mapa) if (v.resetAt <= now) mapa.delete(k);
}

/**
 * Klucz limitera jest kluczowany TAKZE sekretem instancji. Powod jest prosty
 * i wyszedl w testach: mapy sa na poziomie modulu, wiec dwa serwery w jednym
 * procesie (a tak dzialaja testy) dziela liczniki - test, ktory celowo wyczerpuje
 * limit, blokowal logowanie w kolejnym tescie. W produkcji nic to nie zmienia
 * (jeden proces = jedna instancja = jeden sekret), a w testach daje izolacje
 * bez zadnej furtki "wyzeruj limiter", ktora predzej czy pozniej trafilaby
 * do kodu produkcyjnego.
 */
function kluczLimitu(secret: string, key: string): string {
  // CALY sekret, nie jego poczatek. Pierwsza wersja brala `slice(0, 8)` - a wszystkie
  // sekrety testowe zaczynaly sie tak samo, wiec "izolacja" dawala ten sam klucz
  // dla kazdej instancji i niczego nie izolowala. To jest mapa w pamieci procesu,
  // wiec pelny sekret jako fragment klucza nie wychodzi nigdzie na zewnatrz.
  return `${secret}|${key}`;
}

function checkLoginLimit(key: string, now: number): void {
  sprzatniecieOkien(loginAttempts, now);
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

/** Udane logowanie kasuje licznik prob. Limit ma powstrzymywac ZGADYWANIE, a nie
 *  karac czlowieka, ktory sie zalogowal: bez tego dziesiec normalnych wejsc
 *  (albo pare wejsc passkeyem, ktore kosztuja po dwie proby) blokowalo konto
 *  wlascicielowi na 15 minut. */
function zwolnijLimitLogowania(key: string): void {
  loginAttempts.delete(key);
}

const enrollAttempts = new Map<string, { count: number; resetAt: number }>();
function checkEnrollLimit(key: string, now: number): void {
  sprzatniecieOkien(enrollAttempts, now);
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
    checkEnrollLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
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
    checkLoginLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
    const actor = verifyPassword(rc.ctx, handle, password);
    // Jeden komunikat dla zlego handle i zlego hasla: inaczej odpowiedz serwera
    // jest wyrocznia "czy taki uzytkownik istnieje".
    if (!actor) throw unauthorized("zle_dane", "nieprawidlowy uzytkownik lub haslo");
    zwolnijLimitLogowania(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)));
    const cookie = makeCookie(rc.ctx, rc.config, actor.id, rc.config.sessionTtlSec, requestIsSecure(req));
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

  // --- passkeys (Touch ID / Face ID) ---------------------------------------
  // Rejestracja wymaga ZALOGOWANEJ sesji (haslem) - poswiadczenie wiaze sie
  // z aktorem, ktorego tozsamosc juz udowodniono. Tylko ludzie: agent ma token.

  router.add("POST", "/api/webauthn/register/options", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    if (actor.kind !== "human") throw badRequest("tylko_ludzie", "passkey jest dla ludzi - agent ma token");
    const { rpId } = webauthnParams(req, rc.config);
    json(res, 200, {
      challenge: issueChallenge("register", actor.id),
      rpId,
      user: {
        id: Buffer.from(String(actor.id)).toString("base64url"),
        name: actor.handle,
        displayName: actor.displayName || actor.handle,
      },
      excludeCredentials: listCredentials(rc.ctx, actor.id).map((c) => c.id),
    });
  });

  router.add("POST", "/api/webauthn/register", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    if (actor.kind !== "human") throw badRequest("tylko_ludzie", "passkey jest dla ludzi - agent ma token");
    const body = await readJson(req, 64 * 1024);
    const { rpId, origins } = webauthnParams(req, rc.config);
    const id = registerCredential(rc.ctx, {
      rpId,
      expectedOrigins: origins,
      actorId: actor.id,
      clientDataJSON: str(body.clientDataJSON) ?? "",
      attestationObject: str(body.attestationObject) ?? "",
      label: str(body.label) ?? null,
    });
    json(res, 201, { id });
  });

  router.add("GET", "/api/webauthn/credentials", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, { credentials: listCredentials(rc.ctx, actor.id) });
  });

  /** Opcje logowania passkeyem. Publiczne i limitowane jak logowanie haslem.
   *  Bez handle: discoverable credential (przegladarka sama pokaze konta). */
  router.add("POST", "/api/webauthn/login/options", async (req, res, rc) => {
    checkLoginLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
    const body = await readJson(req, 4096);
    const { rpId } = webauthnParams(req, rc.config);
    const handle = str(body.handle);
    let allowCredentials: string[] = [];
    if (handle) {
      const actor = getActorByHandle(rc.ctx, handle);
      if (actor && actor.kind === "human") {
        allowCredentials = listCredentials(rc.ctx, actor.id).map((c) => c.id);
      }
      // Konto nieistniejace ALBO bez klucza dostaje atrape zamiast pustej listy:
      // pusta lista rozniła sie od niepustej i tym samym odpowiadala na pytanie
      // "czy taki uzytkownik istnieje". Przegladarka i tak nie znajdzie tego
      // klucza, wiec uzytkownik widzi normalna odmowe.
      if (allowCredentials.length === 0) {
        allowCredentials = atrapaCredentials(rc.config.secret, handle);
      }
    }
    json(res, 200, { challenge: issueChallenge("login", null), rpId, allowCredentials });
  });

  router.add("POST", "/api/webauthn/login", async (req, res, rc) => {
    checkLoginLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
    const body = await readJson(req, 64 * 1024);
    const { rpId, origins } = webauthnParams(req, rc.config);
    const actorId = verifyAssertion(rc.ctx, {
      rpId,
      expectedOrigins: origins,
      credentialId: str(body.id) ?? "",
      clientDataJSON: str(body.clientDataJSON) ?? "",
      authenticatorData: str(body.authenticatorData) ?? "",
      signature: str(body.signature) ?? "",
    });
    const actor = getActor(rc.ctx, actorId);
    if (!actor || actor.disabledAt) throw unauthorized("konto_wylaczone", "to konto jest wylaczone");
    const cookie = makeCookie(rc.ctx, rc.config, actor.id, rc.config.sessionTtlSec, requestIsSecure(req));
    res.setHeader("set-cookie", cookie);
    json(res, 200, {
      actor,
      csrf: csrfFor(cookie.split(";")[0].slice(COOKIE_NAME.length + 1)),
    });
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
      // Czlonkostwa razem z lista rozmow: klient potrzebuje obu, zeby cokolwiek
      // narysowac, wiec osobne zapytanie o to samo bylo podwojnym liczeniem
      // przy kazdym starcie interfejsu.
      memberships: myMemberships(rc.ctx, actor.id),
      unread: unreadFor(rc.ctx, actor.id),
      // Kto pisze TERAZ - zeby dalo sie to zobaczyc bez osobnego pytania
      // o liste obecnych (prosba @michal, #general [226]).
      typing: whoIsTyping(rc.ctx, actor.id),
      // Czy aktor ma juz passkey - UI na tej podstawie proponuje (albo nie)
      // wlaczenie logowania odciskiem na tym urzadzeniu.
      passkeys: actor.kind === "human" ? hasCredentials(rc.ctx, actor.id) : false,
      // Licznik centrum powiadomien - zeby jedno wywolanie /api/me dalo tez
      // odpowiedz "czy cos mnie wolalo", bez drugiego zapytania.
      notifications: { unread: unreadNotificationCount(rc.ctx, actor.id) },
      // Limity instancji podane WPROST: klient, ktory ich nie zna, moze tylko
      // wyslac i zobaczyc blad - a dla czlowieka piszacego dlugi raport to jest
      // najgorszy moment na dowiedzenie sie o limicie.
      limity: {
        maxMessageBytes: rc.config.maxMessageBytes,
        maxFileBytes: rc.config.maxFileBytes,
        maxWikiBytes: MAX_WIKI_BYTES,
      },
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
