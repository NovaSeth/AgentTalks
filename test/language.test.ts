/**
 * English is the source language throughout the repository. K1 catches Polish
 * diacritics; K2 catches unaccented Polish words, including identifier components.
 * Exceptions are explicit, scoped and explained in language-allowlist.txt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CHECKS = ["filenames", "titles", "strings", "identifiers", "comments", "markdown", "text"] as const;
type Check = typeof CHECKS[number];
type Finding = { check: Check; path: string; line: number; text: string };
type Exception = { check: Check; path: string; text: string; reason: string };

const POLISH_DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
// The detector vocabulary is itself a Polish sample, not application prose.
const POLISH_WORDS = new Set((
  "nie jest sie ktore ktory ktora ktorej ktorym zeby wiec albo tylko moze jak tego przez juz czyli " +
  "kazdy kazda wszystko wszystkie zamiast wlasny wlasna swoj byla bylo byly bedzie dziala robi daje mowi " +
  "dlatego poniewaz natomiast wtedy gdyby ktos cos musi trzeba warto mozna nadal takze rowniez nawet " +
  "wiadomosc wiadomosci rozmowa rozmowy kanal kanaly uzytkownik zapisz odczyt nazwa nazwy plik pliku " +
  "strona strony serwer serwera blad bledu zmiana zmiany wersja liczba potrafi nalezy zawsze nigdy " +
  "akcje dane stan szukaj toasty ikony zdarzenia widok powiadomienia awatary dokumentacja jezyk " +
  "uruchom produkcje wypchnij wdroz instancja przyklad obrazy czat analiza kodu zrodlowego " +
  "audyt agenci etap rdzen tresc komentarza korzen aktora aktor aktorzy czlowiek wszyscy pytanie " +
  "odpowiedz watek skasowana brak dostepu haslo zly zla zle rewizja odwolany wygasl polski " +
  "testy zalozenia podsumowanie wymagania zakres cel kryteria wykonanie krok zadanie zadania " +
  "bezpieczny bezpieczenstwo uwagi uwaga sprawdz czytaj poczatek koniec nowy nowa nowe stary " +
  "polaczenie zalacznik zalaczniki pobierz usun edytuj domyslnie ustawienia sekrety projekt " +
  "przed pozycja licznik katalog przycisk wyslij wynik wyniki zmienne funkcja funkcje dostep " +
  "ponizej powyzej razem gotowe nazwe wartosc tworzy zwraca pozwala opis opisane poprawka " +
  "gdzie kiedy ktora ktorych oraz teraz tutaj tam brakujace docelowy obecny dzien dobry czesc " +
  "domyslny odcinek budzet znakow slownik linie miejsce czytelnie stopka schematu pogrupuj rozmowach " +
  "wzmianki znaki blok bloki osobista kolejnosc waga czeka budzecie pokazane pominiete uciete uzyte " +
  "tniete dopisz nieznane pola ostatnia okno zostalo pisza glowa spis sekcja kompletna naglowek koszt " +
  "czytane poczatku konca nowosci zapisane zmian bez moduly konflikt pulapki testowania wykonalnosc"
).split(/\s+/));

function polish(text: string): boolean {
  const words = text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase().split(/[^\p{L}]+/u);
  return POLISH_DIACRITICS.test(text) || words.some((word) => POLISH_WORDS.has(word));
}

/** The Landfall state directory is a process record kept by the landfall CLI: decision records are
 *  immutable once written (method rule MEM-2) and the rest is append-only task history, so records
 *  written before the English migration stay as they were. New records are written in English.
 *  It is not product code or documentation, so this gate does not scan it. */
const PROCESS_RECORDS = ".landfall/";

