/**
 * Przypiete wiadomosci. Per konwersacja (jak w Slacku), z informacja KTO przypial -
 * przypiecie jest sygnalem redakcyjnym i bez autora traci znaczenie.
 */
import type { Ctx } from "./ctx.ts";
import { assertCanRead, canRead } from "./conversations.ts";
import { notFound } from "./errors.ts";

export type Pin = { conversationId: number; messageId: number; by: string; createdAt: number };

export function pin(ctx: Ctx, input: { messageId: number; actorId: number }): Pin {
  const msg = ctx.db
    .prepare("SELECT conversation_id FROM messages WHERE id = ? AND deleted_at IS NULL")
    .get(input.messageId) as { conversation_id: number } | undefined;
  if (!msg || !canRead(ctx, msg.conversation_id, input.actorId)) {
    throw notFound("wiadomosc", `nie ma wiadomosci ${input.messageId} (albo brak dostepu)`);
  }
  ctx.db
    .prepare(
      `INSERT INTO pins(conversation_id, message_id, actor_id, created_at) VALUES(?,?,?,?)
       ON CONFLICT(conversation_id, message_id) DO NOTHING`,
    )
    .run(msg.conversation_id, input.messageId, input.actorId, ctx.now());
  return listPins(ctx, { conversationId: msg.conversation_id, actorId: input.actorId })
    .find((p) => p.messageId === input.messageId)!;
}

export function unpin(ctx: Ctx, input: { messageId: number; actorId: number }): void {
  const msg = ctx.db
    .prepare("SELECT conversation_id FROM messages WHERE id = ?")
    .get(input.messageId) as { conversation_id: number } | undefined;
  if (!msg || !canRead(ctx, msg.conversation_id, input.actorId)) return;
  ctx.db
    .prepare("DELETE FROM pins WHERE conversation_id = ? AND message_id = ?")
    .run(msg.conversation_id, input.messageId);
}

export function listPins(
  ctx: Ctx,
  q: { conversationId: number; actorId: number },
): Pin[] {
  assertCanRead(ctx, q.conversationId, q.actorId);
  const rows = ctx.db
    .prepare(
      `SELECT p.conversation_id, p.message_id, p.created_at, a.handle
         FROM pins p JOIN actors a ON a.id = p.actor_id
        WHERE p.conversation_id = ? ORDER BY p.created_at`,
    )
    .all(q.conversationId) as Array<{
      conversation_id: number; message_id: number; created_at: number; handle: string;
    }>;
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    messageId: r.message_id,
    by: r.handle,
    createdAt: r.created_at,
  }));
}
