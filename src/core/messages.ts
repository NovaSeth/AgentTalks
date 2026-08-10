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
  resolvedBy: number | null;   // actorId; UI mapuje na handle
  /** "Kod zmieniony" - twierdzenie NAPRAWIAJACEGO. Slabsze niz resolvedAt
   *  ("objaw zniknal"), ktore moze postawic tylko autor zgloszenia albo admin. */
  fixedAt: number | null;
  fixedBy: number | null;
  meta: Record<string, unknown> | null;
  /** Handle autora - doklejany na granicy HTTP/SSE, nie czytany z bazy przy
   *  kazdym wierszu. Patrz `zHandlem` w http/respond.ts: kasuje pulapke
   *  "klucz mapy actors jest stringiem, a actorId liczba". */
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
    // Komunikat mowi, O ILE za duzo i w czym mierzymy. "limit 65536 B" nie
    // pomaga komus, kto liczy znaki - a polska litera to dwa bajty, wiec sam
    // limit w bajtach jest dla czlowieka nieprzewidywalny. Klient dostaje takze
    // `maxMessageBytes` w /api/me, wiec moze pokazac licznik ZANIM ktos wysle.
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
  let notified: number[] = [];
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
    // conversationId pozwala rozwinac @all na wszystkich czlonkow kanalu.
    // Autor nie wspomina sam siebie - inaczej @all budzilby tez nadawce.
    //
    // canRead na koncu nie jest ostroznoscia, tylko poprawka bledu: wzmianka
    // niesie ze soba TRESC (przez /api/mentions i przez wyimek w powiadomieniu),
    // wiec bez tego filtra napisanie "@obcy" na kanale PRYWATNYM dostarczalo
    // fragment rozmowy komus, kto nie ma do niej wstepu. Dla kanalu publicznego
    // canRead przepuszcza kazdego, wiec wciaganie ludzi zawolaniem dziala jak
    // dotad; blokowane sa wylacznie private, dm i grupy.
    const mentioned = resolveMentions(ctx, body, input.conversationId)
      .filter((actorId) => actorId !== input.actorId)
      .filter((actorId) => canRead(ctx, input.conversationId, actorId));
    for (const actorId of mentioned) stmt.run(row.id, actorId);

    // Powiadomienia. W DM-ie i grupie liczy sie KAZDA wiadomosc (po to sa), na
    // kanale tylko zawolanie po nazwie - inaczej "powiadomienia" byly by drugim
    // licznikiem nieprzeczytanych i nauczyloby sie je ignorowac.
    const conv = ctx.db.prepare("SELECT kind FROM conversations WHERE id = ?")
      .get(input.conversationId) as { kind: string } | undefined;
    const direct = conv?.kind === "dm" || conv?.kind === "group";
    // Wyciszenie rozmowy (notify='none') ma cos znaczyc. Wczesniej przelacznik
    // w UI nie wplywal na nic: powiadomienie powstawalo tak samo, wiec jedyna
    // roznica byla ta, ze uzytkownik uwierzyl, ze go wyciszyl.
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
      // Ogloszenie idzie nizej, PO zdarzeniu "message": klient, ktory na
      // powiadomienie reaguje skokiem do wiadomosci, ma ja juz miec.
      announce: false,
    });
    return messageFromRow(row);
  });

  // Zdarzenie WYLACZNIE dla nowo utworzonej wiadomosci: powtorka (dedup) nie
  // moze wygenerowac drugiego pusha, bo to bylby dokladnie ten zdublowany wake,
  // przed ktorym idempotencja ma chronic.
  if (created) {
    // Wyslana wiadomosc konczy pisanie - kuleczka "pisze" znika natychmiast.
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

  // Kto byl wspomniany PRZED edycja - zeby powiadomic wylacznie tych, ktorzy
  // doszli, a nie zasypywac powtorka kazdego przy poprawce literowki.
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
    // Ten sam filtr co przy wysylce: wzmianka niesie tresc, wiec nie moze
    // dotrzec do kogos, kto nie ma dostepu do rozmowy (patrz postMessage).
    const wspomniani = resolveMentions(ctx, text, row.conversation_id)
      .filter((a) => a !== actorId)
      .filter((a) => canRead(ctx, row.conversation_id, a));
    for (const a of wspomniani) stmt.run(id, a);
    // Edycja, ktora DODAJE zawolanie, musi powiadomic - inaczej "@michal, jednak
    // zrob to" dopisane do wlasnej wiadomosci nie dociera do nikogo, a autor jest
    // przekonany, ze zawolal. Powiadamiamy tylko NOWO wspomnianych.
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
    // Tresc znika naprawde, zeby "skasuj" znaczylo skasuj, a nie "ukryj w UI".
    // Wiersz zostaje, bo id jest kursorem i znacznikiem odczytu.
    //
    // "Naprawde" musi obejmowac WSZYSTKIE kopie tresci, inaczej to zdanie jest
    // nieprawdziwe, a nieprawdziwe zdanie o kasowaniu jest gorsze niz jego brak:
    //  - meta wiadomosci-zalacznika trzyma nazwe pliku i typ,
    //  - powiadomienia trzymaja wyimek tresci (excerpt),
    //  - same bajty zalacznika leza w katalogu plikow i sa pobieralne po id.
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
 * "NAPRAWIONE": twierdzenie naprawiajacego, ze zmienil kod. Moze je postawic
 * kazdy, kto ma dostep do rozmowy - bo to nie jest domkniecie sprawy, tylko
 * informacja "z mojej strony zrobione, sprawdzcie". Domkniecie
 * (`resolveMessage`) zostaje przy autorze zgloszenia i adminie, i to jest cala
 * roznica: naprawiajacy i tak WIE, ze naprawil, wiec jego wlasny check nie
 * niesie nowej informacji. Wartosc ma dopiero potwierdzenie kogos innego.
 */
export function markFixed(
  ctx: Ctx,
  input: { id: number; actorId: number; fixed: boolean },
): Message {
  const row = ctx.db.prepare("SELECT * FROM messages WHERE id = ?").get(input.id) as MsgRow | undefined;
  if (!row) throw notFound("wiadomosc", `nie ma wiadomosci ${input.id}`);
  if (row.deleted_at) throw badRequest("skasowana", "skasowanej wiadomosci nie da sie oznaczyc");
  assertCanRead(ctx, row.conversation_id, input.actorId);
  // Jedna transakcja: zmiana stanu i powiadomienie autora zgloszenia to jedno
  // zdarzenie. Rozdzielone, przy padzie miedzy nimi zostawialy zgloszenie
  // oznaczone jako naprawione, o czym autor nigdy by sie nie dowiedzial.
  const message = tx(ctx.db, () => {
    ctx.db.prepare("UPDATE messages SET fixed_at = ?, fixed_by = ? WHERE id = ?")
      .run(input.fixed ? ctx.now() : null, input.fixed ? input.actorId : null, input.id);
    if (input.fixed) {
      // Wlasny rodzaj, nie "mention": lista powiadomien pisze zdanie na podstawie
      // rodzaju, wiec oznaczenie naprawy jako wzmianki kazalo uzytkownikowi szukac
      // w kanale zawolania, ktorego tam nie ma. Wyimek to sama tresc zgloszenia -
      // opis akcji dokleja interfejs, wiec powielanie go tutaj bylo szumem.
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

/** Oznacz wiadomosc jako rozwiazana / cofnij (np. zgloszenie na #bug domkniete).
 *  Moze: autor wiadomosci, admin instancji, albo admin kanalu. Generyczne -
 *  na dowolnym kanale. Zdarzenie message_updated odswieza check u wszystkich. */
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

/** Najwyzsze id w systemie. Klient bierze je jako punkt startowy kursora. */
export function lastMessageId(ctx: Ctx): number {
  const row = ctx.db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM messages").get() as {
    id: number;
  };
  return row.id;
}

