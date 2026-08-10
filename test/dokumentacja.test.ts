/**
 * Document versus code: does what the documentation TELLS you to use exist at all?
 *
 *The reason this file exists has a name given by @motowolt on #bugs [180]: "both sides
 *correct, pair broken". The skill documented a `workingOn` field, the route read `doing`.
 *The code was correct. The document was consistent. What was broken was the RELATION between
 *them - and a relation is invisible from either end alone, so neither a code review nor a
 *proofread stood a chance.
 *
 *The consequence for an agent: `200 OK` and a field that disappears without a trace. No
 *error, no warning - that is, a failure that does not look like a failure.
 *
 *MCP has a sensor for this by nature: it declares its parameters machine-readably
 *(tools/list), so the pair can be checked automatically - and a test in mcp.test.ts does
 *check it. Prose had no sensor. This is that sensor - for both pairs where prose stands on
 *one side: JSON bodies in the skill and CLI flags across the documentation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startTestServer } from "./http-helpers.ts";
import { bearer } from "./http-helpers.ts";
import { createActor } from "../src/core/actors.ts";
import { mintToken } from "../src/core/tokens.ts";
import { createChannel } from "../src/core/conversations.ts";
import { postMessage } from "../src/core/messages.ts";
import { savePage } from "../src/core/wiki.ts";

const plik = (wzgledna: string) =>
  readFileSync(fileURLToPath(new URL(wzgledna, import.meta.url)), "utf8");

/** The path and the body sometimes sit on different lines of the same command (a backslash
 *  continuation), so we walk the lines, remembering the last path seen. */
