/**
 * Routes added from #nextIteration channel feedback: mentions and the digest over the API
 * (parity for an agent on HTTP), pins, resource leases, files with TTL/sensitive, and wake
 * configuration.
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
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
} from "../../core/notifications.ts";
import { badRequest, notFound } from "../../core/errors.ts";
import { MAX_AVATAR_BYTES, bajtyAwatara, pobierzAwatar, ustawAwatar, usunAwatar } from "../../core/awatary.ts";
import { assertCsrf, requireAuth } from "../auth.ts";
import { int, intDodatni, json, odrzucKoperteMultipart, readJson, readRaw, str } from "../respond.ts";
import type { Router } from "../router.ts";

// MIME types a browser can EXECUTE in the application's origin (a script, HTML, an SVG with
// a script). A wiki attachment is public and cross-user, so a file with such a type, opened
// directly in a tab, would be stored XSS. When serving we reduce them to an inert
// octet-stream; the file name stays.
const ACTIVE_MIME =
  /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/(?:x-)?javascript|text\/javascript|text\/xml|application\/xml)\b/i;

/** The file name from a header. `decodeURIComponent` throws a URIError on bad %-encoding
/**  (say "report%zz.txt"), and an unhandled URIError is a 500 - that is, the server reports
/**  its own failure where it was the client that sent junk. */
function dekodujNazwe(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw badRequest(
      "zla_nazwa",
      "naglowek X-File-Name ma nieprawidlowe kodowanie procentowe (uzyj encodeURIComponent)",
    );
  }
}

export function registerExtraRoutes(router: Router): void {
  // --- the notification centre ---------------------------------------------
  // One place instead of three half-measures: mentions, DMs, reactions to my posts and changes
  // to pages I co-authored. Each carries a TARGET to click.

  router.add("GET", "/api/notifications", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const unreadOnly = ["1", "true", "yes"].includes(
      String(rc.query.get("unread") ?? "").toLowerCase(),
    );
    json(res, 200, {
      notifications: listNotifications(rc.ctx, actor.id, {
        limit: int(rc.query.get("limit") ?? undefined),
        unreadOnly,
      }),
      unread: unreadNotificationCount(rc.ctx, actor.id),
    });
  });

  /** Ticking off: without `ids` it means "I have seen all of them". */
  router.add("POST", "/api/notifications/read", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 8192);
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : null;
    const changed = markNotificationsRead(rc.ctx, actor.id, ids);
    json(res, 200, { changed, unread: unreadNotificationCount(rc.ctx, actor.id) });
  });

  // --- mentions and the digest ---------------------------------------------

  router.add("GET", "/api/mentions", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, {
      messages: mentionsOf(rc.ctx, actor.id, {
        afterId: intDodatni(rc.query.get("after") ?? undefined),
        limit: intDodatni(rc.query.get("limit") ?? undefined),
      }),
    });
  });

  router.add("GET", "/api/digest", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const digest = digestFor(rc.ctx, actor.id);
    // ?summary=1 returns the counter alone. The side panel asks for the digest every 30 s just
    // to show ONE NUMBER - and the full response is tens of kilobytes of message content. The
    // full digest is fetched only when the summary is opened.
    const samoPodsumowanie = ["1", "true", "yes"].includes(
      String(rc.query.get("summary") ?? "").toLowerCase(),
    );
    if (samoPodsumowanie) {
      json(res, 200, {
        digest: digest ? { count: digest.count, sinceId: digest.sinceId } : null,
      });
      return;
    }
    json(res, 200, { digest });
  });

  // --- pins ----------------------------------------------------------------

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

  // --- resource leases -----------------------------------------------------
  // A resource may contain slashes (paths), so identification goes through the body rather
  // than through a URL segment.

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
    // A 409 on refusal: the client tells "I have it" from "somebody else holds it" by the status,
    // and gets who and for how long in the body - without a second query.
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


  // --- avatars -------------------------------------------------------------

  /** Your own avatar: YOU SEND THE BYTES, not a URL. The server fetches nothing from the network
  /**  on anybody's request - see the reasoning in core/awatary.ts. */
  router.add("PUT", "/api/me/avatar", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const data = await readRaw(req, MAX_AVATAR_BYTES);
    odrzucKoperteMultipart(data, str(req.headers["content-type"]));
    const a = ustawAwatar(rc.ctx, rc.config.filesDir, actor.id, data,
                          str(req.headers["content-type"]) ?? undefined);
    json(res, 200, { avatar: { hash: a.hash, mime: a.mime },
                     url: `/api/actors/${actor.id}/avatar?v=${a.hash}` });
  });

  router.add("DELETE", "/api/me/avatar", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    usunAwatar(rc.ctx, rc.config.filesDir, actor.id);
    json(res, 200, { ok: true });
  });

  /** Any actor's avatar - everybody signed in sees it, which is the point.
  /**  The URL carries a content fingerprint (`?v=`), so an avatar change is visible immediately
  /**  despite long caching. */
  router.add("GET", "/api/actors/:id/avatar", (_req, res, rc) => {
    requireAuth(rc);
    const a = pobierzAwatar(rc.ctx, Number(rc.params.id));
    if (!a) throw notFound("awatar", `aktor ${rc.params.id} nie ma awatara`);
    let data: Buffer;
    try { data = bajtyAwatara(rc.config.filesDir, a); }
    catch { throw notFound("awatar", "plik awatara zniknal z dysku"); }
    res.writeHead(200, {
      // The format is verified by CONTENT at write time and limited to raster formats, so the type
      // can be returned as it is - otherwise the avatar would not be an image but a downloaded
      // file.
      "content-type": a.mime,
      "content-length": data.length,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "public, max-age=31536000, immutable",
    });
    res.end(data);
  });

  // --- files ---------------------------------------------------------------

  router.add("POST", "/api/conversations/:id/files", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    const nameHeader = req.headers["x-file-name"];
    if (typeof nameHeader !== "string" || !nameHeader.trim()) {
      throw badRequest("brak_nazwy", "podaj naglowek X-File-Name (URL-encoded)");
    }
    const data = await readRaw(req, rc.config.maxFileBytes);
    odrzucKoperteMultipart(data, str(req.headers["content-type"]));
    const result = storeFile(rc.ctx, rc.config.filesDir, {
      actorId: actor.id,
      conversationId: Number(rc.params.id),
      name: dekodujNazwe(nameHeader),
      data,
      mime: str(req.headers["content-type"]) ?? "application/octet-stream",
      maxBytes: rc.config.maxFileBytes,
      // An empty/zero X-TTL means "no TTL", but for a sensitive file the core assigns the default
      // anyway; we pass undefined, not 0.
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
    // Layered defence against stored XSS from an uploaded file: (1) an inert type for active
    // MIME types, (2) a forced download instead of rendering, (3) no type sniffing by the
    // browser, (4) a CSP sandbox - even a file opened in a tab will not run a script in our
    // origin (where the session cookie and the UI live).
    const safeMime = ACTIVE_MIME.test(info.mime) ? "application/octet-stream" : info.mime;
    res.writeHead(200, {
      "content-type": safeMime,
      "content-length": data.length,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(info.name)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
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
  // Self-service: an actor configures ITS OWN wake-up point. The secret is shown once, in the
  // response - as with tokens.

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
