/**
 * Trasy dodane z feedbacku kanalu #nextIteration: wzmianki i digest przez API
 * (parytet dla agenta po HTTP), piny, dzierzawy zasobow, pliki z TTL/sensitive,
 * konfiguracja wake.
 */
import { digestFor } from "../../core/digest.ts";
import { mentionsOf } from "../../core/mentions.ts";
import { listPins, pin, unpin } from "../../core/pins.ts";
import { acquire, listLeases, release } from "../../core/leases.ts";
import {
  deleteFile,
  getFileInfo,
  listFiles,
  readFile,
  storeFile,
} from "../../core/files.ts";
import { clearWake, getWake, setWake } from "../../core/wake.ts";
import { badRequest, notFound } from "../../core/errors.ts";
import { assertCsrf, requireAuth } from "../auth.ts";
import { int, json, readJson, readRaw, str } from "../respond.ts";
import type { Router } from "../router.ts";

export function registerExtraRoutes(router: Router): void {
  // --- wzmianki i digest ---------------------------------------------------

  router.add("GET", "/api/mentions", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, {
      messages: mentionsOf(rc.ctx, actor.id, {
        afterId: int(rc.query.get("after") ?? undefined),
        limit: int(rc.query.get("limit") ?? undefined),
      }),
    });
  });

  router.add("GET", "/api/digest", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, { digest: digestFor(rc.ctx, actor.id) });
  });

  // --- piny ----------------------------------------------------------------

  router.add("POST", "/api/messages/:id/pin", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    json(res, 200, { pin: pin(rc.ctx, { messageId: Number(rc.params.id), actorId: actor.id }) });
  });

  router.add("DELETE", "/api/messages/:id/pin", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    unpin(rc.ctx, { messageId: Number(rc.params.id), actorId: actor.id });
    json(res, 200, { ok: true });
  });

  router.add("GET", "/api/conversations/:id/pins", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, {
      pins: listPins(rc.ctx, { conversationId: Number(rc.params.id), actorId: actor.id }),
    });
  });

  // --- dzierzawy zasobow ---------------------------------------------------
  // Zasob moze zawierac ukosniki (sciezki), wiec identyfikacja idzie przez cialo,
  // nie przez segment URL.

  router.add("POST", "/api/leases", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const result = acquire(rc.ctx, {
      resource: str(body.resource) ?? "",
      actorId: actor.id,
      ttlSec: int(body.ttlSec),
      sessionId: str(body.sessionId) ?? null,
      note: str(body.note) ?? null,
    });
    // 409 przy odmowie: klient odroznia "mam" od "trzyma kto inny" po statusie,
    // a w ciele dostaje kto i na jak dlugo - bez drugiego zapytania.
    json(res, result.granted ? 200 : 409, result);
  });

  router.add("POST", "/api/leases/release", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const result = release(rc.ctx, { resource: str(body.resource) ?? "", actorId: actor.id });
    json(res, result.released ? 200 : 409, result);
  });

  router.add("GET", "/api/leases", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { leases: listLeases(rc.ctx) });
  });

  // --- pliki ---------------------------------------------------------------

  router.add("POST", "/api/conversations/:id/files", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const nameHeader = req.headers["x-file-name"];
    if (typeof nameHeader !== "string" || !nameHeader.trim()) {
      throw badRequest("brak_nazwy", "podaj naglowek X-File-Name (URL-encoded)");
    }
    const data = await readRaw(req, rc.config.maxFileBytes);
    const result = storeFile(rc.ctx, rc.config.filesDir, {
      actorId: actor.id,
      conversationId: Number(rc.params.id),
      name: decodeURIComponent(nameHeader),
      data,
      mime: str(req.headers["content-type"]) ?? "application/octet-stream",
      maxBytes: rc.config.maxFileBytes,
      // Pusty/zerowy X-TTL to "bez TTL", ale dla pliku sensitive rdzen i tak
      // nada domyslny; przekazujemy undefined, nie 0.
      ttlSec: (int(req.headers["x-ttl"]) || undefined) ?? null,
      sensitive: req.headers["x-sensitive"] === "1",
      burn: req.headers["x-burn"] === "1",
      sessionId: str(req.headers["x-session-id"]) ?? null,
    });
    json(res, 201, result);
  });

  router.add("GET", "/api/files/:id", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const { info, data } = readFile(rc.ctx, rc.params.id, actor.id);
    res.writeHead(200, {
      "content-type": info.mime,
      "content-length": data.length,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(info.name)}`,
      "cache-control": "no-store",
    });
    res.end(data);
  });

  router.add("GET", "/api/files/:id/info", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const info = getFileInfo(rc.ctx, rc.params.id, actor.id);
    if (!info) throw notFound("plik", `nie ma pliku ${rc.params.id} (albo wygasl)`);
    json(res, 200, { file: info });
  });

  router.add("GET", "/api/conversations/:id/files", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, {
      files: listFiles(rc.ctx, { conversationId: Number(rc.params.id), actorId: actor.id }),
    });
  });

  router.add("DELETE", "/api/files/:id", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    deleteFile(rc.ctx, rc.params.id, actor.id);
    json(res, 200, { ok: true });
  });

  // --- wake ----------------------------------------------------------------
  // Samoobslugowe: aktor konfiguruje WLASNY punkt budzenia. Sekret jest pokazany
  // raz, w odpowiedzi - jak przy tokenach.

  router.add("GET", "/api/wake", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, { wake: getWake(rc.ctx, actor.id) });
  });

  router.add("PUT", "/api/wake", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const target = str(body.target);
    if (!target) throw badRequest("brak_target", "podaj target (URL webhooka)");
    let result;
    try {
      result = setWake(rc.ctx, actor.id, target, { allowLoopback: rc.config.allowLoopbackWake });
    } catch (err) {
      throw badRequest("zly_target", err instanceof Error ? err.message : String(err));
    }
    json(res, 200, result);
  });

  router.add("DELETE", "/api/wake", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    clearWake(rc.ctx, actor.id);
    json(res, 200, { ok: true });
  });
}
