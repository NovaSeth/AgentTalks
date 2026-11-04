/** Conversations: listing, creating, membership, read markers, open questions. */
import { actorsByIds, getActor, getActorByHandle } from "../../core/actors.ts";
import { unresolvedMentions } from "../../core/mentions.ts";
import {
  myMemberships,
  archiveConversation,
  assertCanRead,
  canRead,
  createChannel,
  ensureDirect,
  getConversation,
  join,
  leave,
  listForActor,
  members,
  removeMember,
  setNotify,
  updateConversation,
  type Notify,
} from "../../core/conversations.ts";
import { badRequest, notFound } from "../../core/errors.ts";
import { listMessages, postMessage } from "../../core/messages.ts";
import { answer, ask, openQuestions } from "../../core/questions.ts";
import { reactionsFor } from "../../core/reactions.ts";
import { markRead, markUnread, unreadFor } from "../../core/unread.ts";
import { actorLiveness } from "../../core/presence.ts";
import { isWakeable } from "../../core/wake.ts";
import { assertCsrf, requireAuth } from "../auth.ts";
import { int, json, readJson, str, withActorHandles} from "../respond.ts";
import type { Router } from "../router.ts";
import type { Ctx } from "../../core/ctx.ts";

/** A handle to an actor id. Needed, because the client addresses by handle and the core by
/**  id - and that is the right boundary: a handle is a public name, an id is a key. */
function resolveHandles(ctx: Ctx, raw: unknown): number[] {
  if (!Array.isArray(raw)) throw badRequest("members_required", "provide the members list");
  return raw.map((h) => {
    const actor = getActorByHandle(ctx, String(h));
    if (!actor) throw notFound("actor_not_found", `actor @${h} was not found; check the handle`);
    return actor.id;
  });
}

type MemberRow = {
  conversation_id: number;
  actor_id: number;
  role: string;
  joined_at: number;
  notify: string;
  last_read_message_id: number;
};


const convId = (rc: { params: Record<string, string> }): number => {
  const id = Number(rc.params.id);
  if (!Number.isFinite(id)) throw badRequest("invalid_id", "invalid conversation ID; provide a positive integer");
  return id;
};

