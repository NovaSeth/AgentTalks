/**
 * Zlozenie serwera. Ten plik zna node:http i router, i nic wiecej - reguly domenowe
 * sa w core/, a SQL w store/.
 */
import { createServer as createHttpServer, type Server } from "node:http";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import { authenticate } from "./auth.ts";
import { fail, json } from "./respond.ts";
import { Router, type RouteCtx } from "./router.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerConversationRoutes } from "./routes/conversations.ts";
import { registerMessageRoutes } from "./routes/messages.ts";
import { registerExtraRoutes } from "./routes/extras.ts";
import { longPollHandler, sseHandler } from "./sse.ts";
import { unauthorized } from "../core/errors.ts";

export const VERSION = "0.2.0";

export function buildRouter(): Router {
  const router = new Router();
  // Health z REALNA sonda: "serwer wstal" != "baza odpowiada". Feedback 332c7e42:
  // auth-stub/pusty strumien NIE moze isc na zielono. Jesli DB nie odpowiada,
  // zapytanie rzuci -> 500 -> kontener/proxy widzi unhealthy, zamiast zielonego
  // procesu nad martwa baza.
  router.add("GET", "/api/health", (_req, res, rc) => {
    const row = rc.ctx.db
      .prepare("SELECT (SELECT COUNT(*) FROM actors) AS actors, (SELECT COALESCE(MAX(id),0) FROM messages) AS lastMessageId")
      .get() as { actors: number; lastMessageId: number };
    json(res, 200, {
      ok: true,
      version: VERSION,
      actors: row.actors,
      lastMessageId: row.lastMessageId,
    });
  });
  registerAuthRoutes(router);
  registerConversationRoutes(router);
  registerMessageRoutes(router);
  registerExtraRoutes(router);
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
  return router;
}

export function createServer(ctx: Ctx, config: Config): Server {
  const router = buildRouter();

  return createHttpServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const match = router.match(req.method ?? "GET", url.pathname);
        if (!match) {
          json(res, 404, { error: "nie ma takiej sciezki", code: "nie_znaleziono" });
          return;
        }
        const rc: RouteCtx = {
          params: match.params,
          query: url.searchParams,
          auth: authenticate(ctx, config, req),
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
