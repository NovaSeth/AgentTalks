/** Operacje na pojedynczej wiadomosci, watki, reakcje, wyszukiwanie, obecnosc. */
import { deleteMessage, editMessage, getMessage, listThread } from "../../core/messages.ts";
import { canRead } from "../../core/conversations.ts";
import { actorsByIds } from "../../core/actors.ts";
import { forbidden, notFound } from "../../core/errors.ts";
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
    // Jeden blad dla "nie ma" i "brak dostepu" - id wiadomosci sa globalne,
    // wiec rozne odpowiedzi zdradzalyby istnienie tresci w cudzych kanalach.
    if (!root || !canRead(rc.ctx, root.conversationId, actor.id)) {
      throw notFound("wiadomosc", `nie ma wiadomosci ${rc.params.id} (albo brak dostepu)`);
    }
    const messages = listThread(rc.ctx, root.threadId ?? root.id);
    json(res, 200, {
      messages,
      reactions: reactionsFor(rc.ctx, messages.map((m) => m.id)),
      actors: actorsByIds(rc.ctx, messages.map((m) => m.actorId)),
    });
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
    const messages = search(rc.ctx, {
      actorId: actor.id,
      text: rc.query.get("q") ?? "",
      conversationId: int(rc.query.get("conversationId") ?? undefined),
      limit: int(rc.query.get("limit") ?? undefined),
      sinceTs: int(rc.query.get("sinceTs") ?? undefined),
      untilTs: int(rc.query.get("untilTs") ?? undefined),
    });
    json(res, 200, { messages, actors: actorsByIds(rc.ctx, messages.map((m) => m.actorId)) });
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
    // Rejestracja ISTNIEJACEJ sesji nalezacej do innego aktora to proba przejecia
    // jej tozsamosci w obecnosci - odrzucana z tym samym kodem, co sygnaly.
    const owner = rc.ctx.db.prepare("SELECT actor_id FROM sessions WHERE id = ?")
      .get(sessionId) as { actor_id: number } | undefined;
    if (owner && owner.actor_id !== actor.id) {
      throw forbidden("nie_twoja_sesja", "ta sesja nalezy do innego aktora");
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

  /** Sesja nalezy do aktora - sygnalizowac i konczyc mozna WYLACZNIE wlasna.
   *  Bez tego sprawdzenia kazdy uwierzytelniony aktor moglby udawac, ze cudza
   *  sesja pracuje, albo ja "zakonczyc" - czyli falszowac obecnosc, na ktorej
   *  inni polegaja przy decyzji "jest, mozna pytac". */
  const assertOwnSession = (rc: { ctx: import("../../core/ctx.ts").Ctx }, sessionId: string,
                            actorId: number): void => {
    const row = rc.ctx.db
      .prepare("SELECT actor_id FROM sessions WHERE id = ?")
      .get(sessionId) as { actor_id: number } | undefined;
    if (!row) throw notFound("sesja", `nie ma sesji ${sessionId}`);
    if (row.actor_id !== actorId) {
      throw forbidden("nie_twoja_sesja", "ta sesja nalezy do innego aktora");
    }
  };

  /** typing i busy to DWA ROZNE sygnaly. "Pracuje" ma pochodzic z uzycia narzedzia
   *  (hook PostToolUse), nigdy z pollowania API - inaczej otwarta karta udaje prace. */
  router.add("POST", "/api/sessions/:id/signal", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    assertOwnSession(rc, rc.params.id, actor.id);
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
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    assertOwnSession(rc, rc.params.id, actor.id);
    endSession(rc.ctx, rc.params.id);
    json(res, 200, { ok: true });
  });
}
