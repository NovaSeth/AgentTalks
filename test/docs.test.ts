// Polish fixture page headings and bodies exercise documented routes with user-supplied Polish content.
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

const file = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** The path and the body sometimes sit on different lines of the same command (a backslash
 *  continuation), so we walk the lines, remembering the last path seen. */
function skillExamples(): Array<{ path: string; keys: string[] }> {
  const out: Array<{ path: string; keys: string[] }> = [];
  let path: string | null = null;
  for (const l of file("../integrations/claude-skill/SKILL.md").split("\n")) {
    const s = l.match(/\/api\/[A-Za-z0-9_<>/\-.]+/);
    if (s) path = s[0];
    const d = l.match(/-d '(\{.*)/);
    if (!d || !path) continue;
    // Bodies with embedded shell quotes are not valid JSON (say a clientMsgId glued together with
    // $RANDOM), so we take the field names alone.
    const keys = [...d[1].matchAll(/"([a-zA-Z]+)"\s*:/g)].map((x) => x[1]);
    if (keys.length) out.push({ path, keys });
  }
  return out;
}

test("every field the skill instructs users to send is read by the route", () => {
  const examples = skillExamples();
  const code = [
    "../src/http/routes/messages.ts", "../src/http/routes/conversations.ts",
    "../src/http/routes/wiki.ts", "../src/http/routes/extras.ts", "../src/http/routes/auth.ts",
  ].map(file).join("\n");

  let checked = 0;
  const unused: string[] = [];
  for (const p of examples) {
    for (const k of p.keys) {
      checked++;
      // A deliberately NARROW pattern: a bare `k:` anywhere in the route code would match on any
      // object literal and count the field as read, even though nobody takes it out of the request.
      if (!new RegExp(`body\\.${k}\\b|body\\["${k}"\\]`).test(code)) {
        unused.push(`${p.path} -> "${k}"`);
      }
    }
  }

  // Without this assertion the test would also pass if extracting the examples stopped finding
  // anything at all - and "all of them are read" over an empty set is a true and useless
  // sentence. The first version of that extraction lost half the blocks and reported success
  // for exactly that reason.
  assert.ok(examples.length >= 6, `only ${examples.length} examples with JSON bodies found`);
  assert.ok(checked >= 14, `only ${checked} fields checked; extraction is broken`);
  assert.deepEqual(
    unused, [],
    `the skill instructs users to send fields no route reads (silently ignored with 200 OK): ${unused.join("; ")}`,
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
test("every CLI flag in the documentation exists in the parser", () => {
  // Directories are READ, not listed by hand: a hard-coded list goes stale at the first new
  // document and quietly shrinks the coverage. The assertion on the number of flags found
  // caught this when that list was typed out.
  const listDirectory = (relative: string): string[] => {
    const dir = fileURLToPath(new URL(relative, import.meta.url));
    try {
      return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".md")).map((f) => relative + f);
    } catch { return []; }
  };
  const docs = [
    "../README.md", "../AgentTalks.md", "../NEWS.md", "../CONTRIBUTING.md", "../SECURITY.md",
    ...listDirectory("../docs/"), ...listDirectory("../integrations/"),
  ];

  /** Only what the author marked as a command: ``` blocks and `...` inline spans.
   *  Without that, prose about a flag (say an error description in an audit) counts as its use. */
  const codeFragments = (t: string): string[] => [
    ...[...t.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]),
    ...[...t.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
  ];

  const used = new Map<string, Set<string>>();
  for (const d of docs) {
    let text: string;
    try { text = file(d); } catch { continue; }
    for (const frag of codeFragments(text)) {
      for (const l of frag.split("\n")) {
        // The CLI name has to be used AS A COMMAND - followed by a subcommand, not straight by a
        // flag. Otherwise `docker inspect agenttalks --format` would count docker's flag as ours
        // (agenttalks is a container name there).
        for (const m of l.matchAll(/(?:^|\s|\/)(atalk|agenttalks)(?:\.js)?\s+(?=[a-z])/g)) {
          let tail = l.slice(m.index! + m[0].length);
          const end = tail.search(/\||&&|;/);
          if (end >= 0) tail = tail.slice(0, end);
          for (const f of tail.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
            if (!used.has(m[1])) used.set(m[1], new Set());
            used.get(m[1])!.add(f[1]);
          }
        }
      }
    }
  }

  const setFromSource = (src: string, name: string): Set<string> => {
    const m = src.match(new RegExp(`${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    return new Set(m ? [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]) : []);
  };
  const known = (src: string, name: string) => new Set([
    ...setFromSource(src, name),
    ...[...src.matchAll(/flagStr\(args,\s*"([a-z-]+)"\)/g)].map((x) => x[1]),
    ...[...src.matchAll(/args\.flags\.([a-zA-Z]+)/g)].map((x) => x[1]),
  ]);
  const parser = {
    atalk: known(file("../src/cli/atalk.ts"), "const KNOWN_FLAGS"),
    agenttalks: known(file("../src/cli/main.ts"), "const BOOLEAN_FLAGS"),
  };

  const unknown: string[] = [];
  let count = 0;
  for (const [cli, flags] of used) {
    for (const f of flags) {
      count++;
      if (!parser[cli as "atalk" | "agenttalks"].has(f)) unknown.push(`${cli} --${f}`);
    }
  }

  // The same protection as above: an extraction that has stopped finding anything reports
  // success. Today there are 18 flags in code blocks.
  assert.ok(count >= 15, `only ${count} flags found in the documentation; extraction is broken`);
  assert.deepEqual(
    unknown, [],
    `the documentation teaches flags unknown to the parser (atalk treats them as CONTENT): ${unknown.join(", ")}`,
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
test("the UI does not build event attributes from data", () => {
  const dir = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 10, `only ${files.length} UI modules found; the path has changed`);

  const invalid: string[] = [];
  for (const f of files) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/\bon[a-z]+\s*=\s*"[^"]*\$\{/g)) {
      invalid.push(`${f}: ${m[0].slice(0, 40)}`);
    }
  }
  assert.deepEqual(
    invalid, [],
    "event attribute built from data; escapeHtml does not protect it, use data-* " +
      `and addEventListener: ${invalid.join("; ")}`,
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
test("every documented response shape matches the server", async () => {
  const skill = file("../integrations/claude-skill/SKILL.md");
  const block = skill.match(/## What comes back[\s\S]*?```\n([\s\S]*?)```/);
  assert.ok(block, "response shape block not found");

  const promises = [...block[1].matchAll(/^GET\s+(\S+)\s*->\s*\{([^}]*)\}/gm)]
    .map((m) => ({ path: m[1], keys: m[2].split(",").map((k) => k.trim()).filter(Boolean) }));
  assert.ok(promises.length >= 12, `only ${promises.length} routes documented`);

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

    const mismatches: string[] = [];
    for (const o of promises) {
      // Placeholders are replaced with what really exists in this database.
      const url = o.path
        .replace("<ID>", "1").replace("<slug>", "strona").replace("<h>", "Rozdzial")
        .replace("?q=", "?q=deploy");
      const res = await fetch(s.url + url, { headers: bearer(token) });
      if (res.status !== 200) { mismatches.push(`${o.path}: HTTP ${res.status}`); continue; }
      const actual = Object.keys(await res.json()).sort();
      // A key with "?" is sometimes absent (say `news` arrives only once), so we do not require it -
      // but a key described WITHOUT "?" must be there, and a key the server returns and the document
      // does not describe is a documentation bug just as much as a missing one.
      const optional = new Set(o.keys.filter((k) => k.endsWith("?")).map((k) => k.slice(0, -1)));
      const required = o.keys.filter((k) => !k.endsWith("?")).sort();
      const missingFields = required.filter((k) => !actual.includes(k));
      const extra = actual.filter((k) => !required.includes(k) && !optional.has(k));
      if (missingFields.length || extra.length) {
        mismatches.push(
          `${o.path}: missing from response [${missingFields}], undocumented in skill [${extra}]`,
        );
      }
    }
    // The file upload is the only non-GET route in this block, and the block promises that all of
    // it is checked - so it has to be checked, otherwise a document about untruths contains an
    // untruth. Its body cannot be derived from the description the way a GET path can, hence the
    // explicit case.
    const uploadShape = block[1].match(/^POST\s+(\S+)\s*->\s*\{([^}]*)\}/m);
    assert.ok(uploadShape, "the file upload description disappeared or its format changed");
    const res = await fetch(`${s.url}/api/conversations/1/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain",
                 "x-file-name": encodeURIComponent("z testu.txt") },
      body: "tresc",
    });
    assert.equal(res.status, 201, "the documented file upload route does not return 201");
    const actualFields = Object.keys(await res.json()).sort();
    const documentedFields = uploadShape[2].split(",").map((k) => k.trim()).filter(Boolean).sort();
    if (JSON.stringify(actualFields) !== JSON.stringify(documentedFields)) {
      mismatches.push(`${uploadShape[1]}: skill promises [${documentedFields}], server returns [${actualFields}]`);
    }

    assert.deepEqual(mismatches, [], `response shapes differ from the server:\n  ${mismatches.join("\n  ")}`);
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
test("UI modules: every import has a corresponding export", () => {
  const dir = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));

  const exportsByModule = new Map<string, Set<string>>();
  for (const f of files) {
    const src = readFileSync(dir + f, "utf8");
    const n = new Set<string>();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([\w$]+)/gm)) n.add(m[1]);
    for (const m of src.matchAll(/^export\s+class\s+([\w$]+)/gm)) n.add(m[1]);
    // `export const A = 1, B = 2` declares SEVERAL names with one keyword. Taking only the first
    // produced three false alarms on the first run (and a fourth, because `$` is a legal character
    // in a name and was missing from the pattern).
    for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm)) {
      for (const part of m[1].split(/,(?![^(]*\))/)) {
        const r = part.match(/^\s*([\w$]+)\s*=/);
        if (r) n.add(r[1]);
      }
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const x of m[1].split(",")) {
        const name = x.trim().split(" as ").pop()?.trim();
        if (name) n.add(name);
      }
    }
    exportsByModule.set(f, n);
  }

  const errors: string[] = [];
  let checked = 0;
  for (const f of files) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)"/gs)) {
      const target = m[2];
      if (!exportsByModule.has(target)) { errors.push(`${f} -> module ${target} not found`); continue; }
      for (const x of m[1].split(",")) {
        const name = x.trim().split(" as ")[0].trim();
        if (!name) continue;
        checked++;
        if (!exportsByModule.get(target)!.has(name)) {
          errors.push(`${f} imports "${name}" from ${target}, which does not export it`);
        }
      }
    }
  }

  // Without this threshold a broken extraction would report "all is well" - and that is exactly
  // how the first version of this check behaved.
  assert.ok(checked > 250, `only ${checked} bindings checked; extraction is broken`);
  assert.deepEqual(errors, [], `broken imports; the page will not start:\n  ${errors.join("\n  ")}`);
});
