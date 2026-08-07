/** Konwersacje: lista, zakladanie, czlonkostwo, znaczniki odczytu, otwarte pytania. */
import { actorsByIds, getActor, getActorByHandle } from "../../core/actors.ts";
import {
  assertCanRead,
  createChannel,
  ensureDirect,
  getConversation,
  join,
  leave,
  listForActor,
  members,
  setNotify,
  type Notify,
} from "../../core/conversations.ts";
import { badRequest, notFound } from "../../core/errors.ts";
import { listMessages, postMessage } from "../../core/messages.ts";
import { answer, ask, openQuestions } from "../../core/questions.ts";
import { reactionsFor } from "../../core/reactions.ts";
import { markRead, unreadFor } from "../../core/unread.ts";
import { actorLiveness } from "../../core/presence.ts";
import { assertCsrf, requireAuth } from "../auth.ts";
import { int, json, readJson, str } from "../respond.ts";
import type { Router } from "../router.ts";
import type { Ctx } from "../../core/ctx.ts";

/** Handle na id aktora. Wymagane, bo klient adresuje po handle, a rdzen po id -
 *  i to jest wlasciwa granica: handle jest publiczna nazwa, id jest kluczem. */
function resolveHandles(ctx: Ctx, raw: unknown): number[] {
  if (!Array.isArray(raw)) throw badRequest("brak_czlonkow", "podaj liste members");
  return raw.map((h) => {
    const actor = getActorByHandle(ctx, String(h));
    if (!actor) throw notFound("aktor", `nie ma aktora @${h}`);
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

function myMemberships(ctx: Ctx, actorId: number) {
  const rows = ctx.db
    .prepare("SELECT * FROM members WHERE actor_id = ? ORDER BY conversation_id")
    .all(actorId) as MemberRow[];
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    actorId: r.actor_id,
    role: r.role,
    joinedAt: r.joined_at,
    notify: r.notify,
    lastReadMessageId: r.last_read_message_id,
  }));
}

const convId = (rc: { params: Record<string, string> }): number => {
  const id = Number(rc.params.id);
  if (!Number.isFinite(id)) throw badRequest("zle_id", "nieprawidlowy identyfikator konwersacji");
  return id;
};

export function registerConversationRoutes(router: Router): void {
  router.add("GET", "/api/conversations", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    // `memberships` jest osobno od `conversations`, bo to sa dwie rozne rzeczy:
    // lista zawiera tez kanaly publiczne, ktore aktor tylko WIDZI, a licznikow
    // i ustawien powiadomien nie ma dla czegos, do czego sie nie dolaczylo.
    // Bez tego rozroznienia klient nie umie odroznic "kanal moj" od "kanal do wziecia".
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
      // Nadawca zawsze jest uczestnikiem swojej rozmowy - inaczej powstalaby
      // konwersacja, ktorej autor nie widzi.
      const ids = [actor.id, ...resolveHandles(rc.ctx, body.members)];
      json(res, 201, { conversation: ensureDirect(rc.ctx, ids) });
      return;
    }
    throw badRequest("zly_rodzaj", "kind musi byc public, private, dm albo group");
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
    json(res, 200, {
      messages,
      reactions: reactionsFor(rc.ctx, messages.map((m) => m.id)),
      actors: actorsByIds(rc.ctx, messages.map((m) => m.actorId)),
    });
  });

  router.add("POST", "/api/conversations/:id/messages", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, rc.config.maxMessageBytes + 4096);
    // `actorId` z ciala jest ignorowane celowo i bez komunikatu: tozsamosc wynika
    // wylacznie z uwierzytelnienia, wiec proba podania jej w ciele nie jest bledem
    // do zaraportowania, tylko polem, ktore nie istnieje.
    // `kind` NIE jest przyjmowane: pytania ida przez /ask (wiadomosc + wpis
    // pytania atomowo), a "ask" przemycone tedy tworzyloby pytanie-sierote,
    // na ktore nie da sie odpowiedziec.
    const id = convId(rc);
    const message = postMessage(rc.ctx, {
      conversationId: id,
      actorId: actor.id,
      body: str(body.body) ?? "",
      threadId: int(body.threadId),
      // Idempotencja: powtorzony clientMsgId zwraca te sama wiadomosc (to samo id),
      // bez drugiego wiersza i bez drugiego pusha. Klient rozpoznaje powtorke po
      // tym, ze dostaje id, ktore juz zna.
      clientMsgId: str(body.clientMsgId) ?? null,
      sessionId: str(body.sessionId) ?? null,
      maxBytes: rc.config.maxMessageBytes,
    });
    // Feedback z #nextIteration: prototypowe `talk to <ktokolwiek>` zawsze mowilo
    // "wyslane" i o martwym adresacie dowiadywales sie z braku odpowiedzi, po
    // godzinie. W rozmowie prywatnej odpowiedz niesie wiec zywotnosc adresatow -
    // dane juz sa w obecnosci, wystarczy je pokazac PRZY zapisie.
    const conversation = getConversation(rc.ctx, id)!;
    let delivery: Array<{ handle: string; online: boolean; lastSeenAt: number | null }> | undefined;
    if (conversation.kind === "dm" || conversation.kind === "group") {
      delivery = members(rc.ctx, id)
        .filter((m) => m.actorId !== actor.id)
        .map((m) => {
          const a = getActor(rc.ctx, m.actorId);
          return { handle: a?.handle ?? "?", ...actorLiveness(rc.ctx, m.actorId) };
        });
    }
    json(res, 201, { message, ...(delivery ? { delivery } : {}) });
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

  router.add("POST", "/api/conversations/:id/members", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const id = convId(rc);
    assertCanRead(rc.ctx, id, actor.id);
    const conversation = getConversation(rc.ctx, id);
    if (conversation?.kind === "dm" || conversation?.kind === "group") {
      // Dolozenie osoby do istniejacej rozmowy zmienialoby jej sklad, a wiec i to,
      // kto widzi wczesniejsze wiadomosci. Wlasciwa operacja to nowa rozmowa.
      throw badRequest("nie_dla_rozmow", "do rozmowy bezposredniej nie dodaje sie osob; zaloz nowa");
    }
    if (conversation?.kind === "public") {
      // Do kanalu publicznego kazdy dolacza SAM (join). Przymusowe dopisywanie
      // cudzych kont to zaproszenie do spamu licznikow - kazdy moglby kazdemu
      // dolozyc dowolny kanal do nieprzeczytanych.
      throw badRequest("publiczny_sam",
        "do kanalu publicznego dolacza sie samemu (POST .../join)");
    }
    const [memberId] = resolveHandles(rc.ctx, [str(body.handle) ?? ""]);
    json(res, 200, { member: join(rc.ctx, id, memberId) });
  });

  router.add("POST", "/api/conversations/:id/notify", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const notify = str(body.notify);
    if (notify !== "all" && notify !== "mentions" && notify !== "none") {
      throw badRequest("zly_notify", "notify musi byc all, mentions albo none");
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
