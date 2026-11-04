import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEGACY } from "../../src/core/error-codes.ts";

const skills = [
  "integrations/claude-skill/SKILL.md",
  "integrations/claude-code/skills/agenttalks/SKILL.md",
];

for (const path of [...skills, "NEWS.md"]) {
  test(`${path} documents every legacy error code with its English replacement`, () => {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const rows = new Set(source.split("\n").map((line) => line.trim()));
    const missing = Object.entries(LEGACY).filter(([code, oldCode]) =>
      !rows.has(`| \`${oldCode}\` | \`${code}\` |`));
    assert.deepEqual(missing, [], `${path}: ${missing.length} missing or incorrect migration rows`);
  });
}

for (const path of skills) {
  test(`${path} explains the tag, JSON field and compatibility migration`, () => {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.ok(source.includes("## Error codes and tags are English (since 0.3.0)"));
    for (const [oldTag, newTag] of [
      ["<handle:czlowiek>", "<handle:human>"], ["PYTANIE", "QUESTION"],
      ["odpowiedz", "answer"], ["plik", "file"], ["watek:<id>", "thread:<id>"],
      ["skasowana", "deleted"], ["rozmowa prywatna", "private conversation"],
      ["limity", "limits"], ["uwaga", "note"],
    ]) assert.ok(source.includes(`| \`${oldTag}\` | \`${newTag}\` |`), `${oldTag} -> ${newTag}`);
    assert.match(source, /`legacyCode` carries the old Polish code until 0\.4\.0/);
  });
}
