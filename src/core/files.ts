/**
 * Pliki przesylane przez kanal.
 *
 * Feedback z #nextIteration (332c7e42): przez wspolny katalog prototypu przeszly
 * prywatne zdjecia i trzeba je bylo czyscic recznie. Stad trzy mechanizmy:
 *   ttl        - plik znika sam po czasie,
 *   sensitive  - plik oznaczony jako wrazliwy dostaje domyslny TTL i nie jest
 *                listowany poza konwersacja, w ktorej go wyslano,
 *   burn       - plik znika po pierwszym pobraniu przez kogos innego niz autor.
 *
 * Dostep do pliku = dostep do konwersacji, w ktorej go wyslano. Plik bez
 * konwersacji widzi tylko autor.
 *
 * Bajty leza na dysku pod losowa nazwa (id), metadane w bazie. Kasowanie
 * najpierw zapisuje deleted_at, potem usuwa bajty - odwrotna kolejnosc
 * zostawialaby wpis wskazujacy na nieistniejacy plik jako stan normalny.
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
  name: string; size: number; sha256: string; mime: string; path: string;
  created_at: number; expires_at: number | null; sensitive: number; burn: number;
  downloads: number; deleted_at: number | null;
};

const toInfo = (r: FileRow): FileInfo => ({
  id: r.id,
  actorId: r.actor_id,
  conversationId: r.conversation_id,
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
  // basename + odsiew sciezkowych smieci: nazwa pliku pochodzi od klienta
  // i nie ma prawa wplynac na to, GDZIE plik wyladuje.
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
  if (input.data.length === 0) throw badRequest("pusty_plik", "plik nie moze byc pusty");
  if (input.data.length > input.maxBytes) {
    throw tooLarge("plik_za_duzy", `plik jest za duzy (limit ${input.maxBytes} B)`);
  }
  assertCanPost(ctx, input.conversationId, input.actorId);

  const id = randomBytes(16).toString("base64url");
  const name = safeName(input.name);
  const sensitive = input.sensitive === true;
  // Wrazliwy plik bez jawnego TTL dostaje domyslny - "wrazliwy i wieczny"
  // to dokladnie kombinacja, ktora bolala w prototypie.
  const ttl = input.ttlSec ?? (sensitive ? SENSITIVE_DEFAULT_TTL : null);
  const now = ctx.now();

  mkdirSync(filesDir, { recursive: true });
  const path = join(filesDir, id);
  writeFileSync(path, input.data, { mode: 0o600 });

  ctx.db
    .prepare(
      `INSERT INTO files(id, actor_id, conversation_id, name, size, sha256, mime, path,
                         created_at, expires_at, sensitive, burn)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, input.actorId, input.conversationId, name, input.data.length,
      createHash("sha256").update(input.data).digest("hex"),
      input.mime ?? "application/octet-stream", path, now,
      ttl ? now + Math.trunc(ttl) : null, sensitive ? 1 : 0, input.burn ? 1 : 0,
    );

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

/** Metadane pliku, jesli aktor ma prawo go widziec. */
export function getFileInfo(ctx: Ctx, id: string, actorId: number): FileInfo | null {
  const row = ctx.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
  if (!row || row.deleted_at) return null;
  if (row.expires_at && row.expires_at <= ctx.now()) {
    deleteFileRow(ctx, row);
    return null;
  }
  const allowed = row.actor_id === actorId
    || (row.conversation_id !== null && canRead(ctx, row.conversation_id, actorId));
  if (!allowed) return null;
  return toInfo(row);
}

/**
 * Pobranie bajtow. burn: plik znika po pierwszym pobraniu przez NIE-autora -
 * autor moze sprawdzic wlasny plik bez spalenia go.
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

/** Pliki widoczne dla aktora w danej konwersacji. */
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

/** Sprzatanie wygaslych. Wolane leniwie przy listowaniu i okresowo z serwera. */
export function sweepExpired(ctx: Ctx): number {
  const rows = ctx.db
    .prepare("SELECT * FROM files WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?")
    .all(ctx.now()) as FileRow[];
  for (const row of rows) deleteFileRow(ctx, row);
  return rows.length;
}

function deleteFileRow(ctx: Ctx, row: FileRow): void {
  ctx.db.prepare("UPDATE files SET deleted_at = ? WHERE id = ?").run(ctx.now(), row.id);
  try {
    rmSync(row.path, { force: true });
  } catch {
    // Wpis jest juz oznaczony jako skasowany, wiec bajty-sieroty nie beda
    // nikomu serwowane; kolejny sweep sprobuje jeszcze raz nic nie psujac.
  }
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
