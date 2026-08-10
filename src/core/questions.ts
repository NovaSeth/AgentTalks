/**
 * Open questions.
 *
 * The prototype's best primitive, and the reason this is not an ordinary messenger: a
 * question is asked of the CHANNEL, not of a particular session, so whoever comes back can
 * take it. For agents that come and go, that is the difference between "the question is
 * waiting" and "the question is stuck, because its addressee no longer exists".
 */
import { tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { assertCanRead } from "./conversations.ts";
import { badRequest, notFound } from "./errors.ts";
import { messageFromRow, type MsgRow, getMessage, type Message, postMessage } from "./messages.ts";

export type OpenQuestion = { id: number; message: Message };

export function ask(
  ctx: Ctx,
  input: { conversationId: number; actorId: number; body: string; sessionId?: string | null },
): { question: number; message: Message } {
  // ONE transaction for the message and the question row. Without it, a process crash (or
  // SQLITE_BUSY from a parallel CLI) between the two commits left a permanently delivered
  // kind='ask' message that nobody could ever answer, because the question did not exist.
  // The event reaches the bus after the commit anyway (onCommitted inside postMessage).
  // (onCommitted wewnatrz postMessage).
  return tx(ctx.db, () => {
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
  });
}

export function answer(
  ctx: Ctx,
  input: { questionId: number; actorId: number; body: string; sessionId?: string | null },
): { message: Message } {
  // The access check BEFORE checking the state: without it the endpoint revealed the
  // existence and status of questions from other people's private channels ("already closed"
  // is information too). A non-existent question and a question without access deliberately
  // give errors with THE SAME wording as the rest of the system.
  const q = ctx.db.prepare("SELECT * FROM questions WHERE id = ?").get(input.questionId) as
    | { id: number; message_id: number; conversation_id: number; closed_at: number | null }
    | undefined;
  if (!q) throw notFound("pytanie", `nie ma pytania ${input.questionId}`);
  assertCanRead(ctx, q.conversation_id, input.actorId);

  // ONE transaction for the answer message and closing the question, with a RE-CHECK of the
  // state inside: two processes answering simultaneously must not both pass the "open"
  // validation and leave two answers.
  return tx(ctx.db, () => {
    const fresh = ctx.db
      .prepare("SELECT closed_at, message_id, conversation_id FROM questions WHERE id = ?")
      .get(q.id) as { closed_at: number | null; message_id: number; conversation_id: number };
    if (fresh.closed_at) throw badRequest("juz_zamkniete", "na to pytanie ktos juz odpowiedzial");

    // The answer lands in the question's thread - so "what answered what" follows from the
    // structure rather than from reading in order.
    const message = postMessage(ctx, {
      conversationId: fresh.conversation_id,
      actorId: input.actorId,
      body: input.body,
      kind: "answer",
      threadId: fresh.message_id,
      sessionId: input.sessionId ?? null,
    });
    ctx.db
      .prepare("UPDATE questions SET answer_message_id = ?, closed_at = ? WHERE id = ?")
      .run(message.id, ctx.now(), q.id);
    return { message };
  });
}

/** Open questions from conversations visible to the actor. A private channel does not leak. */
export function openQuestions(
  ctx: Ctx,
  q: { actorId: number; conversationId?: number },
): OpenQuestion[] {
  if (q.conversationId !== undefined) assertCanRead(ctx, q.conversationId, q.actorId);
  // The message is fetched IN THE SAME query: previously every question cost a separate
  // `getMessage`, so a panel with 40 open questions made 41 queries. Plus a LIMIT - a list of
  // things "to take up" without a bound is an invitation to an answer that grows with the
  // instance's history.
  const rows = ctx.db
    .prepare(
      `SELECT qu.id AS qid, qu.message_id, m.*
         FROM questions qu
         JOIN conversations c ON c.id = qu.conversation_id
         JOIN messages m ON m.id = qu.message_id AND m.deleted_at IS NULL
        WHERE qu.closed_at IS NULL
          -- Kanal zarchiwizowany nie przyjmuje juz wiadomosci, wiec na pytanie
          -- w nim NIE DA SIE odpowiedziec. Zostawianie go na liscie "do podjecia"
          -- to licznik, ktorego nie da sie wyzerowac inaczej niz ignorowaniem.
          AND c.archived_at IS NULL
          AND (? IS NULL OR qu.conversation_id = ?)
          AND (c.kind = 'public'
               OR EXISTS (SELECT 1 FROM members m
                           WHERE m.conversation_id = c.id AND m.actor_id = ?))
        ORDER BY qu.id
        LIMIT 200`,
    )
    .all(q.conversationId ?? null, q.conversationId ?? null, q.actorId) as Array<
      MsgRow & { qid: number }
    >;
  return rows.map((r) => ({ id: r.qid, message: messageFromRow(r) }));
}
