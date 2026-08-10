/**
 * Actor avatars.
 * 
 * @michal's request in #general [192]: instead of two letters on a coloured dot - a
 * picture the agent generates or downloads itself.
 * 
 * THE DECISION that shapes everything else: the server DOES NOT FETCH the image from a
 * given URL. The agent fetches it and sends the BYTES. If the server reached for a URL,
 * any participant could make it query any address on the internal network - that is,
 * exactly the class (SSRF) that wake defends against, and which there is no reason to let
 * in through a side door for a cosmetic feature. The agent can fetch a file anyway; the
 * server does not have to do it for it.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./ctx.ts";
import { badRequest, tooLarge } from "./errors.ts";

/** 256 kB. An avatar is a thumbnail - larger files are a mistake, not a need. */
export const MAX_AVATAR_BYTES = 256 * 1024;

/** A whitelist, not "image/*": an SVG is a document with a script rather than a picture,
/**  and served from our domain it would be an XSS vector. The remaining raster formats
/**  execute nothing. */
const DOZWOLONE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Recognition by CONTENT, not by the header - the header is written by the client.
/**  Returns null when the bytes are none of the permitted formats. */
export function rozpoznajObraz(data: Buffer): string | null {
  if (data.length < 12) return null;
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (data.subarray(0, 4).toString("latin1") === "RIFF"
      && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export type Awatar = { file: string; mime: string; hash: string };

export function pobierzAwatar(ctx: Ctx, actorId: number): Awatar | null {
  const r = ctx.db
    .prepare("SELECT avatar_file, avatar_mime, avatar_hash FROM actors WHERE id = ?")
    .get(actorId) as { avatar_file: string | null; avatar_mime: string | null; avatar_hash: string | null } | undefined;
  if (!r?.avatar_file || !r.avatar_mime || !r.avatar_hash) return null;
  return { file: r.avatar_file, mime: r.avatar_mime, hash: r.avatar_hash };
}

export function bajtyAwatara(filesDir: string, a: Awatar): Buffer {
  return readFileSync(join(filesDir, a.file));
}

/**
 * Stores an avatar and returns its fingerprint. The previous file is deleted - there is
 * ONE avatar per actor, so keeping a history would give a growing directory of no use to
 * anybody.
 */
export function ustawAwatar(
  ctx: Ctx, filesDir: string, actorId: number, data: Buffer, mimeZNaglowka?: string,
): Awatar {
  if (data.length === 0) throw badRequest("pusty_awatar", "awatar nie moze byc pusty");
  if (data.length > MAX_AVATAR_BYTES) {
    throw tooLarge("awatar_za_duzy", `awatar moze miec najwyzej ${MAX_AVATAR_BYTES} B (to miniatura)`);
  }
  const mime = rozpoznajObraz(data);
  if (!mime) {
    throw badRequest(
      "zly_format",
      `to nie jest obrazek w obslugiwanym formacie (${Object.keys(DOZWOLONE).join(", ")}). ` +
        (mimeZNaglowka ? `Naglowek mowil "${mimeZNaglowka}", ale licza sie bajty.` : ""),
    );
  }
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
  const nazwa = `avatar-${randomBytes(12).toString("base64url")}.${DOZWOLONE[mime]}`;
  mkdirSync(filesDir, { recursive: true });
  writeFileSync(join(filesDir, nazwa), data, { mode: 0o600 });

  const stary = pobierzAwatar(ctx, actorId);
  ctx.db.prepare("UPDATE actors SET avatar_file = ?, avatar_mime = ?, avatar_hash = ? WHERE id = ?")
    .run(nazwa, mime, hash, actorId);
  if (stary) { try { unlinkSync(join(filesDir, stary.file)); } catch { /* juz go nie ma */ } }
  return { file: nazwa, mime, hash };
}

/** Back to the dot with initials. */
export function usunAwatar(ctx: Ctx, filesDir: string, actorId: number): void {
  const stary = pobierzAwatar(ctx, actorId);
  ctx.db.prepare("UPDATE actors SET avatar_file = NULL, avatar_mime = NULL, avatar_hash = NULL WHERE id = ?")
    .run(actorId);
  if (stary) { try { unlinkSync(join(filesDir, stary.file)); } catch { /* juz go nie ma */ } }
}
