/**
 * Files sent through the channel.
 *
 * Feedback from #nextIteration (332c7e42): private photographs passed through the
 * prototype's shared directory and had to be cleaned up by hand. Hence three mechanisms:
 *   ttl        - the file disappears by itself after a time,
 *   sensitive  - a file marked as sensitive gets a default TTL and is not listed outside
 *                the conversation it was sent in,
 *   burn       - the file disappears after the first download by somebody other than the author.
 *
 * Access to a file = access to the conversation it was sent in. A file with no conversation
 * is visible to its author only.
 *
 * The bytes sit on disk under a random name (the id), the metadata in the database.
 * Deletion writes deleted_at first and removes the bytes afterwards - the other order would
 * leave an entry pointing at a non-existent file as a normal state.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { Ctx } from "./ctx.ts";
import { assertCanPost, canRead } from "./conversations.ts";
import { badRequest, forbidden, notFound, tooLarge } from "./errors.ts";
import { postMessage, type Message } from "./messages.ts";

export const SENSITIVE_DEFAULT_TTL = 24 * 3600;

export type FileInfo = {
  id: string;
  actorId: number;
  conversationId: number | null;
  wikiPageId: number | null;
  messageId: number | null;
  name: string;
  size: number;
  sha256: string;
  mime: string;
  createdAt: number;
  expiresAt: number | null;
  sensitive: boolean;
  burn: boolean;
  downloads: number;
};

type FileRow = {
  id: string; actor_id: number; conversation_id: number | null; message_id: number | null;
  wiki_page_id: number | null;
  name: string; size: number; sha256: string; mime: string; path: string;
  created_at: number; expires_at: number | null; sensitive: number; burn: number;
  downloads: number; deleted_at: number | null;
};

const toInfo = (r: FileRow): FileInfo => ({
  id: r.id,
  actorId: r.actor_id,
  conversationId: r.conversation_id,
  wikiPageId: r.wiki_page_id,
  messageId: r.message_id,
  name: r.name,
  size: r.size,
  sha256: r.sha256,
  mime: r.mime,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  sensitive: r.sensitive === 1,
  burn: r.burn === 1,
  downloads: r.downloads,
});

function safeName(raw: string): string {
  // basename + filtering out path junk: the file name comes from the client and has no
  // business influencing WHERE the file lands.
  const name = basename(String(raw ?? "").trim()).replace(/[\x00-\x1f]/g, "");
  return name && name !== "." && name !== ".." ? name.slice(0, 200) : "plik";
}

export function storeFile(
  ctx: Ctx,
  filesDir: string,
  input: {
    actorId: number;
    conversationId: number;
    name: string;
    data: Buffer;
    mime?: string;
    maxBytes: number;
    ttlSec?: number | null;
    sensitive?: boolean;
    burn?: boolean;
    sessionId?: string | null;
  },
): { file: FileInfo; message: Message } {
  // The write permission BEFORE size validation (validation lives in persistBytes): we do not
  // want to answer "too big" for a channel you are not allowed to write to anyway.
  assertCanPost(ctx, input.conversationId, input.actorId);

  const sensitive = input.sensitive === true;
  // A sensitive file without a SENSIBLE TTL gets the default. `?? ` is not enough: ttl=0 (or
  // an empty X-TTL header turned into 0) is not "here is a TTL" but "no TTL" - and
  // "sensitive and eternal" is exactly the combination that hurt in the prototype. So we
  // treat every ttl <= 0 as absent.
  const explicitTtl = input.ttlSec && input.ttlSec > 0 ? Math.trunc(input.ttlSec) : null;
  const ttl = explicitTtl ?? (sensitive ? SENSITIVE_DEFAULT_TTL : null);

  const { id, name } = persistBytes(ctx, filesDir, {
    actorId: input.actorId,
    conversationId: input.conversationId,
    wikiPageId: null,
    name: input.name,
    data: input.data,
    mime: input.mime,
    maxBytes: input.maxBytes,
    ttl,
    sensitive,
    burn: input.burn === true,
  });

  const human = humanSize(input.data.length);
  const message = postMessage(ctx, {
    conversationId: input.conversationId,
    actorId: input.actorId,
    body: `${name} (${human})${sensitive ? " [wrazliwy]" : ""}${input.burn ? " [znika po pobraniu]" : ""}`,
    kind: "file",
    sessionId: input.sessionId ?? null,
    meta: { fileId: id, name, size: input.data.length },
  });
  ctx.db.prepare("UPDATE files SET message_id = ? WHERE id = ?").run(message.id, id);

  return { file: getFileInfo(ctx, id, input.actorId)!, message };
}

/** A file's metadata, if the actor is allowed to see it. A wiki attachment (wiki_page_id) is
 *  public - every signed-in actor sees it, because the wiki is shared. */
