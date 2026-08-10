/**
 * Assembling the server. This file knows node:http and the router, and nothing more - domain
 * rules are in core/, SQL in store/.
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
  // Health with a REAL probe: "the server came up" != "the database answers". Feedback
  // 332c7e42: an auth stub / empty stream must NOT go green. If the DB does not answer, the
  // query throws -> 500 -> the container/proxy sees unhealthy, instead of a green process over
  // a dead database.
  router.add("GET", "/api/health", (req, res, rc) => {
    // The probe MUST touch the database - otherwise a green process over a dead database looks
    // healthy (feedback 332c7e42). But the response does not have to TELL anything about it: the
    // number of accounts and the id of the last message are free telemetry for anybody on the
    // internet - they show the pace of conversation and the team's growth, without logging in.
    // So the numbers go only to a caller from the LOOPBACK: the container healthcheck and the
    // deployment script, which uses them to detect a volume swapped for an empty one. From
    // outside, only the fact "the database answers" remains.
    const row = rc.ctx.db
      .prepare("SELECT (SELECT COUNT(*) FROM actors) AS actors, (SELECT COALESCE(MAX(id),0) FROM messages) AS lastMessageId")
      .get() as { actors: number; lastMessageId: number };
    json(res, 200, {
      ok: true,
      version: VERSION,
      ...(zPetliZwrotnej(req) ? { actors: row.actors, lastMessageId: row.lastMessageId } : {}),
    });
  });

  /** The same numbers for calls from outside the machine - but after logging in, because then
  /**  it is monitoring of one's own instance rather than free reconnaissance. */
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

  // MCP - the main interface for agents. The module is loaded dynamically: this is the ONLY
  // place with an npm dependency, and the server has to come up even when somebody runs it
  // from source without `npm install` (everything except /mcp works on the stdlib alone).
  router.add("POST", "/mcp", async (req, res, rc) => {
    if (!rc.auth || rc.auth.via !== "token") {
      // Bearer only: an MCP client is an agent, not a browser tab.
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
  // The UI, the gate, public onboarding - mounted last (the most general routes).
  registerUiRoutes(router);
  return router;
}

/** Whether the request came from this machine. The presence of X-Forwarded-For means it went
/**  through a proxy, so it is not local, even when the socket says 127.0.0.1. */
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
        // The anti-bot gate BEFORE routing: the UI behind a password, API/MCP/public free.
        if (siteGateBlocks(req, res, config, url.pathname)) return;
        const match = router.match(req.method ?? "GET", url.pathname);
        if (!match) {
          json(res, 404, { error: "nie ma takiej sciezki", code: "nie_znaleziono" });
          return;
        }
        // Security headers on EVERY response, set before a handler starts writing. The reason for
        // each of them separately:
        //  - nosniff: a user's attachment served as octet-stream must not be "guessed" by the browser
        //    as HTML and executed,
        //  - Referrer-Policy: this instance's URLs (including invites in links) must not leak to
        //    other people's servers in a Referer header,
        //  - frame-ancestors: another site cannot embed the UI in a frame (clickjacking),
        //  - a CSP with no 'unsafe-eval' and with self: the UI loads nothing from outside, so the
        //    policy is strict with no concessions. This is a second line of defence behind HTML
        //    escaping in the client, not a replacement for it.
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
          // Computed only for an unauthenticated request - one database query per 401, none on normal
          // traffic.
          authNote: auth ? null : authFailureNote(ctx, req),
          ctx,
          config,
        };
        await match.handler(req, res, rc);
      } catch (err) {
        // SSE and long-poll write their own headers. If an error arrived after they were sent, the
        // only thing left is to close the connection - trying to append JSON would corrupt the stream
        // the client is parsing.
        if (res.headersSent) {
          res.end();
          return;
        }
        fail(res, err);
      }
    })();
  });
}
