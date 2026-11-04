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

/**
 * The most unread messages (and badge hits) counted per conversation: "99+" semantics.
 * Counting EVERY unread row made the cost grow with history: agents rarely mark anything
 * read, and 200 channels with 300k unread messages took ~230 ms per call. Above the cap the
 * exact number carries no information anyway ("a lot").
 * Measured on that scene: the per-conversation walk costs ~0.03 ms per counted row (it reads
 * the row for actor_id/deleted_at), so a cap of 1000 cost ~66 ms and 100 costs ~6 ms.
 */
export const UNREAD_CAP = 100;

export function unreadFor(ctx: Ctx, actorId: number): UnreadRow[] {
  // The unread count is a correlated subquery with LIMIT, so it stops at the cap instead of
  // aggregating every unread row. "Unread" means: newer than the read marker, not mine, not
  // deleted - the same three conditions in every query below.
  const rows = ctx.db
    .prepare(
      `SELECT
         mem.conversation_id AS conversation_id,
         (mem.notify = 'none') AS muted,
         (c.kind IN ('dm','group')) AS direct,
         (SELECT COUNT(*) FROM (
            SELECT 1 FROM messages m
             WHERE m.conversation_id = mem.conversation_id
               AND m.id > mem.last_read_message_id
               AND m.actor_id <> mem.actor_id
               AND m.deleted_at IS NULL
             LIMIT :cap)) AS unread,
         -- The id of the last UNREAD message, or the read marker when there is none. The
         -- index on (conversation_id, id) is walked backwards and stops at the first hit.
         COALESCE(
           (SELECT m.id FROM messages m
             WHERE m.conversation_id = mem.conversation_id
               AND m.id > mem.last_read_message_id
               AND m.actor_id <> mem.actor_id
               AND m.deleted_at IS NULL
             ORDER BY m.id DESC LIMIT 1),
           mem.last_read_message_id) AS last_unread_message_id
       FROM members mem
       JOIN conversations c ON c.id = mem.conversation_id
       WHERE mem.actor_id = :me AND c.archived_at IS NULL
       ORDER BY mem.conversation_id`,
    )
    .all({ me: actorId, cap: UNREAD_CAP }) as Array<{
      conversation_id: number;
      muted: number;
      direct: number;
      unread: number;
      last_unread_message_id: number;
    }>;

  // Mentions of me in unread messages, in ONE pass driven by my mentions (CROSS JOIN fixes
  // the order: mentions by actor, then the message and the membership by primary key). A
  // per-conversation subquery walked every unread message of every channel looking for
  // mentions, which costs as much as counting without a cap.
  const mentionRows = ctx.db
    .prepare(
      `SELECT m.conversation_id AS conversation_id, COUNT(*) AS n
         FROM mentions mn
        CROSS JOIN messages m ON m.id = mn.message_id
        CROSS JOIN members mem
                ON mem.conversation_id = m.conversation_id AND mem.actor_id = mn.actor_id
        WHERE mn.actor_id = :me
          AND m.id > mem.last_read_message_id
          AND m.actor_id <> :me
          AND m.deleted_at IS NULL
        GROUP BY m.conversation_id`,
    )
    .all({ me: actorId }) as Array<{ conversation_id: number; n: number }>;
  const mentioned = new Map(mentionRows.map((r) => [r.conversation_id, r.n]));

  return rows.map((r) => ({
    conversationId: r.conversation_id,
    unread: r.unread,
    // The badge (the strong signal) respects muting; the unread counter stays, because it
    // answers a different question ("did something arrive"). In a direct conversation every
    // unread message is addressed to me; on a channel only a mention counts.
    badge: r.muted
      ? 0
      : r.direct
        ? r.unread
        : Math.min(mentioned.get(r.conversation_id) ?? 0, UNREAD_CAP),
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
  // Clamped to the conversation's last message: a marker set past the end (a typo, a stale
  // global cursor, a hostile client) silently marked every FUTURE message as read.
  const lastInConv = (ctx.db
    .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE conversation_id = ?")
    .get(convId) as { id: number }).id;
  const target = Math.min(messageId ?? lastMessageId(ctx), lastInConv);
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
