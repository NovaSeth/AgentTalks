/**
 * Reakcje. Wlasna tabela, a nie wiadomosci w tym samym logu.
 *
 * W prototypie reakcja byla rekordem w channel.jsonl, wiec kazde miejsce czytajace
 * historie musialo ja odfiltrowac zbiorem NOISE - powtorzonym w trzech plikach,
 * w dwoch jezykach. Osobna tabela usuwa ten obowiazek u zrodla.
 */
import type { Ctx } from "./ctx.ts";
import { canRead, recipientsOf } from "./conversations.ts";
import { onCommitted } from "../store/db.ts";
import { normalizeEmoji } from "./ids.ts";
import { notFound } from "./errors.ts";
import { excerptOf, notify } from "./notifications.ts";

/** Przelacznik: druga taka sama reakcja tego samego aktora ja zdejmuje. */
export function react(
  ctx: Ctx,
  input: { messageId: number; actorId: number; emoji: string },
): { on: boolean } {
  const emoji = normalizeEmoji(input.emoji);
  const msg = ctx.db
    .prepare("SELECT conversation_id FROM messages WHERE id = ?")
    .get(input.messageId) as { conversation_id: number } | undefined;
  // Jeden blad dla "nie ma" i "nie masz dostepu": numer wiadomosci z cudzego
  // kanalu prywatnego nie moze byc wyrocznia jej istnienia.
  if (!msg || !canRead(ctx, msg.conversation_id, input.actorId)) {
    throw notFound("wiadomosc", `nie ma wiadomosci ${input.messageId} (albo brak dostepu)`);
  }

  const target = ctx.db
    .prepare("SELECT actor_id, body FROM messages WHERE id = ?")
    .get(input.messageId) as { actor_id: number; body: string } | undefined;

  const existing = ctx.db
    .prepare("SELECT 1 FROM reactions WHERE message_id=? AND actor_id=? AND emoji=?")
    .get(input.messageId, input.actorId, emoji);
  if (existing) {
    ctx.db
      .prepare("DELETE FROM reactions WHERE message_id=? AND actor_id=? AND emoji=?")
      .run(input.messageId, input.actorId, emoji);
  } else {
    ctx.db
      .prepare("INSERT INTO reactions(message_id, actor_id, emoji, created_at) VALUES(?,?,?,?)")
      .run(input.messageId, input.actorId, emoji, ctx.now());
  }
  // Powiadamiamy TYLKO o dolozeniu reakcji i tylko autora wpisu: zdjecie reakcji
  // nie jest zdarzeniem, o ktorym warto kogos budzic, a reszta kanalu widzi
  // emoji przy wiadomosci i bez powiadomienia.
  if (!existing && target) {
    notify(ctx, {
      actorIds: [target.actor_id],
      kind: "reaction",
      fromActorId: input.actorId,
      conversationId: msg.conversation_id,
      messageId: input.messageId,
      excerpt: `${emoji}  ${excerptOf(target.body)}`,
    });
  }
  onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, msg.conversation_id), {
    type: "reaction",
    conversationId: msg.conversation_id,
    messageId: input.messageId,
  }));
  return { on: !existing };
}

/** { messageId: { emoji: [handle, ...] } } - `handle` zasila tooltip "kto zareagowal".
 *  Bez tego emoji jest anonimowe i przestaje byc sygnalem. */
export function reactionsFor(
  ctx: Ctx,
  messageIds: readonly number[],
): Record<number, Record<string, string[]>> {
  if (messageIds.length === 0) return {};
  const marks = messageIds.map(() => "?").join(",");
  const rows = ctx.db
    .prepare(
      `SELECT r.message_id, r.emoji, a.handle
         FROM reactions r JOIN actors a ON a.id = r.actor_id
        WHERE r.message_id IN (${marks})
        ORDER BY r.created_at`,
    )
    .all(...messageIds) as Array<{ message_id: number; emoji: string; handle: string }>;
  const out: Record<number, Record<string, string[]>> = {};
  for (const r of rows) {
    (out[r.message_id] ??= {})[r.emoji] ??= [];
    out[r.message_id][r.emoji].push(r.handle);
  }
  return out;
}

