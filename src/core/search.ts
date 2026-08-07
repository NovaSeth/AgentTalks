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

/**
 * Zapytanie uzytkownika jest tekstem, nie skladnia FTS. Kazde slowo idzie w cudzyslow
 * i dostaje gwiazdke (dopasowanie przedrostkowe). Bez tego wpisanie nawiasu albo
 * slowa "AND" wywracaloby zapytanie bledem skladni zamiast czegokolwiek znalezc.
 */
function toMatchQuery(text: string): string | null {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}

export function search(
  ctx: Ctx,
  q: { actorId: number; text: string; conversationId?: number; limit?: number },
): Message[] {
  const match = toMatchQuery(q.text);
  if (!match) return [];
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = ctx.db
    .prepare(
      `SELECT m.* FROM messages_fts f
         JOIN messages m      ON m.id = f.rowid
         JOIN conversations c ON c.id = m.conversation_id
        WHERE f.messages_fts MATCH ?
          AND m.deleted_at IS NULL
          AND (? IS NULL OR m.conversation_id = ?)
          AND (c.kind = 'public'
               OR EXISTS (SELECT 1 FROM members mem
                           WHERE mem.conversation_id = c.id AND mem.actor_id = ?))
        ORDER BY m.id DESC
        LIMIT ?`,
    )
    .all(match, q.conversationId ?? null, q.conversationId ?? null, q.actorId, limit) as MsgRow[];

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
