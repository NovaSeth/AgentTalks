/**
 * Do the UI modules parse - and can the check that says so actually fail?
 *
 * The second half is the point. While translating the interface I used
 * `node --check <file>` as a syntax gate and reported that it is blind to ES
 * modules. @zelda measured the boundary and it turned out narrower: it is blind
 * only to a `.js` file whose module type is AMBIGUOUS (no "type": "module" in the
 * nearest package.json, no .mjs extension). This repository declares
 * "type": "module", so on the real files the gate worked.
 *
 * My error was therefore not in the tool but in the MEASUREMENT: I put the probe
 * where it was convenient to write the script - in a temporary directory, that is,
 * outside the package - and the verdict depends on the file's surroundings, not on
 * its content. Same bytes, same Node, different answer.
 *
 * The remedy that is cheaper than either analysis is @zelda's: put ONE deliberately
 * broken file into the gate's input set. It catches this on the first day and needs
 * no knowledge of module detection at all. That is the second test below.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

/** Parses source as an ES module. Returns the error message, or null when it parses.
 *
 *  Through stdin with an EXPLICIT `--input-type=module`, not `node --check <file>`:
 *  with an explicit type there is nothing left to guess, so the verdict depends on the
 *  content alone. The negative probe below is what proves that - and it would prove it
 *  for any other mechanism put here too, which is the whole point of having it. */
function syntaxError(src: string, name: string): string | null {
  const r = spawnSync(process.execPath, ["--check", "--input-type=module", "-"],
    { input: src, encoding: "utf8" });
  if (r.status === 0) return null;
  return `${name}: ${(r.stderr || "").trim().split("\n").slice(0, 3).join(" ")}`;
}

test("every UI module parses as an ES module", () => {
  const files = readdirSync(UI).filter((f) => f.endsWith(".js"));
  assert.ok(files.length >= 15, `the check sees only ${files.length} UI files; did the directory move?`);
  const invalid = files
    .map((f) => ({ f, error: syntaxError(readFileSync(UI + f, "utf8"), f) }))
    .filter((x) => x.error);
  assert.deepEqual(invalid, [], invalid.map((x) => `${x.f}: ${x.error}`).join("\n"));
});

test("the syntax gate CAN fail - a deliberately broken sample", () => {
  // Input of the same shape as the real thing (an import + an export), with one explicit error.
  // If the gate were blind - as `node --check` is on a file of ambiguous type - this line would
  // pass green and the test above would mean nothing.
  const broken = 'import { t } from "./i18n.js";\nexport const q = ;\n';
  assert.ok(syntaxError(broken, "broken-sample.js"), "the gate did NOT report an error in a broken file");
  // And the other side: a correct file of the same shape has to pass, otherwise "always red"
  // is as useless as "always green".
  const valid = 'import { t } from "./i18n.js";\nexport const q = t("x");\n';
  assert.equal(syntaxError(valid, "valid-sample.js"), null);
});
