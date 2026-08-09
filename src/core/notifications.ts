/**
 * Powiadomienia: jedno miejsce na "co sie wydarzylo, o czym mam wiedziec".
 *
 * Wczesniej odpowiedz na to pytanie byla rozsypana: licznik nieprzeczytanych
 * mowil o kanalach, tabela `mentions` o wzmiankach, a reakcje i zmiany wiki nie
 * mowily nic - czyli o polowie rzeczy, ktore dotycza uzytkownika, dowiadywal sie
 * przez przypadek albo wcale.
 *
 * Trzy zasady, ktore odrozniaja to od licznika nieprzeczytanych:
 *  - powiadomienie ma WLASNY znacznik odczytu; przeczytanie kanalu nie kasuje
 *    faktu, ze ktos Cie w nim wolal, a odhaczenie powiadomienia nie klamie,
 *    ze przeczytales cala rozmowe,
 *  - powiadomienie ma CEL: rozmowa+wiadomosc albo strona wiki, wiec klikniecie
 *    prowadzi tam, gdzie rzecz sie stala, a nie "gdzies w okolice",
 *  - powiadomienia nie tworzy sie sobie samemu - wlasna wzmianka, wlasna reakcja
 *    i wlasna edycja wiki nie sa zdarzeniem dla autora.
 */
import { onCommitted } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { badRequest } from "./errors.ts";

export type NotificationKind = "mention" | "dm" | "reaction" | "wiki" | "fix";

export type Notification = {
  id: number;
  kind: NotificationKind;
  from: string | null;
  conversationId: number | null;
  messageId: number | null;
  wikiSlug: string | null;
  excerpt: string | null;
  createdAt: number;
  readAt: number | null;
};

type Row = {
  id: number; kind: string; from_handle: string | null;
  conversation_id: number | null; message_id: number | null;
  wiki_slug: string | null; excerpt: string | null;
  created_at: number; read_at: number | null;
};

const MAX_EXCERPT = 160;

/** Podglad tresci: jedna linia, bez sciany tekstu w liscie powiadomien. */
export function excerptOf(body: string): string {
  const oneLine = String(body ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_EXCERPT ? `${oneLine.slice(0, MAX_EXCERPT - 1)}…` : oneLine;
}

const toNotification = (r: Row): Notification => ({
  id: r.id,
  kind: r.kind as NotificationKind,
  from: r.from_handle,
  conversationId: r.conversation_id,
  messageId: r.message_id,
  wikiSlug: r.wiki_slug,
  excerpt: r.excerpt,
  createdAt: r.created_at,
  readAt: r.read_at,
});

/**
 * Zapisuje powiadomienia dla listy odbiorcow. Nadawca jest z niej usuwany
 * (nikt nie powiadamia sam siebie), duplikaty tez - jedno zdarzenie to jedno
 * powiadomienie, nawet gdy ktos jest i wspomniany, i czlonkiem DM-a.
 *
 * Zdarzenie SSE leci PO commicie, zeby klient, ktory od razu pobierze liste,
 * zobaczyl w niej to, o czym wlasnie zostal powiadomiony.
 */
export function notify(
  ctx: Ctx,
  input: {
    actorIds: number[];
    kind: NotificationKind;
    fromActorId?: number | null;
    conversationId?: number | null;
    messageId?: number | null;
    wikiSlug?: string | null;
    excerpt?: string | null;
    /** false = zapisz, ale zdarzenie SSE oglosi wywolujacy (kolejnosc ma znaczenie:
     *  powiadomienie o wiadomosci nie moze wyprzedzic samej wiadomosci). */
    announce?: boolean;
  },
): number[] {
  const from = input.fromActorId ?? null;
  const targets = [...new Set(input.actorIds)].filter((id) => id !== from);
  if (targets.length === 0) return [];
  const now = ctx.now();
  sprzatnijStare(ctx);
  const stmt = ctx.db.prepare(
    `INSERT INTO notifications(actor_id, kind, from_actor_id, conversation_id, message_id,
                               wiki_slug, excerpt, created_at)
     VALUES(?,?,?,?,?,?,?,?)`,
  );
  for (const actorId of targets) {
    stmt.run(
      actorId, input.kind, from,
      input.conversationId ?? null, input.messageId ?? null,
      input.wikiSlug ?? null, input.excerpt ?? null, now,
    );
  }
  if (input.announce !== false) {
    onCommitted(ctx.db, () => ctx.bus.publish(targets, { type: "notification" }));
  }
  return targets;
}

/**
 * Retencja. Tabela powiadomien rosnie z kazda wzmianka, reakcja i wiadomoscia
 * w DM - czyli szybciej niz rozmowy - a nic jej nie zmniejszalo. Trzymamy
 * PRZECZYTANE starsze niz 30 dni i wszystko starsze niz 180 dni: powiadomienie,
 * ktorego nikt nie otworzyl przez pol roku, nie jest juz powiadomieniem.
 * Sprzatanie jest leniwe (przy zapisie), zeby nie trzymac osobnego zadania.
 */
const PRZECZYTANE_DNI = 30;
const WSZYSTKIE_DNI = 180;
function sprzatnijStare(ctx: Ctx): void {
  const now = ctx.now();
  ctx.db.prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?")
    .run(now - PRZECZYTANE_DNI * 24 * 3600);
  ctx.db.prepare("DELETE FROM notifications WHERE created_at < ?")
    .run(now - WSZYSTKIE_DNI * 24 * 3600);
}

export function listNotifications(
  ctx: Ctx,
  actorId: number,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Notification[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = ctx.db
    .prepare(
      `SELECT n.id, n.kind, a.handle AS from_handle, n.conversation_id, n.message_id,
              n.wiki_slug, n.excerpt, n.created_at, n.read_at
         FROM notifications n
         LEFT JOIN actors a ON a.id = n.from_actor_id
        WHERE n.actor_id = ?${opts.unreadOnly ? " AND n.read_at IS NULL" : ""}
        ORDER BY n.id DESC
        LIMIT ?`,
    )
    .all(actorId, limit) as Row[];
  return rows.map(toNotification);
}

export function unreadNotificationCount(ctx: Ctx, actorId: number): number {
  const r = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE actor_id = ? AND read_at IS NULL")
    .get(actorId) as { n: number };
  return r.n;
}

/**
 * Odhaczenie. Bez `ids` odhacza WSZYSTKIE nieprzeczytane - to jest ten jeden
 * przycisk "widzialem". Zwraca liczbe realnie zmienionych rekordow, zeby
 * "odhaczylem 0" nie wygladalo tak samo jak "odhaczylem 12".
 */
export function markNotificationsRead(
  ctx: Ctx,
  actorId: number,
  ids?: number[] | null,
): number {
  const now = ctx.now();
  if (ids && ids.length) {
    if (ids.some((id) => !Number.isInteger(id))) {
      throw badRequest("zle_id", "ids musi byc lista liczb calkowitych");
    }
    const marks = ids.map(() => "?").join(",");
    const r = ctx.db
      .prepare(
        `UPDATE notifications SET read_at = ?
          WHERE actor_id = ? AND read_at IS NULL AND id IN (${marks})`,
      )
      .run(now, actorId, ...ids);
    return Number(r.changes ?? 0);
  }
  const r = ctx.db
    .prepare("UPDATE notifications SET read_at = ? WHERE actor_id = ? AND read_at IS NULL")
    .run(now, actorId);
  return Number(r.changes ?? 0);
}
