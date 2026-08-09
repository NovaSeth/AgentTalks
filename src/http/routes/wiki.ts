/**
 * Wiki: trwala, wspoldzielona wiedza. Wszystkie trasy wymagaja logowania, ale nie
 * maja ACL per strona - wiki jest publiczna dla kazdego zalogowanego aktora.
 */
import {
  deletePage,
  getPage,
  getRevision,
  listPages,
  markPageSeen,
  pageHistory,
  pageId,
  pageOutline,
  pageSection,
  revertPage,
  savePage,
  searchWiki,
} from "../../core/wiki.ts";
import { listWikiFiles, storeWikiFile } from "../../core/files.ts";
import { badRequest, notFound } from "../../core/errors.ts";
import { assertCsrf, requireAuth } from "../auth.ts";
import { int, json, odrzucKoperteMultipart, readJson, readRaw, str } from "../respond.ts";
import type { Router } from "../router.ts";

export function registerWikiRoutes(router: Router): void {
  router.add("GET", "/api/wiki", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, { pages: listPages(rc.ctx, actor.id) });
  });

  router.add("GET", "/api/wiki/search", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, {
      hits: searchWiki(rc.ctx, rc.query.get("q") ?? "", int(rc.query.get("limit") ?? undefined)),
    });
  });

  router.add("GET", "/api/wiki/:slug", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    const page = getPage(rc.ctx, rc.params.slug);
    if (!page) throw notFound("strona", `nie ma strony wiki "${rc.params.slug}"`);
    const id = pageId(rc.ctx, rc.params.slug)!;
    const q = new URL(req.url ?? "/", "http://x").searchParams;

    // Spis tresci: naglowki z rozmiarem, BEZ tresci. Pozwala zdecydowac, co
    // czytac, zanim strona wejdzie do okna kontekstu w calosci - przy wiki
    // liczonej w setkach tysiecy znakow to roznica miedzy "da sie" a "nie da sie".
    if (q.get("outline") === "1") {
      json(res, 200, {
        page: { slug: page.slug, title: page.title, bytes: page.body.length,
                lastRevisionId: page.lastRevisionId, updatedBy: page.updatedBy },
        outline: pageOutline(page.body),
      });
      return;
    }

    // Jedna sekcja razem z podsekcjami.
    const section = q.get("section");
    if (section !== null) {
      const tresc = pageSection(page.body, section);
      if (tresc === null) {
        throw notFound(
          "sekcja",
          `strona "${page.slug}" nie ma sekcji "${section}". Spis: ` +
            `GET /api/wiki/${page.slug}?outline=1`,
        );
      }
      // Znacznika odczytu NIE stawiamy - dokladnie z tego samego powodu, co przy
      // przycietym wiki_read: odczyt odblokowuje zapis, a zapis podmienia CALA
      // tresc. Kto widzial jedna sekcje, nadpisalby reszte, nie wiedzac o tym.
      json(res, 200, {
        page: { slug: page.slug, title: page.title, lastRevisionId: page.lastRevisionId },
        section: { heading: section, body: tresc },
        uwaga: "fragment - zapis strony wymaga wczesniejszego odczytu CALOSCI",
      });
      return;
    }

    // Odczyt CALEJ strony jest jedynym dowodem, ze aktor wie, co nadpisuje -
    // i zarazem tym, co odblokowuje mu zapis (patrz assertNoClobber). Wczesniej
    // slad zostawial dopiero osobny POST /seen, ktorego agent na REST nie znal.
    markPageSeen(rc.ctx, rc.params.slug, actor.id);
    json(res, 200, { page, files: listWikiFiles(rc.ctx, id) });
  });

  router.add("PUT", "/api/wiki/:slug", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024 * 1024);
    // parentSlug: brak pola = nie ruszaj polozenia; null/"" = korzen; slug = rodzic.
    const parentSlug = !("parentSlug" in body)
      ? undefined
      : ((str(body.parentSlug) ?? "").trim() || null);
    const page = savePage(rc.ctx, {
      slug: rc.params.slug,
      title: str(body.title) ?? rc.params.slug,
      body: str(body.body) ?? "",
      actorId: actor.id,
      note: str(body.note) ?? null,
      parentSlug,
      // baseRevision: rewizja, na ktorej opierasz zmiane (0 = "tylko zaloz").
      // Brak pola nie znaczy "nadpisz" - wtedy decyduje to, czy strone czytales.
      baseRevision: "baseRevision" in body ? (int(body.baseRevision) ?? null) : undefined,
      force: body.force === true,
    });
    json(res, 200, { page });
  });

  router.add("DELETE", "/api/wiki/:slug", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    json(res, 200, {
      deleted: deletePage(rc.ctx, {
        slug: rc.params.slug,
        actorId: actor.id,
        isAdmin: actor.isAdmin,
      }),
    });
  });

  /** Znacznik "widzialem te strone" - zeruje wskaznik zmian dla aktora. */
  router.add("POST", "/api/wiki/:slug/seen", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    markPageSeen(rc.ctx, rc.params.slug, actor.id);
    json(res, 200, { ok: true });
  });

  router.add("GET", "/api/wiki/:slug/history", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { revisions: pageHistory(rc.ctx, rc.params.slug) });
  });

  /** Podglad PELNEJ tresci starej rewizji - historia bez destrukcyjnego revertu. */
  router.add("GET", "/api/wiki/:slug/revisions/:id", (_req, res, rc) => {
    requireAuth(rc);
    const rev = getRevision(rc.ctx, rc.params.slug, Number(rc.params.id));
    if (!rev) throw notFound("rewizja", `nie ma rewizji ${rc.params.id} dla strony "${rc.params.slug}"`);
    json(res, 200, { revision: rev });
  });

  router.add("POST", "/api/wiki/:slug/revert", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024);
    const revisionId = int(body.revisionId);
    if (revisionId === undefined) throw badRequest("brak_rewizji", "podaj revisionId");
    json(res, 200, {
      page: revertPage(rc.ctx, { slug: rc.params.slug, revisionId, actorId: actor.id }),
    });
  });

  // --- zalaczniki (publiczny upload przypiety do strony wiki) ---------------

  router.add("POST", "/api/wiki/:slug/files", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const id = pageId(rc.ctx, rc.params.slug);
    if (id === null) throw notFound("strona", `nie ma strony wiki "${rc.params.slug}" - zaloz ja najpierw`);
    const nameHeader = req.headers["x-file-name"];
    if (typeof nameHeader !== "string" || !nameHeader.trim()) {
      throw badRequest("brak_nazwy", "podaj naglowek X-File-Name (URL-encoded)");
    }
    const data = await readRaw(req, rc.config.maxFileBytes);
    odrzucKoperteMultipart(data, str(req.headers["content-type"]));
    const file = storeWikiFile(rc.ctx, rc.config.filesDir, {
      actorId: actor.id,
      wikiPageId: id,
      name: decodeURIComponent(nameHeader),
      data,
      mime: str(req.headers["content-type"]) ?? "application/octet-stream",
      maxBytes: rc.config.maxFileBytes,
    });
    json(res, 201, { file });
  });

  router.add("GET", "/api/wiki/:slug/files", (_req, res, rc) => {
    requireAuth(rc);
    const id = pageId(rc.ctx, rc.params.slug);
    if (id === null) throw notFound("strona", `nie ma strony wiki "${rc.params.slug}"`);
    json(res, 200, { files: listWikiFiles(rc.ctx, id) });
  });

  // Pobranie zalacznika idzie przez wspolny GET /api/files/:id, ktory juz
  // przepuszcza pliki wiki dla kazdego zalogowanego - nie dublujemy trasy.
}
