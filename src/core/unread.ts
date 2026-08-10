/**
 * Unread.
 * 
 * The semantics are carried over from the prototype deliberately, because they are good and
 * come from Slack:
 * 
 *   unread ("something new")     -> the conversation's name in bold
 *   badge  ("concerns YOU")      -> a numbered badge
 * 
 * A number on everything flattens that hierarchy and stops meaning anything.
 * A badge comes from a mention of me AND from every message in a direct conversation - a
 * DM is by definition addressed to me, so it needs no mention.
 * 
 * The read marker is a message ID, not a time. The prototype kept milliseconds and thereby
 * collided with clock drift and with messages sharing a ts.
 */
import type { Ctx } from "./ctx.ts";
import { canRead, join, isMember } from "./conversations.ts";
import { onCommitted } from "../store/db.ts";
import { lastMessageId } from "./messages.ts";

export type UnreadRow = {
  conversationId: number;
  unread: number;
  badge: number;
  /** The id of the last UNREAD message; with zero unread - the read marker.
  /**  This is NOT the id of the last message in the conversation. */
  lastUnreadMessageId: number;
};

export function unreadFor(ctx: Ctx, actorId: number): UnreadRow[] {
  const rows = ctx.db
    .prepare(
      `SELECT
         mem.conversation_id                                   AS conversation_id,
         COUNT(m.id)                                           AS unread,
         -- Plakietka (mocny sygnal) respektuje wyciszenie rozmowy; sam licznik
         -- nieprzeczytanych zostaje, bo to inne pytanie ("czy cos przybylo")
         -- niz plakietka ("czy mam na to zareagowac").
         SUM(CASE
               WHEN m.id IS NULL             THEN 0
               WHEN mem.notify = 'none'      THEN 0
               WHEN c.kind IN ('dm','group') THEN 1
               WHEN mn.actor_id IS NOT NULL  THEN 1
               ELSE 0
             END)                                              AS badge,
         -- Nazwa last_message_id klamala: to bylo id ostatniej NIEPRZECZYTANEJ
         -- wiadomosci (albo znacznik odczytu, gdy nie bylo zadnej), a nie ostatniej
         -- w rozmowie. Pole nie mialo konsumenta, wiec zamiast dokladac drugie
         -- podzapytanie pod nazwe, ktorej nikt nie uzywal, oddajemy prawde:
         -- last_unread_message_id.
         COALESCE(MAX(m.id), mem.last_read_message_id)         AS last_unread_message_id
       FROM members mem
       JOIN conversations c ON c.id = mem.conversation_id
       LEFT JOIN messages m
              ON m.conversation_id = mem.conversation_id
             AND m.id > mem.last_read_message_id
             AND m.actor_id <> mem.actor_id
             AND m.deleted_at IS NULL
       LEFT JOIN mentions mn
              ON mn.message_id = m.id AND mn.actor_id = mem.actor_id
       WHERE mem.actor_id = ? AND c.archived_at IS NULL
       GROUP BY mem.conversation_id
       ORDER BY mem.conversation_id`,
    )
    .all(actorId) as Array<{
      conversation_id: number;
      unread: number;
      badge: number | null;
      last_unread_message_id: number;
    }>;
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    unread: r.unread,
    badge: r.badge ?? 0,
    lastUnreadMessageId: r.last_unread_message_id,
  }));
}

export function totalBadge(ctx: Ctx, actorId: number): number {
  return unreadFor(ctx, actorId).reduce((n, r) => n + r.badge, 0);
}

/**
 * Without `messageId` it clears up to the newest message in the system.
 * The marker never moves backwards: two devices reading in parallel cannot take each
 * other's read messages away.
 */
export function markRead(ctx: Ctx, actorId: number, convId: number, messageId?: number): void {
  // The guard is in the core, not only in the routes: markRead joins the conversation, so
  // without this check every "mark as read" would be a way into somebody else's private
  // channel (found through the MCP path).
  if (!canRead(ctx, convId, actorId)) return;
  if (!isMember(ctx, convId, actorId)) join(ctx, convId, actorId);
  const target = messageId ?? lastMessageId(ctx);
  ctx.db
    .prepare(
      `UPDATE members
          SET last_read_message_id = MAX(last_read_message_id, ?)
        WHERE conversation_id = ? AND actor_id = ?`,
    )
    .run(target, convId, actorId);
  onCommitted(ctx.db, () => ctx.bus.publish([actorId], {
    type: "read",
    conversationId: convId,
    actorId,
    messageId: target,
  }));
}
