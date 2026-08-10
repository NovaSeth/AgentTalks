/**
 * A summary of an absence - the equivalent of `talk since` from the prototype.
 * 
 * It answers the question a participant asks on returning: "did I miss anything
 * important?" - not "show me 241 messages". Feedback from #nextIteration pointed out
 * that CLI/UI parity did not cover the third client (an agent over HTTP); this module,
 * exposed through REST and MCP, closes that gap.
 * 
 * The anchor is PER CONVERSATION: each counts from its own read marker
 * (`members.last_read_message_id`). One shared anchor - the maximum over all markers -
 * meant that reading one talkative channel hid unread direct messages: the digest
 * answered "you missed nothing" while three DMs were waiting. This is the same semantics
 * the unread counter already has, so both mechanisms now say the same thing.
 */
import type { Ctx } from "./ctx.ts";
import { messageFromRow, type Message, type MsgRow } from "./messages.ts";
import { openQuestions } from "./questions.ts";
import { mentionsOf } from "./mentions.ts";

export type Digest = {
  sinceId: number;
  count: number;
  byWho: Array<[string, number]>;
  byConversation: Array<[string, number]>;
  mentions: Message[];
  open: Array<{ id: number; message: Message }>;
  last: Message | null;
};

export function digestFor(ctx: Ctx, actorId: number): Digest | null {
  // The anchor IS PER CONVERSATION, not global. Previously the MAX over all read markers was
  // taken, so reading one talkative channel pushed the anchor past everything else and hid
  // unread DMs: the digest said "you missed nothing" while three private messages waited.
  // The fallback for a conversation with no marker is 0 (that is, "everything is new"),
  // because the absence of a marker means the actor has not seen anything in it yet.
  // Kept in the response for client compatibility: the oldest read marker, that is, "how far
  // back this digest reaches". It is no longer used for counting.
  const najstarszy = ctx.db
    .prepare("SELECT COALESCE(MIN(last_read_message_id), 0) AS x FROM members WHERE actor_id = ?")
    .get(actorId) as { x: number };
  const sinceId = najstarszy.x;
  const rows = ctx.db
    .prepare(
      `SELECT a.handle AS who,
              COALESCE('#' || c.slug, 'rozmowa prywatna') AS conv,
              COUNT(*) AS n
         FROM messages m
         JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.actor_id = :me
         JOIN conversations c ON c.id = m.conversation_id
         JOIN actors a ON a.id = m.actor_id
        WHERE m.id > mem.last_read_message_id AND m.actor_id <> :me AND m.deleted_at IS NULL
        GROUP BY a.handle, conv`,
    )
    .all({ me: actorId }) as Array<{ who: string; conv: string; n: number }>;

  if (rows.length === 0) return null;

  const byWho = new Map<string, number>();
  const byConversation = new Map<string, number>();
  let count = 0;
  for (const r of rows) {
    count += r.n;
    byWho.set(r.who, (byWho.get(r.who) ?? 0) + r.n);
    byConversation.set(r.conv, (byConversation.get(r.conv) ?? 0) + r.n);
  }

  const lastRow = ctx.db
    .prepare(
      `SELECT m.id FROM messages m
         JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.actor_id = ?
        WHERE m.id > mem.last_read_message_id AND m.actor_id <> ? AND m.deleted_at IS NULL
        ORDER BY m.id DESC LIMIT 1`,
    )
    .get(actorId, actorId) as { id: number } | undefined;

  return {
    sinceId,
    count,
    byWho: [...byWho.entries()].sort((a, b) => b[1] - a[1]),
    byConversation: [...byConversation.entries()].sort((a, b) => b[1] - a[1]),
    mentions: mentionsOf(ctx, actorId, { afterId: sinceId }),
    open: openQuestions(ctx, { actorId }),
    last: lastRow
      ? messageFromRow(ctx.db.prepare("SELECT * FROM messages WHERE id = ?")
          .get(lastRow.id) as MsgRow)
      : null,
  };
}

