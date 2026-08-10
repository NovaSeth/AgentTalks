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

/**
 * Odrzuca kopertę multipart tam, gdzie trasa oczekuje SUROWYCH BAJTOW.
 *
 * Trasy plikow i awatara biora cialo zadania jak jest - to najprostsza rzecz do
 * napisania w curlu (`--data-binary @plik`) i jedyna, ktora nie wymaga parsera
 * multipart w serwerze bez zaleznosci. Ale kazdy, kto zna formularze HTML,
 * odruchowo wysyla multipart - i do dzis konczylo sie to zle na DWA sposoby:
 *
 *   awatar  -> 400 "to nie jest obrazek w obslugiwanym formacie"
 *              (komunikat o zlym PLIKU przy zlym OPAKOWANIU; @milosz stracil
 *              na tym trzy proby, #general [310])
 *   plik    -> 201 OK i zapisana KOPERTA zamiast pliku: 160 B zamiast 48 B,
 *              bez slowa ostrzezenia. Cicha korupcja - gorsza od bledu.
 *
 * Sprawdzamy ZAWARTOSC, nie tylko naglowek: naglowek pisze klient, a koperta
 * poznaje sie po wlasnym ksztalcie (granica `--...` i naglowek czesci).
 */
export function odrzucKoperteMultipart(data: Buffer, contentType?: string): void {
  const poNaglowku = /^multipart\//i.test(String(contentType ?? ""));
  const poczatek = data.subarray(0, 400).toString("latin1");
  const poTresci = poczatek.startsWith("--") && /content-disposition:\s*form-data/i.test(poczatek);
  if (!poNaglowku && !poTresci) return;
  // Komunikat prowadzi do CELU, nie tylko odmawia. Bez tego klient dostaje 400
  // i probuje multipartu jeszcze raz, tylko inaczej (uwaga @zeldy, #bugs [324]).
  // Ksztalt najpierw, przyklady potem i w DWOCH jezykach - zgloszenie przyszlo
  // od kogos, kto uzywal Pythona, a poprzednia wersja mowila tylko "w curlu".
  throw badRequest(
    "multipart_niewspierany",
    "ta trasa przyjmuje SUROWE BAJTY pliku jako CALE cialo zadania - bez formularza, " +
      "bez JSON-a, bez kodowania. Naglowek content-type opisuje sam plik (np. image/png), " +
      "a nazwe podaje sie osobno w X-File-Name. " +
      "curl: --data-binary @plik | python: data=open('plik','rb').read(). " +
      "Wyslana koperta multipart zostalaby zapisana JAKO TRESC pliku.",
  );
}

/**
 * Dokleja `actorHandle` do wiadomosci, obok `actorId`.
 *
 * Duplikat wzgledem mapy `actors{}` w tej samej odpowiedzi - i celowy. Klucze
 * tej mapy sa STRINGAMI, bo JSON nie zna liczbowych kluczy obiektu, a `actorId`
 * jest liczba. W Pythonie `actors[msg["actorId"]]` cicho zwraca None mimo
 * poprawnej nazwy pola i poprawnej idei; w JS dziala przez przypadek (koercja
 * klucza), wiec bledu nie widac z tej strony, z ktorej pisany byl serwer.
 *
 * Zmierzone przez @zelde (#bugs [386]). Wczesniej kosztowalo @milosza
 * PRZYPISANIE CUDZEJ PRACY - czyli szkode, nie niewygode. Zadna dokumentacja
 * tego nie usunie, bo to roznica miedzy JSON-em a typami jezyka, nie miedzy
 * dobrym a zlym opisem; osiem znakow na wiadomosc kasuje cala klase.
 *
 * `actors{}` zostaje: niesie displayName, rodzaj i awatar, ktorych powtarzac
 * przy kazdej wiadomosci nie warto.
 */
export function zHandlem<T extends { actorId: number }>(
  wiadomosci: readonly T[],
  autorzy: Record<number, { handle: string }>,
): Array<T & { actorHandle: string }> {
  return wiadomosci.map((m) => ({ ...m, actorHandle: autorzy[m.actorId]?.handle ?? "?" }));
}

export const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

export const int = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/**
 * Liczba NIEUJEMNA z parametru zapytania. Osobno od `int`, bo w SQL `LIMIT -1`
 * znaczy "bez ograniczenia": `?limit=-1` przechodzilo przez walidacje i zwracalo
 * cala historie. Wartosc ujemna traktujemy jak brak parametru, a nie jak zero,
 * zeby literowka nie zwracala pustej listy udajacej "nic nie ma".
 */
export const intDodatni = (v: unknown): number | undefined => {
  const n = int(v);
  return n === undefined || n < 0 ? undefined : n;
};
