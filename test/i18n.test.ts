/**
 * Interface language: does every sentence the code shows have a translation?
 *
 * This is the same class of sensor as `dokumentacja.test.ts` - "both sides
 * correct, pair broken". A `t("Send")` with no Polish entry is not an error
 * anywhere: the code is fine, the dictionary is fine, and the interface quietly
 * shows one English word in the middle of a Polish screen. Nobody reports it,
 * everybody sees it.
 *
 * Three things are checked, and they catch different failures:
 *
 *  1. Every key used has a translation, and every translation is used. The second
 *     half matters as much as the first: a dead entry is a sentence that used to
 *     be somewhere, and a dictionary full of them stops being reviewable.
 *  2. The plural forms are the ones `Intl.PluralRules` actually asks for in
 *     Polish (one / few / many). Polish has three, English two, so any
 *     `n === 1 ? a : b` written here would be wrong at "2 wiadomości".
 *  3. No file that imports `t` declares its own `t`. This one is not theoretical:
 *     while translating the interface, a local `t` (a token, a title field, a tab
 *     button) shadowed the imported function in four separate files. The result
 *     would have been a TypeError at runtime, in a branch nobody clicks daily.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

/** A JS literal is not JSON: it may contain \` and \$ (needed inside a template),
 *  which JSON.parse rejects. We unescape them instead of pretending they do not
 *  occur - the wiki editor placeholder contains exactly that. */
const naJson = (s: string): string => s.replace(/\\([`$])/g, "$1");

function plikiUI(): string[] {
  return readdirSync(UI).filter((f) => f.endsWith(".js") && !f.startsWith("i18n"));
}

function uzyteKlucze(): Map<string, string[]> {
  const gdzie = new Map<string, string[]>();
  for (const f of plikiUI()) {
    const src = readFileSync(UI + f, "utf8");
    for (const m of src.matchAll(/\b(?:t|msg)\(\s*("(?:[^"\\]|\\.)*")/g)) {
      const klucz = JSON.parse(naJson(m[1])) as string;
      const lista = gdzie.get(klucz);
      if (lista) { if (!lista.includes(f)) lista.push(f); } else gdzie.set(klucz, [f]);
    }
  }
  return gdzie;
}

test("kazde zdanie interfejsu ma tlumaczenie, a kazde tlumaczenie jest uzywane", async () => {
  const uzyte = uzyteKlucze();
  // A guard against a silent failure of the sensor itself: when the expression stops matching
  // (a different function name, a different quote), the set will be empty and the test will
  // pass HAVING CHECKED NOTHING. That threshold has already been the cause of false green here.
  assert.ok(uzyte.size > 400, `wyciagnieto tylko ${uzyte.size} kluczy - czujnik przestal widziec kod`);

  const { PL } = await import("../src/http/ui/js/i18n-pl.js");
  const maja = new Set(Object.keys(PL));

  const brak = [...uzyte.keys()].filter((k) => !maja.has(k));
  assert.deepEqual(brak, [], `bez tlumaczenia:\n${brak.map((k) => `  ${JSON.stringify(k)} (${uzyte.get(k)!.join(", ")})`).join("\n")}`);

  const martwe = [...maja].filter((k) => !uzyte.has(k));
  assert.deepEqual(martwe, [], `w slowniku, nieuzywane w kodzie:\n${martwe.map((k) => `  ${JSON.stringify(k)}`).join("\n")}`);
});

test("formy mnogie pokrywaja kategorie, o ktore pyta polski Intl.PluralRules", async () => {
  const { PL } = await import("../src/http/ui/js/i18n-pl.js");
  const rules = new Intl.PluralRules("pl");
  // The numbers are chosen so that all three Polish categories occur: 1 -> one, 2..4 -> few,
  // 5+ and 0 -> many. We ask Intl rather than ourselves - it is what picks the form at runtime,
  // so its opinion is the binding one.
  const kategorie = new Set([0, 1, 2, 3, 5, 11, 22, 25, 101].map((n) => rules.select(n)));
  assert.ok(kategorie.size >= 3, `polski powinien miec >=3 kategorie, jest ${[...kategorie]}`);

  let mnogich = 0;
  for (const [klucz, wartosc] of Object.entries(PL)) {
    if (typeof wartosc === "string") continue;
    mnogich++;
    for (const kat of kategorie) {
      assert.ok(
        typeof (wartosc as Record<string, string>)[kat] === "string"
          || typeof (wartosc as Record<string, string>).other === "string",
        `${JSON.stringify(klucz)}: brak formy "${kat}"`,
      );
    }
  }
  assert.ok(mnogich >= 5, `spodziewam sie kilku form mnogich, jest ${mnogich}`);
});

test("t() tlumaczy, wybiera forme i wraca do angielskiego przy braku wpisu", async () => {
  const i18n = await import("../src/http/ui/js/i18n.js");
  i18n.setLang("en");
  assert.equal(i18n.t("Sign in"), "Sign in");
  assert.equal(i18n.t("{n} replies", { n: 1 }), "1 reply");
  assert.equal(i18n.t("{n} replies", { n: 5 }), "5 replies");

  i18n.setLang("pl");
  assert.equal(i18n.t("Sign in"), "Wejdź");
  // Three forms, not two - that is the whole difference between this mechanism and the ternary
  // `n === 1 ? a : b` that stood here before and said "2 nieprzeczytanych".
  assert.equal(i18n.t("{n} unread", { n: 1 }), "1 nieprzeczytana");
  assert.equal(i18n.t("{n} unread", { n: 2 }), "2 nieprzeczytane");
  assert.equal(i18n.t("{n} unread", { n: 5 }), "5 nieprzeczytanych");
  // The substitution does not escape HTML and that is intended - callers pass values already
  // put through escapeHtml (see the note at the top of i18n.js).
  assert.equal(i18n.t("Write to @{handle} privately", { handle: "a&b" }), "Napisz do @a&b prywatnie");
  // A missing entry = English shows through, not "missing.key" and not emptiness.
  assert.equal(i18n.t("A sentence nobody translated"), "A sentence nobody translated");
  i18n.setLang("en");
});

test("zaden plik UI nie przykrywa importowanego t() wlasnym `t`", () => {
  // The patterns that actually occurred while translating the interface: `const t =` (a title
  // field, a bar), `(t)` and `(t,` (a parameter in map/forEach - a token, a tab).
  const PRZYKRYCIE = /\bconst\s+t\b|\blet\s+t\b|\bvar\s+t\b|\(\s*t\s*\)\s*=>|\(\s*t\s*,/;
  const winne: string[] = [];
  let sprawdzonych = 0;
  for (const f of plikiUI()) {
    const src = readFileSync(UI + f, "utf8");
    if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*"\.\/i18n\.js"/.test(src)) continue;
    sprawdzonych++;
    if (PRZYKRYCIE.test(src)) winne.push(f);
  }
  assert.ok(sprawdzonych >= 8, `czujnik widzi tylko ${sprawdzonych} plikow z importem t() - wzorzec importu przestal pasowac`);
  assert.deepEqual(winne, [], `lokalne \`t\` przykrywa tlumaczenie w: ${winne.join(", ")}`);
});
