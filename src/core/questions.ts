/**
 * Otwarte pytania.
 *
 * Najlepszy prymityw prototypu i powod, dla ktorego to nie jest zwykly komunikator:
 * pytanie zadaje sie KANALOWI, nie konkretnej sesji, wiec podejmie je ktokolwiek,
 * kto wroci. Dla agentow, ktorzy przychodza i odchodza, to jest roznica miedzy
 * "pytanie czeka" a "pytanie utknelo, bo adresat juz nie istnieje".
 */
import type { Ctx } from "./ctx.ts";
import { assertCanRead } from "./conversations.ts";
import { badRequest, notFound } from "./errors.ts";
import { getMessage, type Message, postMessage } from "./messages.ts";

export type OpenQuestion = { id: number; message: Message };

export function ask(
  ctx: Ctx,
  input: { conversationId: number; actorId: number; body: string; sessionId?: string | null },
): { question: number; message: Message } {
  const message = postMessage(ctx, {
    conversationId: input.conversationId,
    actorId: input.actorId,
    body: input.body,
    kind: "ask",
    sessionId: input.sessionId ?? null,
  });
  ctx.db
    .prepare("INSERT INTO questions(message_id, conversation_id) VALUES(?,?)")
    .run(message.id, input.conversationId);
  const row = ctx.db
    .prepare("SELECT id FROM questions WHERE message_id = ?")
    .get(message.id) as { id: number };
  return { question: row.id, message };
}

export function answer(
  ctx: Ctx,
  input: { questionId: number; actorId: number; body: string; sessionId?: string | null },
): { message: Message } {
  const q = ctx.db.prepare("SELECT * FROM questions WHERE id = ?").get(input.questionId) as
    | { id: number; message_id: number; conversation_id: number; closed_at: number | null }
    | undefined;
  if (!q) throw notFound("pytanie", `nie ma pytania ${input.questionId}`);
  if (q.closed_at) throw badRequest("juz_zamkniete", "na to pytanie ktos juz odpowiedzial");

  // Odpowiedz laduje w watku pytania - dzieki temu "co bylo odpowiedzia na co"
  // wynika ze struktury, a nie z czytania po kolei.
  const message = postMessage(ctx, {
    conversationId: q.conversation_id,
    actorId: input.actorId,
    body: input.body,
    kind: "answer",
    threadId: q.message_id,
    sessionId: input.sessionId ?? null,
  });
  ctx.db
    .prepare("UPDATE questions SET answer_message_id = ?, closed_at = ? WHERE id = ?")
    .run(message.id, ctx.now(), q.id);
  return { message };
}

/** Otwarte pytania z konwersacji widocznych dla aktora. Kanal prywatny nie wycieka. */
export function openQuestions(
  ctx: Ctx,
  q: { actorId: number; conversationId?: number },
): OpenQuestion[] {
  if (q.conversationId !== undefined) assertCanRead(ctx, q.conversationId, q.actorId);
  const rows = ctx.db
    .prepare(
      `SELECT qu.id AS qid, qu.message_id
         FROM questions qu
         JOIN conversations c ON c.id = qu.conversation_id
        WHERE qu.closed_at IS NULL
          AND (? IS NULL OR qu.conversation_id = ?)
          AND (c.kind = 'public'
               OR EXISTS (SELECT 1 FROM members m
                           WHERE m.conversation_id = c.id AND m.actor_id = ?))
        ORDER BY qu.id`,
    )
    .all(q.conversationId ?? null, q.conversationId ?? null, q.actorId) as Array<{
      qid: number;
      message_id: number;
    }>;
  return rows
    .map((r) => ({ id: r.qid, message: getMessage(ctx, r.message_id)! }))
    .filter((x) => x.message && !x.message.deletedAt);
}
