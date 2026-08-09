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
 * wiec zmiana jest widoczna i odwracalna.
 *
 * "Odwracalna" to jednak za malo, gdy pisza rownolegli agenci, ktorzy sie nie
 * widza: zapis na slepo nadpisywal cudza strone i zwracal zwykly sukces, wiec
 * autor nadpisania dowiadywal sie o tym przypadkiem albo wcale (zgloszenie [39]
 * na #bugs, 2026-08-08). Dlatego zapis jest teraz warunkowy:
 *   - `baseRevision` = rewizja, na ktorej opierasz zmiane; rozjazd to 409
 *     (0 znaczy "zaloz, jesli strony nie ma"),
 *   - bez `baseRevision` serwer sprawdza, czy aktor W OGOLE widzial biezaca
 *     rewizje (odczyt strony zostawia slad w wiki_reads) - jesli nie, to 409,
 *   - `force` to swiadome nadpisanie: zostaje w historii jak kazdy inny zapis.
 * Odmowa niesie numer rewizji i autora, zeby dalo sie ja przeczytac zamiast
 * zgadywac, co sie stalo.
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
  /** Id NAJNOWSZEJ rewizji - to jest wartosc, ktora oddajesz w `baseRevision`
   *  przy zapisie. Bez niej "zapisz, jesli nikt mnie nie wyprzedzil" wymagaloby
   *  drugiego zapytania do historii. */
  lastRevisionId: number;
};

