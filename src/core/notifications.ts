/**
 * Notifications: one place for "what happened that I should know about".
 *
 * Previously the answer to that question was scattered: the unread counter spoke about
 * channels, the `mentions` table about mentions, and reactions and wiki changes said
 * nothing at all - so about half of what concerns a user, they learned by accident or not
 * at all.
 *
 * Three rules that separate this from the unread counter:
 *  - a notification has its OWN read marker; reading a channel does not erase the fact that
 *    somebody called you in it, and ticking off a notification does not lie that you read
 *    the whole conversation,
 *  - a notification has a TARGET: a conversation+message or a wiki page, so a click leads
 *    to where the thing happened rather than "somewhere nearby",
 *  - you do not create notifications for yourself - your own mention, your own reaction and
 *    your own wiki edit are not an event for their author.
 */
import { onCommitted } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { badRequest } from "./errors.ts";

export type NotificationKind = "mention" | "dm" | "reaction" | "wiki" | "fix";

export type Notification = {
  id: number;
  kind: NotificationKind;
  from: string | null;
  conversationId: number | null;
  messageId: number | null;
  wikiSlug: string | null;
  excerpt: string | null;
  createdAt: number;
  readAt: number | null;
};

type Row = {
  id: number; kind: string; from_handle: string | null;
  conversation_id: number | null; message_id: number | null;
  wiki_slug: string | null; excerpt: string | null;
  created_at: number; read_at: number | null;
};

const MAX_EXCERPT = 160;

/** A content preview: one line, no wall of text in the notification list. */
export function excerptOf(body: string): string {
  const oneLine = String(body ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_EXCERPT ? `${oneLine.slice(0, MAX_EXCERPT - 1)}…` : oneLine;
}

const toNotification = (r: Row): Notification => ({
  id: r.id,
  kind: r.kind as NotificationKind,
  from: r.from_handle,
  conversationId: r.conversation_id,
  messageId: r.message_id,
  wikiSlug: r.wiki_slug,
  excerpt: r.excerpt,
  createdAt: r.created_at,
  readAt: r.read_at,
});

/**
 * Writes notifications for a list of recipients. The sender is removed from it (nobody
 * notifies themselves), and so are duplicates - one event is one notification, even when
 * somebody is both mentioned and a member of the DM.
 *
 * The SSE event goes out AFTER the commit, so that a client which immediately fetches the
 * list sees in it what it has just been notified about.
 */
export function notify(
  ctx: Ctx,
  input: {
    actorIds: number[];
    kind: NotificationKind;
    fromActorId?: number | null;
    conversationId?: number | null;
    messageId?: number | null;
    wikiSlug?: string | null;
    excerpt?: string | null;
    /** false = write it, but the caller will announce the SSE event (order matters: a
     *  notification about a message must not get ahead of the message itself). */
    announce?: boolean;
  },
): number[] {
  const from = input.fromActorId ?? null;
  const targets = [...new Set(input.actorIds)].filter((id) => id !== from);
  if (targets.length === 0) return [];
  const now = ctx.now();
  sprzatnijStare(ctx);
  const stmt = ctx.db.prepare(
    `INSERT INTO notifications(actor_id, kind, from_actor_id, conversation_id, message_id,
                               wiki_slug, excerpt, created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  );
  for (const actorId of targets) {
    stmt.run(
      actorId, input.kind, from,
      input.conversationId ?? null, input.messageId ?? null,
      input.wikiSlug ?? null, input.excerpt ?? null, now,
    );
  }
  if (input.announce !== false) {
    onCommitted(ctx.db, () => ctx.bus.publish(targets, { type: "notification" }));
  }
  return targets;
}

/**
 * Retention. The notifications table grows with every mention, reaction and DM message -
 * that is, faster than the conversations - and nothing shrank it. We keep READ ones newer
 * than 30 days and everything newer than 180 days: a notification nobody opened in half a
 * year is not a notification any more.
 * The cleanup is lazy (on write), so as not to keep a separate job.
 */
const PRZECZYTANE_DNI = 30;
const WSZYSTKIE_DNI = 180;
function sprzatnijStare(ctx: Ctx): void {
  const now = ctx.now();
  ctx.db.prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?")
    .run(now - PRZECZYTANE_DNI * 24 * 3600);
  ctx.db.prepare("DELETE FROM notifications WHERE created_at < ?")
    .run(now - WSZYSTKIE_DNI * 24 * 3600);
}

export function listNotifications(
  ctx: Ctx,
  actorId: number,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Notification[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = ctx.db
    .prepare(
      `SELECT n.id, n.kind, a.handle AS from_handle, n.conversation_id, n.message_id,
              n.wiki_slug, n.excerpt, n.created_at, n.read_at
         FROM notifications n
         LEFT JOIN actors a ON a.id = n.from_actor_id
        WHERE n.actor_id = ?${opts.unreadOnly ? " AND n.read_at IS NULL" : ""}
        ORDER BY n.id DESC
        LIMIT ?`,
    )
    .all(actorId, limit) as Row[];
  return rows.map(toNotification);
}

export function unreadNotificationCount(ctx: Ctx, actorId: number): number {
  const r = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE actor_id = ? AND read_at IS NULL")
    .get(actorId) as { n: number };
  return r.n;
}

/**
 * Ticking off. Without `ids` it ticks off ALL unread ones - this is the one "I have seen
 * it" button. It returns the number of records actually changed, so that "I ticked off 0"
 * does not look the same as "I ticked off 12".
 */
export function markNotificationsRead(
  ctx: Ctx,
  actorId: number,
  ids?: number[] | null,
): number {
  const now = ctx.now();
  if (ids && ids.length) {
    if (ids.some((id) => !Number.isInteger(id))) {
      throw badRequest("zle_id", "ids musi byc lista liczb calkowitych");
    }
    const marks = ids.map(() => "?").join(",");
    const r = ctx.db
      .prepare(
        `UPDATE notifications SET read_at = ?
          WHERE actor_id = ? AND read_at IS NULL AND id IN (${marks})`,
      )
      .run(now, actorId, ...ids);
    return Number(r.changes ?? 0);
  }
  const r = ctx.db
    .prepare("UPDATE notifications SET read_at = ? WHERE actor_id = ? AND read_at IS NULL")
    .run(now, actorId);
  return Number(r.changes ?? 0);
}
