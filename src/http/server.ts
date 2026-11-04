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

export const VERSION = "0.3.0";

export function buildRouter(ui = true): Router {
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
      ui: rc.config.ui,
      ...(isLoopbackRequest(req) ? { actors: row.actors, lastMessageId: row.lastMessageId } : {}),
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
      throw unauthorized("unauthenticated", "MCP requires an Authorization: Bearer <token> header");
    }
    let mcp;
    try {
      mcp = await import("../mcp/server.ts");
    } catch {
      json(res, 501, {
        error: "MCP module unavailable; install dependencies with npm install",
        code: "mcp_unavailable",
      });
      return;
    }
    // Caps BEFORE the SDK sees the body: it would otherwise buffer whatever arrives (a 60 MB
    // body, or a batch of 20 000 calls, each one a tool run).
    const parsed = await readMcpBody(req, res);
    if (parsed === undefined) return;
    await mcp.handleMcp(rc.ctx, rc.config, rc.auth.actor, req, res, parsed);
  });
  router.add("GET", "/mcp", (_req, res) => {
    json(res, 405, { error: "the MCP server is stateless; use POST", code: "post_only" });
  });
  // The UI, the gate, public onboarding - mounted last (the most general routes).
  registerUiRoutes(router, ui);
  return router;
}

/** POST /mcp body cap and JSON-RPC batch cap. */
const MCP_MAX_BODY = 1024 * 1024;
const MCP_MAX_BATCH = 50;

/** Reads and parses the /mcp body. Answers 413/400 itself and returns undefined when the
 *  request is refused. */
async function readMcpBody(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): Promise<unknown | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  const refuse = (): undefined => {
    // Answer at once and close: the rest of an oversized body is neither read nor waited for.
    // After the answer we discard a few more MB so a client that is still uploading can read
    // the 413 (an abrupt close would show up as a connection reset), then cut the request.
    res.once("finish", () => {
      let drained = 0;
      req.on("data", (c: Buffer) => { drained += c.length; if (drained > 4 * MCP_MAX_BODY) req.destroy(); });
      req.on("error", () => {});
      req.resume();
      setTimeout(() => req.destroy(), 2000).unref();
    });
    json(res, 413, {
      error: "request body over 1 MB: send a smaller message or split the work into several calls",
      code: "body_too_large",
    });
    return undefined;
  };
  // A declared length over the cap is refused before a single body byte is read.
  if (Number(req.headers["content-length"] ?? 0) > MCP_MAX_BODY) return refuse();
  let tooBig = false;
  await new Promise<void>((resolve) => {
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MCP_MAX_BODY) {
        // A chunked body has no declared length: stop at the cap instead of draining it.
        tooBig = true;
        chunks.length = 0;
        req.pause();
        resolve();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve());
    req.on("error", () => resolve());
    req.on("close", () => resolve());
  });
  if (tooBig) return refuse();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    json(res, 400, { error: "request body is not valid JSON", code: "bad_json" });
    return undefined;
  }
  if (Array.isArray(parsed) && parsed.length > MCP_MAX_BATCH) {
    json(res, 400, {
      error: `JSON-RPC batch of ${parsed.length} calls; the limit is ${MCP_MAX_BATCH}. ` +
        `Send fewer calls per request.`,
      code: "batch_too_large",
    });
    return undefined;
  }
  return parsed;
}

/** Whether the request came from this machine. The presence of X-Forwarded-For means it went
/**  through a proxy, so it is not local, even when the socket says 127.0.0.1. */
function isLoopbackRequest(req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } }): boolean {
  if (req.headers["x-forwarded-for"]) return false;
  const a = String(req.socket.remoteAddress ?? "");
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

export function createServer(ctx: Ctx, config: Config): Server {
  const router = buildRouter(config.ui);

  return createHttpServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        // The anti-bot gate BEFORE routing: the UI behind a password, API/MCP/public free.
        if (siteGateBlocks(req, res, config, url.pathname)) return;
        const match = router.match(req.method ?? "GET", url.pathname);
        if (!match) {
          json(res, 404, { error: "path not found; check the URL", code: "not_found" });
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
