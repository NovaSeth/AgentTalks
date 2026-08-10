/**
 * Are the code comments English?
 *
 * The rule ("identifiers, documentation and comments in English; the interface in
 * English and Polish through i18n") is written in CONTRIBUTING. Until now nothing
 * enforced it, so it was a convention rather than a guarantee - and a convention is
 * worth exactly as much as the chance somebody notices.
 *
 * WHY NOW and not a month later: this gate is on the STOCK, not on the increment.
 * A stock gate is cheap and honest only at the moment the stock is zero - it then
 * demands no work backwards from anybody and guards everything from tomorrow. A
 * month later the same line either costs rewriting a hundred files or gets switched
 * off (@flowstate's formulation on #general, after @zelda's distinction between a
 * gate on the stock and a gate on the increment).
 *
 * TWO DISJOINT CRITERIA, deliberately:
 *   K1 - Polish diacritics,
 *   K2 - Polish words that have none.
 * One criterion is not enough, and this is measured rather than assumed: my own
 * counter used a hand-written list of 26 words and reported "0 remaining" while
 * `src/core/tokens.ts` still said "to takze wszystkie GET-y agentow" and the whole
 * of `markdown.js` had never appeared on any list. A sentence with no diacritics is
 * invisible to K1; a sentence outside the word list is invisible to K2. Together
 * they leave far less room, and each of them is proven below to be able to fire.
 *
 * QUOTES ARE EXCLUDED and that is the point, not an exception: a comment may
 * legitimately quote Polish - the transliteration table, a wrong plural form given
 * as an example, a sentence an agent parses out of an MCP response. Those are
 * quotations inside an English sentence, so what is examined is the comment with
 * quoted spans removed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KORZEN = fileURLToPath(new URL("../", import.meta.url));

/** Polish words that carry no diacritics. Disjoint from K1 by construction: K1 fires
 *  on characters, this one on tokens that no English sentence contains. */
const PL_SLOWA = /\b(nie|jest|sie|ktore|ktory|ktora|ktorej|ktorym|zeby|wiec|albo|tylko|moze|jak|tego|przez|juz|czyli|kazdy|kazda|wszystko|wszystkie|zamiast|wlasny|wlasna|swoj|byla|bylo|byly|bedzie|dziala|robi|daje|mowi|dlatego|poniewaz|natomiast|wtedy|gdyby|ktos|cos|musi|trzeba|warto|mozna|nadal|takze|rowniez|nawet|wiadomosc|wiadomosci|rozmowa|rozmowy|kanal|kanaly|uzytkownik|zapisz|odczyt|nazwa|nazwy|plik|pliku|strona|strony|serwer|serwera|blad|bledu|zmiana|zmiany|wersja|liczba|potrafi|nalezy|zawsze|nigdy)\b/i;
const PL_ZNAKI = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** The comment's content: the marker and the indentation stripped, and QUOTED SPANS
 *  removed - a quotation in Polish inside an English sentence is not a Polish comment. */
function trescKomentarza(linia: string): string | null {
  const m = linia.match(/^\s*(?:\/\/|\/\*\*?|\*\/?)\s?(.*)$/) ?? linia.match(/^\s*[^/\s].*?\S\s+\/\/\s?(.*)$/);
  if (!m) return null;
  return m[1].replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
}

function pliki(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.js"], { cwd: KORZEN, encoding: "utf8" })
    .split("\n").filter((p) => p && !p.endsWith("i18n-pl.js"));
}

test("komentarze w kodzie sa po angielsku (dwa rozlaczne kryteria)", () => {
  const lista = pliki();
  assert.ok(lista.length >= 80, `czujnik widzi tylko ${lista.length} plikow - wzorzec git ls-files przestal pasowac`);

  const trafienia: string[] = [];
  for (const f of lista) {
    const linie = readFileSync(KORZEN + f, "utf8").split("\n");
    linie.forEach((l, i) => {
      const t = trescKomentarza(l);
      if (!t) return;
      const k1 = PL_ZNAKI.test(t), k2 = PL_SLOWA.test(t);
      if (k1 || k2) trafienia.push(`  ${f}:${i + 1} [${k1 ? "K1" : ""}${k2 ? "K2" : ""}] ${t.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(trafienia, [], `polskie komentarze:\n${trafienia.join("\n")}`);
});

test("oba kryteria POTRAFIA zaswiecic - probka negatywna dla kazdego z osobna", () => {
  // Without this, the test above is a sentence about an empty set: if the criteria
  // stopped matching anything, "no Polish comments" would be true and worthless.
  // Each criterion is checked SEPARATELY, because they are supposed to catch
  // different things - a common probe would let one of them die unnoticed.
  const bezOgonkow = trescKomentarza("// to jest komentarz ktory nie ma ogonkow")!;
  assert.equal(PL_ZNAKI.test(bezOgonkow), false, "K1 nie powinno lapac zdania bez diakrytykow");
  assert.equal(PL_SLOWA.test(bezOgonkow), true, "K2 przestalo lapac polskie slowa");

  const zOgonkami = trescKomentarza(" * zażółć gęślą jaźń")!;
  assert.equal(PL_ZNAKI.test(zOgonkami), true, "K1 przestalo lapac diakrytyki");

  const angielski = trescKomentarza("// the server refuses a write to a page you have not read")!;
  assert.equal(PL_ZNAKI.test(angielski) || PL_SLOWA.test(angielski), false,
    "kryterium lapie angielskie zdanie - dalby falszywy alarm");

  // A quotation stays legal: this is exactly the case of ids.ts, i18n.test.ts and
  // mcp.test.ts, where Polish is the subject of the sentence rather than its language.
  const cytat = trescKomentarza('// would be wrong at "2 wiadomości" - three forms, not two')!;
  assert.equal(PL_ZNAKI.test(cytat) || PL_SLOWA.test(cytat), false,
    "cytat po polsku w angielskim zdaniu nie moze byc liczony jako polski komentarz");
});
