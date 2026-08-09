/**
 * Zlozenie serwera. Ten plik zna node:http i router, i nic wiecej - reguly domenowe
 * sa w core/, a SQL w store/.
 */
import { createServer as createHttpServer, type Server } from "node:http";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import { authenticate, authFailureNote, requireAuth } from "./auth.ts";
import { fail, json } from "./respond.ts";
import { Router, type RouteCtx } from "./router.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerConversationRoutes } from "./routes/conversations.ts";
import { registerMessageRoutes } from "./routes/messages.ts";
import { registerExtraRoutes } from "./routes/extras.ts";
import { registerWikiRoutes } from "./routes/wiki.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerUiRoutes, siteGateBlocks } from "./ui.ts";
import { longPollHandler, sseHandler } from "./sse.ts";
import { unauthorized } from "../core/errors.ts";

export const VERSION = "0.2.0";

export function buildRouter(): Router {
  const router = new Router();
  // Health z REALNA sonda: "serwer wstal" != "baza odpowiada". Feedback 332c7e42:
  // auth-stub/pusty strumien NIE moze isc na zielono. Jesli DB nie odpowiada,
  // zapytanie rzuci -> 500 -> kontener/proxy widzi unhealthy, zamiast zielonego
  // procesu nad martwa baza.
  router.add("GET", "/api/health", (req, res, rc) => {
    // Sonda MUSI dotknac bazy - inaczej zielony proces nad martwa baza wyglada
    // zdrowo (feedback 332c7e42). Ale odpowiedz nie musi niczego o niej
    // OPOWIADAC: liczba kont i numer ostatniej wiadomosci to darmowa telemetria
    // dla kazdego z internetu - widac z niej tempo rozmow i wzrost zespolu, bez
    // logowania. Dlatego liczby dostaje wylacznie wywolujacy z PETLI ZWROTNEJ:
    // healthcheck kontenera i skrypt wdrozeniowy, ktory po nich rozpoznaje
    // podmiane wolumenu na pusty. Z zewnatrz zostaje sam fakt "baza odpowiada".
    const row = rc.ctx.db
      .prepare("SELECT (SELECT COUNT(*) FROM actors) AS actors, (SELECT COALESCE(MAX(id),0) FROM messages) AS lastMessageId")
      .get() as { actors: number; lastMessageId: number };
    json(res, 200, {
      ok: true,
      version: VERSION,
      ...(zPetliZwrotnej(req) ? { actors: row.actors, lastMessageId: row.lastMessageId } : {}),
    });
  });

  /** Te same liczby dla wywolan spoza maszyny - ale po zalogowaniu, bo wtedy
   *  to jest monitoring wlasnej instancji, a nie darmowy zwiad. */
  router.add("GET", "/api/status", (_req, res, rc) => {
    requireAuth(rc);
    const row = rc.ctx.db
      .prepare("SELECT (SELECT COUNT(*) FROM actors) AS actors, (SELECT COALESCE(MAX(id),0) FROM messages) AS lastMessageId")
      .get() as { actors: number; lastMessageId: number };
    json(res, 200, { ok: true, version: VERSION, actors: row.actors, lastMessageId: row.lastMessageId });
  });

  registerAuthRoutes(router);
  registerConversationRoutes(router);
  registerMessageRoutes(router);
  registerExtraRoutes(router);
  registerWikiRoutes(router);
  registerAdminRoutes(router);
  router.add("GET", "/api/events", sseHandler);
  router.add("GET", "/api/messages", longPollHandler);

  // MCP - glowny interfejs agentow. Modul ladowany dynamicznie: to JEDYNE miejsce
  // z zaleznoscia npm i serwer ma wstac takze wtedy, gdy ktos uruchamia go ze
  // zrodel bez `npm install` (wszystko poza /mcp dziala na samej stdlib).
  router.add("POST", "/mcp", async (req, res, rc) => {
    if (!rc.auth || rc.auth.via !== "token") {
      // Wylacznie bearer: klient MCP to agent, a nie karta przegladarki.
      throw unauthorized("nieuwierzytelniony", "MCP wymaga naglowka Authorization: Bearer <token>");
    }
    let mcp;
    try {
      mcp = await import("../mcp/server.ts");
    } catch {
      json(res, 501, {
        error: "modul MCP niedostepny - zainstaluj zaleznosci: npm install",
        code: "mcp_niedostepny",
      });
      return;
    }
    await mcp.handleMcp(rc.ctx, rc.config, rc.auth.actor, req, res);
  });
  router.add("GET", "/mcp", (_req, res) => {
    json(res, 405, { error: "serwer MCP jest bezstanowy - uzyj POST", code: "tylko_post" });
  });
  // UI, bramka, publiczny onboarding - montowane na koncu (najbardziej ogolne trasy).
  registerUiRoutes(router);
  return router;
}

/** Czy zadanie przyszlo z tej samej maszyny. Obecnosc X-Forwarded-For znaczy,
 *  ze przeszlo przez proxy, wiec nie jest lokalne, nawet gdy gniazdo mowi 127.0.0.1. */
function zPetliZwrotnej(req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } }): boolean {
  if (req.headers["x-forwarded-for"]) return false;
  const a = String(req.socket.remoteAddress ?? "");
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

export function createServer(ctx: Ctx, config: Config): Server {
  const router = buildRouter();

  return createHttpServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        // Bramka anty-bot PRZED routingiem: UI za haslem, API/MCP/publiczne wolne.
        if (siteGateBlocks(req, res, config, url.pathname)) return;
        const match = router.match(req.method ?? "GET", url.pathname);
        if (!match) {
          json(res, 404, { error: "nie ma takiej sciezki", code: "nie_znaleziono" });
          return;
        }
        // Naglowki bezpieczenstwa na KAZDEJ odpowiedzi, ustawione zanim
        // handler zacznie pisac. Powod dla kazdego z osobna:
        //  - nosniff: zalacznik uzytkownika serwowany jako octet-stream nie moze
        //    zostac "odgadniety" przez przegladarke jako HTML i wykonany,
        //  - Referrer-Policy: adresy tej instancji (w tym zaproszenia w linkach)
        //    nie maja wyciekac do cudzych serwerow w naglowku Referer,
        //  - frame-ancestors: obca strona nie osadzi UI w ramce (clickjacking),
        //  - CSP bez 'unsafe-eval' i z self: UI nie laduje niczego z zewnatrz,
        //    wiec polityka jest scisla bez zadnych ustepstw. To druga linia
        //    obrony za ucieczka HTML w kliencie, nie zamiast niej.
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("referrer-policy", "no-referrer");
        res.setHeader("content-security-policy",
          "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
          "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; " +
          "form-action 'self'; object-src 'none'");
        const auth = authenticate(ctx, config, req);
        const rc: RouteCtx = {
          params: match.params,
          query: url.searchParams,
          auth,
          // Liczone tylko dla nieuwierzytelnionego zadania - jedno zapytanie do
          // bazy na 401, zero na normalnym ruchu.
          authNote: auth ? null : authFailureNote(ctx, req),
          ctx,
          config,
        };
        await match.handler(req, res, rc);
      } catch (err) {
        // SSE i long-poll pisza naglowki same. Jesli blad przyszedl po ich wyslaniu,
        // jedyne co mozna zrobic, to zamknac polaczenie - proba dopisania JSON-a
        // zepsulaby strumien, ktory klient wlasnie parsuje.
        if (res.headersSent) {
          res.end();
          return;
        }
        fail(res, err);
      }
    })();
  });
}
