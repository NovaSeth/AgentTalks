/**
 * Wzmianki. Parsowane raz, przy zapisie, i zapisywane do tabeli `mentions`.
 *
 * W prototypie kazde pytanie "czy to mnie dotyczy" bylo skanem podlancuchowym po
 * calej historii, z lista wariantow nazwy budowana w locie (`@label`, `@pierwsza-czesc`,
 * `@osiem-znakow-sid`). To bylo wolne i zawodne: zmiana etykiety zmieniala wynik
 * wstecz, a fraza "@nestor" w cudzej wiadomosci liczyla sie tak samo jak wzmianka.
 */
import type { Ctx } from "./ctx.ts";
import { transliterate } from "./ids.ts";
import { messageFromRow, type Message, type MsgRow } from "./messages.ts";

// Wzmianka musi byc poprzedzona poczatkiem tekstu albo znakiem, ktory nie jest
// czescia slowa. Bez tego "michal@example.com" bylby wzmianka uzytkownika "example".
const MENTION_RE = /(^|[^\p{L}\p{N}_@.-])@([\p{L}\p{N}][\p{L}\p{N}._-]{1,31})/gu;

/** Zwraca handle w kolejnosci wystapienia, bez duplikatow, malymi literami. */
export function parseMentions(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(body ?? "").matchAll(MENTION_RE)) {
    // Kropka i mysnik moga byc czescia handle, ale nie na koncu - tam to zwykle
    // interpunkcja zdania ("zapytaj @nestor."). Transliteracja TA SAMA co przy
    // nadawaniu handle - inaczej "@Michal" pisane z polskimi znakami nigdy nie
    // trafialoby w konto "michal", bo handle jest po transliteracji.
    const h = transliterate(m[2]).replace(/[._-]+$/, "");
    if (h.length < 2 || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/** Handle, ktore realnie istnieja, na id aktorow. Nieistniejace sa po prostu tekstem. */
export function resolveMentions(ctx: Ctx, body: string): number[] {
  const handles = parseMentions(body);
  if (handles.length === 0) return [];
  const marks = handles.map(() => "?").join(",");
  const rows = ctx.db
    .prepare(`SELECT id FROM actors WHERE handle IN (${marks})`)
    .all(...handles) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/**
 * Wiadomosci wspominajace aktora - odpowiednik `talk mentions`.
 * Ograniczone do konwersacji, ktore aktor ma prawo czytac (publiczne albo wlasne):
 * wzmianka w cudzym kanale prywatnym NIE moze byc kanalem wycieku tresci.
 */
export function mentionsOf(
  ctx: Ctx,
  actorId: number,
  opts: { afterId?: number; limit?: number } = {},
): Message[] {
  const rows = ctx.db
    .prepare(
      `SELECT m.* FROM mentions mn
         JOIN messages m ON m.id = mn.message_id
         JOIN conversations c ON c.id = m.conversation_id
        WHERE mn.actor_id = :me
          AND m.id > :after
          AND m.actor_id <> :me
          AND m.deleted_at IS NULL
          AND (c.kind = 'public'
               OR EXISTS (SELECT 1 FROM members mem
                           WHERE mem.conversation_id = c.id AND mem.actor_id = :me))
        ORDER BY m.id DESC LIMIT :lim`,
    )
    .all({ me: actorId, after: opts.afterId ?? 0, lim: Math.min(opts.limit ?? 50, 200) }) as
    MsgRow[];
  return rows.reverse().map(messageFromRow);
}
