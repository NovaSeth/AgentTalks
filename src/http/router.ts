/**
 * Maly router. Dopasowanie segmentami, bez budowania wyrazen regularnych z danych
 * wejsciowych - to jest cala jego tajemnica i cala jego wartosc.
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
    const parts = path.split("/").filter(Boolean);
    for (const route of this.#routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) {
          try {
            params[seg.slice(1)] = decodeURIComponent(parts[i]);
          } catch {
            // Zepsute %-kodowanie ("%zz") to smieciowe zadanie, nie awaria
            // serwera - traktowane jak sciezka, ktorej nie ma.
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
