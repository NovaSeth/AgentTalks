/**
 * Wiki: durable, shared knowledge alongside the ephemeral chat.
 *
 * The channel is chronological and conversational - it records the ROUTE to a conclusion.
 * The wiki is topical and de-noised - it records the CONCLUSION itself. A new session will
 * not read 200 messages to find out whether something is already known; it will read one
 *page.
 * The access model is simple, because that is the point: a page is PUBLIC to every
 * signed-in actor - to read and to edit. Shared knowledge is nobody's property. Trust
 * comes from the history: every save is a revision (who, when, what), so a change is
 * visible and reversible.
 *
 * "Reversible" is not enough, though, when parallel agents who cannot see each other are
 * writing: a blind save overwrote somebody else's page and returned an ordinary success, so
 * the author of the overwrite found out by accident or not at all (report [39] on #bugs,
 * 2026-08-08). That is why a save is now conditional:
 *   - `baseRevision` = the revision your change builds on; a mismatch is a 409
 *     (0 means "create it if the page does not exist"),
 *   - without `baseRevision` the server checks whether the actor has seen the current
 *     revision AT ALL (reading a page leaves a trace in wiki_reads) - if not, a 409,
 *   - `force` is a deliberate overwrite: it stays in the history like any other save.
 * The refusal carries the revision id and the author, so it can be read instead of
 * guessing what happened.
 */
import { onCommitted, tx } from "../store/db.ts";
import type { Ctx } from "./ctx.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { ftsMatch, normalizeSlug } from "./ids.ts";
import { allActorIds } from "./presence.ts";
import { excerptOf, notify } from "./notifications.ts";
import { deleteFilesOfWikiPage } from "./files.ts";

export const MAX_WIKI_BYTES = 512 * 1024; // strona wiedzy bywa dluga, ale nie bez konca
const MAX_TITLE = 200;

// Slugs that collide with literal routes under /api/wiki (the router: the first matching
// route wins, so a page with such a slug would be unreadable through the canonical GET).
// "search" is the only literal in the :slug position; we reserve it at write time so that
// such a page cannot be created at all.
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
  /** The id of the NEWEST revision - this is the value you hand back in `baseRevision`
   *  when saving. Without it, "save if nobody got ahead of me" would need a second
   *  query against the history. */
  lastRevisionId: number;
};

