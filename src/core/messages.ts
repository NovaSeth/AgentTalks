/**
 * Wiadomosci.
 *
 * Trzy rzeczy warte uwagi przy czytaniu tego pliku:
 *
 * 1. `id` jest AUTOINCREMENT, wiec zapis nie musi niczego skanowac. Prototyp liczyl
 *    kolejny `mid` przechodzac caly plik pod globalnym lockiem - O(n) na kazda
 *    wiadomosc, dla wszystkich kanalow naraz.
 *
 * 2. Watki sa splaszczone do jednego poziomu: odpowiedz na odpowiedz laduje w tym
 *    samym watku, co korzen. Drzewo o dowolnej glebokosci wyglada madrze i nie daje
 *    sie ani czytac, ani renderowac; Slack ma z tego samego powodu jeden poziom.
 *
 * 3. Zdarzenie na szyne idzie PO zatwierdzeniu transakcji. Odwrotna kolejnosc
 *    znaczylaby, ze subskrybent moze zapytac o dane, ktorych jeszcze nie ma w bazie.
 */
import { tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { assertCanPost, assertCanRead, recipientsOf } from "./conversations.ts";
import { badRequest, forbidden, notFound, tooLarge } from "./errors.ts";
import { resolveMentions } from "./mentions.ts";

export const MAX_BODY_BYTES = 65536;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export type MsgKind = "text" | "ask" | "answer" | "file" | "system";

export type Message = {
  id: number;
  conversationId: number;
  actorId: number;
  sessionId: string | null;
  ts: number;
  kind: MsgKind;
  body: string;
  threadId: number | null;
  editedAt: number | null;
  deletedAt: number | null;
  meta: Record<string, unknown> | null;
};

type MsgRow = {
  id: number;
  conversation_id: number;
  actor_id: number;
  session_id: string | null;
  ts: number;
  kind: MsgKind;
  body: string;
  thread_id: number | null;
  edited_at: number | null;
  deleted_at: number | null;
  meta: string | null;
};

/** Skasowana wiadomosc zostaje w kolejnosci (inaczej rozjechalyby sie kursory
 *  i znaczniki odczytu), ale traci tresc. */
const toMsg = (r: MsgRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  actorId: r.actor_id,
  sessionId: r.session_id,
  ts: r.ts,
  kind: r.kind,
  body: r.deleted_at ? "" : r.body,
  threadId: r.thread_id,
  editedAt: r.edited_at,
  deletedAt: r.deleted_at,
  meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
});

function validateBody(body: string): string {
  const text = String(body ?? "").trim();
  if (!text) throw badRequest("puste_cialo", "wiadomosc nie moze byc pusta");
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw tooLarge("cialo_za_dlugie", `wiadomosc jest za dluga (limit ${MAX_BODY_BYTES} B)`);
  }
  return text;
}