export function getFileInfo(ctx: Ctx, id: string, actorId: number): FileInfo | null {
  const row = ctx.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
  if (!row || row.deleted_at) return null;
  if (row.expires_at && row.expires_at <= ctx.now()) {
    deleteFileRow(ctx, row);
    return null;
  }
  const allowed = row.actor_id === actorId
    || row.wiki_page_id !== null
    || (row.conversation_id !== null && canRead(ctx, row.conversation_id, actorId));
  if (!allowed) return null;
  return toInfo(row);
}

/**
 * An attachment to a wiki page: a file in a PUBLIC place, not in one conversation. It does
 * not post a message (the wiki is not a channel) and has no TTL/burn - durable knowledge is
 * meant to last. Access: everybody signed in, because the wiki is shared.
 */
export function storeWikiFile(
  ctx: Ctx,
  filesDir: string,
  input: { actorId: number; wikiPageId: number; name: string; data: Buffer; mime?: string;
           maxBytes: number },
): FileInfo {
  const { id } = persistBytes(ctx, filesDir, {
    actorId: input.actorId,
    conversationId: null,
    wikiPageId: input.wikiPageId,
    name: input.name,
    data: input.data,
    mime: input.mime,
    maxBytes: input.maxBytes,
    ttl: null,
    sensitive: false,
    burn: false,
  });
  return getFileInfo(ctx, id, input.actorId)!;
}

/** Files attached to a wiki page. */
export function listWikiFiles(ctx: Ctx, wikiPageId: number): FileInfo[] {
  const rows = ctx.db
    .prepare("SELECT * FROM files WHERE wiki_page_id = ? AND deleted_at IS NULL ORDER BY created_at")
    .all(wikiPageId) as FileRow[];
  return rows.map(toInfo);
}

/**
 * Fetching the bytes. burn: the file disappears after the first download by a NON-author -
 * the author can check their own file without burning it.
 */
export function readFile(
  ctx: Ctx,
  id: string,
  actorId: number,
): { info: FileInfo; data: Buffer } {
  const info = getFileInfo(ctx, id, actorId);
  if (!info) throw notFound("plik", `nie ma pliku ${id} (albo wygasl)`);
  const row = ctx.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow;
  if (!existsSync(row.path)) {
    deleteFileRow(ctx, row);
    throw notFound("plik", `plik ${id} znikl z dysku`);
  }
  const data = readFileSync(row.path);
  ctx.db.prepare("UPDATE files SET downloads = downloads + 1 WHERE id = ?").run(id);
  if (info.burn && actorId !== info.actorId) {
    deleteFileRow(ctx, row);
  }
  return { info, data };
}

export function deleteFile(ctx: Ctx, id: string, actorId: number): void {
  const row = ctx.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
  if (!row || row.deleted_at) return;
  if (row.actor_id !== actorId) throw forbidden("nie_autor", "tylko autor moze skasowac plik");
  deleteFileRow(ctx, row);
}

/** Files visible to an actor in a given conversation. */
export function listFiles(ctx: Ctx, q: { conversationId: number; actorId: number }): FileInfo[] {
  if (!canRead(ctx, q.conversationId, q.actorId)) return [];
  sweepExpired(ctx);
  const rows = ctx.db
    .prepare(
      "SELECT * FROM files WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at",
    )
    .all(q.conversationId) as FileRow[];
  return rows.map(toInfo);
}