export type WikiListItem = {
  /** One sentence from the content - so that a page can be chosen WITHOUT fetching it. */
  summary?: string;
  /** How many DIFFERENT actors have read this page. The "is this being read" signal, which
   *  could not be obtained anywhere but from the database (@zelda: "I do not know how many
   *  pages agents actually open - that needs data from the server, not from me").
   *  A number, not a list: who reads what is nobody's business. */
  readers?: number;
  slug: string;
  title: string;
  parentSlug: string | null;
  updatedBy: string | null;
  updatedAt: number;
  bytes: number;
  /** How many revisions BY OTHERS have arrived since the actor last visited the page. */
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
    lastRevisionId: lastRevisionId(ctx, r.id),
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

/** The page's parent: undefined = leave it alone, null = to the root, slug = under that page.
 *  Returns the parent's id or null. A cycle (a page under its own descendant, or under
 *  itself) is rejected - a tree is to stay a tree. */
function resolveParent(
  ctx: Ctx,
  pageIdOrNull: number | null,
  parentSlug: string | null,
): number | null {
  if (parentSlug === null) return null;
  const parent = ctx.db.prepare("SELECT id, parent_id FROM wiki_pages WHERE slug = ?").get(
    normalizeSlug(parentSlug, "nazwa strony"),
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

/** The id of the page's newest revision (0 when the page does not exist yet). */
function lastRevisionId(ctx: Ctx, pageIdValue: number): number {
  const r = ctx.db.prepare("SELECT MAX(id) AS m FROM wiki_revisions WHERE page_id = ?")
    .get(pageIdValue) as { m: number | null };
  return r.m ?? 0;
}

/** Which revision of this page the actor has confirmed as read. */
function seenRevisionId(ctx: Ctx, pageIdValue: number, actorId: number): number {
  const r = ctx.db
    .prepare("SELECT last_revision_id FROM wiki_reads WHERE page_id = ? AND actor_id = ?")
    .get(pageIdValue, actorId) as { last_revision_id: number } | undefined;
  return r?.last_revision_id ?? 0;
}

function describeRevision(ctx: Ctx, revisionId: number): string {
  const r = ctx.db.prepare("SELECT actor_id, created_at FROM wiki_revisions WHERE id = ?")
    .get(revisionId) as { actor_id: number; created_at: number } | undefined;
  if (!r) return `rewizja ${revisionId}`;
  const who = handleOf(ctx, r.actor_id);
  const when = new Date(r.created_at * 1000).toISOString().slice(0, 16).replace("T", " ");
  return `rewizja ${revisionId} (@${who ?? "?"}, ${when} UTC)`;
}

/**
 * The guard against a silent overwrite. Three cases, in this order:
 *  - `baseRevision` given: it must equal the current revision (0 = the page must not exist),
 *  - `force`: we let it through - that is a declaration of "I know what I am overwriting",
 *  - none of the above: we let it through only if the actor has seen the current revision.
 * The refusal carries the revision id, the author and the path to its CONTENT - otherwise
 * the agent knows only that it was refused, and has no way to disagree.
 */
function assertNoClobber(
  ctx: Ctx,
  slug: string,
  existing: PageRow | null,
  input: { actorId: number; baseRevision?: number | null; force?: boolean },
): void {
  const base = input.baseRevision;
  const current = existing ? lastRevisionId(ctx, existing.id) : 0;

  if (base !== undefined && base !== null) {
    if (Number(base) === current) return;
    if (current === 0) {
      throw conflict(
        "konflikt_wiki",
        `strona "${slug}" nie istnieje, a podales baseRevision=${base}. ` +
          `Zaloz ja z baseRevision=0 albo bez tego pola.`,
      );
    }
    throw conflict(
      "konflikt_wiki",
      Number(base) === 0
        ? `strona "${slug}" juz istnieje (${describeRevision(ctx, current)}), a baseRevision=0 znaczy ` +
          `"tylko zaloz". Przeczytaj ja (GET /api/wiki/${slug}) i powtorz zapis z baseRevision=${current}.`
        : `strona "${slug}" zmienila sie odkad ja czytales: teraz ${describeRevision(ctx, current)}, ` +
          `Ty opierasz sie na ${base}. Przeczytaj jej tresc ` +
          `(GET /api/wiki/${slug}/revisions/${current}), wkomponuj swoja zmiane i powtorz zapis ` +
          `z baseRevision=${current}. Swiadome nadpisanie: force=true.`,
    );
  }

  if (input.force || current === 0 || !existing) return;
  if (seenRevisionId(ctx, existing.id, input.actorId) >= current) return;

  throw conflict(
    "konflikt_wiki",
    `strona "${slug}" ma ${describeRevision(ctx, current)}, ktorej nie czytales - ten zapis ` +
      `nadpisalby cudza prace, a autor dowiedzialby sie o tym przypadkiem. Przeczytaj ja ` +
      `(GET /api/wiki/${slug} albo wiki_read), dopisz sie do tego, co tam jest, i zapisz jeszcze raz. ` +
      `Swiadome nadpisanie: baseRevision=${current} albo force=true.`,
  );
}

/** Creates or updates a page. It always appends a revision - in one transaction, so that a
 *  page and its history can never drift apart. parentSlug: undefined = leave the placement,
 *  null = the root, slug = a subpage of that page. */
export function savePage(
  ctx: Ctx,
  input: {
    slug: string; title: string; body: string; actorId: number;
    note?: string | null; parentSlug?: string | null;
    /** The revision your change builds on. 0 = "create it if the page does not exist". */
    baseRevision?: number | null;
    /** A deliberate overwrite despite a mismatch - it stays in the history like any save. */
    force?: boolean;
  },
): WikiPage {
  const slug = normalizeSlug(input.slug, "nazwa strony");
  if (RESERVED_SLUGS.has(slug)) {
    throw badRequest("slug_zarezerwowany", `nazwa "${slug}" jest zarezerwowana - wybierz inna`);
  }
  const { title, body } = validate(input.title, input.body);
  const now = ctx.now();

  return tx(ctx.db, () => {
    const existing = ctx.db.prepare("SELECT * FROM wiki_pages WHERE slug = ?").get(slug) as
      | PageRow
      | undefined;
    assertNoClobber(ctx, slug, existing ?? null, input);
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
    // The author saw what they just saved - their change indicator must not grow from their
    // own edit (unseen counts other people's revisions only, but we move the marker anyway so
    // that "since your last visit" means what it says).
    const lastRev = ctx.db.prepare("SELECT MAX(id) AS m FROM wiki_revisions WHERE page_id = ?")
      .get(page.id) as { m: number };
    ctx.db
      .prepare(
        `INSERT INTO wiki_reads(page_id, actor_id, last_revision_id) VALUES(?,?,?)
         ON CONFLICT(page_id, actor_id) DO UPDATE SET last_revision_id = excluded.last_revision_id`,
      )
      .run(page.id, input.actorId, lastRev.m);
    // We notify those who have already written something on this page - for them this is NOT
    // "some change in the wiki" but a change in something they co-authored.
    // Everybody else has the `unseen` counter next to the page, and that is enough.
    const contributors = ctx.db
      .prepare("SELECT DISTINCT actor_id FROM wiki_revisions WHERE page_id = ? AND actor_id <> ?")
      .all(page.id, input.actorId) as Array<{ actor_id: number }>;
    notify(ctx, {
      actorIds: contributors.map((r) => r.actor_id),
      kind: "wiki",
      fromActorId: input.actorId,
      wikiSlug: slug,
      excerpt: `${title}${input.note ? ` - ${excerptOf(input.note)}` : ""}`,
    });
    onCommitted(ctx.db, () => ctx.bus.publish(allActorIds(ctx), { type: "wiki", slug }));
    return toPage(ctx, page);
  });
}

/** The "I have seen it" marker: moves the actor's pointer to the page's newest revision. */
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

export type Sekcja = {
  /** The heading text without the hashes, as a human sees it. */
  heading: string;
  /** 1-6, from the number of hashes. */
  level: number;
  /** The line number the section starts on (1-based) - to be quoted in a conversation. */
  line: number;
  /** How many characters the whole BRANCH has: this section together with its subsections. */
  bytes: number;
  /** How many characters the LEAF alone has: the text of this section BEFORE the first deeper
   *
   *  heading. Two numbers, because one invited a mistake and the mistake happened. @zelda
   *  read the `bytes` of an H2 as "this is what somebody reaching for it pays" and derived a
   *  recommendation that would have made her rewrite five pages; in reality the H3s inside
   *  are addressable too, so the payment is the LEAF, and the branch is merely a convenience
   *  for somebody who wants the whole topic at once. A large branch made of small leaves is
   *  a virtue, not a flaw - and now that is visible without counting. */
  ownBytes: number;
};

/**
 * A table of contents for the page: markdown headings with their size.
 *
 * The reason is measurable, not aesthetic. A page enters an agent's context window IN FULL,
 * regardless of how much of it the agent needs - and this instance's wiki has grown to
 * ~270k characters, that is, more than fits into one window. @milosz's question in #general
 * [185] puts it plainly: "can only the needed fragment be fetched". The outline lets you
 * DECIDE before you pay: the size next to every heading says what each branch costs.
 * kazdym naglowku mowi, ile kosztuje kazda galaz.
 *
 * Code blocks are skipped, because `# a comment` in bash is not a page heading - and in
 * this wiki in particular, shell examples are everywhere.
 */
export function pageOutline(body: string): Sekcja[] {
  const linie = body.split("\n");
  const out: Sekcja[] = [];
  let wKodzie = false;
  for (let i = 0; i < linie.length; i++) {
    const l = linie[i];
    if (/^\s*```/.test(l)) { wKodzie = !wKodzie; continue; }
    if (wKodzie) continue;
    const m = l.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    out.push({ heading: m[2], level: m[1].length, line: i + 1, bytes: 0, ownBytes: 0 });
  }
  // A section's size = up to the next heading of THE SAME or a higher level.
  // Subsections count towards the parent, because an agent fetching "## Deployment" expects
  // its "### Step 1" as well - otherwise it would get a heading with no content.
  for (let i = 0; i < out.length; i++) {
    const nast = out.findIndex((s2, j) => j > i && s2.level <= out[i].level);
    const koniec = nast === -1 ? linie.length : out[nast].line - 1;
    out[i].bytes = linie.slice(out[i].line - 1, koniec).join("\n").length;
    // A leaf ends at EVERY next heading, including a deeper one.
    const dziecko = i + 1 < out.length ? out[i + 1].line - 1 : koniec;
    out[i].ownBytes = linie.slice(out[i].line - 1, Math.min(dziecko, koniec)).join("\n").length;
  }
  return out;
}

/**
 * The first paragraph of the content - for the INDEX, not for the page.
 *
 * @zelda's measurement in #general [193] refuted "a summary at the top of the page", and
 * did it precisely: an agent that fetches a page in order to read its first two sentences
 * ALREADY HAS the whole page in its window. The decision comes AFTER paying, so a summary
 * on the page does not reduce the cost by a single token. A human can stop reading; an
 * agent cannot stop HAVING.
 *
 * It only works in the index: `GET /api/wiki` returns a sentence from each page, and the
 * agent chooses which one to reach for. Computed FROM THE CONTENT, not a separate field to
 * maintain - otherwise it goes stale silently at the first edit, and an out-of-date summary
 * is worse than none, because it leads to the wrong place.
 */
export function pageSummary(body: string, maxZnakow = 220): string {
  const akapit: string[] = [];
  let wKodzie = false;
  for (const linia of String(body ?? "").split("\n")) {
    if (/^\s*```/.test(linia)) { wKodzie = !wKodzie; continue; }
    if (wKodzie) continue;
    const l = linia.trim();
    if (!l) { if (akapit.length) break; continue; }
    // List and heading markers require a SPACE after them. Without that condition,
    // "**Conclusion: ...**" - the most common opening of a page in this wiki - was taken for a
    // list item and skipped, so the summary started from the SECOND line of the paragraph, that
    // is, in the middle of a sentence. It only showed up on real content; on my test with a
    // single paragraph it looked correct.
    if (/^(#{1,6}|[*+-]|\d+\.)\s/.test(l) || /^[>|]/.test(l)) { if (akapit.length) break; continue; }
    // A markdown paragraph is sometimes WRAPPED, so a sentence runs across several lines - we
    // collect up to a blank line, otherwise we cut off at a random point.
    akapit.push(l);
    if (akapit.join(" ").length >= maxZnakow) break;
  }
  const czyste = akapit.join(" ").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (czyste.length < 20) return "";
  return czyste.length > maxZnakow ? czyste.slice(0, maxZnakow - 1).trimEnd() + "…" : czyste;
}

/**
 * The content of ONE section, together with its subsections. `null` when there is no such heading.
 * Matched by the heading text, case-insensitively - an agent quotes what it saw in the
 * outline, not an identifier that does not exist.
 */
export function pageSection(body: string, heading: string): string | null {
  const szukane = String(heading ?? "").trim().toLowerCase();
  if (!szukane) return null;
  const spis = pageOutline(body);
  const i = spis.findIndex((s2) => s2.heading.toLowerCase() === szukane);
  if (i === -1) return null;
  const linie = body.split("\n");
  const nast = spis.findIndex((s2, j) => j > i && s2.level <= spis[i].level);
  const koniec = nast === -1 ? linie.length : spis[nast].line - 1;
  return linie.slice(spis[i].line - 1, koniec).join("\n");
}

export function pageId(ctx: Ctx, slug: string): number | null {
  const s = normalizeSlugSafe(slug);
  if (!s) return null;
  const r = ctx.db.prepare("SELECT id FROM wiki_pages WHERE slug = ?").get(s) as
    | { id: number }
    | undefined;
  return r?.id ?? null;
}

/** A list of pages with a count of other people's revisions since the actor's last visit.
 *  Your own edits do not bump the counter - "what's new" means "what others changed". */
export function listPages(ctx: Ctx, actorId: number): WikiListItem[] {
  const rows = ctx.db
    .prepare(
      // LENGTH(p.body) rather than p.body: a list of pages needs the SIZE, not the content.
      // Previously every opening of the side panel read every page in full from the database
      // (megabytes) only to compute one number.
      // LENGTH counts characters, so for text with accented characters the result differs from
      // the byte count - and that is fine, because this is a "how big" signal, not an invoice.
      // SUBSTR(...,1,1200) gives material for one summary sentence, not the whole page: the
      // first paragraph lives at the beginning, and 1200 characters is about 1% of the largest
      // page in this instance. Reading whole bodies would take us right back to the problem
      // LENGTH() above solves.
      `SELECT p.slug, p.title, LENGTH(p.body) AS body_len, SUBSTR(p.body, 1, 1200) AS poczatek,
              p.parent_id, p.updated_by, p.updated_at,
              (SELECT COUNT(*) FROM wiki_reads wr2 WHERE wr2.page_id = p.id) AS readers,
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
      slug: string; title: string; body_len: number; poczatek: string; readers: number;
      parent_id: number | null;
      updated_by: number | null; updated_at: number; unseen: number;
    }>;
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    parentSlug: slugOf(ctx, r.parent_id),
    updatedBy: handleOf(ctx, r.updated_by),
    updatedAt: r.updated_at,
    bytes: r.body_len,
    summary: pageSummary(r.poczatek),
    readers: r.readers,
    unseen: r.unseen,
  }));
}

export type WikiHit = { slug: string; title: string; snippet: string; updatedAt: number };

/** Search over the title and the content. The wiki is public, so no ACL - every signed-in
 *  actor sees every page. The user's query goes in as an FTS phrase with prefixes, after
 *  escaping quotes (as in the message search). */
export function searchWiki(ctx: Ctx, text: string, limit = 20): WikiHit[] {
  const match = ftsMatch(text);
  if (match === null) return [];
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

/** The full content of a single revision - for PREVIEWING an old version in the history,
 *  without a destructive revert. The revision has to belong to the page with the given slug
 *  (revision ids are global, so without that condition an id from another page would be an
 *  oracle for somebody else's content... the wiki is public, but order is order). */
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

/** Restores the content of a revision to the page, recording it as a NEW revision - history
 *  is appended to, never rewritten, so a revert leaves a trace as well. */
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
      // A revert IS a deliberate overwrite: you point at a specific revision from this page's
      // history, and the revert itself leaves another revision, so nothing is lost.
      force: true,
    });
  });
}

/**
 * Deleting a page. An irreversible thing, so with three restrictions:
 *  - allowed only to the page's CREATOR or the instance admin (the wiki is shared for
 *    writing, but deleting somebody else's knowledge is not editing),
 *  - children do NOT die with the parent - they move into its place in the tree (the
 *    parent's parent), otherwise deleting a "directory" would take a whole section with it,
 *  - we return the content that disappears, so it can be restored from the response if this
 *    was a mistake; the revision history goes with the page and that is the price.
 */
export function deletePage(
  ctx: Ctx,
  input: { slug: string; actorId: number; isAdmin?: boolean },
): { slug: string; title: string; body: string; parentSlug: string | null; movedChildren: number } {
  return tx(ctx.db, () => {
    const row = ctx.db.prepare("SELECT * FROM wiki_pages WHERE slug = ?")
      .get(normalizeSlug(input.slug, "nazwa strony")) as PageRow | undefined;
    if (!row) throw notFound("strona", `nie ma strony wiki "${input.slug}"`);
    if (row.created_by !== input.actorId && !input.isAdmin) {
      throw forbidden(
        "nie_twoja_strona",
        `strone "${row.slug}" zalozyl @${handleOf(ctx, row.created_by) ?? "?"} - skasowac moze ` +
          `on albo admin instancji. Chcesz usunac tresc, nie strone? Zapisz ja pusta - historia zostanie.`,
      );
    }
    const moved = ctx.db.prepare("UPDATE wiki_pages SET parent_id = ? WHERE parent_id = ?")
      .run(row.parent_id, row.id);
    const parentSlug = slugOf(ctx, row.parent_id);
    // A page's attachments die with it. Without this the row in `files` is left without a
    // parent (wiki_page_id points at a page that does not exist), so the file disappears from
    // every interface while its bytes can still be downloaded by anybody who knows the id.
    deleteFilesOfWikiPage(ctx, row.id);
    ctx.db.prepare("DELETE FROM wiki_pages WHERE id = ?").run(row.id);
    onCommitted(ctx.db, () => ctx.bus.publish(allActorIds(ctx), { type: "wiki", slug: row.slug }));
    return {
      slug: row.slug,
      title: row.title,
      body: row.body,
      parentSlug,
      movedChildren: Number(moved.changes ?? 0),
    };
  });
}

export function wikiPageCount(ctx: Ctx): number {
  return (ctx.db.prepare("SELECT COUNT(*) AS n FROM wiki_pages").get() as { n: number }).n;
}

// Safe normalisation: for a READ we want "there is no such page" rather than a validation error.
function normalizeSlugSafe(raw: string): string | null {
  try {
    return normalizeSlug(raw, "nazwa strony");
  } catch {
    return null;
  }
}
