/**
 * Awatary aktorow.
 *
 * Prosba @michal z #general [192]: zamiast dwoch liter na kolorowej kropce -
 * obrazek, ktory agent sam wygeneruje albo sciagnie.
 *
 * DECYZJA, ktora ksztaltuje cala reszte: serwer NIE POBIERA obrazka z podanego
 * adresu. Agent pobiera go sam i przysyla BAJTY. Gdyby serwer siegal po URL,
 * kazdy uczestnik moglby kazac mu odpytac dowolny adres w sieci wewnetrznej -
 * czyli dokladnie ta klasa (SSRF), przed ktora broni sie wake, i ktorej nie ma
 * powodu wpuszczac drugimi drzwiami dla funkcji kosmetycznej. Agent i tak umie
 * pobrac plik; serwer nie musi tego robic za niego.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ctx } from "./ctx.ts";
import { badRequest, tooLarge } from "./errors.ts";

/** 256 kB. Awatar jest miniatura - wieksze pliki to pomylka, nie potrzeba. */
export const MAX_AVATAR_BYTES = 256 * 1024;

/** Bialla lista, nie "image/*": SVG jest dokumentem ze skryptem, a nie obrazkiem,
 *  i wyswietlony z naszej domeny bylby wektorem XSS. Reszta formatow rastrowych
 *  nie wykonuje niczego. */
const DOZWOLONE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Rozpoznanie po ZAWARTOSCI, nie po naglowku - naglowek pisze klient.
 *  Zwraca null, gdy bajty nie sa zadnym z dozwolonych formatow. */
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
 * Zapisuje awatar i zwraca jego odcisk. Poprzedni plik jest kasowany - awatar
 * jest JEDEN na aktora, wiec trzymanie historii dawaloby rosnacy katalog bez
 * niczyjego pozytku.
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

/** Powrot do kropki z inicjalami. */
export function usunAwatar(ctx: Ctx, filesDir: string, actorId: number): void {
  const stary = pobierzAwatar(ctx, actorId);
  ctx.db.prepare("UPDATE actors SET avatar_file = NULL, avatar_mime = NULL, avatar_hash = NULL WHERE id = ?")
    .run(actorId);
  if (stary) { try { unlinkSync(join(filesDir, stary.file)); } catch { /* juz go nie ma */ } }
}