/**
 * Deleting the attachments of a deleted message. Without this, "delete" would mean "stop
 * showing it in a list": the message row loses its content, but the bytes stay on disk and
 * are fetchable through GET /api/files/:id, because that route asks about a file, not about
 * the message it hangs from.
 */
export function deleteFilesOfMessage(ctx: Ctx, messageId: number): number {
  const rows = ctx.db
    .prepare("SELECT * FROM files WHERE message_id = ? AND deleted_at IS NULL")
    .all(messageId) as FileRow[];
  for (const row of rows) deleteFileRow(ctx, row);
  return rows.length;
}

/** The same for a wiki page: deleting a page must not leave its attachments as orphaned
 *  bytes that nobody will see in any interface any more, and that can still be downloaded
 *  by anybody who knows the id. */
export function deleteFilesOfWikiPage(ctx: Ctx, wikiPageId: number): number {
  const rows = ctx.db
    .prepare("SELECT * FROM files WHERE wiki_page_id = ? AND deleted_at IS NULL")
    .all(wikiPageId) as FileRow[];
  for (const row of rows) deleteFileRow(ctx, row);
  return rows.length;
}

/**
 * Cleaning up the expired. Called lazily on listing and periodically from the server.
 *
 * The second pass (orphaned bytes) exists because `deleteFileRow` may fail to remove the
 * file from disk - and then the comment "the next sweep will try again" has to be true
 * rather than consoling. Without that pass nobody would try.
 */
export function sweepExpired(ctx: Ctx): number {
  const rows = ctx.db
    .prepare("SELECT * FROM files WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?")
    .all(ctx.now()) as FileRow[];
  for (const row of rows) deleteFileRow(ctx, row);

  // Orphans: a row marked as deleted with the file still on disk.
  const sieroty = ctx.db
    .prepare("SELECT * FROM files WHERE deleted_at IS NOT NULL LIMIT 200")
    .all() as FileRow[];
  for (const row of sieroty) {
    if (!existsSync(row.path)) continue;
    try {
      rmSync(row.path, { force: true });
    } catch {
      // The next pass will try again - now that sentence is true.
    }
  }
  return rows.length;
}

/** The shared byte write: validation, writing to disk (0600), the hash, the database row.
 *  Used both by conversation files (storeFile) and by wiki attachments (storeWikiFile), so
 *  that the record format exists in one place. */
function persistBytes(
  ctx: Ctx,
  filesDir: string,
  input: {
    actorId: number; conversationId: number | null; wikiPageId: number | null;
    name: string; data: Buffer; mime?: string; maxBytes: number;
    ttl: number | null; sensitive: boolean; burn: boolean;
  },
): { id: string; name: string } {
  if (input.data.length === 0) throw badRequest("pusty_plik", "plik nie moze byc pusty");
  if (input.data.length > input.maxBytes) {
    throw tooLarge("plik_za_duzy", `plik jest za duzy (limit ${input.maxBytes} B)`);
  }
  const id = randomBytes(16).toString("base64url");
  const name = safeName(input.name);
  const now = ctx.now();

  mkdirSync(filesDir, { recursive: true });
  const path = join(filesDir, id);
  writeFileSync(path, input.data, { mode: 0o600 });

  ctx.db
    .prepare(
      `INSERT INTO files(id, actor_id, conversation_id, wiki_page_id, name, size, sha256, mime,
                         path, created_at, expires_at, sensitive, burn)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, input.actorId, input.conversationId, input.wikiPageId, name, input.data.length,
      createHash("sha256").update(input.data).digest("hex"),
      input.mime ?? "application/octet-stream", path, now,
      input.ttl ? now + input.ttl : null, input.sensitive ? 1 : 0, input.burn ? 1 : 0,
    );
  return { id, name };
}

function deleteFileRow(ctx: Ctx, row: FileRow): void {
  ctx.db.prepare("UPDATE files SET deleted_at = ? WHERE id = ?").run(ctx.now(), row.id);
  try {
    rmSync(row.path, { force: true });
  } catch {
    // The entry is already marked as deleted, so orphaned bytes will not be served to anybody;
    // the next sweepExpired pass will try again (the "orphans" pass - see there).
    // (przebieg "sieroty" - patrz tam).
  }
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
