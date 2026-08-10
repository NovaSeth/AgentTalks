/**
 * Messages.
 *
 * Three things worth noticing while reading this file:
 *
 * 1. `id` is AUTOINCREMENT, so a write does not have to scan anything. The prototype
 *    computed the next `mid` by walking the whole file under a global lock - O(n) per
 *    message, for every channel at once.
 *
 * 2. Threads are flattened to one level: a reply to a reply lands in the same thread as
 *    the root. A tree of arbitrary depth looks clever and is neither readable nor
 *    renderable; Slack has one level for the same reason.
 *
 * 3. The event goes onto the bus AFTER the transaction commits. The other order would mean
 *    a subscriber can ask for data that is not in the database yet.
 */
import { onCommitted, tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { assertCanPost, assertCanRead, canRead, getMember, recipientsOf } from "./conversations.ts";
import { badRequest, forbidden, notFound, tooLarge } from "./errors.ts";
import { resolveMentions } from "./mentions.ts";
import { clearTyping } from "./presence.ts";
import { excerptOf, notify } from "./notifications.ts";
import { deleteFilesOfMessage } from "./files.ts";

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
  resolvedAt: number | null;
  resolvedBy: number | null;   // actorId; the UI maps it to a handle
  /** "The code was changed" - the FIXER's claim. Weaker than resolvedAt ("the symptom is
   *  gone"), which only the report's author or an admin can assert. */
  fixedAt: number | null;
  fixedBy: number | null;
  meta: Record<string, unknown> | null;
  /** The author's handle - attached at the HTTP/SSE boundary rather than read from the
   *  database for every row. See `zHandlem` in http/respond.ts: it removes the trap of
   *  "the key of the actors map is a string, and actorId is a number". */
  actorHandle?: string;
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
  resolved_at: number | null;
  fixed_at?: number | null;
  fixed_by?: number | null;
  resolved_by: number | null;
  meta: string | null;
};

/** A deleted message keeps its place in the order (otherwise cursors and read markers would
 *  drift), but loses its content. Exported so that the digest and mentions do not maintain
 *  their own copies of this mapping. */
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
  resolvedAt: r.resolved_at ?? null,
  resolvedBy: r.resolved_by ?? null,
  fixedAt: r.fixed_at ?? null,
  fixedBy: r.fixed_by ?? null,
  meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
});

function validateBody(body: string, maxBytes: number): string {
  const text = String(body ?? "").trim();
  if (!text) throw badRequest("puste_cialo", "wiadomosc nie moze byc pusta");
  const bajty = Buffer.byteLength(text, "utf8");
  if (bajty > maxBytes) {
    // The message says BY HOW MUCH it is too big and in what unit. "limit 65536 B" does not
    // help somebody counting characters - and an accented letter is two bytes, so a limit in
    // bytes is unpredictable for a human. The client also receives `maxMessageBytes` in
    // /api/me, so it can show a counter BEFORE anybody sends.
    throw tooLarge(
      "cialo_za_dlugie",
      `wiadomosc jest o ${bajty - maxBytes} B za dluga (masz ${bajty} B, limit ${maxBytes} B - ` +
        `polskie znaki licza sie podwojnie). Skroc ja albo wyslij jako plik.`,
    );
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
    /** Idempotency: on a retry the same clientMsgId returns the existing message instead of
     *  creating a new one. Keyed per actor, so two actors can use the same id without a
     *  collision. */
    clientMsgId?: string | null;
    /** The limit from the instance configuration; MAX_BODY_BYTES applies when none is given. */
    maxBytes?: number;
  },
): Message {
  const body = validateBody(input.body, input.maxBytes ?? MAX_BODY_BYTES);
  assertCanPost(ctx, input.conversationId, input.actorId);
  const dedupKey = input.clientMsgId ? `${input.actorId}:${input.clientMsgId}` : null;

  let created = true;
  let notified: number[] = [];
  const message = tx(ctx.db, () => {
    // Idempotency: on a retry (SSE/long-poll/webhook can each deliver twice) a repeated
    // clientMsgId must not duplicate a message. SELECT-then-INSERT is safe here, because the
    // outer transaction is BEGIN IMMEDIATE - the processes serialise.
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
    // conversationId lets @all be expanded to every member of the channel.
    // An author does not mention themselves - otherwise @all would wake the sender too.
    //
    // The canRead at the end is not caution but a bug fix: a mention carries CONTENT with it
    // (through /api/mentions and through the excerpt in the notification), so without this
    // filter writing "@stranger" on a PRIVATE channel delivered a fragment of the conversation
    // to somebody with no access to it. For a public channel canRead lets everybody through,
    // so pulling people in by calling them works as before; only private, dm and groups are
    // blocked.
    const mentioned = resolveMentions(ctx, body, input.conversationId)
      .filter((actorId) => actorId !== input.actorId)
      .filter((actorId) => canRead(ctx, input.conversationId, actorId));
    for (const actorId of mentioned) stmt.run(row.id, actorId);

    // Notifications. In a DM and a group EVERY message counts (that is what they are for); on
    // a channel only a mention by name - otherwise "notifications" would be a second unread
    // counter and people would learn to ignore them.
    const conv = ctx.db.prepare("SELECT kind FROM conversations WHERE id = ?")
      .get(input.conversationId) as { kind: string } | undefined;
    const direct = conv?.kind === "dm" || conv?.kind === "group";
    // Muting a conversation (notify='none') has to mean something. Previously the switch in
    // the UI affected nothing: the notification was created all the same, so the only
    // difference was that the user believed they had muted it.
    const wyciszeni = new Set(
      (ctx.db.prepare("SELECT actor_id FROM members WHERE conversation_id = ? AND notify = 'none'")
        .all(input.conversationId) as Array<{ actor_id: number }>).map((r) => r.actor_id),
    );
    const odbiorcy = (direct ? recipientsOf(ctx, input.conversationId) : mentioned)
      .filter((id) => !wyciszeni.has(id));
    notified = notify(ctx, {
      actorIds: odbiorcy,
      kind: direct ? "dm" : "mention",
      fromActorId: input.actorId,
      conversationId: input.conversationId,
      messageId: row.id,
      excerpt: excerptOf(body),
      // The announcement goes out later, AFTER the "message" event: a client that reacts to a
      // notification by jumping to the message has to have it already.
      announce: false,
    });
    return messageFromRow(row);
  });

  // The event fires ONLY for a newly created message: a repeat (dedup) must not generate a
  // second push, because that would be exactly the duplicated wake that idempotency is
  // supposed to prevent.
  if (created) {
    // A sent message ends typing - the "typing" bubble disappears immediately.
    if (input.sessionId) clearTyping(ctx, input.sessionId);
    onCommitted(ctx.db, () => {
      ctx.bus.publish(recipientsOf(ctx, input.conversationId), {
        type: "message",
        conversationId: input.conversationId,
        message,
      });
      if (notified.length) ctx.bus.publish(notified, { type: "notification" });
    });
  }
  return message;
}

