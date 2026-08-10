/**
 * Conversations: ONE primitive for public channels, private channels, DMs and groups.
 *
 * This is the most important change from the prototype. There a message had `chan` OR
 * `to`, so channels and DMs were two separate code paths in every function: visibility,
 * counters, delivery and rendering each had two branches that had to be kept consistent by
 * hand. "A message to many" fitted in neither of them and simply did not exist.
 * nie istniala.
 *
 * Here everything is a conversation with a member list. The kind says who may enter:
 *   public  - anybody reads, writing joins automatically
 *   private - members only
 *   dm      - exactly two, created by ensureDirect
 *   group   - three or more, created by ensureDirect
 */
import { onCommitted, tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { normalizeSlug } from "./ids.ts";

export type ConvKind = "public" | "private" | "dm" | "group";
export type Notify = "all" | "mentions" | "none";
export type Role = "admin" | "member";

export type Rozmowca = { handle: string; displayName: string; kind: string };

export type Conversation = {
  id: number;
  kind: ConvKind;
  slug: string | null;
  topic: string;
  createdBy: number | null;
  createdAt: number;
  archivedAt: number | null;
  /** The participants of a direct conversation OTHER than the asker - for dm/group only.
   *  Thanks to this the conversation list has names and faces right after login. */
  others?: Rozmowca[];
};

export type Member = {
  conversationId: number;
  actorId: number;
  role: Role;
  joinedAt: number;
  notify: Notify;
  lastReadMessageId: number;
};

type ConvRow = {
  id: number;
  kind: ConvKind;
  slug: string | null;
  member_key: string | null;
  topic: string;
  created_by: number | null;
  created_at: number;
  archived_at: number | null;
};

type MemberRow = {
  conversation_id: number;
  actor_id: number;
  role: Role;
  joined_at: number;
  notify: Notify;
  last_read_message_id: number;
};

const toConv = (r: ConvRow): Conversation => ({
  id: r.id,
  kind: r.kind,
  slug: r.slug,
  topic: r.topic,
  createdBy: r.created_by,
  createdAt: r.created_at,
  archivedAt: r.archived_at,
});

const toMember = (r: MemberRow): Member => ({
  conversationId: r.conversation_id,
  actorId: r.actor_id,
  role: r.role,
  joinedAt: r.joined_at,
  notify: r.notify,
  lastReadMessageId: r.last_read_message_id,
});

export function createChannel(
  ctx: Ctx,
  input: { slug: string; kind: "public" | "private"; topic?: string; createdBy: number },
): Conversation {
  const slug = normalizeSlug(input.slug, "nazwa kanalu");
  if (getBySlug(ctx, slug)) throw conflict("kanal_istnieje", `kanal "${slug}" juz istnieje`);
  // One transaction for the channel and the creator's membership: a failure in the middle
  // would burn the unique slug forever, leaving a ghost channel with no admin at all.
  return tx(ctx.db, () => {
    const now = ctx.now();
    ctx.db
      .prepare(
        "INSERT INTO conversations(kind, slug, topic, created_by, created_at) VALUES(?,?,?,?,?)",
      )
      .run(input.kind, slug, input.topic ?? "", input.createdBy, now);
    const conv = getBySlug(ctx, slug)!;
    join(ctx, conv.id, input.createdBy, "admin");
    return conv;
  });
}

export function getConversation(ctx: Ctx, id: number): Conversation | null {
  const row = ctx.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | ConvRow
    | undefined;
  return row ? toConv(row) : null;
}

export function getBySlug(ctx: Ctx, slug: string): Conversation | null {
  const s = String(slug ?? "").trim().replace(/^#+/, "").toLowerCase();
  const row = ctx.db.prepare("SELECT * FROM conversations WHERE slug = ?").get(s) as
    | ConvRow
    | undefined;
  return row ? toConv(row) : null;
}

/**
 * A direct conversation between the given set of actors. Two is a `dm`, three or more a
 * `group`. Idempotent regardless of the order of the arguments.
 *
 * The `member_key` key (sorted ids, comma-separated, UNIQUE) makes a repeated "write to
 * these three" one indexed read rather than a comparison of the membership sets of every
 * conversation.
 */
export function ensureDirect(ctx: Ctx, actorIds: readonly number[]): Conversation {
  const ids = [...new Set(actorIds)].sort((a, b) => a - b);
  if (ids.length < 2) {
    throw badRequest("za_malo_uczestnikow", "rozmowa wymaga co najmniej dwoch roznych osob");
  }
  const key = ids.join(",");
  // The whole thing in one transaction: a conversation without its full membership is the
  // worst possible durable state ("a DM to Bob" that Bob cannot see), and UNIQUE member_key
  // would make it permanent. ON CONFLICT DO NOTHING closes the race between processes: the
  // loser does not get a raw UNIQUE error but the existing row.
  // Members are added for an existing conversation too (INSERT OR IGNORE in join), so any
  // earlier half-state heals itself on the next use.
  return tx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO conversations(kind, member_key, created_at) VALUES(?,?,?)
         ON CONFLICT(member_key) DO NOTHING`,
      )
      .run(ids.length === 2 ? "dm" : "group", key, ctx.now());
    const row = ctx.db.prepare("SELECT * FROM conversations WHERE member_key = ?")
      .get(key) as ConvRow;
    // A direct conversation is meant to arrive in full, not only on a mention - but only for
    // the NEWLY added. Whoever muted this conversation earlier is to stay muted (see the
    // comment in join).
    for (const actorId of ids) join(ctx, row.id, actorId, "member", "all");
    return toConv(row);
  });
}

export function join(
  ctx: Ctx,
  convId: number,
  actorId: number,
  role: Role = "member",
  notify: Notify = "mentions",
): Member {
  const existing = getMember(ctx, convId, actorId);
  if (existing) return existing;
  if (!getConversation(ctx, convId)) throw notFound("konwersacja", `nie ma konwersacji ${convId}`);
  // OR IGNORE: two processes joining the same pair at the same moment must not end with a
  // raw primary-key error for the loser.
  //
  // We set `notify` HERE, at insert time, rather than with a bulk UPDATE after the loop: the
  // bulk UPDATE overwrote the setting of EVERY member, so a muted conversation unmuted
  // itself whenever anybody returned to it.
  ctx.db
    .prepare(
      "INSERT OR IGNORE INTO members(conversation_id, actor_id, role, joined_at, notify) VALUES(?,?,?,?,?)",
    )
    .run(convId, actorId, role, ctx.now(), notify);
  return getMember(ctx, convId, actorId)!;
}

export function leave(ctx: Ctx, convId: number, actorId: number): void {
  const conv = getConversation(ctx, convId);
  if (conv && (conv.kind === "dm" || conv.kind === "group")) {
    // Leaving a DM would leave a conversation with one participant and messages nobody can
    // read. A direct conversation is hidden, not left.
    throw badRequest("nie_mozna_wyjsc", "z rozmowy bezposredniej nie da sie wyjsc");
  }
  ctx.db
    .prepare("DELETE FROM members WHERE conversation_id = ? AND actor_id = ?")
    .run(convId, actorId);
}

export function getMember(ctx: Ctx, convId: number, actorId: number): Member | null {
  const row = ctx.db
    .prepare("SELECT * FROM members WHERE conversation_id = ? AND actor_id = ?")
    .get(convId, actorId) as MemberRow | undefined;
  return row ? toMember(row) : null;
}

export function members(ctx: Ctx, convId: number): Member[] {
  const rows = ctx.db
    .prepare("SELECT * FROM members WHERE conversation_id = ? ORDER BY actor_id")
    .all(convId) as MemberRow[];
  return rows.map(toMember);
}

export function isMember(ctx: Ctx, convId: number, actorId: number): boolean {
  return getMember(ctx, convId, actorId) !== null;
}

export function canRead(ctx: Ctx, convId: number, actorId: number): boolean {
  const conv = getConversation(ctx, convId);
  if (!conv) return false;
  return conv.kind === "public" || isMember(ctx, convId, actorId);
}

export function assertCanRead(ctx: Ctx, convId: number, actorId: number): Conversation {
  const conv = getConversation(ctx, convId);
  // Deliberately the same error for "does not exist" and "not allowed": otherwise the server's
  // answer would reveal private channels to somebody with no right to them.
  if (!conv || !canRead(ctx, convId, actorId)) {
    throw forbidden("brak_dostepu", "brak dostepu do tej konwersacji");
  }
  return conv;
}

/** Writing to a public channel joins the actor - as in the prototype, where speaking up made
 *  you a participant. For everything else you have to be a member already. */
export function assertCanPost(ctx: Ctx, convId: number, actorId: number): Conversation {
  const conv = assertCanRead(ctx, convId, actorId);
  if (conv.archivedAt) throw forbidden("zarchiwizowana", "ta konwersacja jest zarchiwizowana");
  if (conv.kind === "public" && !isMember(ctx, convId, actorId)) join(ctx, convId, actorId);
  return conv;
}

/** Conversations visible to an actor: all public ones plus those it is a member of. */
export function listForActor(ctx: Ctx, actorId: number): Conversation[] {
  const rows = ctx.db
    .prepare(
      `SELECT c.* FROM conversations c
        WHERE c.archived_at IS NULL
          AND (c.kind = 'public'
               OR EXISTS (SELECT 1 FROM members m
                           WHERE m.conversation_id = c.id AND m.actor_id = ?))
        ORDER BY (c.kind = 'public') DESC, c.slug IS NULL, c.slug, c.id`,
    )
    .all(actorId) as ConvRow[];

  // Direct conversations carry their PARTICIPANTS straight away. Without this the client
  // knows only the id and after login shows three identical "Message" rows with no faces -
  // the conversation's name appeared only once you opened it and messages arrived. In a
  // messenger the conversation list IS the navigation, so it has to be readable from the
  // first frame (Messenger: faces and names, not content).
  const rozmowcy = ctx.db.prepare(
    `SELECT m.conversation_id AS cid, a.handle, a.display_name, a.kind
       FROM members m JOIN actors a ON a.id = m.actor_id
      WHERE m.actor_id <> ? AND m.conversation_id IN (
        SELECT conversation_id FROM members WHERE actor_id = ?
      )`,
  ).all(actorId, actorId) as Array<{ cid: number; handle: string; display_name: string; kind: string }>;
  const wgRozmowy = new Map<number, Array<{ handle: string; displayName: string; kind: string }>>();
  for (const r of rozmowcy) {
    const lista = wgRozmowy.get(r.cid) ?? [];
    lista.push({ handle: r.handle, displayName: r.display_name, kind: r.kind });
    wgRozmowy.set(r.cid, lista);
  }
  return rows.map((r) => {
    const conv = toConv(r);
    if (r.kind === "dm" || r.kind === "group") {
      return { ...conv, others: wgRozmowy.get(r.id) ?? [] };
    }
    return conv;
  });
}

/** An actor's memberships: role, notification setting, read marker.
 *  Needed both by /api/me and by /api/conversations - so it lives in the core rather than
 *  in one of the routes. */
export function myMemberships(ctx: Ctx, actorId: number): Member[] {
  const rows = ctx.db
    .prepare("SELECT * FROM members WHERE actor_id = ? ORDER BY conversation_id")
    .all(actorId) as Array<{
      conversation_id: number; actor_id: number; role: Role;
      joined_at: number; notify: Notify; last_read_message_id: number;
    }>;
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    actorId: r.actor_id,
    role: r.role,
    joinedAt: r.joined_at,
    notify: r.notify,
    lastReadMessageId: r.last_read_message_id,
  }));
}

export function setNotify(ctx: Ctx, convId: number, actorId: number, notify: Notify): void {
  if (!isMember(ctx, convId, actorId)) join(ctx, convId, actorId);
  ctx.db
    .prepare("UPDATE members SET notify = ? WHERE conversation_id = ? AND actor_id = ?")
    .run(notify, convId, actorId);
}

/** Who is to receive the event about a new message. For a public channel these are its
 *  members, not every actor: a channel nobody watches must not wake the whole world.
 *  Whoever wants to receive, joins. */
export function recipientsOf(ctx: Ctx, convId: number): number[] {
  const rows = ctx.db
    .prepare("SELECT actor_id FROM members WHERE conversation_id = ?")
    .all(convId) as Array<{ actor_id: number }>;
  return rows.map((r) => r.actor_id);
}

// ------------------------------------------------------- channel management

/** A channel is managed by its admin (a role in members) or the instance admin. */
function assertCanManage(ctx: Ctx, convId: number, actorId: number, isInstanceAdmin: boolean): Conversation {
  const conv = getConversation(ctx, convId);
  if (!conv) throw notFound("konwersacja", `nie ma konwersacji ${convId}`);
  if (isInstanceAdmin) return conv;
  const m = getMember(ctx, convId, actorId);
  if (!m || m.role !== "admin") {
    throw forbidden("brak_uprawnien", "tym kanalem zarzadza jego admin (albo admin instancji)");
  }
  return conv;
}

/** Editing a channel: the topic and (for channels) the slug. A DM/group can change only the
 *  topic - the name of a direct conversation is its participants, not a label. */
export function updateConversation(
  ctx: Ctx,
  input: { convId: number; actorId: number; isInstanceAdmin: boolean; topic?: string; slug?: string },
): Conversation {
  const conv = assertCanManage(ctx, input.convId, input.actorId, input.isInstanceAdmin);
  return tx(ctx.db, () => {
    if (input.slug !== undefined) {
      if (conv.kind !== "public" && conv.kind !== "private") {
        throw badRequest("bez_slug", "nazwe (slug) ma tylko kanal, nie rozmowa bezposrednia");
      }
      const slug = normalizeSlug(input.slug, "nazwa kanalu");
      const taken = getBySlug(ctx, slug);
      if (taken && taken.id !== conv.id) throw conflict("kanal_istnieje", `kanal "${slug}" juz istnieje`);
      ctx.db.prepare("UPDATE conversations SET slug = ? WHERE id = ?").run(slug, conv.id);
    }
    if (input.topic !== undefined) {
      ctx.db.prepare("UPDATE conversations SET topic = ? WHERE id = ?").run(String(input.topic), conv.id);
    }
    const updated = getConversation(ctx, conv.id)!;
    onCommitted(ctx.db, () => ctx.bus.publish(recipientsOf(ctx, conv.id), {
      type: "conversation", conversationId: conv.id,
    }));
    return updated;
  });
}

/** "Deleting" a channel = archiving: it disappears from lists and stops accepting messages,
 *  but the history stays and the operation can be undone by hand in the database.
 *  Irreversible deletion of conversations is not a one-click operation. */
export function archiveConversation(
  ctx: Ctx,
  input: { convId: number; actorId: number; isInstanceAdmin: boolean },
): void {
  const conv = assertCanManage(ctx, input.convId, input.actorId, input.isInstanceAdmin);
  if (conv.kind === "dm") throw badRequest("dm_nie_znika", "rozmowy 1:1 sie nie archiwizuje");
  if (conv.archivedAt) return; // idempotentnie
  const audience = recipientsOf(ctx, conv.id);
  ctx.db.prepare("UPDATE conversations SET archived_at = ? WHERE id = ?").run(ctx.now(), conv.id);
  onCommitted(ctx.db, () => ctx.bus.publish(audience, {
    type: "conversation", conversationId: conv.id,
  }));
}

/** Removing a participant: anybody can remove themselves (= leave), others only somebody
 *  managing the channel. Nobody can be removed from a DM - that would be a conversation
 *  with yourself. */
export function removeMember(
  ctx: Ctx,
  input: { convId: number; actorId: number; targetActorId: number; isInstanceAdmin: boolean },
): void {
  const conv = input.targetActorId === input.actorId
    ? (getConversation(ctx, input.convId) ?? (() => { throw notFound("konwersacja", `nie ma konwersacji ${input.convId}`); })())
    : assertCanManage(ctx, input.convId, input.actorId, input.isInstanceAdmin);
  if (conv.kind === "dm" || conv.kind === "group") {
    // Consistent with leave(): the membership of a direct conversation is fixed; you hide it
    // rather than trim its participants.
    throw badRequest("dm_staly", "z rozmowy bezposredniej nie usuwa sie uczestnikow");
  }
  // Event recipients are COUNTED BEFORE the removal - the one being removed should learn of it too.
  const audience = recipientsOf(ctx, conv.id);
  leave(ctx, conv.id, input.targetActorId);
  onCommitted(ctx.db, () => ctx.bus.publish(audience, {
    type: "conversation", conversationId: conv.id,
  }));
}
