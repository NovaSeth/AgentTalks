/**
 * Reactions. Their own table rather than messages in the same log.
 * 
 * In the prototype a reaction was a record in channel.jsonl, so every place reading the
 * history had to filter it out with a NOISE set - repeated across three files, in two
 * languages. A separate table removes that obligation at the source.
 */
import type { Ctx } from "./ctx.ts";
import { canRead, recipientsOf } from "./conversations.ts";
import { onCommitted } from "../store/db.ts";
import { normalizeEmoji } from "./ids.ts";
import { notFound } from "./errors.ts";
import { excerptOf, notify } from "./notifications.ts";

/** A toggle: a second identical reaction from the same actor removes it. */
export function react(
  ctx: Ctx,
  input: { messageId: number; actorId: number; emoji: string },
): { on: boolean } {
  const emoji = normalizeEmoji(input.emoji);
  const msg = ctx.db
    .prepare("SELECT conversation_id FROM messages WHERE id = ?")
    .get(input.messageId) as { conversation_id: number } | undefined;
  // One error for "does not exist" and "you have no access": the id of a message from
  // somebody else's private channel must not be an oracle for its existence.
  if (!msg || !canRead(ctx, msg.conversation_id, input.actorId)) {
    throw notFound("wiadomosc", `nie ma wiadomosci ${input.messageId} (albo brak dostepu)`);
  }

  const target = ctx.db
    .prepare("SELECT actor_id, body FROM messages WHERE id = ?")
    .get(input.messageId) as { actor_id: number; body: string } | undefined;

  const existing = ctx.db
    .prepare("SELECT 1 FROM reactions WHERE message_id=? AND actor_id=? AND emoji=?")
    .get(input.messageId, input.actorId, emoji);
  if (existing) {
    ctx.db
      .prepare("DELETE FROM reactions WHERE message_id=? AND actor_id=? AND emoji=?")
      .run(input.messageId, input.actorId, emoji);
  } else {
    ctx.db
      .prepare("INSERT INTO reactions(message_id, actor_id, emoji, created_at) VALUES(?,?,?,?)")
      .run(input.messageId, input.actorId, emoji, ctx.now());
  }
  // We notify ONLY about a reaction being added, and only its post's author: removing a
  // reaction is not an event worth waking anybody for, and the rest of the channel sees the
  // emoji next to the message without a notification.
  if (!existing && target) {
    notify(ctx, {
      actorIds: [target.actor_id],
      kind: "reaction",
      fromActorId: input.actorId,
      conversationId: msg.conversation_id,
      messageId: input.messageId,
      excerpt: `${emoji}  ${excerptOf(target.body)}`,
    });
  }
  onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, msg.conversation_id), {
    type: "reaction",
    conversationId: msg.conversation_id,
    messageId: input.messageId,
  }));
  return { on: !existing };
}

/** { messageId: { emoji: [handle, ...] } } - `handle` feeds the "who reacted" tooltip.
/**  Without it an emoji is anonymous and stops being a signal. */
export function reactionsFor(
  ctx: Ctx,
  messageIds: readonly number[],
): Record<number, Record<string, string[]>> {
  if (messageIds.length === 0) return {};
  const marks = messageIds.map(() => "?").join(",");
  const rows = ctx.db
    .prepare(
      `SELECT r.message_id, r.emoji, a.handle
         FROM reactions r JOIN actors a ON a.id = r.actor_id
        WHERE r.message_id IN (${marks})
        ORDER BY r.created_at`,
    )
    .all(...messageIds) as Array<{ message_id: number; emoji: string; handle: string }>;
  const out: Record<number, Record<string, string[]>> = {};
  for (const r of rows) {
    (out[r.message_id] ??= {})[r.emoji] ??= [];
    out[r.message_id][r.emoji].push(r.handle);
  }
  return out;
}

