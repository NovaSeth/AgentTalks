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

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Polish words that carry no diacritics. Disjoint from K1 by construction: K1 fires
 *  on characters, this one on tokens that no English sentence contains. */
const POLISH_WORDS = /\b(nie|jest|sie|ktore|ktory|ktora|ktorej|ktorym|zeby|wiec|albo|tylko|moze|jak|tego|przez|juz|czyli|kazdy|kazda|wszystko|wszystkie|zamiast|wlasny|wlasna|swoj|byla|bylo|byly|bedzie|dziala|robi|daje|mowi|dlatego|poniewaz|natomiast|wtedy|gdyby|ktos|cos|musi|trzeba|warto|mozna|nadal|takze|rowniez|nawet|wiadomosc|wiadomosci|rozmowa|rozmowy|kanal|kanaly|uzytkownik|zapisz|odczyt|nazwa|nazwy|plik|pliku|strona|strony|serwer|serwera|blad|bledu|zmiana|zmiany|wersja|liczba|potrafi|nalezy|zawsze|nigdy)\b/i;
const POLISH_DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/** The comment's content: the marker and the indentation stripped, and QUOTED SPANS
 *  removed - a quotation in Polish inside an English sentence is not a Polish comment. */
function commentContent(line: string): string | null {
  const m = line.match(/^\s*(?:\/\/|\/\*\*?|\*\/?)\s?(.*)$/) ?? line.match(/^\s*[^/\s].*?\S\s+\/\/\s?(.*)$/);
  if (!m) return null;
  return m[1].replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
}

function files(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.js"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((p) => p && !p.endsWith("i18n-pl.js"));
}

test("code comments are English, checked by two disjoint criteria", () => {
  const list = files();
  assert.ok(list.length >= 80, `the check sees only ${list.length} files; the git ls-files pattern no longer matches`);

  const matches: string[] = [];
  for (const f of list) {
    const lines = readFileSync(ROOT + f, "utf8").split("\n");
    lines.forEach((l, i) => {
      const t = commentContent(l);
      if (!t) return;
      const k1 = POLISH_DIACRITICS.test(t), k2 = POLISH_WORDS.test(t);
      if (k1 || k2) matches.push(`  ${f}:${i + 1} [${k1 ? "K1" : ""}${k2 ? "K2" : ""}] ${t.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(matches, [], `Polish comments:\n${matches.join("\n")}`);
});

test("both criteria CAN fire, with a separate negative sample for each", () => {
  // Without this, the test above is a sentence about an empty set: if the criteria
  // stopped matching anything, "no Polish comments" would be true and worthless.
  // Each criterion is checked SEPARATELY, because they are supposed to catch
  // different things - a common probe would let one of them die unnoticed.
  // This Polish sample without diacritics proves the word criterion can detect Polish.
  const withoutDiacritics = commentContent("// to jest komentarz ktory nie ma ogonkow")!;
  assert.equal(POLISH_DIACRITICS.test(withoutDiacritics), false, "K1 must not match a sentence without diacritics");
  assert.equal(POLISH_WORDS.test(withoutDiacritics), true, "K2 stopped matching Polish words");

  // This Polish pangram proves the diacritic criterion can detect Polish independently.
  const withDiacritics = commentContent(" * zażółć gęślą jaźń")!;
  assert.equal(POLISH_DIACRITICS.test(withDiacritics), true, "K1 stopped matching diacritics");

  const english = commentContent("// the server refuses a write to a page you have not read")!;
  assert.equal(POLISH_DIACRITICS.test(english) || POLISH_WORDS.test(english), false,
    "the criterion matches an English sentence; this would be a false alarm");

  // A quotation stays legal: this is exactly the case of ids.ts, i18n.test.ts and
  // mcp.test.ts, where Polish is the subject of the sentence rather than its language.
  const quotation = commentContent('// would be wrong at "2 wiadomości" - three forms, not two')!;
  assert.equal(POLISH_DIACRITICS.test(quotation) || POLISH_WORDS.test(quotation), false,
    "a Polish quotation in an English sentence must not count as a Polish comment");
});
