/**
 * Wyszukiwanie przez FTS5.
 *
 * Prototyp robil skan podlancuchowy po calej historii, po stronie CLI i osobno
 * po stronie przegladarki (klient trzymal cala historie w pamieci). Tutaj indeks
 * robi to samo w jednym zapytaniu i - co wazniejsze - wynik jest ZAWSZE ograniczony
 * do konwersacji, ktore wolajacy ma prawo czytac. Wyszukiwarka jest najlatwiejszym
 * miejscem na wyciek tresci z kanalu prywatnego.
 */
import type { Ctx } from "./ctx.ts";
import { ftsMatch } from "./ids.ts";
import type { Message } from "./messages.ts";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;

type MsgRow = {
  id: number;
  conversation_id: number;
  actor_id: number;
  session_id: string | null;
  ts: number;
  kind: Message["kind"];
  body: string;
  thread_id: number | null;
  edited_at: number | null;
  deleted_at: number | null;
  meta: string | null;
};


export function search(
  ctx: Ctx,
  q: {
    actorId: number;
    text: string;
    conversationId?: number;
    limit?: number;
    // Okno czasu (sekundy uniksowe). Feedback z #nextIteration: przy historii,
    // ktora nie jest kasowana, search bez zakresu dat to dokladnie ta komenda,
    // ktora zaboli pierwsza.
    sinceTs?: number;
    untilTs?: number;
  },
): Message[] {
  // Zapytanie uzytkownika jest TEKSTEM, nie skladnia FTS - zamiana na fraze
  // z przedrostkami mieszka w ids.ts, wspolnie z wyszukiwarka wiki. Dwie kopie
  // tej samej reguly to dwie okazje, zeby jedna z nich zapomniec poprawic.
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

  return rows.reverse().map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    actorId: r.actor_id,
    sessionId: r.session_id,
    ts: r.ts,
    kind: r.kind,
    body: r.body,
    threadId: r.thread_id,
    editedAt: r.edited_at,
    deletedAt: r.deleted_at,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
  }));
}
