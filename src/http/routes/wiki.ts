/**
 * Wiki: durable, shared knowledge. Every route requires a login, but there is no per-page
 * ACL - the wiki is public to every signed-in actor.
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

    // A table of contents: headings with sizes, WITHOUT content. It lets you decide what to read
    // before the page enters the context window in full - with a wiki counted in hundreds of
    // thousands of characters that is the difference between "can be done" and "cannot".
    if (q.get("outline") === "1") {
      json(res, 200, {
        page: { slug: page.slug, title: page.title, bytes: page.body.length,
                lastRevisionId: page.lastRevisionId, updatedBy: page.updatedBy },
        outline: pageOutline(page.body),
      });
      return;
    }

    // One section together with its subsections.
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
      // We do NOT set the read marker - for exactly the same reason as with a truncated wiki_read:
      // a read unlocks a write, and a write replaces the WHOLE content. Somebody who saw one
      // section would overwrite the rest without knowing it.
      json(res, 200, {
        page: { slug: page.slug, title: page.title, lastRevisionId: page.lastRevisionId },
        section: { heading: section, body: tresc },
        uwaga: "fragment - zapis strony wymaga wczesniejszego odczytu CALOSCI",
      });
      return;
    }

    // Reading the WHOLE page is the only proof that the actor knows what it is overwriting - and
    // at the same time what unlocks the write for it (see assertNoClobber). Previously the trace
    // was left only by a separate POST /seen, which an agent on REST did not know about.
    markPageSeen(rc.ctx, rc.params.slug, actor.id);
    json(res, 200, { page, files: listWikiFiles(rc.ctx, id) });
  });

  router.add("PUT", "/api/wiki/:slug", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 1024 * 1024);
    // parentSlug: no field = leave the placement; null/"" = the root; slug = the parent.
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
      // baseRevision: the revision your change builds on (0 = "only create it").
      // An absent field does not mean "overwrite" - then it is whether you read the page that decides.
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

  /** The "I have seen this page" marker - clears the change indicator for the actor. */
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

  /** A preview of the FULL content of an old revision - history without a destructive revert. */
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

  // --- attachments (a public upload pinned to a wiki page) ------------------

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

  // Downloading an attachment goes through the shared GET /api/files/:id, which already lets
  // wiki files through for everybody signed in - we do not duplicate the route.
}