/** A thread is one level deep: pointing at a reply as the parent leads to its root. */
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
 * A page of a conversation's messages, always ascending by id.
 * `after` fetches newer ones (the SSE and long-poll cursor), `before` older ones (scrolling up).
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
  // Without `after` we want the LAST `limit` messages, but returned ascending - hence
  // fetching descending and reversing.
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

  // Who was mentioned BEFORE the edit - so that we notify only those who were added, rather
  // than burying everybody in a repeat over a fixed typo.
  const mialiWzmianke = new Set(
    (ctx.db.prepare("SELECT actor_id FROM mentions WHERE message_id = ?").all(id) as
      Array<{ actor_id: number }>).map((r) => r.actor_id),
  );
  let nowoWspomniani: number[] = [];

  const message = tx(ctx.db, () => {
    ctx.db.prepare("UPDATE messages SET body = ?, edited_at = ? WHERE id = ?")
      .run(text, ctx.now(), id);
    ctx.db.prepare("DELETE FROM mentions WHERE message_id = ?").run(id);
    const stmt = ctx.db.prepare(
      "INSERT OR IGNORE INTO mentions(message_id, actor_id) VALUES(?,?)",
    );
    // The same filter as on send: a mention carries content, so it must not reach somebody who
    // has no access to the conversation (see postMessage).
    const wspomniani = resolveMentions(ctx, text, row.conversation_id)
      .filter((a) => a !== actorId)
      .filter((a) => canRead(ctx, row.conversation_id, a));
    for (const a of wspomniani) stmt.run(id, a);
    // An edit that ADDS a call has to notify - otherwise "@michal, do it after all" appended to
    // your own message reaches nobody while the author is convinced they called somebody. We
    // notify only the NEWLY mentioned.
    nowoWspomniani = wspomniani.filter((a) => !mialiWzmianke.has(a));
    return messageFromRow(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow);
  });

  if (nowoWspomniani.length) {
    notify(ctx, {
      actorIds: nowoWspomniani,
      kind: "mention",
      fromActorId: actorId,
      conversationId: row.conversation_id,
      messageId: id,
      excerpt: excerptOf(text),
    });
  }
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
    // The content really disappears, so that "delete" means delete rather than "hide in the UI".
    // The row stays, because the id is a cursor and a read marker.
    //
    // "Really" has to cover ALL copies of the content, otherwise that sentence is untrue, and
    // an untrue sentence about deletion is worse than none at all:
    //  - the meta of an attachment message holds the file name and type,
    //  - notifications hold an excerpt of the content,
    //  - the attachment's bytes themselves sit in the file directory and are fetchable by id.
    ctx.db.prepare("UPDATE messages SET body = '', meta = NULL, deleted_at = ? WHERE id = ?")
      .run(ctx.now(), id);
    ctx.db.prepare("DELETE FROM mentions WHERE message_id = ?").run(id);
    ctx.db.prepare("UPDATE notifications SET excerpt = NULL WHERE message_id = ?").run(id);
    deleteFilesOfMessage(ctx, id);
    return messageFromRow(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MsgRow);
  });

  onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, row.conversation_id), {
    type: "message_updated",
    conversationId: row.conversation_id,
    message,
  }));
  return message;
}

