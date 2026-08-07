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
import { longPollHandler, sseHandler } from "./sse.ts";

export const VERSION = "0.1.0";

export function buildRouter(): Router {
  const router = new Router();
  router.add("GET", "/api/health", (_req, res) => json(res, 200, { ok: true, version: VERSION }));
  registerAuthRoutes(router);
  registerConversationRoutes(router);
  registerMessageRoutes(router);
  router.add("GET", "/api/events", sseHandler);
  router.add("GET", "/api/messages", longPollHandler);
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
