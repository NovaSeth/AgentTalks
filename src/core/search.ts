/**
 * Search through FTS5.
 * 
 * The prototype did a substring scan over the whole history, on the CLI side and separately
 * in the browser (the client kept the entire history in memory). Here the index does the
 * same in one query and - more importantly - the result is ALWAYS limited to conversations
 * the caller is allowed to read. Search is the easiest place to leak content out of a
 * private channel.
 */
import type { Ctx } from "./ctx.ts";
import { ftsMatch } from "./ids.ts";
import { messageFromRow, type Message, type MsgRow } from "./messages.ts";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;


export function search(
  ctx: Ctx,
  q: {
    actorId: number;
    text: string;
    conversationId?: number;
    limit?: number;
    // A time window (unix seconds). Feedback from #nextIteration: with a history that is never
    // deleted, a search without a date range is exactly the command that will hurt first.
    sinceTs?: number;
    untilTs?: number;
  },
): Message[] {
  // The user's query is TEXT, not FTS syntax - turning it into a phrase with prefixes lives
  // in ids.ts, shared with the wiki search. Two copies of the same rule are two chances to
  // forget to fix one of them.
  const match = ftsMatch(q.text);
  if (!match) return [];
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = ctx.db
    .prepare(
      `SELECT m.* FROM messages_fts f
         JOIN messages m      ON m.id = f.rowid
         JOIN conversations c ON c.id = m.conversation_id
        WHERE f.messages_fts MATCH :match
          AND m.deleted_at IS NULL
          AND (:conv IS NULL OR m.conversation_id = :conv)
          AND (:since IS NULL OR m.ts >= :since)
          AND (:until IS NULL OR m.ts <= :until)
          AND (c.kind = 'public'
               OR EXISTS (SELECT 1 FROM members mem
                           WHERE mem.conversation_id = c.id AND mem.actor_id = :me))
        ORDER BY m.id DESC
        LIMIT :lim`,
    )
    .all({
      match,
      conv: q.conversationId ?? null,
      since: q.sinceTs ?? null,
      until: q.untilTs ?? null,
      me: q.actorId,
      lim: limit,
    }) as MsgRow[];

  // A shared mapper rather than a copy of its own. The copy existed and drifted silently: it
  // lost resolvedAt/resolvedBy/fixedAt/fixedBy, so a closed report found through search looked
  // open. One place - one drift fewer (tsc caught it only after Node types were enabled).
  return rows.reverse().map(messageFromRow);
}
