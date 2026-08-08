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
import { tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { badRequest, notFound } from "./errors.ts";
import { normalizeSlug } from "./ids.ts";

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
  createdBy: string | null;
  createdAt: number;
  updatedBy: string | null;
  updatedAt: number;
  revisions: number;
};

export type WikiListItem = {
  slug: string;
  title: string;
  updatedBy: string | null;
  updatedAt: number;
  bytes: number;
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

function toPage(ctx: Ctx, r: PageRow): WikiPage {
  const rev = ctx.db.prepare("SELECT COUNT(*) AS n FROM wiki_revisions WHERE page_id = ?")
    .get(r.id) as { n: number };
  return {
    slug: r.slug,
    title: r.title,
    body: r.body,
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

/** Zaklada albo aktualizuje strone. Zawsze dopisuje rewizje - w jednej transakcji,
 *  zeby strona i jej historia nigdy sie nie rozjechaly. */
export function savePage(
  ctx: Ctx,
  input: { slug: string; title: string; body: string; actorId: number; note?: string | null },
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
      ctx.db
        .prepare("UPDATE wiki_pages SET title = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ?")
        .run(title, body, input.actorId, now, existing.id);
    } else {
      ctx.db
        .prepare(
          `INSERT INTO wiki_pages(slug, title, body, created_by, created_at, updated_by, updated_at)
           VALUES(?,?,?,?,?,?,?)`,
        )
        .run(slug, title, body, input.actorId, now, input.actorId, now);
    }
    const page = ctx.db.prepare("SELECT * FROM wiki_pages WHERE slug = ?").get(slug) as PageRow;
    ctx.db
      .prepare(
        "INSERT INTO wiki_revisions(page_id, actor_id, title, body, note, created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(page.id, input.actorId, title, body, input.note ?? null, now);
    return toPage(ctx, page);
  });
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

export function listPages(ctx: Ctx): WikiListItem[] {
  const rows = ctx.db
    .prepare(
      `SELECT slug, title, body, updated_by, updated_at FROM wiki_pages ORDER BY updated_at DESC`,
    )
    .all() as Array<{ slug: string; title: string; body: string; updated_by: number | null; updated_at: number }>;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    updatedBy: handleOf(ctx, r.updated_by),
    updatedAt: r.updated_at,
    bytes: Buffer.byteLength(r.body, "utf8"),
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
