/** Operations on a single message, threads, reactions, search, presence. */
import { deleteMessage, editMessage, getMessage, listThread, markFixed, resolveMessage } from "../../core/messages.ts";
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
import { int, json, readJson, str, zHandlem} from "../respond.ts";
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

  /** "Fixed" - the fixer's claim (the code was changed). It does NOT close the report: that is
  /**  still done by the author or an admin through /resolve. fixed=false takes it back. */
  router.add("POST", "/api/messages/:id/fix", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 512);
    json(res, 200, {
      message: markFixed(rc.ctx, {
        id: Number(rc.params.id),
        actorId: actor.id,
        fixed: body.fixed !== false,
      }),
    });
  });

  /** Closing a report (for instance on #bug): a check on the entry. resolved=false takes it back. */
  router.add("POST", "/api/messages/:id/resolve", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 512);
    json(res, 200, {
      message: resolveMessage(rc.ctx, {
        id: Number(rc.params.id),
        actorId: actor.id,
        resolved: body.resolved !== false,
        isInstanceAdmin: !!actor.isAdmin,
      }),
    });
  });

  router.add("GET", "/api/messages/:id/thread", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const root = getMessage(rc.ctx, Number(rc.params.id));
    // One error for "does not exist" and "no access" - message ids are global, so different
    // answers would reveal the existence of content in other people's channels.
    if (!root || !canRead(rc.ctx, root.conversationId, actor.id)) {
      throw notFound("wiadomosc", `nie ma wiadomosci ${rc.params.id} (albo brak dostepu)`);
    }
    const messages = listThread(rc.ctx, root.threadId ?? root.id);
    const autorzy = actorsByIds(rc.ctx, messages.map((m) => m.actorId));
    json(res, 200, {
      messages: zHandlem(messages, autorzy),
      reactions: reactionsFor(rc.ctx, messages.map((m) => m.id)),
      actors: autorzy,
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
    const autorzy = actorsByIds(rc.ctx, messages.map((m) => m.actorId));
    json(res, 200, { messages: zHandlem(messages, autorzy), actors: autorzy });
  });

  router.add("GET", "/api/presence", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { presence: presence(rc.ctx) });
  });

  /** Registration and heartbeat in one: an agent calls this at startup and then periodically,
  /**  and the server does not have to tell the two cases apart. */
  router.add("POST", "/api/sessions", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const sessionId = str(body.sessionId);
    if (!sessionId) {
      json(res, 400, { error: "brak sessionId", code: "brak_sessionid" });
      return;
    }
    // Registering an EXISTING session belonging to another actor is an attempt to take over its
    // identity in presence - rejected with the same code as signals.
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
    // `workingOn` as an alias for `doing`, because that is how the skill - wrongly - described
    // it, and the skill is distributed by COPYING the file: copies with that name are already
    // circulating and will keep sending it, even once the source is fixed. Without the alias each
    // of them registers a session with no "what I am doing" information and GETS NO SIGNAL about
    // it - the field simply disappears. The canonical name is `doing` (that is what it is called
    // in presence and in the CLI), so when both arrive, `doing` wins.
    const doing = body.doing !== undefined ? body.doing : body.workingOn;
    if (doing !== undefined) setDoing(rc.ctx, sessionId, str(doing) ?? null);
    json(res, 200, { ok: true });
  });

  /** A session belongs to an actor - you can signal and end ONLY your own. Without this check
  /**  any authenticated actor could pretend somebody else's session is working, or "end" it -
  /**  that is, falsify the presence other people rely on when deciding "they are here, I can
  /**  ask". */
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

  /** typing and busy are TWO DIFFERENT signals. "Working" is meant to come from tool use (the
  /**  PostToolUse hook), never from polling the API - otherwise an open tab pretends to work. */
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
    // `in` = where they are writing ("c:<convId>" / "w:<slug>"); stop=true clears the bubble at
    // once (changed their mind), rather than waiting for the TTL.
    signal(rc.ctx, rc.params.id, kind, {
      typingIn: str(body.in) ?? null,
      stop: body.stop === true,
      // An agent writes in one move lasting tens of seconds - the default seven clears its bubble
      // before it finishes a sentence.
      sec: int(body.sec) ?? null,
    });
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