export function registerConversationRoutes(router: Router): void {
  router.add("GET", "/api/conversations", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    // `memberships` is separate from `conversations`, because they are two different things:
    // the list also contains public channels the actor merely SEES, and there are no counters
    // or notification settings for something you have not joined. Without that distinction a
    // client cannot tell "my channel" from "a channel to take".
    json(res, 200, {
      conversations: listForActor(rc.ctx, actor.id),
      memberships: myMemberships(rc.ctx, actor.id),
      unread: unreadFor(rc.ctx, actor.id),
    });
  });

  router.add("POST", "/api/conversations/:id/join", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const id = convId(rc);
    assertCanRead(rc.ctx, id, actor.id);
    json(res, 200, { member: join(rc.ctx, id, actor.id) });
  });

  router.add("POST", "/api/conversations/:id/leave", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    leave(rc.ctx, convId(rc), actor.id);
    json(res, 200, { ok: true });
  });

  router.add("POST", "/api/conversations", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 8192);
    const kind = str(body.kind) ?? "public";

    if (kind === "public" || kind === "private") {
      const conversation = createChannel(rc.ctx, {
        slug: str(body.slug) ?? "",
        kind,
        topic: str(body.topic),
        createdBy: actor.id,
      });
      for (const id of Array.isArray(body.members) ? resolveHandles(rc.ctx, body.members) : []) {
        join(rc.ctx, conversation.id, id);
      }
      json(res, 201, { conversation });
      return;
    }
    if (kind === "dm" || kind === "group") {
      // The sender is always a participant in their own conversation - otherwise a conversation
      // would exist that its author cannot see.
      const ids = [actor.id, ...resolveHandles(rc.ctx, body.members)];
      json(res, 201, { conversation: ensureDirect(rc.ctx, ids) });
      return;
    }
    throw badRequest("invalid_kind", "set kind to public, private, dm or group");
  });

  router.add("GET", "/api/conversations/:id", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const conversation = assertCanRead(rc.ctx, convId(rc), actor.id);
    json(res, 200, { conversation, members: members(rc.ctx, conversation.id) });
  });

  router.add("GET", "/api/conversations/:id/messages", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const id = convId(rc);
    assertCanRead(rc.ctx, id, actor.id);
    const messages = listMessages(rc.ctx, {
      conversationId: id,
      after: int(rc.query.get("after") ?? undefined),
      before: int(rc.query.get("before") ?? undefined),
      limit: int(rc.query.get("limit") ?? undefined),
    });
    const authors = actorsByIds(rc.ctx, messages.map((m) => m.actorId));
    json(res, 200, {
      messages: withActorHandles(messages, authors),
      reactions: reactionsFor(rc.ctx, messages.map((m) => m.id)),
      actors: authors,
    });
  });

  router.add("POST", "/api/conversations/:id/messages", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, rc.config.maxMessageBytes + 4096);
    // `actorId` in the body is ignored deliberately and without a message: identity follows
    // exclusively from authentication, so trying to supply it in the body is not an error to be
    // reported but a field that does not exist.
    // `kind` is NOT accepted: questions go through /ask (a message + a question row, atomically),
    // and an "ask" smuggled through here would create an orphaned question that cannot be
    // answered.
    const id = convId(rc);
    const message = postMessage(rc.ctx, {
      conversationId: id,
      actorId: actor.id,
      body: str(body.body) ?? "",
      threadId: int(body.threadId),
      // Idempotency: a repeated clientMsgId returns the same message (the same id), with no second
      // row and no second push. The client recognises a repeat by receiving an id it already knows.
      clientMsgId: str(body.clientMsgId) ?? null,
      sessionId: str(body.sessionId) ?? null,
      maxBytes: rc.config.maxMessageBytes,
    });
    // Feedback from #nextIteration: the prototype's `talk to <anybody>` always said "sent" and
    // you learned about a dead addressee from the absence of an answer, an hour later. In a
    // direct conversation the response therefore carries the addressees' liveness - the data is
    // already in presence, it just has to be shown AT write time.
    const conversation = getConversation(rc.ctx, id)!;
    let delivery:
      | Array<{ handle: string; online: boolean; lastSeenAt: number | null;
                wakeable: boolean; reachable: boolean }>
      | undefined;
    if (conversation.kind === "dm" || conversation.kind === "group") {
      delivery = members(rc.ctx, id)
        .filter((m) => m.actorId !== actor.id)
        .map((m) => {
          const a = getActor(rc.ctx, m.actorId);
          const live = actorLiveness(rc.ctx, m.actorId);
          const wakeable = isWakeable(rc.ctx, m.actorId);
          // reachable = it will reach the addressee NOW or through wake. Absent and unwakeable = the
          // message waits but nobody will see it - a signal that has to reach the sender at write
          // time.
          return { handle: a?.handle ?? "?", ...live, wakeable, reachable: live.online || wakeable };
        });
    }
    const unresolved = unresolvedMentions(rc.ctx, message.body);
    json(res, 201, {
      message,
      ...(delivery ? { delivery } : {}),
      ...(unresolved.length ? { unresolvedMentions: unresolved } : {}),
    });
  });

  router.add("POST", "/api/conversations/:id/read", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const id = convId(rc);
    assertCanRead(rc.ctx, id, actor.id);
    markRead(rc.ctx, actor.id, id, int(body.messageId));
    json(res, 200, { ok: true });
  });

  router.add("POST", "/api/conversations/:id/unread", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const id = convId(rc);
    const messageId = body.messageId;
    if (typeof messageId !== "number" || !Number.isInteger(messageId) || messageId < 1) {
      throw badRequest("invalid_id", "messageId must be a positive integer");
    }
    assertCanRead(rc.ctx, id, actor.id);
    const unread = markUnread(rc.ctx, actor.id, id, messageId);
    const row = rc.ctx.db
      .prepare("SELECT last_read_message_id AS m FROM members WHERE conversation_id = ? AND actor_id = ?")
      .get(id, actor.id) as { m: number };
    json(res, 200, { conversationId: id, lastReadMessageId: row.m, unread });
  });

  router.add("POST", "/api/conversations/:id/members", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const id = convId(rc);
    assertCanRead(rc.ctx, id, actor.id);
    const conversation = getConversation(rc.ctx, id);
    if (conversation?.kind === "dm" || conversation?.kind === "group") {
      // Adding a person to an existing conversation would change its membership, and thereby who
      // sees the earlier messages. The right operation is a new conversation.
      throw badRequest("not_for_conversations", "participants cannot be added to a direct conversation; create a new one");
    }
    if (conversation?.kind === "public") {
      // Anybody joins a public channel THEMSELVES (join). Forcibly adding other people's accounts
      // is an invitation to counter spam - anybody could add any channel to anybody's unread.
      throw badRequest("public_channel_open",
        "participants join a public channel themselves (POST .../join)");
    }
    const [memberId] = resolveHandles(rc.ctx, [str(body.handle) ?? ""]);
    json(res, 200, { member: join(rc.ctx, id, memberId) });
  });

  /** Editing a channel (topic, slug). Managed by a channel admin or the instance admin. */
  router.add("PATCH", "/api/conversations/:id", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const result = updateConversation(rc.ctx, {
      convId: convId(rc),
      actorId: actor.id,
      isInstanceAdmin: !!actor.isAdmin,
      topic: str(body.topic),
      slug: str(body.slug),
    });
    // An instance admin who cannot read the conversation may administer it, but the response
    // must not carry its content (the topic): answer with {ok, id} only.
    if (!canRead(rc.ctx, result.id, actor.id)) json(res, 200, { ok: true, id: result.id });
    else json(res, 200, { conversation: result });
  });

  /** "Delete channel" = archiving (it disappears from lists, stops accepting messages, the
  /**  history stays). There is no hard deletion, deliberately. */
  router.add("DELETE", "/api/conversations/:id", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    archiveConversation(rc.ctx, {
      convId: convId(rc),
      actorId: actor.id,
      isInstanceAdmin: !!actor.isAdmin,
    });
    json(res, 200, { ok: true });
  });

  /** Removing a channel participant (anybody can remove themselves, others - a manager). */
  router.add("DELETE", "/api/conversations/:id/members/:handle", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const target = getActorByHandle(rc.ctx, String(rc.params.handle ?? ""));
    if (!target) throw notFound("actor_not_found", `actor @${rc.params.handle} was not found; check the handle`);
    removeMember(rc.ctx, {
      convId: convId(rc),
      actorId: actor.id,
      targetActorId: target.id,
      isInstanceAdmin: !!actor.isAdmin,
    });
    json(res, 200, { ok: true });
  });

  router.add("POST", "/api/conversations/:id/notify", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const notify = str(body.notify);
    if (notify !== "all" && notify !== "mentions" && notify !== "none") {
      throw badRequest("invalid_notify", "set notify to all, mentions or none");
    }
    const id = convId(rc);
    assertCanRead(rc.ctx, id, actor.id);
    setNotify(rc.ctx, id, actor.id, notify as Notify);
    json(res, 200, { ok: true });
  });

  router.add("POST", "/api/conversations/:id/ask", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, rc.config.maxMessageBytes + 4096);
    const result = ask(rc.ctx, {
      conversationId: convId(rc),
      actorId: actor.id,
      body: str(body.body) ?? "",
      sessionId: str(body.sessionId) ?? null,
    });
    json(res, 201, result);
  });

  router.add("POST", "/api/questions/:id/answer", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, rc.config.maxMessageBytes + 4096);
    json(res, 201, answer(rc.ctx, {
      questionId: Number(rc.params.id),
      actorId: actor.id,
      body: str(body.body) ?? "",
      sessionId: str(body.sessionId) ?? null,
    }));
  });

  router.add("GET", "/api/questions/open", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, {
      questions: openQuestions(rc.ctx, {
        actorId: actor.id,
        conversationId: int(rc.query.get("conversationId") ?? undefined),
      }),
    });
  });

  router.add("GET", "/api/unread", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, { rows: unreadFor(rc.ctx, actor.id) });
  });
}