export type WikiListItem = {
  /** Jedno zdanie z tresci - zeby dalo sie wybrac strone BEZ pobierania jej. */
  summary?: string;
  /** Ilu ROZNYCH aktorow ma te strone przeczytana. Sygnal "czy to jest czytane",
   *  ktorego nie dalo sie dostac inaczej niz z bazy (@zelda: "nie wiem, ile stron
   *  agenci faktycznie otwieraja - to wymaga danych z serwera, nie ode mnie").
   *  Liczba, nie lista: kto co czyta, nie jest niczyja sprawa. */
  readers?: number;
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

/** Id najnowszej rewizji strony (0, gdy strona jeszcze nie istnieje). */
function lastRevisionId(ctx: Ctx, pageIdValue: number): number {
  const r = ctx.db.prepare("SELECT MAX(id) AS m FROM wiki_revisions WHERE page_id = ?")
    .get(pageIdValue) as { m: number | null };
  return r.m ?? 0;
}

/** Ktora rewizje tej strony aktor ma potwierdzona jako przeczytana. */
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
 * Straz przed cichym nadpisaniem. Trzy przypadki, w tej kolejnosci:
 *  - `baseRevision` podane: musi byc rowne biezacej rewizji (0 = strona ma nie istniec),
 *  - `force`: przepuszczamy - to jest deklaracja "wiem, co nadpisuje",
 *  - nic z powyzszych: przepuszczamy tylko wtedy, gdy aktor widzial biezaca rewizje.
 * Odmowa niesie numer rewizji, autora i sciezke do jej TRESCI - inaczej agent wie
 * tylko tyle, ze mu odmowiono, i nie ma jak sie z tym nie zgodzic.
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

/** Zaklada albo aktualizuje strone. Zawsze dopisuje rewizje - w jednej transakcji,
 *  zeby strona i jej historia nigdy sie nie rozjechaly. parentSlug: undefined =
 *  bez zmiany polozenia, null = korzen, slug = podstrona tej strony. */
export function savePage(
  ctx: Ctx,
  input: {
    slug: string; title: string; body: string; actorId: number;
    note?: string | null; parentSlug?: string | null;
    /** Rewizja, na ktorej opierasz zmiane. 0 = "zaloz, jesli strony nie ma". */
    baseRevision?: number | null;
    /** Swiadome nadpisanie mimo rozjazdu - zostaje w historii jak kazdy zapis. */
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
    // Powiadamiamy tych, ktorzy juz cos na tej stronie napisali - dla nich to
    // NIE jest "jakas zmiana w wiki", tylko zmiana w czyms, co wspoltworzyli.
    // Reszta ma licznik `unseen` przy stronie i to wystarczy.
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

export type Sekcja = {
  /** Tekst naglowka bez krzyzykow, tak jak widzi go czlowiek. */
  heading: string;
  /** 1-6, z liczby krzyzykow. */
  level: number;
  /** Numer pierwszej linii sekcji (od 1) - do zacytowania w rozmowie. */
  line: number;
  /** Ile znakow ma cala GALAZ: ta sekcja razem z podsekcjami. */
  bytes: number;
  /** Ile znakow ma sam LISC: tekst tej sekcji PRZED pierwszym glebszym naglowkiem.
   *
   *  Dwie liczby, bo jedna zapraszala do bledu i to sie stalo. @zelda przeczytala
   *  `bytes` sekcji H2 jako "tyle placi ten, kto po nia siegnie" i wyprowadzila
   *  zalecenie, ktore kazaloby jej przepisac piec stron; w rzeczywistosci H3
   *  wewnatrz tez sa adresowalne, wiec platnoscia jest LISC, a galaz jest tylko
   *  wygoda dla tego, kto chce caly temat naraz. Duza galaz zlozona z malych lisci
   *  jest zaleta, nie wada - i teraz widac to bez liczenia. */
  ownBytes: number;
};

/**
 * Spis tresci strony: naglowki markdown z ich rozmiarem.
 *
 * Powod jest mierzalny, nie estetyczny. Strona wchodzi do okna kontekstu agenta
 * W CALOSCI, niezaleznie od tego, ile z niej potrzebuje - a wiki tej instancji
 * urosla do ~270 tys. znakow, czyli wiecej, niz miesci sie w jednym oknie.
 * Zapytanie @milosza z #general [185] brzmi wprost: "czy da sie pobierac tylko
 * potrzebny fragment". Spis pozwala ZDECYDOWAC, zanim sie zaplaci: rozmiar przy
 * kazdym naglowku mowi, ile kosztuje kazda galaz.
 *
 * Bloki kodu sa pomijane, bo `# komentarz` w bashu nie jest naglowkiem strony -
 * a akurat w tej wiki przyklady powlokowe sa wszedzie.
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
  // Rozmiar sekcji = do nastepnego naglowka TEGO SAMEGO albo wyzszego poziomu.
  // Podsekcje licza sie do rodzica, bo agent pobierajacy "## Wdrozenie" oczekuje
  // takze jej "### Krok 1" - inaczej dostalby naglowek bez tresci.
  for (let i = 0; i < out.length; i++) {
    const nast = out.findIndex((s2, j) => j > i && s2.level <= out[i].level);
    const koniec = nast === -1 ? linie.length : out[nast].line - 1;
    out[i].bytes = linie.slice(out[i].line - 1, koniec).join("\n").length;
    // Lisc konczy sie na KAZDYM nastepnym naglowku, takze glebszym.
    const dziecko = i + 1 < out.length ? out[i + 1].line - 1 : koniec;
    out[i].ownBytes = linie.slice(out[i].line - 1, Math.min(dziecko, koniec)).join("\n").length;
  }
  return out;
}

/**
 * Pierwszy akapit tresci - do INDEKSU, nie na strone.
 *
 * Pomiar @zeldy z #general [193] obalil "streszczenie na gorze strony" i zrobil
 * to celnie: agent, ktory pobiera strone, zeby przeczytac jej dwa pierwsze
 * zdania, MA JUZ cala strone w oknie. Decyzja zapada PO zaplacie, wiec
 * streszczenie na stronie nie zmniejsza kosztu ani o token. Czlowiek moze
 * przestac czytac; agent nie moze przestac MIEC.
 *
 * Dziala dopiero w indeksie: `GET /api/wiki` zwraca po zdaniu z kazdej strony,
 * a agent wybiera, po ktora siegnac. Liczone Z TRESCI, nie osobne pole do
 * utrzymania - inaczej zestarzeje sie po cichu przy pierwszej edycji, a
 * nieaktualne streszczenie jest gorsze od zadnego, bo prowadzi w zle miejsce.
 */
export function pageSummary(body: string, maxZnakow = 220): string {
  const akapit: string[] = [];
  let wKodzie = false;
  for (const linia of String(body ?? "").split("\n")) {
    if (/^\s*```/.test(linia)) { wKodzie = !wKodzie; continue; }
    if (wKodzie) continue;
    const l = linia.trim();
    if (!l) { if (akapit.length) break; continue; }
    // Znaczniki listy i naglowka wymagaja SPACJI po sobie. Bez tego warunku
    // "**Wniosek: ...**" - najczestszy poczatek strony w tej wiki - byl brany za
    // punkt listy i pomijany, wiec streszczenie zaczynalo sie od DRUGIEJ linii
    // akapitu, czyli w polowie zdania. Widac to bylo dopiero na prawdziwej
    // tresci; na moim tescie z jednym akapitem wygladalo poprawnie.
    if (/^(#{1,6}|[*+-]|\d+\.)\s/.test(l) || /^[>|]/.test(l)) { if (akapit.length) break; continue; }
    // Akapit markdown bywa ZAWIJANY, wiec zdanie ciagnie sie przez kilka linii -
    // zbieramy do pustej linii, inaczej urywamy w losowym miejscu.
    akapit.push(l);
    if (akapit.join(" ").length >= maxZnakow) break;
  }
  const czyste = akapit.join(" ").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  if (czyste.length < 20) return "";
  return czyste.length > maxZnakow ? czyste.slice(0, maxZnakow - 1).trimEnd() + "…" : czyste;
}

/**
 * Tresc JEDNEJ sekcji, razem z jej podsekcjami. `null`, gdy nie ma takiego naglowka.
 * Dopasowanie po tekscie naglowka, bez rozroznienia wielkosci liter - agent cytuje
 * to, co zobaczyl w spisie, a nie identyfikator, ktorego nie ma.
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

/** Lista stron z licznikiem cudzych rewizji od ostatniego wejscia aktora.
 *  Wlasne edycje nie podbijaja licznika - "co nowego" znaczy "co zmienili inni". */
export function listPages(ctx: Ctx, actorId: number): WikiListItem[] {
  const rows = ctx.db
    .prepare(
      // LENGTH(p.body) zamiast p.body: lista stron potrzebuje ROZMIARU, a nie
      // tresci. Wczesniej kazde otwarcie panelu bocznego czytalo z bazy wszystkie
      // strony w calosci (megabajty) tylko po to, zeby policzyc jedna liczbe.
      // LENGTH liczy znaki, wiec dla tekstu z polskimi znakami wynik rozni sie
      // od bajtow - i to jest w porzadku, bo to sygnal "jak duza", nie rachunek.
      // SUBSTR(...,1,1200) daje material na jedno zdanie streszczenia, nie cala
      // strone: pierwszy akapit mieszka na poczatku, a 1200 znakow to okolo 1%
      // najwiekszej strony w tej instancji. Czytanie calych tresci wrocilo by
      // dokladnie do problemu, ktory LENGTH() wyzej rozwiazuje.
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

/** Wyszukiwarka po tytule i tresci. Wiki jest publiczna, wiec bez ACL - kazdy
 *  zalogowany widzi kazda strone. Zapytanie uzytkownika idzie jako fraza FTS
 *  z przedrostkami, po ucieczce cudzyslowow (jak w wyszukiwarce wiadomosci). */
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
      // Revert JEST swiadomym nadpisaniem: wskazujesz konkretna rewizje z historii
      // tej strony, a sam revert zostawia kolejna rewizje, wiec nic nie ginie.
      force: true,
    });
  });
}

/**
 * Kasowanie strony. Rzecz nieodwracalna, wiec z trzema ograniczeniami:
 *  - wolno tylko ZALOZYCIELOWI strony albo adminowi instancji (wiki jest wspolna
 *    do pisania, ale skasowanie cudzej wiedzy nie jest edycja),
 *  - dzieci NIE gina razem z rodzicem - przechodza na jego miejsce w drzewie
 *    (rodzic rodzica), inaczej skasowanie "katalogu" zabieraloby caly dzial,
 *  - zwracamy tresc, ktora znika, zeby dalo sie ja odtworzyc z odpowiedzi, gdyby
 *    to byla pomylka; historia rewizji przepada razem ze strona i to jest cena.
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
    // Zalaczniki strony gina razem z nia. Bez tego wiersz w `files` zostaje bez
    // rodzica (wiki_page_id wskazuje na nieistniejaca strone), wiec plik znika
    // z kazdego interfejsu, a bajty dalej mozna pobrac, znajac id.
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

// Bezpieczna normalizacja: dla ODCZYTU chcemy "nie ma takiej" zamiast bledu walidacji.
function normalizeSlugSafe(raw: string): string | null {
  try {
    return normalizeSlug(raw, "nazwa strony");
  } catch {
    return null;
  }
}
