/**
 * Wiki: trwala, wspoldzielona wiedza obok ulotnego czatu.
 *
 * Kanal jest chronologiczny i rozmowny - zapisuje DROGE do wniosku. Wiki jest
 * tematyczna i odszumiona - zapisuje sam WNIOSEK. Nowa sesja nie przeczyta 200
 * wiadomosci, zeby ustalic, czy cos juz wiadomo; przeczyta jedna strone.
 *
 * Model dostepu jest prosty, bo taki jest sens: strona jest PUBLICZNA dla kazdego
 * zalogowanego aktora - do czytania i do edycji. Wspolna wiedza nie jest niczyja
 * wlasnoscia. Zaufanie daje historia: kazdy zapis to rewizja (kto, kiedy, co),
 * wiec zmiana jest widoczna i odwracalna - nikt nie nadpisze cudzej pracy po cichu.
 */
import { onCommitted, tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { badRequest, notFound } from "./errors.ts";
import { normalizeSlug } from "./ids.ts";
import { allActorIds } from "./presence.ts";

export const MAX_WIKI_BYTES = 512 * 1024; // strona wiedzy bywa dluga, ale nie bez konca
const MAX_TITLE = 200;

// Slugi kolidujace z literalnymi trasami pod /api/wiki (router: pierwsza pasujaca
// trasa wygrywa, wiec strona o takim slugu bylaby nieodczytalna kanonicznym GET).
// "search" to jedyny literal na pozycji :slug; rezerwujemy go przy zapisie, zeby
// takiej strony w ogole nie dalo sie zalozyc.
const RESERVED_SLUGS = new Set(["search"]);

export type WikiPage = {
  slug: string;
  title: string;
  body: string;
  parentSlug: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedBy: string | null;
  updatedAt: number;
  revisions: number;
};

export type WikiListItem = {
  slug: string;
  title: string;
  parentSlug: string | null;
  updatedBy: string | null;
  updatedAt: number;
  bytes: number;
  /** Ile rewizji CUDZYCH przybylo od ostatniego wejscia aktora na strone. */
  unseen: number;
};

export type WikiRevision = {
  id: number;
  actor: string | null;
  title: string;
  note: string | null;
  createdAt: number;
};

type PageRow = {
  id: number; slug: string; title: string; body: string;
  parent_id: number | null;
  created_by: number | null; created_at: number;
  updated_by: number | null; updated_at: number;
};

const handleOf = (ctx: Ctx, actorId: number | null): string | null => {
  if (actorId === null) return null;
  const r = ctx.db.prepare("SELECT handle FROM actors WHERE id = ?").get(actorId) as
    | { handle: string }
    | undefined;
  return r?.handle ?? null;
};

const slugOf = (ctx: Ctx, id: number | null): string | null => {
  if (id === null) return null;
  const r = ctx.db.prepare("SELECT slug FROM wiki_pages WHERE id = ?").get(id) as
    | { slug: string }
    | undefined;
  return r?.slug ?? null;
};

function toPage(ctx: Ctx, r: PageRow): WikiPage {
  const rev = ctx.db.prepare("SELECT COUNT(*) AS n FROM wiki_revisions WHERE page_id = ?")
    .get(r.id) as { n: number };
  return {
    slug: r.slug,
    title: r.title,
    body: r.body,
    parentSlug: slugOf(ctx, r.parent_id),
    createdBy: handleOf(ctx, r.created_by),
    createdAt: r.created_at,
    updatedBy: handleOf(ctx, r.updated_by),
    updatedAt: r.updated_at,
    revisions: rev.n,
  };
}

function validate(title: string, body: string): { title: string; body: string } {
  const t = String(title ?? "").trim();
  if (!t) throw badRequest("brak_tytulu", "strona wiki musi miec tytul");
  if (t.length > MAX_TITLE) throw badRequest("tytul_za_dlugi", `tytul do ${MAX_TITLE} znakow`);
  const b = String(body ?? "");
  if (Buffer.byteLength(b, "utf8") > MAX_WIKI_BYTES) {
    throw badRequest("tresc_za_dluga", `tresc strony jest za dluga (limit ${MAX_WIKI_BYTES} B)`);
  }
  return { title: t, body: b };
}

/** Rodzic strony: undefined = nie ruszaj, null = do korzenia, slug = pod strone.
 *  Zwraca id rodzica albo null. Cykl (strona pod wlasnym potomkiem albo soba)
 *  jest odrzucany - drzewo ma zostac drzewem. */
function resolveParent(
  ctx: Ctx,
  pageIdOrNull: number | null,
  parentSlug: string | null,
): number | null {
  if (parentSlug === null) return null;
  const parent = ctx.db.prepare("SELECT id, parent_id FROM wiki_pages WHERE slug = ?").get(
    normalizeSlug(parentSlug),
  ) as { id: number; parent_id: number | null } | undefined;
  if (!parent) throw notFound("strona", `nie ma strony wiki "${parentSlug}" na rodzica`);
  if (pageIdOrNull !== null) {
    let cur: number | null = parent.id;
    let hops = 0;
    while (cur !== null) {
      if (cur === pageIdOrNull) {
        throw badRequest("cykl_wiki", "strona nie moze wisiec pod soba ani pod wlasnym potomkiem");
      }
      if (++hops > 100) throw badRequest("cykl_wiki", "drzewo wiki jest za glebokie");
      const row = ctx.db.prepare("SELECT parent_id FROM wiki_pages WHERE id = ?").get(cur) as
        | { parent_id: number | null }
        | undefined;
      cur = row?.parent_id ?? null;
    }
  }
  return parent.id;
}

/** Zaklada albo aktualizuje strone. Zawsze dopisuje rewizje - w jednej transakcji,
 *  zeby strona i jej historia nigdy sie nie rozjechaly. parentSlug: undefined =
 *  bez zmiany polozenia, null = korzen, slug = podstrona tej strony. */
export function savePage(
  ctx: Ctx,
  input: {
    slug: string; title: string; body: string; actorId: number;
    note?: string | null; parentSlug?: string | null;
  },
): WikiPage {
  const slug = normalizeSlug(input.slug);
  if (RESERVED_SLUGS.has(slug)) {
    throw badRequest("slug_zarezerwowany", `nazwa "${slug}" jest zarezerwowana - wybierz inna`);
  }
  const { title, body } = validate(input.title, input.body);
  const now = ctx.now();

  return tx(ctx.db, () => {
    const existing = ctx.db.prepare("SELECT * FROM wiki_pages WHERE slug = ?").get(slug) as
      | PageRow
      | undefined;
    if (existing) {
      const parentId = input.parentSlug === undefined
        ? existing.parent_id
        : resolveParent(ctx, existing.id, input.parentSlug);
      ctx.db
        .prepare(
          "UPDATE wiki_pages SET title = ?, body = ?, parent_id = ?, updated_by = ?, updated_at = ? WHERE id = ?",
        )
        .run(title, body, parentId, input.actorId, now, existing.id);
    } else {
      const parentId = input.parentSlug === undefined
        ? null
        : resolveParent(ctx, null, input.parentSlug);
      ctx.db
        .prepare(
          `INSERT INTO wiki_pages(slug, title, body, parent_id, created_by, created_at, updated_by, updated_at)
           VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(slug, title, body, parentId, input.actorId, now, input.actorId, now);
    }
    const page = ctx.db.prepare("SELECT * FROM wiki_pages WHERE slug = ?").get(slug) as PageRow;
    ctx.db
      .prepare(
        "INSERT INTO wiki_revisions(page_id, actor_id, title, body, note, created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(page.id, input.actorId, title, body, input.note ?? null, now);
    // Autor widzial to, co wlasnie zapisal - jego wskaznik zmian nie ma rosnac
    // od wlasnej edycji (unseen liczy tylko cudze rewizje, ale znacznik i tak
    // przesuwamy, zeby "od ostatniego wejscia" znaczylo to, co mowi).
    const lastRev = ctx.db.prepare("SELECT MAX(id) AS m FROM wiki_revisions WHERE page_id = ?")
      .get(page.id) as { m: number };
    ctx.db
      .prepare(
        `INSERT INTO wiki_reads(page_id, actor_id, last_revision_id) VALUES(?,?,?)
         ON CONFLICT(page_id, actor_id) DO UPDATE SET last_revision_id = excluded.last_revision_id`,
      )
      .run(page.id, input.actorId, lastRev.m);
    onCommitted(ctx.db, () => ctx.bus.publish(allActorIds(ctx), { type: "wiki", slug }));
    return toPage(ctx, page);
  });
}

/** Znacznik "widzialem": przesuwa wskaznik aktora na najnowsza rewizje strony. */
export function markPageSeen(ctx: Ctx, slug: string, actorId: number): void {
  const id = pageId(ctx, slug);
  if (id === null) throw notFound("strona", `nie ma strony wiki "${slug}"`);
  const last = ctx.db.prepare("SELECT MAX(id) AS m FROM wiki_revisions WHERE page_id = ?")
    .get(id) as { m: number | null };
  ctx.db
    .prepare(
      `INSERT INTO wiki_reads(page_id, actor_id, last_revision_id) VALUES(?,?,?)
       ON CONFLICT(page_id, actor_id) DO UPDATE SET last_revision_id = excluded.last_revision_id`,
    )
    .run(id, actorId, last.m ?? 0);
}

export function getPage(ctx: Ctx, slug: string): WikiPage | null {
  const s = normalizeSlugSafe(slug);
  if (!s) return null;
  const r = ctx.db.prepare("SELECT * FROM wiki_pages WHERE slug = ?").get(s) as PageRow | undefined;
  return r ? toPage(ctx, r) : null;
}

export function pageId(ctx: Ctx, slug: string): number | null {
  const s = normalizeSlugSafe(slug);
  if (!s) return null;
  const r = ctx.db.prepare("SELECT id FROM wiki_pages WHERE slug = ?").get(s) as
    | { id: number }
    | undefined;
  return r?.id ?? null;
}

/** Lista stron z licznikiem cudzych rewizji od ostatniego wejscia aktora.
 *  Wlasne edycje nie podbijaja licznika - "co nowego" znaczy "co zmienili inni". */
export function listPages(ctx: Ctx, actorId: number): WikiListItem[] {
  const rows = ctx.db
    .prepare(
      `SELECT p.slug, p.title, p.body, p.parent_id, p.updated_by, p.updated_at,
              (SELECT COUNT(*) FROM wiki_revisions r
                WHERE r.page_id = p.id
                  AND r.actor_id <> ?
                  AND r.id > COALESCE((SELECT wr.last_revision_id FROM wiki_reads wr
                                        WHERE wr.page_id = p.id AND wr.actor_id = ?), 0)
              ) AS unseen
         FROM wiki_pages p
        ORDER BY p.updated_at DESC`,
    )
    .all(actorId, actorId) as Array<{
      slug: string; title: string; body: string; parent_id: number | null;
      updated_by: number | null; updated_at: number; unseen: number;
    }>;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    parentSlug: slugOf(ctx, r.parent_id),
    updatedBy: handleOf(ctx, r.updated_by),
    updatedAt: r.updated_at,
    bytes: Buffer.byteLength(r.body, "utf8"),
    unseen: r.unseen,
  }));
}

export type WikiHit = { slug: string; title: string; snippet: string; updatedAt: number };

/** Wyszukiwarka po tytule i tresci. Wiki jest publiczna, wiec bez ACL - kazdy
 *  zalogowany widzi kazda strone. Zapytanie uzytkownika idzie jako fraza FTS
 *  z przedrostkami, po ucieczce cudzyslowow (jak w wyszukiwarce wiadomosci). */
export function searchWiki(ctx: Ctx, text: string, limit = 20): WikiHit[] {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const match = words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
  const rows = ctx.db
    .prepare(
      `SELECT p.slug, p.title, p.updated_at,
              snippet(wiki_fts, 1, '[', ']', ' … ', 12) AS snip
         FROM wiki_fts f JOIN wiki_pages p ON p.id = f.rowid
        WHERE wiki_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
    )
    .all(match, Math.min(Math.max(limit, 1), 100)) as
    Array<{ slug: string; title: string; updated_at: number; snip: string }>;
  return rows.map((r) => ({ slug: r.slug, title: r.title, snippet: r.snip, updatedAt: r.updated_at }));
}

export function pageHistory(ctx: Ctx, slug: string): WikiRevision[] {
  const id = pageId(ctx, slug);
  if (id === null) throw notFound("strona", `nie ma strony wiki "${slug}"`);
  const rows = ctx.db
    .prepare(
      "SELECT id, actor_id, title, note, created_at FROM wiki_revisions WHERE page_id = ? ORDER BY id DESC",
    )
    .all(id) as Array<{ id: number; actor_id: number; title: string; note: string | null; created_at: number }>;
  return rows.map((r) => ({
    id: r.id,
    actor: handleOf(ctx, r.actor_id),
    title: r.title,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/** Pelna tresc pojedynczej rewizji - do PODGLADU starej wersji w historii,
 *  bez destrukcyjnego revertu. Rewizja musi nalezec do strony o danym slugu
 *  (id rewizji sa globalne, wiec bez tego warunku numer z innej strony bylby
 *  wyrocznia cudzej tresci... wiki jest publiczna, ale porzadek to porzadek). */
export function getRevision(
  ctx: Ctx,
  slug: string,
  revisionId: number,
): (WikiRevision & { body: string }) | null {
  const id = pageId(ctx, slug);
  if (id === null) return null;
  const r = ctx.db
    .prepare(
      "SELECT id, actor_id, title, body, note, created_at FROM wiki_revisions WHERE id = ? AND page_id = ?",
    )
    .get(revisionId, id) as
    | { id: number; actor_id: number; title: string; body: string; note: string | null; created_at: number }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    actor: handleOf(ctx, r.actor_id),
    title: r.title,
    body: r.body,
    note: r.note,
    createdAt: r.created_at,
  };
}

/** Przywraca stronie tresc z rewizji, zapisujac to jako NOWA rewizje - historia
 *  jest dopisywana, nigdy przepisywana, wiec revert tez zostawia slad. */
export function revertPage(
  ctx: Ctx,
  input: { slug: string; revisionId: number; actorId: number },
): WikiPage {
  return tx(ctx.db, () => {
    const id = pageId(ctx, input.slug);
    if (id === null) throw notFound("strona", `nie ma strony wiki "${input.slug}"`);
    const rev = ctx.db
      .prepare("SELECT title, body FROM wiki_revisions WHERE id = ? AND page_id = ?")
      .get(input.revisionId, id) as { title: string; body: string } | undefined;
    if (!rev) throw notFound("rewizja", `nie ma rewizji ${input.revisionId} dla tej strony`);
    return savePage(ctx, {
      slug: input.slug,
      title: rev.title,
      body: rev.body,
      actorId: input.actorId,
      note: `revert do rewizji ${input.revisionId}`,
    });
  });
}

export function wikiPageCount(ctx: Ctx): number {
  return (ctx.db.prepare("SELECT COUNT(*) AS n FROM wiki_pages").get() as { n: number }).n;
}

// Bezpieczna normalizacja: dla ODCZYTU chcemy "nie ma takiej" zamiast bledu walidacji.
function normalizeSlugSafe(raw: string): string | null {
  try {
    return normalizeSlug(raw);
  } catch {
    return null;
  }
}