function przykladyZeSkilla(): Array<{ sciezka: string; klucze: string[] }> {
  const out: Array<{ sciezka: string; klucze: string[] }> = [];
  let sciezka: string | null = null;
  for (const l of plik("../integrations/claude-skill/SKILL.md").split("\n")) {
    const s = l.match(/\/api\/[A-Za-z0-9_<>/\-.]+/);
    if (s) sciezka = s[0];
    const d = l.match(/-d '(\{.*)/);
    if (!d || !sciezka) continue;
    // Bodies with embedded shell quotes are not valid JSON (say a clientMsgId glued together with
    // $RANDOM), so we take the field names alone.
    const klucze = [...d[1].matchAll(/"([a-zA-Z]+)"\s*:/g)].map((x) => x[1]);
    if (klucze.length) out.push({ sciezka, klucze });
  }
  return out;
}

test("kazde pole, ktore skill kaze wyslac, jest czytane przez trase", () => {
  const przyklady = przykladyZeSkilla();
  const kod = [
    "../src/http/routes/messages.ts", "../src/http/routes/conversations.ts",
    "../src/http/routes/wiki.ts", "../src/http/routes/extras.ts", "../src/http/routes/auth.ts",
  ].map(plik).join("\n");

  let sprawdzonych = 0;
  const martwe: string[] = [];
  for (const p of przyklady) {
    for (const k of p.klucze) {
      sprawdzonych++;
      // A deliberately NARROW pattern: a bare `k:` anywhere in the route code would match on any
      // object literal and count the field as read, even though nobody takes it out of the request.
      if (!new RegExp(`body\\.${k}\\b|body\\["${k}"\\]`).test(kod)) {
        martwe.push(`${p.sciezka} -> "${k}"`);
      }
    }
  }

  // Without this assertion the test would also pass if extracting the examples stopped finding
  // anything at all - and "all of them are read" over an empty set is a true and useless
  // sentence. The first version of that extraction lost half the blocks and reported success
  // for exactly that reason.
  assert.ok(przyklady.length >= 6, `znaleziono tylko ${przyklady.length} przykladow z cialem JSON`);
  assert.ok(sprawdzonych >= 14, `sprawdzono tylko ${sprawdzonych} pol - wyciaganie sie zepsulo`);
  assert.deepEqual(
    martwe, [],
    `skill kaze wyslac pola, ktorych zadna trasa nie czyta (200 OK i cisza): ${martwe.join("; ")}`,
  );
});

/**
 * Every CLI flag shown in the documentation has to exist in the parser.
 *
 *For `atalk` the consequence of an error is SILENT and has already occurred once: the
 *`--force` and `--base` flags were not listed in KNOWN_FLAGS, so instead of working they
 *landed in the CONTENT of the wiki page being saved. No error, no message - an unknown flag
 *is an ordinary word to the parser.
 *
 *The existing test in atalk.test.ts guards the direction CODE -> parser (every flag used in
 *the code is known). This is the other direction, which that one cannot see: DOCUMENT ->
 *parser. We are teaching somebody a flag that does not exist.
 */
test("kazda flaga CLI z dokumentacji istnieje w parserze", () => {
  // Directories are READ, not listed by hand: a hard-coded list goes stale at the first new
  // document and quietly shrinks the coverage. The assertion on the number of flags found
  // caught this when that list was typed out.
  const katalog = (wzgledna: string): string[] => {
    const dir = fileURLToPath(new URL(wzgledna, import.meta.url));
    try {
      return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".md")).map((f) => wzgledna + f);
    } catch { return []; }
  };
  const doks = [
    "../README.md", "../AgentTalks.md", "../NEWS.md", "../CONTRIBUTING.md", "../SECURITY.md",
    ...katalog("../docs/"), ...katalog("../integrations/"),
  ];

  /** Only what the author marked as a command: ``` blocks and `...` inline spans.
   *  Without that, prose about a flag (say an error description in an audit) counts as its use. */
  const fragmentyKodu = (t: string): string[] => [
    ...[...t.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]),
    ...[...t.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
  ];

  const uzyte = new Map<string, Set<string>>();
  for (const d of doks) {
    let tekst: string;
    try { tekst = plik(d); } catch { continue; }
    for (const frag of fragmentyKodu(tekst)) {
      for (const l of frag.split("\n")) {
        // The CLI name has to be used AS A COMMAND - followed by a subcommand, not straight by a
        // flag. Otherwise `docker inspect agenttalks --format` would count docker's flag as ours
        // (agenttalks is a container name there).
        for (const m of l.matchAll(/(?:^|\s|\/)(atalk|agenttalks)(?:\.js)?\s+(?=[a-z])/g)) {
          let ogon = l.slice(m.index! + m[0].length);
          const koniec = ogon.search(/\||&&|;/);
          if (koniec >= 0) ogon = ogon.slice(0, koniec);
          for (const f of ogon.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
            if (!uzyte.has(m[1])) uzyte.set(m[1], new Set());
            uzyte.get(m[1])!.add(f[1]);
          }
        }
      }
    }
  }

  const zbior = (src: string, nazwa: string): Set<string> => {
    const m = src.match(new RegExp(`${nazwa} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    return new Set(m ? [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]) : []);
  };
  const znane = (src: string, nazwa: string) => new Set([
    ...zbior(src, nazwa),
    ...[...src.matchAll(/flagStr\(args,\s*"([a-z-]+)"\)/g)].map((x) => x[1]),
    ...[...src.matchAll(/args\.flags\.([a-zA-Z]+)/g)].map((x) => x[1]),
  ]);
  const parser = {
    atalk: znane(plik("../src/cli/atalk.ts"), "const KNOWN_FLAGS"),
    agenttalks: znane(plik("../src/cli/main.ts"), "const FLAGI_LOGICZNE"),
  };

  const nieznane: string[] = [];
  let ile = 0;
  for (const [cli, flagi] of uzyte) {
    for (const f of flagi) {
      ile++;
      if (!parser[cli as "atalk" | "agenttalks"].has(f)) nieznane.push(`${cli} --${f}`);
    }
  }

  // The same protection as above: an extraction that has stopped finding anything reports
  // success. Today there are 18 flags in code blocks.
  assert.ok(ile >= 15, `znaleziono tylko ${ile} flag w dokumentacji - wyciaganie sie zepsulo`);
  assert.deepEqual(
    nieznane, [],
    `dokumentacja uczy flag, ktorych parser nie zna (w atalk ladują w TRESCI): ${nieznane.join(", ")}`,
  );
});

/**
 * No event attribute in the UI may be BUILT from data.
 *
 *Found by a security review in my own, fresh code: the avatar had
 *`onerror="...${escapeHtml(initials(handle))}..."`. HTML escaping does NOT protect in that
 *position - the browser first decodes the attribute's entities and only then reads its
 *content as code, so `&#39;` comes back as an apostrophe and closes the literal.
 *
 *It was not exploitable at the time, because the handle is validated down to [a-z0-9._-] by
 *ANOTHER file. That is exactly why this test is here: a safeguard resting on validation
 *elsewhere disappears the moment somebody calls that function with a different argument, and
 *nobody notices, because nothing breaks.
 */
test("UI nie sklada atrybutow zdarzen z danych", () => {
  const dir = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
  const pliki = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(pliki.length >= 10, `znaleziono tylko ${pliki.length} modulow UI - sciezka sie zmienila`);

  const zle: string[] = [];
  for (const f of pliki) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/\bon[a-z]+\s*=\s*"[^"]*\$\{/g)) {
      zle.push(`${f}: ${m[0].slice(0, 40)}`);
    }
  }
  assert.deepEqual(
    zle, [],
    "atrybut zdarzenia sklejany z danych - escapeHtml tam nie chroni, uzyj data-* " +
      `i addEventListener: ${zle.join("; ")}`,
  );
});

/**
 * The response shapes in the skill have to match the LIVE server.
 *
 *Three stumbles in one night - `hits` instead of `results`, `doing` instead of `workingOn`,
 *`section.body` instead of `page.body` - were not three typos but one omission: the skill
 *said WHERE to send and was silent about WHAT comes back (@zelda, #bugs [194]). The "What
 *comes back" section closes that.
 *
 *That section on its own would be ordinary prose, though - that is, the next thing to drift
 *away from the code, which is exactly the class we are fixing. So this test calls EVERY
 *documented route on a real server and compares the top-level keys with what the document
 *promises.
 */
test("kazdy udokumentowany ksztalt odpowiedzi zgadza sie z serwerem", async () => {
  const skill = plik("../integrations/claude-skill/SKILL.md");
  const blok = skill.match(/## What comes back[\s\S]*?```\n([\s\S]*?)```/);
  assert.ok(blok, "nie ma bloku z ksztaltami odpowiedzi");

  const obietnice = [...blok[1].matchAll(/^GET\s+(\S+)\s*->\s*\{([^}]*)\}/gm)]
    .map((m) => ({ sciezka: m[1], klucze: m[2].split(",").map((k) => k.trim()).filter(Boolean) }));
  assert.ok(obietnice.length >= 12, `udokumentowano tylko ${obietnice.length} tras`);

  const s = await startTestServer();
  try {
    const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
    createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
    const token = mintToken(s.ctx, ala.id, "t").token;
    postMessage(s.ctx, { conversationId: 1, actorId: ala.id, body: "deploy poszedl" });
    savePage(s.ctx, {
      slug: "strona", title: "Strona", actorId: ala.id,
      body: "Zdanie opisujace strone.\n\n# Rozdzial\ntresc rozdzialu",
    });

    const rozjazdy: string[] = [];
    for (const o of obietnice) {
      // Placeholders are replaced with what really exists in this database.
      const url = o.sciezka
        .replace("<ID>", "1").replace("<slug>", "strona").replace("<h>", "Rozdzial")
        .replace("?q=", "?q=deploy");
      const res = await fetch(s.url + url, { headers: bearer(token) });
      if (res.status !== 200) { rozjazdy.push(`${o.sciezka}: HTTP ${res.status}`); continue; }
      const realne = Object.keys(await res.json()).sort();
      // A key with "?" is sometimes absent (say `news` arrives only once), so we do not require it -
      // but a key described WITHOUT "?" must be there, and a key the server returns and the document
      // does not describe is a documentation bug just as much as a missing one.
      const opcjonalne = new Set(o.klucze.filter((k) => k.endsWith("?")).map((k) => k.slice(0, -1)));
      const wymagane = o.klucze.filter((k) => !k.endsWith("?")).sort();
      const brakuje = wymagane.filter((k) => !realne.includes(k));
      const nadmiar = realne.filter((k) => !wymagane.includes(k) && !opcjonalne.has(k));
      if (brakuje.length || nadmiar.length) {
        rozjazdy.push(
          `${o.sciezka}: brakuje w odpowiedzi [${brakuje}], nieopisane w skillu [${nadmiar}]`,
        );
      }
    }
    // The file upload is the only non-GET route in this block, and the block promises that all of
    // it is checked - so it has to be checked, otherwise a document about untruths contains an
    // untruth. Its body cannot be derived from the description the way a GET path can, hence the
    // explicit case.
    const plikowa = blok[1].match(/^POST\s+(\S+)\s*->\s*\{([^}]*)\}/m);
    assert.ok(plikowa, "znikl opis wysylki pliku - albo zmienil ksztalt zapisu");
    const res = await fetch(`${s.url}/api/conversations/1/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain",
                 "x-file-name": encodeURIComponent("z testu.txt") },
      body: "tresc",
    });
    assert.equal(res.status, 201, "trasa wysylki pliku z dokumentacji nie odpowiada 201");
    const realneP = Object.keys(await res.json()).sort();
    const opisaneP = plikowa[2].split(",").map((k) => k.trim()).filter(Boolean).sort();
    if (JSON.stringify(realneP) !== JSON.stringify(opisaneP)) {
      rozjazdy.push(`${plikowa[1]}: skill mowi [${opisaneP}], serwer oddaje [${realneP}]`);
    }

    assert.deepEqual(rozjazdy, [], `ksztalty rozjechaly sie z serwerem:\n  ${rozjazdy.join("\n  ")}`);
  } finally {
    await s.close();
  }
});

/**
 * Every import between UI modules has to point at an export that exists.
 *
 *ES modules are not forgiving: importing a name a module does not export blows up the WHOLE
 *graph at load - the user gets a blank page rather than a broken fragment. This layer has no
 *browser tests at all, so the only check was opening the page by hand. Today I changed
 *imports in four modules and checked it only at the end, in a browser.
 *
 *The test does the same thing, only on every run and without a browser.
 */
test("moduly UI: kazdy import ma odpowiadajacy eksport", () => {
  const dir = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
  const pliki = readdirSync(dir).filter((f) => f.endsWith(".js"));

  const eksporty = new Map<string, Set<string>>();
  for (const f of pliki) {
    const src = readFileSync(dir + f, "utf8");
    const n = new Set<string>();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([\w$]+)/gm)) n.add(m[1]);
    for (const m of src.matchAll(/^export\s+class\s+([\w$]+)/gm)) n.add(m[1]);
    // `export const A = 1, B = 2` declares SEVERAL names with one keyword. Taking only the first
    // produced three false alarms on the first run (and a fourth, because `$` is a legal character
    // in a name and was missing from the pattern).
    for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm)) {
      for (const czesc of m[1].split(/,(?![^(]*\))/)) {
        const r = czesc.match(/^\s*([\w$]+)\s*=/);
        if (r) n.add(r[1]);
      }
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const x of m[1].split(",")) {
        const nazwa = x.trim().split(" as ").pop()?.trim();
        if (nazwa) n.add(nazwa);
      }
    }
    eksporty.set(f, n);
  }

  const bledy: string[] = [];
  let sprawdzonych = 0;
  for (const f of pliki) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)"/gs)) {
      const cel = m[2];
      if (!eksporty.has(cel)) { bledy.push(`${f} -> nie ma modulu ${cel}`); continue; }
      for (const x of m[1].split(",")) {
        const nazwa = x.trim().split(" as ")[0].trim();
        if (!nazwa) continue;
        sprawdzonych++;
        if (!eksporty.get(cel)!.has(nazwa)) {
          bledy.push(`${f} importuje "${nazwa}" z ${cel}, ktory tego nie eksportuje`);
        }
      }
    }
  }

  // Without this threshold a broken extraction would report "all is well" - and that is exactly
  // how the first version of this check behaved.
  assert.ok(sprawdzonych > 250, `sprawdzono tylko ${sprawdzonych} powiazan - wyciaganie sie zepsulo`);
  assert.deepEqual(bledy, [], `zepsute importy - strona nie wstanie w ogole:\n  ${bledy.join("\n  ")}`);
});