export function postMessage(
  ctx: Ctx,
  input: {
    conversationId: number;
    actorId: number;
    body: string;
    kind?: MsgKind;
    sessionId?: string | null;
    threadId?: number | null;
    meta?: Record<string, unknown> | null;
    importKey?: string | null;
  },
): Message {
  const body = validateBody(input.body);
  assertCanPost(ctx, input.conversationId, input.actorId);

  const message = tx(ctx.db, () => {
    const threadId = rootOfThread(ctx, input.threadId ?? null, input.conversationId);
    const ts = ctx.now();
    ctx.db
      .prepare(
        `INSERT INTO messages(conversation_id, actor_id, session_id, ts, kind, body,
                              thread_id, meta, import_key)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.conversationId,
        input.actorId,
        input.sessionId ?? null,
        ts,
        input.kind ?? "text",
        body,
        threadId,
        input.meta ? JSON.stringify(input.meta) : null,
        input.importKey ?? null,
      );
    const row = ctx.db.prepare("SELECT * FROM messages WHERE id = last_insert_rowid()").get() as
      MsgRow;

    const stmt = ctx.db.prepare(
      "INSERT OR IGNORE INTO mentions(message_id, actor_id) VALUES(?,?)",
    );
    for (const actorId of resolveMentions(ctx, body)) stmt.run(row.id, actorId);
    return toMsg(row);
  });

  ctx.bus.publish(recipientsOf(ctx, input.conversationId), {
    type: "message",
    conversationId: input.conversationId,
    message,
  });
  return message;
}

/** Watek jest jednopoziomowy: wskazanie odpowiedzi jako rodzica prowadzi do jej korzenia. */
function rootOfThread(ctx: Ctx, threadId: number | null, convId: number): number | null {
  if (!threadId) return null;
  const parent = ctx.db
    .prepare("SELECT id, conversation_id, thread_id FROM messages WHERE id = ?")
    .get(threadId) as { id: number; conversation_id: number; thread_id: number | null } | undefined;
  if (!parent) throw notFound("wiadomosc", `nie ma wiadomosci ${threadId}`);
  if (parent.conversation_id !== convId) {
    throw badRequest("obcy_watek", "watek nalezy do innej konwersacji");
  }
  return parent.thread_id ?? parent.id;
}

export function getMessage(ctx: Ctx, id: number): Message | null {
  const row = ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow | undefined;
  return row ? toMsg(row) : null;
}

/**
 * Strona wiadomosci konwersacji, zawsze rosnaco po id.
 * `after` doczytuje nowsze (kursor SSE i long-polla), `before` starsze (przewijanie w gore).
 */
export function listMessages(
  ctx: Ctx,
  q: { conversationId: number; after?: number; before?: number; limit?: number },
): Message[] {
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  if (q.after !== undefined) {
    const rows = ctx.db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT ?",
      )
      .all(q.conversationId, q.after, limit) as MsgRow[];
    return rows.map(toMsg);
  }
  // Bez `after` chcemy OSTATNIE `limit` wiadomosci, ale oddane rosnaco - stad
  // pobranie malejaco i odwrocenie.
  const rows = ctx.db
    .prepare(
      `SELECT * FROM messages
        WHERE conversation_id = ? AND (? IS NULL OR id < ?)
        ORDER BY id DESC LIMIT ?`,
    )
    .all(q.conversationId, q.before ?? null, q.before ?? null, limit) as MsgRow[];
  return rows.reverse().map(toMsg);
}

export function listThread(ctx: Ctx, threadId: number): Message[] {
  const rows = ctx.db
    .prepare("SELECT * FROM messages WHERE id = ? OR thread_id = ? ORDER BY id")
    .all(threadId, threadId) as MsgRow[];
  return rows.map(toMsg);
}

export function editMessage(ctx: Ctx, id: number, actorId: number, body: string): Message {
  const row = ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow | undefined;
  if (!row) throw notFound("wiadomosc", `nie ma wiadomosci ${id}`);
  if (row.actor_id !== actorId) throw forbidden("nie_autor", "nie jestes autorem tej wiadomosci");
  if (row.deleted_at) throw badRequest("skasowana", "nie da sie edytowac skasowanej wiadomosci");
  const text = validateBody(body);

  const message = tx(ctx.db, () => {
    ctx.db.prepare("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?")
      .run(text, ctx.now(), id);
    ctx.db.prepare("DELETE FROM mentions WHERE message_id = ?").run(id);
    const stmt = ctx.db.prepare(
      "INSERT OR IGNORE INTO mentions(message_id, actor_id) VALUES(?,?)",
    );
    for (const a of resolveMentions(ctx, text)) stmt.run(id, a);
    return toMsg(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow);
  });

  ctx.bus.publish(recipientsOf(ctx, row.conversation_id), {
    type: "message_updated",
    conversationId: row.conversation_id,
    message,
  });
  return message;
}

export function deleteMessage(ctx: Ctx, id: number, actorId: number): Message {
  const row = ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow | undefined;
  if (!row) throw notFound("wiadomosc", `nie ma wiadomosci ${id}`);
  if (row.actor_id !== actorId) throw forbidden("nie_autor", "nie jestes autorem tej wiadomosci");

  const message = tx(ctx.db, () => {
    // Tresc znika naprawde, zeby "skasuj" znaczylo skasuj, a nie "ukryj w UI".
    // Wiersz zostaje, bo id jest kursorem i znacznikiem odczytu.
    ctx.db.prepare("UPDATE messages SET body = '', deleted_at = ? WHERE id = ?")
      .run(ctx.now(), id);
    ctx.db.prepare("DELETE FROM mentions WHERE message_id = ?").run(id);
    return toMsg(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow);
  });

  ctx.bus.publish(recipientsOf(ctx, row.conversation_id), {
    type: "message_updated",
    conversationId: row.conversation_id,
    message,
  });
  return message;
}

/** Wszystko nowsze niz `afterId` ze wszystkich konwersacji, ktorych aktor jest czlonkiem.
 *  To jest zrodlo dla long-polla i dla wznowienia SSE po zerwaniu. */
export function inboxAfter(ctx: Ctx, actorId: number, afterId: number, limit = 200): Message[] {
  const rows = ctx.db
    .prepare(
      `SELECT m.* FROM messages m
         JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.actor_id = ?
        WHERE m.id > ? AND m.actor_id <> ?
        ORDER BY m.id LIMIT ?`,
    )
    .all(actorId, afterId, actorId, Math.min(limit, MAX_LIMIT)) as MsgRow[];
  return rows.map(toMsg);
}

/** Najwyzsze id w systemie. Klient bierze je jako punkt startowy kursora. */
export function lastMessageId(ctx: Ctx): number {
  const row = ctx.db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages").get() as {
    id: number;
  };
  return row.id;
}

export { assertCanRead };
