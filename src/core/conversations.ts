/**
 * Konwersacje: JEDEN prymityw dla kanalow publicznych, prywatnych, DM-ow i grup.
 *
 * To najwazniejsza zmiana wobec prototypu. Tam wiadomosc miala `chan` ALBO `to`,
 * wiec kanaly i DM-y byly dwiema osobnymi sciezkami kodu w kazdej funkcji: widocznosc,
 * liczniki, dostarczanie i render mialy po dwie galezie, ktore trzeba bylo trzymac
 * zgodne recznie. "Wiadomosc do wielu" nie miescila sie w zadnej z nich i po prostu
 * nie istniala.
 *
 * Tutaj wszystko jest konwersacja z lista czlonkow. Rodzaj mowi, kto moze wejsc:
 *   public  - czyta kazdy, pisanie dolacza automatycznie
 *   private - tylko czlonkowie
 *   dm      - dokladnie dwoch, tworzona przez ensureDirect
 *   group   - trzech i wiecej, tworzona przez ensureDirect
 */
import type { Ctx } from "./ctx.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { normalizeSlug } from "./ids.ts";

export type ConvKind = "public" | "private" | "dm" | "group";
export type Notify = "all" | "mentions" | "none";
export type Role = "admin" | "member";

export type Conversation = {
  id: number;
  kind: ConvKind;
  slug: string | null;
  topic: string;
  createdBy: number | null;
  createdAt: number;
  archivedAt: number | null;
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
  const slug = normalizeSlug(input.slug);
  if (getBySlug(ctx, slug)) throw conflict("kanal_istnieje", `kanal "${slug}" juz istnieje`);
  const now = ctx.now();
  ctx.db
    .prepare(
      "INSERT INTO conversations(kind, slug, topic, created_by, created_at) VALUES(?,?,?,?,?)",
    )
    .run(input.kind, slug, input.topic ?? "", input.createdBy, now);
  const conv = getBySlug(ctx, slug)!;
  join(ctx, conv.id, input.createdBy, "admin");
  return conv;
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
 * Rozmowa bezposrednia miedzy podanym zbiorem aktorow. Dwoch to `dm`, trzech
 * i wiecej to `group`. Idempotentna niezaleznie od kolejnosci argumentow.
 *
 * Klucz `member_key` (posortowane id po przecinku, UNIQUE) sprawia, ze ponowne
 * "napisz do tych trzech" jest jednym odczytem po indeksie, a nie porownywaniem
 * zbiorow czlonkostw wszystkich rozmow.
 */
export function ensureDirect(ctx: Ctx, actorIds: readonly number[]): Conversation {
  const ids = [...new Set(actorIds)].sort((a, b) => a - b);
  if (ids.length < 2) {
    throw badRequest("za_malo_uczestnikow", "rozmowa wymaga co najmniej dwoch roznych osob");
  }
  const key = ids.join(",");
  const existing = ctx.db.prepare("SELECT * FROM conversations WHERE member_key = ?").get(key) as
    | ConvRow
    | undefined;
  if (existing) return toConv(existing);

  const now = ctx.now();
  ctx.db
    .prepare("INSERT INTO conversations(kind, member_key, created_at) VALUES(?,?,?)")
    .run(ids.length === 2 ? "dm" : "group", key, now);
  const row = ctx.db.prepare("SELECT * FROM conversations WHERE member_key = ?").get(key) as ConvRow;
  for (const actorId of ids) join(ctx, row.id, actorId);
  // Rozmowa prywatna ma dochodzic w calosci, nie tylko przy wzmiance.
  ctx.db.prepare("UPDATE members SET notify = 'all' WHERE conversation_id = ?").run(row.id);
  return toConv(row);
}

export function join(ctx: Ctx, convId: number, actorId: number, role: Role = "member"): Member {
  const existing = getMember(ctx, convId, actorId);
  if (existing) return existing;
  if (!getConversation(ctx, convId)) throw notFound("konwersacja", `nie ma konwersacji ${convId}`);
  ctx.db
    .prepare(
      "INSERT INTO members(conversation_id, actor_id, role, joined_at) VALUES(?,?,?,?)",
    )
    .run(convId, actorId, role, ctx.now());
  return getMember(ctx, convId, actorId)!;
}

export function leave(ctx: Ctx, convId: number, actorId: number): void {
  const conv = getConversation(ctx, convId);
  if (conv && (conv.kind === "dm" || conv.kind === "group")) {
    // Wyjscie z DM-a zostawialoby rozmowe z jednym uczestnikiem i wiadomosciami,
    // ktorych nikt nie moze przeczytac. Rozmowe prywatna sie ukrywa, nie opuszcza.
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
  // Celowo ten sam blad dla "nie ma" i "nie wolno": inaczej odpowiedz serwera
  // zdradzalaby istnienie kanalow prywatnych komus, kto nie ma do nich prawa.
  if (!conv || !canRead(ctx, convId, actorId)) {
    throw forbidden("brak_dostepu", "brak dostepu do tej konwersacji");
  }
  return conv;
}

/** Pisanie do kanalu publicznego dolacza aktora - tak jak w prototypie, gdzie samo
 *  odezwanie sie czynilo cie uczestnikiem. Do reszty trzeba byc juz czlonkiem. */
export function assertCanPost(ctx: Ctx, convId: number, actorId: number): Conversation {
  const conv = assertCanRead(ctx, convId, actorId);
  if (conv.archivedAt) throw forbidden("zarchiwizowana", "ta konwersacja jest zarchiwizowana");
  if (conv.kind === "public" && !isMember(ctx, convId, actorId)) join(ctx, convId, actorId);
  return conv;
}

/** Konwersacje widoczne dla aktora: wszystkie publiczne plus te, ktorych jest czlonkiem. */
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
  return rows.map(toConv);
}

export function setNotify(ctx: Ctx, convId: number, actorId: number, notify: Notify): void {
  if (!isMember(ctx, convId, actorId)) join(ctx, convId, actorId);
  ctx.db
    .prepare("UPDATE members SET notify = ? WHERE conversation_id = ? AND actor_id = ?")
    .run(notify, convId, actorId);
}

/** Kto ma dostac zdarzenie o nowej wiadomosci. Dla kanalu publicznego sa to jego
 *  czlonkowie, a nie wszyscy aktorzy: kanal, ktorego nikt nie obserwuje, nie ma
 *  budzic calego swiata. Kto chce dostawac, ten dolacza. */
export function recipientsOf(ctx: Ctx, convId: number): number[] {
  const rows = ctx.db
    .prepare("SELECT actor_id FROM members WHERE conversation_id = ?")
    .all(convId) as Array<{ actor_id: number }>;
  return rows.map((r) => r.actor_id);
}
