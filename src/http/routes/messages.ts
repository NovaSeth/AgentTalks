/** Operacje na pojedynczej wiadomosci, watki, reakcje, wyszukiwanie, obecnosc. */
import { deleteMessage, editMessage, getMessage, listThread } from "../../core/messages.ts";
import { assertCanRead } from "../../core/conversations.ts";
import { notFound } from "../../core/errors.ts";
import { react, reactionsFor } from "../../core/reactions.ts";
import { search } from "../../core/search.ts";
import {
  endSession,
  presence,
  registerSession,
  setDoing,
  signal,
  type SessionKind,
} from "../../core/presence.ts";
import { assertCsrf, requireAuth } from "../auth.ts";
import { int, json, readJson, str } from "../respond.ts";
import type { Router } from "../router.ts";

export function registerMessageRoutes(router: Router): void {
  router.add("PATCH", "/api/messages/:id", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, rc.config.maxMessageBytes + 4096);
    json(res, 200, {
      message: editMessage(rc.ctx, Number(rc.params.id), actor.id, str(body.body) ?? ""),
    });
  });

  router.add("DELETE", "/api/messages/:id", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    json(res, 200, { message: deleteMessage(rc.ctx, Number(rc.params.id), actor.id) });
  });

  router.add("GET", "/api/messages/:id/thread", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const root = getMessage(rc.ctx, Number(rc.params.id));
    if (!root) throw notFound("wiadomosc", `nie ma wiadomosci ${rc.params.id}`);
    assertCanRead(rc.ctx, root.conversationId, actor.id);
    const messages = listThread(rc.ctx, root.threadId ?? root.id);
    json(res, 200, { messages, reactions: reactionsFor(rc.ctx, messages.map((m) => m.id)) });
  });

  router.add("POST", "/api/messages/:id/reactions", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    json(res, 200, react(rc.ctx, {
      messageId: Number(rc.params.id),
      actorId: actor.id,
      emoji: str(body.emoji) ?? "",
    }));
  });

  router.add("GET", "/api/search", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, {
      messages: search(rc.ctx, {
        actorId: actor.id,
        text: rc.query.get("q") ?? "",
        conversationId: int(rc.query.get("conversationId") ?? undefined),
        limit: int(rc.query.get("limit") ?? undefined),
      }),
    });
  });

  router.add("GET", "/api/presence", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { presence: presence(rc.ctx) });
  });

  /** Rejestracja i heartbeat w jednym: agent wola to na starcie i potem cyklicznie,
   *  a serwer nie musi rozrozniac tych dwoch przypadkow. */
  router.add("POST", "/api/sessions", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const sessionId = str(body.sessionId);
    if (!sessionId) {
      json(res, 400, { error: "brak sessionId", code: "brak_sessionid" });
      return;
    }
    const kind = str(body.kind);
    registerSession(rc.ctx, {
      sessionId,
      actorId: actor.id,
      label: str(body.label),
      kind: (kind === "ephemeral" ? "ephemeral" : "durable") as SessionKind,
      cwd: str(body.cwd) ?? null,
      host: str(body.host) ?? null,
    });
    if (body.doing !== undefined) setDoing(rc.ctx, sessionId, str(body.doing) ?? null);
    json(res, 200, { ok: true });
  });

  /** typing i busy to DWA ROZNE sygnaly. "Pracuje" ma pochodzic z uzycia narzedzia
   *  (hook PostToolUse), nigdy z pollowania API - inaczej otwarta karta udaje prace. */
  router.add("POST", "/api/sessions/:id/signal", async (req, res, rc) => {
    requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const kind = str(body.kind);
    if (kind !== "typing" && kind !== "busy") {
      json(res, 400, { error: "kind musi byc typing albo busy", code: "zly_sygnal" });
      return;
    }
    signal(rc.ctx, rc.params.id, kind);
    json(res, 200, { ok: true });
  });

  router.add("DELETE", "/api/sessions/:id", (req, res, rc) => {
    requireAuth(rc);
    assertCsrf(rc, req);
    endSession(rc.ctx, rc.params.id);
    json(res, 200, { ok: true });
  });
}