/**
 * "FIXED": the fixer's claim that they changed the code. Anybody with access to the
 * conversation can assert it - because this is not closing the case, only the information
 * "done on my side, please check". Closing it (`resolveMessage`) stays with the report's
 * author and an admin, and that is the whole difference: the fixer KNOWS they fixed it
 * anyway, so their own check carries no new information. Only somebody else's confirmation
 * has value.
 */
export function markFixed(
  ctx: Ctx,
  input: { id: number; actorId: number; fixed: boolean },
): Message {
  const row = ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(input.id) as MsgRow | undefined;
  if (!row) throw notFound("wiadomosc", `nie ma wiadomosci ${input.id}`);
  if (row.deleted_at) throw badRequest("skasowana", "skasowanej wiadomosci nie da sie oznaczyc");
  assertCanRead(ctx, row.conversation_id, input.actorId);
  // One transaction: the state change and notifying the report's author are one event. Split
  // apart, a crash between them left the report marked as fixed, which its author would
  // never have found out about.
  const message = tx(ctx.db, () => {
    ctx.db.prepare("UPDATE messages SET fixed_at = ?, fixed_by = ? WHERE id = ?")
      .run(input.fixed ? ctx.now() : null, input.fixed ? input.actorId : null, input.id);
    if (input.fixed) {
      // Its own kind, not "mention": the notification list writes its sentence from the kind, so
      // marking a fix as a mention sent the user looking in the channel for a call that is not
      // there. The excerpt is the report's content alone - the description of the action is added
      // by the interface, so duplicating it here was noise.
      notify(ctx, {
        actorIds: [row.actor_id],
        kind: "fix",
        fromActorId: input.actorId,
        conversationId: row.conversation_id,
        messageId: row.id,
        excerpt: excerptOf(row.body),
      });
    }
    return messageFromRow(
      ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(input.id) as MsgRow,
    );
  });
  onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, row.conversation_id), {
    type: "message_updated",
    conversationId: row.conversation_id,
    message,
  }));
  return message;
}

/** Mark a message as resolved / take it back (for instance a report on #bug being closed).
 *  Allowed to: the message's author, the instance admin, or a channel admin. Generic - on
 *  any channel. The message_updated event refreshes the check for everybody. */
export function resolveMessage(
  ctx: Ctx,
  input: { id: number; actorId: number; resolved: boolean; isInstanceAdmin: boolean },
): Message {
  const row = ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(input.id) as MsgRow | undefined;
  if (!row) throw notFound("wiadomosc", `nie ma wiadomosci ${input.id}`);
  if (row.deleted_at) throw badRequest("skasowana", "skasowanej wiadomosci nie da sie rozwiazac");
  assertCanRead(ctx, row.conversation_id, input.actorId);
  if (!input.isInstanceAdmin && row.actor_id !== input.actorId) {
    const m = getMember(ctx, row.conversation_id, input.actorId);
    if (!m || m.role !== "admin") {
      throw forbidden("brak_uprawnien", "rozwiazac moze autor, admin kanalu albo admin instancji");
    }
  }
  ctx.db.prepare("UPDATE messages SET resolved_at = ?, resolved_by = ? WHERE id = ?")
    .run(input.resolved ? ctx.now() : null, input.resolved ? input.actorId : null, input.id);
  const message = messageFromRow(ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(input.id) as MsgRow);
  onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, row.conversation_id), {
    type: "message_updated",
    conversationId: row.conversation_id,
    message,
  }));
  return message;
}

/** Everything newer than `afterId` from every conversation the actor is a member of.
 *  This is the source for the long-poll and for resuming SSE after a break.
 *  includeOwn: a live SSE stream also delivers your own messages (a second device of the
 *  same actor has to see them), so a resumption has to as well. */
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
 * Messages from before the cursor that HAVE CHANGED (edited/deleted) since `sinceTs` - for
 * resuming SSE. An id cursor carries no information about changes to old messages, so after
 * a break a client would get the new ones but never learn about the edits.
 * The time window is bounded, because "every edit in history" is a full scan, while real
 * disconnections are measured in minutes.
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
          -- Bez COALESCE: NULL >= x daje NULL (czyli falsz), wiec wynik jest ten
          -- sam, ale warunek da sie oprzec o indeks czesciowy z migracji 14.
          -- Roznica jest tylko przy sinceTs = 0, gdzie stara wersja uznawala
          -- KAZDA wiadomosc za zmieniona - co i tak bylo bledne.
          AND (m.edited_at >= ? OR m.deleted_at >= ?)
        ORDER BY m.id LIMIT 500`,
    )
    .all(actorId, afterCursor, beforeId, sinceTs, sinceTs) as MsgRow[];
  return rows.map(messageFromRow);
}

/** The highest id in the system. A client takes it as the starting point of its cursor. */
export function lastMessageId(ctx: Ctx): number {
  const row = ctx.db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages").get() as {
    id: number;
  };
  return row.id;
}

