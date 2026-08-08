/**
 * Wiki: trwala, wspoldzielona wiedza. Wszystkie trasy wymagaja logowania, ale nie
 * maja ACL per strona - wiki jest publiczna dla kazdego zalogowanego aktora.
 */
import {
  getPage,
  listPages,
  pageHistory,
  pageId,
  revertPage,
  savePage,
  searchWiki,
} from "../../core/wiki.ts";
import { listWikiFiles, storeWikiFile } from "../../core/files.ts";
import { badRequest, notFound } from "../../core/errors.ts";
import { assertCsrf, requireAuth } from "../auth.ts";
import { int, json, readJson, readRaw, str } from "../respond.ts";
import type { Router } from "../router.ts";

export function registerWikiRoutes(router: Router): void {
  router.add("GET", "/api/wiki", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { pages: listPages(rc.ctx) });
  });

  router.add("GET", "/api/wiki/search", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, {
      hits: searchWiki(rc.ctx, rc.query.get("q") ?? "", int(rc.query.get("limit") ?? undefined)),
    });
  });

  router.add("GET", "/api/wiki/:slug", (_req, res, rc) => {
    requireAuth(rc);
    const page = getPage(rc.ctx, rc.params.slug);
    if (!page) throw notFound("strona", `nie ma strony wiki "${rc.params.slug}"`);
    const id = pageId(rc.ctx, rc.params.slug)!;
    json(res, 200, { page, files: listWikiFiles(rc.ctx, id) });
  });

  router.add("PUT", "/api/wiki/:slug", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024 * 1024);
    const page = savePage(rc.ctx, {
      slug: rc.params.slug,
      title: str(body.title) ?? rc.params.slug,
      body: str(body.body) ?? "",
      actorId: actor.id,
      note: str(body.note) ?? null,
    });
    json(res, 200, { page });
  });

  router.add("GET", "/api/wiki/:slug/history", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { revisions: pageHistory(rc.ctx, rc.params.slug) });
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
