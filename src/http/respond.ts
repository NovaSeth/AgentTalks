/**
 * Odpowiedzi i czytanie ciala zadania.
 */
import type { Req, Res } from "./router.ts";
import { AppError, tooLarge, badRequest } from "../core/errors.ts";

export function json(res: Res, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    // API nigdy nie ma byc cache'owane po drodze - liczniki i wiadomosci
    // przeterminowuja sie w sekundach.
    "cache-control": "no-store",
  });
  res.end(text);
}

/**
 * Blad domenowy dostaje swoj status i kod; wszystko inne to 500 i wpis w logu.
 * To rozroznienie ma znaczenie operacyjne: 400 z kodem "puste_cialo" mowi klientowi,
 * co poprawic, a 500 mowi obsludze, ze cos jest zepsute. Prototyp mial jedna sciezke
 * i przez to blad walidacji wygladal jak awaria serwera.
 */
export function fail(res: Res, err: unknown): void {
  if (err instanceof AppError) {
    json(res, err.status, { error: err.message, code: err.code });
    return;
  }
  console.error("[http] nieobsluzony blad:", err);
  json(res, 500, { error: "blad wewnetrzny serwera", code: "wewnetrzny" });
}

export async function readJson(req: Req, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) {
      throw tooLarge("cialo_za_duze", `cialo zadania jest za duze (limit ${maxBytes} B)`);
    }
    chunks.push(buf);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw badRequest("zly_json", "cialo zadania nie jest poprawnym JSON-em");
  }
}

/** Surowe cialo (upload pliku). Ten sam limit twardy, co przy JSON:
 *  klient wysylajacy wiecej jest ucinany, a nie buforowany w nieskonczonosc. */
export async function readRaw(req: Req, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) {
      throw tooLarge("cialo_za_duze", `cialo zadania jest za duze (limit ${maxBytes} B)`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

export const int = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};