/** Include new files and exclude deleted paths during a rename, before a commit. */
function files(): string[] {
  return [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8" }).split("\0"))]
    .filter((p) => p && !p.startsWith(PROCESS_RECORDS) && existsSync(ROOT + p)).sort();
}

function exceptions(): Exception[] {
  return readFileSync(ROOT + "test/language-allowlist.txt", "utf8").split("\n")
    .filter((line) => line.trim() && !line.startsWith("#")).map((line, i) => {
      const [check, path, quoted, reason, extra] = line.split("\t");
      assert.ok(CHECKS.includes(check as Check) && path && quoted && reason?.trim() && !extra,
        `invalid allowlist entry ${i + 1}: expected check, path, JSON string, reason (tab-separated)`);
      const text: unknown = JSON.parse(quoted);
      assert.ok(typeof text === "string" && text.length > 0, `empty allowlist sample: ${path}`);
      assert.ok(text !== "*" || (path === "src/http/ui/js/i18n-pl.js" && check === "strings"),
        "only the Polish UI translation values may use a whole-category exception");
      return { check: check as Check, path, text, reason };
    });
}

function findings(path: string, source: string): Finding[] {
  const out: Finding[] = [];
  const add = (check: Check, text: string, line: number) => {
    if (polish(text)) out.push({ check, path, line, text });
  };
  add("filenames", path, 1);
  if (path.endsWith(".md")) source.split("\n").forEach((line, i) => add("markdown", line, i + 1));
  if (/\.(?:[cm]?[jt]s|json)$/.test(path)) {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
      path.endsWith(".json") ? ts.ScriptKind.JSON : path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const skipped = new Map<number, number>();
    const testFunctions = new Set(["test", "it", "describe", "suite"]);
    const testContexts = new Set<string>();
    const testNamespaces = new Set<string>();
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
          !["node:test", "test"].includes(statement.moduleSpecifier.text)) continue;
      const clause = statement.importClause;
      if (clause?.name) testFunctions.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) testNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          if (testFunctions.has((specifier.propertyName ?? specifier.name).text)) testFunctions.add(specifier.name.text);
        }
      }
    }
    const visit = (node: ts.Node) => {
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      if (ts.isIdentifier(node)) add("identifiers", node.text, line);
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const translationKey = path === "src/http/ui/js/i18n-pl.js" &&
          ts.isPropertyAssignment(node.parent) && node.parent.name === node;
        if (translationKey) add("identifiers", node.text, line);
        else if (/^(src|bin)\//.test(path) || /^integrations\/.*\.mjs$/.test(path) || path.endsWith(".json")) {
          add("strings", node.text, line);
        }
        skipped.set(node.getStart(ast), node.end);
      }
      if (ts.isRegularExpressionLiteral(node)) skipped.set(node.getStart(ast), node.end);
      if (path.startsWith("test/") && ts.isCallExpression(node)) {
        let callee = node.expression;
        let testMember = false;
        while (ts.isPropertyAccessExpression(callee)) {
          if (["test", "it", "describe", "suite"].includes(callee.name.text)) testMember = true;
          callee = callee.expression;
        }
        const isTest = ts.isIdentifier(callee) && (testFunctions.has(callee.text) ||
          (testMember && (testContexts.has(callee.text) || testNamespaces.has(callee.text))));
        if (isTest) {
          for (const arg of node.arguments) {
            if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
            const context = arg.parameters[0]?.name;
            if (context && ts.isIdentifier(context)) testContexts.add(context.text);
          }
          const title = node.arguments[0];
          if (title && (ts.isStringLiteralLike(title) || ts.isTemplateExpression(title))) {
            add("titles", ts.isStringLiteralLike(title) ? title.text : title.getText(ast), line);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    // Skip literal spans using AST boundaries: // inside a URL or regexp is not a comment.
    // Template expressions remain scanned, including any comments inside ${...}.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      const start = scanner.getTokenPos();
      const end = skipped.get(start);
      if (end !== undefined) { scanner.setTextPos(end); continue; }
      if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
        const firstLine = ast.getLineAndCharacterOfPosition(start).line + 1;
        scanner.getTokenText().split("\n").forEach((line, i) => add("comments", line, firstLine + i));
      }
    }
  } else if (path.endsWith(".svg")) {
    // Match comments and text separately; tag attributes and path geometry are not prose.
    for (const match of source.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g)) {
      const part = match[0];
      const comment = part.startsWith("<!--");
      if (part.startsWith("<") && !comment && !part.startsWith("<![CDATA[")) continue;
      const firstLine = source.slice(0, match.index).split("\n").length;
      part.split("\n").forEach((line, i) => add(comment ? "comments" : "text", line, firstLine + i));
    }
  } else if (path.endsWith(".py") || path.endsWith(".txt") || extensionlessScript(path)) {
    source.split("\n").forEach((line, i) => add(/^\s*#/.test(line) ? "comments" : "text", line, i + 1));
  } else if (/\.(css|html)$/.test(path)) {
    const pattern = path.endsWith(".css") ? /\/\*[\s\S]*?\*\//g : /<!--[\s\S]*?-->/g;
    for (const match of source.matchAll(pattern)) {
      const firstLine = source.slice(0, match.index).split("\n").length;
      match[0].split("\n").forEach((line, i) => add("comments", line, firstLine + i));
    }
  } else if (path.endsWith(".gitignore") || path.endsWith(".dockerignore") || path.endsWith(".sh") || /\.(yml|yaml|example)$/.test(path) || path === "Dockerfile") {
    source.split("\n").forEach((line, i) => {
      if (/^\s*#/.test(line)) add("comments", line, i + 1);
    });
  }
  return out;
}

/** Remove only the named sample; English prose around it remains checked. */
function allowed(finding: Finding, list: Exception[]): boolean {
  let remaining = finding.text;
  for (const entry of list) {
    if (entry.check !== finding.check || entry.path !== finding.path) continue;
    if (entry.text === "*") return true;
    if (["strings", "identifiers", "titles", "filenames"].includes(finding.check)) {
      if (entry.text === remaining) return true;
    } else remaining = remaining.split(entry.text).join("");
  }
  return !polish(remaining);
}

const paths = files();
const allowlist = exceptions().sort((a, b) => b.text.length - a.text.length);
function extensionlessScript(path: string): boolean {
  return /^(?:cli\/(?:.*\/)?|integrations\/(?:.*\/)?hooks\/(?:.*\/)?)[^/.]+$/.test(path);
}

function readsSource(path: string, mode = 0): boolean {
  if (/(?:^|\/)package-lock\.json$/.test(path) || path === "test/language-allowlist.txt") return false;
  return /\.(md|[cm]?[jt]s|json|py|svg|txt|sh|yml|yaml|example|css|html)$/.test(path)
    || /(?:^|\/)\.(?:gitignore|dockerignore)$/.test(path) || path === "Dockerfile"
    || (extensionlessScript(path) && (mode & 0o111) !== 0);
}
const all = paths.flatMap((path) => findings(path,
  readsSource(path, extensionlessScript(path) ? statSync(ROOT + path).mode : 0) ? readFileSync(ROOT + path, "utf8") : ""));

test("the language gate sees the whole repository and explained exceptions", () => {
  assert.ok(paths.filter((p) => /\.[jt]s$/.test(p)).length >= 80, "source inventory shrank unexpectedly");
  assert.ok(paths.filter((p) => p.endsWith(".md")).length >= 15, "Markdown inventory shrank unexpectedly");
  assert.ok(paths.includes("test/language.test.ts"), "uncommitted files must be included");
  assert.equal(new Set(allowlist.map((e) => JSON.stringify([e.check, e.path, e.text]))).size, allowlist.length,
    "duplicate allowlist entries");
  for (const entry of allowlist) assert.ok(paths.includes(entry.path), `stale allowlist path: ${entry.path}`);
});

for (const check of CHECKS) {
  test(`${check} are English (K1 diacritics and K2 words)`, () => {
    const hits = all.filter((f) => f.check === check && !allowed(f, allowlist));
    assert.equal(hits.length, 0,
      `${hits.length} Polish ${check}:\n${hits.map((f) => `${f.path}:${f.line}: ${f.text.trim()}`).join("\n")}`);
  });
}

test("each language check fires independently for accented and unaccented Polish", () => {
  for (const sample of ["wiadomość", "wiadomosc"]) {
    const probes: [Check, string, string][] = [
      ["filenames", `docs/${sample}.md`, ""],
      ["titles", "test/probe.test.ts", `test("${sample}", () => {});`],
      ["strings", "src/probe.ts", `const label = "${sample}";`],
      ["identifiers", "src/probe.ts", `const last${sample[0].toUpperCase() + sample.slice(1)}Count = 1;`],
      ["comments", "src/probe.ts", `const n = 1; /* ${sample} */`],
      ["markdown", "docs/probe.md", `# ${sample}`],
      ["text", "docs/probe.txt", sample],
    ];
    for (const [check, path, source] of probes) {
      assert.ok(findings(path, source).some((f) => f.check === check && !allowed(f, allowlist)),
        `${check} failed to detect ${sample}`);
    }
  }
  assert.equal(POLISH_DIACRITICS.test("wiadomosc"), false, "K2 probe must be independent of K1");
  assert.equal(polish("zażółć"), true, "K1 must work independently of the word list");
});

test("extraction covers templates, escaped strings, snake case, and inline comments", () => {
  const probes: [Check, string, string][] = [
    ["strings", "bin/probe.js", 'const label = `wiadomosc ${id} wiadomosc`;'],
    ["strings", "src/probe.ts", 'const label = "wiadomo\\u015b\\u0107";'],
    ["identifiers", "src/probe.ts", 'const WIADOMOSC_COUNT = 1;'],
    ["titles", "test/probe.test.ts", 'test.skip(`wiadomosc ${id}`, () => {});'],
    ["comments", "src/probe.ts", 'const label = `text ${ /* wiadomosc */ id }`;'],
    ["comments", "deploy/probe.sh", '# wiadomosc'],
    ["comments", "src/probe.css", 'p { color: red; } /* wiadomosc */'],
    ["comments", "src/probe.html", '<p>text</p><!-- wiadomosc -->'],
    ["markdown", "docs/probe.md", '```js\nconst wiadomosc = 1;\n```'],
  ];
  for (const [check, path, source] of probes) assert.ok(findings(path, source).some((f) => f.check === check), check);
  assert.deepEqual(findings("src/probe.ts", 'const url = "https://example.org"; const re = /https?:\\/\\//; // English comment'), []);
  assert.deepEqual(findings("docs/probe.md", "# Read the message and save the page"), []);
});

for (const [path, makeSource] of [
  ["integrations/probe.json", (sample: string) => JSON.stringify({ label: sample })],
  ["cli/probe.py", (sample: string) => `print("${sample}")\n# ${sample}`],
  ["src/probe.svg", (sample: string) => `<svg><text>${sample}</text><!-- ${sample} --></svg>`],
  ["docs/probe.txt", (sample: string) => sample],
  ["cli/probe", (sample: string) => `#!/bin/sh\nprintf '${sample}'\n# ${sample}`],
  ["integrations/plugin/hooks/probe", (sample: string) => `#!/bin/sh\nprintf '${sample}'\n# ${sample}`],
  ["integrations/plugin/lib/probe.mjs", (sample: string) => `const label = "${sample}";`],
  ["src/http/ui/js/probe.js", (sample: string) => `const label = "${sample}";`],
] as const) {
  test(`language gate reads and detects Polish in ${path}`, () => {
    assert.ok(readsSource(path, 0o755), `source inventory excludes ${path}`);
    for (const sample of ["wiadomość", "wiadomosc"]) {
      const hits = findings(path, makeSource(sample)).filter((f) => !allowed(f, allowlist));
      assert.ok(hits.length > 0, `no Polish detected in ${path}: ${sample}`);
      if (/\.(mjs|js|json)$/.test(path)) assert.ok(hits.some((f) => f.check === "strings"));
      if (/\.py$|\.svg$|\/probe$/.test(path)) assert.ok(hits.some((f) => f.check === "comments"));
      if (/\.(py|svg|txt)$|\/probe$/.test(path)) assert.ok(hits.some((f) => f.check === "text"));
      assert.deepEqual(findings(path, makeSource("English message")), []);
    }
  });
}

test("new source types respect explicit inventory exclusions and decode JSON strings", () => {
  for (const path of ["package-lock.json", "test/language-allowlist.txt", "docs/probe", "cli/probe.png"]) {
    assert.equal(readsSource(path, 0o755), false, path);
  }
  assert.equal(readsSource("cli/probe", 0o644), false);
  assert.equal(readsSource("integrations/plugin/hooks/nested/probe", 0o755), true);
  assert.ok(findings("integrations/probe.json", '{"label":"wiadomo\\u015b\\u0107"}')
    .some((f) => f.check === "strings"));
});

test("only Polish translation values are exempt, while UI keys and comments remain checked", () => {
  const path = "src/http/ui/js/i18n-pl.js";
  assert.deepEqual(findings(path, 'export const PL = { "Message": "wiadomość" };')
    .filter((f) => !allowed(f, allowlist)), []);
  for (const source of ['export const PL = { "wiadomość": "wiadomość" };', '// wiadomosc']) {
    assert.ok(findings(path, source).some((f) => !allowed(f, allowlist)));
  }
});

test("an exception cannot hide Polish text outside its quoted sample", () => {
  const entry: Exception = { check: "markdown", path: "docs/probe.md", text: "wiadomosc", reason: "Quoted historical sample" };
  const make = (text: string): Finding => ({ check: "markdown", path: entry.path, line: 1, text });
  assert.equal(allowed(make('The word "wiadomosc" means message.'), [entry]), true);
  assert.equal(allowed(make('wiadomosc jest'), [entry]), false);
  assert.equal(allowed({ ...make("wiadomosc"), path: "docs/other.md" }, [entry]), false);
});

test("code comments are English, checked by two disjoint criteria", () => {
  assert.ok(paths.filter((p) => /\.[jt]s$/.test(p)).length >= 80);
  assert.deepEqual(all.filter((f) => f.check === "comments" && !allowed(f, allowlist)), []);
});

test("both criteria CAN fire, with a separate negative sample for each", () => {
  const withoutDiacritics = findings("src/probe.ts", "// to jest komentarz ktory nie ma ogonkow");
  assert.equal(POLISH_DIACRITICS.test(withoutDiacritics[0].text), false);
  assert.equal(polish(withoutDiacritics[0].text), true);
  assert.ok(findings("src/probe.ts", "/* zażółć gęślą jaźń */").length > 0);
  assert.deepEqual(findings("src/probe.ts", "// the server refuses a write to a page you have not read"), []);
  const quotation: Finding = { check: "comments", path: "test/i18n.test.ts", line: 1,
    text: '// would be wrong at "2 wiadomości" - three forms, not two' };
  assert.equal(allowed(quotation, allowlist), true, "only an explicitly allowlisted Polish quotation is accepted");
});

test("nested Node test titles cannot evade the language gate", () => {
  const source = 'test("English", async t => { await t.test("wiadomość", () => {}); });';
  assert.ok(findings("test/probe.test.ts", source).some((f) => f.check === "titles"));
  assert.ok(findings("test/probe.test.ts", 'import { test as check } from "node:test"; check("wiadomosc", () => {});')
    .some((f) => f.check === "titles"));
  assert.ok(findings("test/probe.test.ts", 'import * as checks from "node:test"; checks.test("wiadomosc", () => {});')
    .some((f) => f.check === "titles"));
  assert.deepEqual(findings("test/probe.test.ts", 'const pattern = /message/; pattern.test("wiadomosc");'), []);
});

test("historical code exceptions cannot exempt ordinary Polish prose", () => {
  const path = "docs/superpowers/plans/2026-08-07-agenttalks-stage-1-core.md";
  for (const text of ["mozna pytanie", "tresc pytanie zle"]) {
    assert.equal(allowed({ check: "markdown", path, line: 1, text }, allowlist), false);
  }
});
