/**
 * Podsumowanie nieobecnosci - odpowiednik `talk since` z prototypu.
 *
 * Odpowiada na pytanie, ktore uczestnik zadaje po powrocie: "przegapilem cos
 * waznego?" - a nie "pokaz mi 241 wiadomosci". Feedback z #nextIteration wskazal
 * wprost, ze parytet CLI/UI nie obejmowal trzeciego klienta (agenta po HTTP);
 * ten modul, wystawiony przez REST i MCP, zamyka te luke.
 *
 * Kotwica jest PER ROZMOWA: kazda liczy sie od wlasnego znacznika odczytu
 * (`members.last_read_message_id`). Jedna wspolna kotwica - maksimum ze
 * wszystkich znacznikow - powodowala, ze przeczytanie jednego gadatliwego
 * kanalu chowalo nieprzeczytane wiadomosci prywatne: digest odpowiadal "nic Cie
 * nie ominelo", gdy czekaly trzy DM-y. To jest ta sama semantyka, ktora ma juz
 * licznik nieprzeczytanych, wiec oba mechanizmy mowia teraz to samo.
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
  // Kotwica JEST PER ROZMOWA, nie globalna. Wczesniej brano MAX ze wszystkich
  // znacznikow odczytu, wiec przeczytanie jednego gadatliwego kanalu przesuwalo
  // kotwice ponad wszystko inne i chowalo nieprzeczytane DM-y: digest mowil
  // "nic Cie nie ominelo", gdy czekaly trzy wiadomosci prywatne. Fallbackiem dla
  // rozmowy bez znacznika jest 0 (czyli "wszystko jest nowe"), bo brak znacznika
  // znaczy, ze aktor nie widzial jeszcze niczego w tej rozmowie.
  // Zachowane w odpowiedzi dla zgodnosci klientow: najstarszy znacznik odczytu,
  // czyli "od kiedy najdalej siega ten digest". Nie sluzy juz do liczenia.
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

