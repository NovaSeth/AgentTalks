/**
 * Interface language: does every sentence the code shows have a translation?
 *
 * This is the same class of sensor as `docs.test.ts` - "both sides
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
const asJson = (s: string): string => s.replace(/\\([`$])/g, "$1");

function uiFiles(): string[] {
  return readdirSync(UI).filter((f) => f.endsWith(".js") && !f.startsWith("i18n"));
}

function usedKeys(): Map<string, string[]> {
  const locations = new Map<string, string[]>();
  for (const f of uiFiles()) {
    const src = readFileSync(UI + f, "utf8");
    for (const m of src.matchAll(/\b(?:t|msg)\(\s*("(?:[^"\\]|\\.)*")/g)) {
      const key = JSON.parse(asJson(m[1])) as string;
      const list = locations.get(key);
      if (list) { if (!list.includes(f)) list.push(f); } else locations.set(key, [f]);
    }
  }
  return locations;
}

test("every interface sentence has a translation and every translation is used", async () => {
  const used = usedKeys();
  // A guard against a silent failure of the sensor itself: when the expression stops matching
  // (a different function name, a different quote), the set will be empty and the test will
  // pass HAVING CHECKED NOTHING. That threshold has already been the cause of false green here.
  assert.ok(used.size > 400, `only ${used.size} keys extracted; the check no longer sees the code`);

  const { PL } = await import("../src/http/ui/js/i18n-pl.js");
  const have = new Set(Object.keys(PL));

  const missing = [...used.keys()].filter((k) => !have.has(k));
  assert.deepEqual(missing, [], `missing translations:\n${missing.map((k) => `  ${JSON.stringify(k)} (${used.get(k)!.join(", ")})`).join("\n")}`);

  const unused = [...have].filter((k) => !used.has(k));
  assert.deepEqual(unused, [], `in the dictionary but unused in code:\n${unused.map((k) => `  ${JSON.stringify(k)}`).join("\n")}`);
});

test("plural forms cover the categories requested by Polish Intl.PluralRules", async () => {
  const { PL } = await import("../src/http/ui/js/i18n-pl.js");
  const rules = new Intl.PluralRules("pl");
  // The numbers are chosen so that all three Polish categories occur: 1 -> one, 2..4 -> few,
  // 5+ and 0 -> many. We ask Intl rather than ourselves - it is what picks the form at runtime,
  // so its opinion is the binding one.
  const categories = new Set([0, 1, 2, 3, 5, 11, 22, 25, 101].map((n) => rules.select(n)));
  assert.ok(categories.size >= 3, `Polish must have >=3 categories; found ${[...categories]}`);

  let pluralEntries = 0;
  for (const [key, value] of Object.entries(PL)) {
    if (typeof value === "string") continue;
    pluralEntries++;
    for (const category of categories) {
      assert.ok(
        typeof (value as Record<string, string>)[category] === "string"
          || typeof (value as Record<string, string>).other === "string",
        `${JSON.stringify(key)}: missing form "${category}"`,
      );
    }
  }
  assert.ok(pluralEntries >= 5, `expected several plural entries; found ${pluralEntries}`);
});

test("t() translates, selects the plural form and falls back to English for missing entries", async () => {
  const i18n = await import("../src/http/ui/js/i18n.js");
  i18n.setLang("en");
  assert.equal(i18n.t("Sign in"), "Sign in");
  assert.equal(i18n.t("{n} replies", { n: 1 }), "1 reply");
  assert.equal(i18n.t("{n} replies", { n: 5 }), "5 replies");

  // Polish expected values verify translation, plural forms and interpolation.
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

test("no UI file shadows the imported t() with its own `t`", () => {
  // The patterns that actually occurred while translating the interface: `const t =` (a title
  // field, a bar), `(t)` and `(t,` (a parameter in map/forEach - a token, a tab).
  const SHADOWING = /\bconst\s+t\b|\blet\s+t\b|\bvar\s+t\b|\(\s*t\s*\)\s*=>|\(\s*t\s*,/;
  const offenders: string[] = [];
  let checked = 0;
  for (const f of uiFiles()) {
    const src = readFileSync(UI + f, "utf8");
    if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*"\.\/i18n\.js"/.test(src)) continue;
    checked++;
    if (SHADOWING.test(src)) offenders.push(f);
  }
  assert.ok(checked >= 8, `the check sees only ${checked} files importing t(); the import pattern no longer matches`);
  assert.deepEqual(offenders, [], `local \`t\` shadows the translation function in: ${offenders.join(", ")}`);
});
