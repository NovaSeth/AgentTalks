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
  /** Uczestnicy rozmowy prywatnej POZA pytajacym - tylko dla dm/group.
   *  Dzieki temu lista rozmow ma nazwy i twarze od razu po zalogowaniu. */
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
  // Jedna transakcja na kanal i czlonkostwo tworcy: awaria posrodku palilaby
  // unikalny slug na zawsze, zostawiajac kanal-widmo bez zadnego admina.
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
  // Calosc w jednej transakcji: rozmowa bez kompletu czlonkow to najgorszy mozliwy
  // stan trwaly ("DM do Boba", ktorego Bob nie widzi), a UNIQUE member_key
  // utrwalalby go na zawsze. ON CONFLICT DO NOTHING zamyka wyscig miedzy
  // procesami: przegrany nie dostaje surowego bledu UNIQUE, tylko istniejacy wiersz.
  // Czlonkowie dokladani takze dla istniejacej rozmowy (INSERT OR IGNORE w join),
  // wiec ewentualny wczesniejszy stan polowiczny sam sie leczy przy nastepnym uzyciu.
  return tx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO conversations(kind, member_key, created_at) VALUES(?,?,?)
         ON CONFLICT(member_key) DO NOTHING`,
      )
      .run(ids.length === 2 ? "dm" : "group", key, ctx.now());
    const row = ctx.db.prepare("SELECT * FROM conversations WHERE member_key = ?")
      .get(key) as ConvRow;
    // Rozmowa prywatna ma dochodzic w calosci, nie tylko przy wzmiance - ale
    // tylko dla NOWO dodanych. Kto wczesniej wyciszyl te rozmowe, ma zostac
    // wyciszony (patrz komentarz w join).
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
  // OR IGNORE: dwa procesy dolaczajace ten sam duet w tym samym momencie nie moga
  // konczyc sie surowym bledem klucza glownego u przegranego.
  //
  // `notify` ustawiamy TUTAJ, przy wstawianiu, a nie zbiorczym UPDATE-em po
  // petli: zbiorczy UPDATE nadpisywal ustawienie WSZYSTKICH czlonkow, wiec
  // wyciszona rozmowa odciszala sie sama, gdy ktokolwiek do niej wrocil.
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

  // Rozmowy prywatne dostaja UCZESTNIKOW od razu. Bez tego klient zna tylko id
  // i po zalogowaniu pokazuje trzy identyczne wiersze "Wiadomosc" bez twarzy -
  // nazwa rozmowy pojawiala sie dopiero, gdy sie ja otworzylo i przyszly
  // wiadomosci. W komunikatorze lista rozmow JEST nawigacja, wiec musi byc
  // czytelna od pierwszej klatki (Messenger: twarze i imiona, nie tresc).
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

/** Czlonkostwa aktora: rola, ustawienie powiadomien, znacznik odczytu.
 *  Potrzebne i przy /api/me, i przy /api/conversations - wiec mieszka w rdzeniu,
 *  a nie w jednej z tras. */
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

/** Kto ma dostac zdarzenie o nowej wiadomosci. Dla kanalu publicznego sa to jego
 *  czlonkowie, a nie wszyscy aktorzy: kanal, ktorego nikt nie obserwuje, nie ma
 *  budzic calego swiata. Kto chce dostawac, ten dolacza. */
export function recipientsOf(ctx: Ctx, convId: number): number[] {
  const rows = ctx.db
    .prepare("SELECT actor_id FROM members WHERE conversation_id = ?")
    .all(convId) as Array<{ actor_id: number }>;
  return rows.map((r) => r.actor_id);
}

// ------------------------------------------------------ zarzadzanie kanalem

/** Kanalem zarzadza jego admin (rola w members) albo admin instancji. */
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

/** Edycja kanalu: temat i (dla kanalow) slug. DM/grupa moze zmienic tylko temat -
 *  nazwa rozmowy bezposredniej to jej uczestnicy, nie etykieta. */
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

/** "Usuniecie" kanalu = archiwizacja: znika z list i nie przyjmuje wiadomosci,
 *  ale historia zostaje i operacje da sie cofnac reczna zmiana w bazie.
 *  Nieodwracalne kasowanie rozmow to nie jest operacja na jeden klik. */
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

/** Usuniecie uczestnika: sam siebie moze kazdy (= leave), innych tylko
 *  zarzadzajacy kanalem. Z DM-a nie da sie nikogo usunac - to bylaby rozmowa
 *  z samym soba. */
export function removeMember(
  ctx: Ctx,
  input: { convId: number; actorId: number; targetActorId: number; isInstanceAdmin: boolean },
): void {
  const conv = input.targetActorId === input.actorId
    ? (getConversation(ctx, input.convId) ?? (() => { throw notFound("konwersacja", `nie ma konwersacji ${input.convId}`); })())
    : assertCanManage(ctx, input.convId, input.actorId, input.isInstanceAdmin);
  if (conv.kind === "dm" || conv.kind === "group") {
    // Spojnie z leave(): sklad rozmowy bezposredniej jest staly, ukrywa sie ja,
    // a nie okraja z uczestnikow.
    throw badRequest("dm_staly", "z rozmowy bezposredniej nie usuwa sie uczestnikow");
  }
  // Odbiorcy zdarzenia LICZENI PRZED usunieciem - usuwany tez ma sie dowiedziec.
  const audience = recipientsOf(ctx, conv.id);
  leave(ctx, conv.id, input.targetActorId);
  onCommitted(ctx.db, () => ctx.bus.publish(audience, {
    type: "conversation", conversationId: conv.id,
  }));
}
