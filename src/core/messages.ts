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
import { onCommitted, tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { assertCanPost, assertCanRead, recipientsOf } from "./conversations.ts";
import { badRequest, forbidden, notFound, tooLarge } from "./errors.ts";
import { resolveMentions } from "./mentions.ts";
import { clearTyping } from "./presence.ts";

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

export type MsgRow = {
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
 *  i znaczniki odczytu), ale traci tresc. Eksportowane, zeby digest i wzmianki
 *  nie utrzymywaly wlasnych kopii tego mapowania. */
export const messageFromRow = (r: MsgRow): Message => ({
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

function validateBody(body: string, maxBytes: number): string {
  const text = String(body ?? "").trim();
  if (!text) throw badRequest("puste_cialo", "wiadomosc nie moze byc pusta");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw tooLarge("cialo_za_dlugie", `wiadomosc jest za dluga (limit ${maxBytes} B)`);
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
    /** Idempotencja: przy retry ten sam clientMsgId zwraca istniejaca wiadomosc,
     *  zamiast tworzyc nowa. Kluczowany per aktor, wiec dwoch aktorow moze uzyc
     *  tego samego id bez kolizji. */
    clientMsgId?: string | null;
    /** Limit z konfiguracji instancji; bez podania obowiazuje MAX_BODY_BYTES. */
    maxBytes?: number;
  },
): Message {
  const body = validateBody(input.body, input.maxBytes ?? MAX_BODY_BYTES);
  assertCanPost(ctx, input.conversationId, input.actorId);
  const dedupKey = input.clientMsgId ? `${input.actorId}:${input.clientMsgId}` : null;

  let created = true;
  const message = tx(ctx.db, () => {
    // Idempotencja: przy retry (SSE/long-poll/webhook potrafia dostarczyc dwa razy)
    // powtorzony clientMsgId nie moze zdublowac wiadomosci. SELECT-then-INSERT jest
    // bezpieczne, bo transakcja zewnetrzna to BEGIN IMMEDIATE - procesy sie szereguja.
    if (dedupKey) {
      const dup = ctx.db.prepare("SELECT * FROM messages WHERE dedup_key = ?")
        .get(dedupKey) as MsgRow | undefined;
      if (dup) {
        created = false;
        return messageFromRow(dup);
      }
    }
    const threadId = rootOfThread(ctx, input.threadId ?? null, input.conversationId);
    const ts = ctx.now();
    ctx.db
      .prepare(
        `INSERT INTO messages(conversation_id, actor_id, session_id, ts, kind, body,
                              thread_id, meta, import_key, dedup_key)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
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
        dedupKey,
      );
    const row = ctx.db.prepare("SELECT * FROM messages WHERE id = last_insert_rowid()").get() as
      MsgRow;

    const stmt = ctx.db.prepare(
      "INSERT OR IGNORE INTO mentions(message_id, actor_id) VALUES(?,?)",
    );
    for (const actorId of resolveMentions(ctx, body)) stmt.run(row.id, actorId);
    return messageFromRow(row);
  });

  // Zdarzenie WYLACZNIE dla nowo utworzonej wiadomosci: powtorka (dedup) nie
  // moze wygenerowac drugiego pusha, bo to bylby dokladnie ten zdublowany wake,
  // przed ktorym idempotencja ma chronic.
  if (created) {
    // Wyslana wiadomosc konczy pisanie - kuleczka "pisze" znika natychmiast.
    if (input.sessionId) clearTyping(ctx, input.sessionId);
    onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, input.conversationId), {
      type: "message",
      conversationId: input.conversationId,
      message,
    }));
  }
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
  return row ? messageFromRow(row) : null;
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
    return rows.map(messageFromRow);
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
  return rows.reverse().map(messageFromRow);
}

export function listThread(ctx: Ctx, threadId: number): Message[] {
  const rows = ctx.db
    .prepare("SELECT * FROM messages WHERE id = ? OR thread_id = ? ORDER BY id")
    .all(threadId, threadId) as MsgRow[];
  return rows.map(messageFromRow);
}

export function editMessage(ctx: Ctx, id: number, actorId: number, body: string): Message {
  const row = ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow | undefined;
  if (!row) throw notFound("wiadomosc", `nie ma wiadomosci ${id}`);
  if (row.actor_id !== actorId) throw forbidden("nie_autor", "nie jestes autorem tej wiadomosci");
  if (row.deleted_at) throw badRequest("skasowana", "nie da sie edytowac skasowanej wiadomosci");
  const text = validateBody(body, MAX_BODY_BYTES);

  const message = tx(ctx.db, () => {
    ctx.db.prepare("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?")
      .run(text, ctx.now(), id);
    ctx.db.prepare("DELETE FROM mentions WHERE message_id = ?").run(id);
    const stmt = ctx.db.prepare(
      "INSERT OR IGNORE INTO mentions(message_id, actor_id) VALUES(?,?)",
    );
    for (const a of resolveMentions(ctx, text)) stmt.run(id, a);
    return messageFromRow(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow);
  });

  onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, row.conversation_id), {
    type: "message_updated",
    conversationId: row.conversation_id,
    message,
  }));
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
    return messageFromRow(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow);
  });

  onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, row.conversation_id), {
    type: "message_updated",
    conversationId: row.conversation_id,
    message,
  }));
  return message;
}

/** Wszystko nowsze niz `afterId` ze wszystkich konwersacji, ktorych aktor jest czlonkiem.
 *  To jest zrodlo dla long-polla i dla wznowienia SSE po zerwaniu.
 *  includeOwn: zywy strumien SSE dostarcza takze wlasne wiadomosci (drugie
 *  urzadzenie tego samego aktora musi je widziec), wiec wznowienie tez musi. */
export function inboxAfter(
  ctx: Ctx,
  actorId: number,
  afterId: number,
  limit = 200,
  opts: { includeOwn?: boolean } = {},
): Message[] {
  const rows = ctx.db
    .prepare(
      `SELECT m.* FROM messages m
         JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.actor_id = :me
        WHERE m.id > :after AND (:own = 1 OR m.actor_id <> :me)
        ORDER BY m.id LIMIT :lim`,
    )
    .all({ me: actorId, after: afterId, own: opts.includeOwn ? 1 : 0,
           lim: Math.min(limit, MAX_LIMIT) }) as MsgRow[];
  return rows.map(messageFromRow);
}

/**
 * Wiadomosci sprzed kursora, ktore ZMIENILY SIE (edycja/kasowanie) od `sinceTs` -
 * do wznowienia SSE. Kursor id nie niesie informacji o zmianach starych wiadomosci,
 * wiec po zerwaniu klient dostalby nowe, ale nie dowiedzialby sie o edycjach.
 * Okno czasowe jest ograniczone, bo "wszystkie edycje w historii" to pelny skan,
 * a realne zerwania mierzy sie w minutach.
 */
export function updatedBefore(
  ctx: Ctx,
  actorId: number,
  beforeId: number,
  sinceTs: number,
  afterCursor = 0,
): Message[] {
  const rows = ctx.db
    .prepare(
      `SELECT m.* FROM messages m
         JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.actor_id = ?
        WHERE m.id > ? AND m.id <= ?
          AND (COALESCE(m.edited_at, 0) >= ? OR COALESCE(m.deleted_at, 0) >= ?)
        ORDER BY m.id LIMIT 500`,
    )
    .all(actorId, afterCursor, beforeId, sinceTs, sinceTs) as MsgRow[];
  return rows.map(messageFromRow);
}

/** Najwyzsze id w systemie. Klient bierze je jako punkt startowy kursora. */
export function lastMessageId(ctx: Ctx): number {
  const row = ctx.db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages").get() as {
    id: number;
  };
  return row.id;
}

