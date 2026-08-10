/**
 * A small router. Segment matching, with no regular expressions built from input data - that
 * is its entire secret and its entire value.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import type { Auth } from "./auth.ts";

export type Req = IncomingMessage;
export type Res = ServerResponse;

export type RouteCtx = {
  params: Record<string, string>;
  query: URLSearchParams;
  auth: Auth | null;
  /** When `auth` is null but the client DID supply a token that was once valid: the reason for
  /**  the rejection and what to do about it (see authFailureNote). */
  authNote?: { code: string; message: string } | null;
  ctx: Ctx;
  config: Config;
};

export type Handler = (req: Req, res: Res, rc: RouteCtx) => Promise<unknown> | unknown;

type Route = { method: string; segments: string[]; handler: Handler };

export class Router {
  #routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.#routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    // HEAD is served by every GET route: Node itself strips the response body for HEAD, and
    // monitoring probing with HEAD must not see a 404 on a live endpoint.
    const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
    const parts = path.split("/").filter(Boolean);
    for (const route of this.#routes) {
      if (route.method !== m) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) {
          try {
            params[seg.slice(1)] = decodeURIComponent(parts[i]);
          } catch {
            // Broken %-encoding ("%zz") is a junk request, not a server failure - treated as a path that
            // does not exist.
            ok = false;
            break;
          }
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}
