/**
 * Nieprzeczytane.
 *
 * Semantyka przeniesiona z prototypu swiadomie, bo jest dobra i pochodzi ze Slacka:
 *
 *   unread ("cos nowego")   -> pogrubienie nazwy konwersacji
 *   badge  ("dotyczy CIEBIE") -> numerowana plakietka
 *
 * Numer na wszystkim splaszcza te hierarchie i przestaje cokolwiek znaczyc.
 * Plakietke daje wzmianka o mnie ORAZ kazda wiadomosc w rozmowie bezposredniej -
 * DM jest z definicji adresowany do mnie, wiec nie wymaga wzmianki.
 *
 * Znacznikiem odczytu jest ID wiadomosci, nie czas. Prototyp trzymal milisekundy
 * i przez to zderzal sie z rozjazdem zegarow oraz z wiadomosciami o tym samym ts.
 */
import type { Ctx } from "./ctx.ts";
import { canRead, join, isMember } from "./conversations.ts";
import { onCommitted } from "../store/db.ts";
import { lastMessageId } from "./messages.ts";

export type UnreadRow = {
  conversationId: number;
  unread: number;
  badge: number;
  lastMessageId: number;
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
         COALESCE(MAX(m.id), mem.last_read_message_id)         AS last_message_id
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
      last_message_id: number;
    }>;
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    unread: r.unread,
    badge: r.badge ?? 0,
    lastMessageId: r.last_message_id,
  }));
}

export function totalBadge(ctx: Ctx, actorId: number): number {
  return unreadFor(ctx, actorId).reduce((n, r) => n + r.badge, 0);
}

/**
 * Bez `messageId` zeruje do najnowszej wiadomosci w systemie.
 * Znacznik nigdy sie nie cofa: dwa urzadzenia czytajace rownolegle nie moga
 * odebrac sobie nawzajem przeczytanych wiadomosci.
 */
export function markRead(ctx: Ctx, actorId: number, convId: number, messageId?: number): void {
  // Guard w rdzeniu, nie tylko w trasach: markRead dolacza do konwersacji,
  // wiec bez tego sprawdzenia kazde "oznacz przeczytane" byloby furtka
  // do wejscia w cudzy kanal prywatny (znaleziona przez sciezke MCP).
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
