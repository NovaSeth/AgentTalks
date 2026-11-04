# T-MG-2 slices EN-2 .. EN-7 (one codex run each, in this order)
Read first: slice-common.md and vocabulary.md in /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-2/. Do ONLY your slice; earlier slices are committed already.

## EN-2 agent surface
Scope: src/mcp/server.ts (every string: tool and parameter descriptions, results, headings, hints, errors; tags per vocabulary section 2; identifiers stay for EN-4 unless trivial in the same line), src/core/guidelines.ts, src/core/news.ts (format strings; NEWS.md content is EN-7), src/core/digest.ts (the 'rozmowa prywatna' SQL literal), src/core/untrusted.ts if any Polish, AgentTalks.md, integrations/claude-skill/SKILL.md, integrations/claude-code/skills/agenttalks/SKILL.md, integrations/claude-code/README.md, integrations/claude-code/hooks/atalk-hook.sh (comments, messages; `grep -v '^Brak nowych'` must follow the CLI's new English "no new messages" text - coordinate: the CLI string changes in EN-3, so in EN-2 make the hook accept BOTH the old and the new phrase), tests asserting these strings (test/mcp/**, test/fixes/t-mg-10-*).
Add to NEWS.md a new top section (English) "Error codes and agent tags are English" with the code table (old -> new), the tag table and the note that `legacyCode` carries the old code until 0.4.0.
Leftover check: Polish words/diacritics in string literals of the scoped src files = 0 (use the K1/K2 lists from test/jezyk.test.ts).

## EN-3 CLI
Scope: src/cli/atalk.ts, src/cli/main.ts (help texts, output, errors, prompts, identifiers), bin/*, the hook's accepted phrase (drop the old Polish one now), tests in test/cli/**. Output formats that agents parse (e.g. `GRANTED`, cursor lines) keep their tokens; translate words around them. `atalk help` and `agenttalks help` fully English.

## EN-4 server identifiers and strings
Scope: src/core/** (except files done in EN-2), src/http/** except src/http/ui/**, src/store/**, src/importer/**, src/config.ts, src/version.ts: identifiers (vocabulary conventions), remaining Polish strings (error MESSAGES next to the English codes, log lines), and the rename src/core/awatary.ts -> src/core/avatars.ts with every import. Tests that import renamed identifiers.

## EN-5 UI
Scope: src/http/ui/** and src/http/ui.ts: file renames (vocabulary section 3) with every import and the module whitelist, identifiers, CSS class names and comments in app.css (keep classes consistent across JS/CSS/HTML), index.html, gate.html, install.html strings, i18n-pl.js KEYS that are Polish identifiers (values stay Polish), Polish strings outside i18n (toasty 'Zamknij', 'Powiadomienia, N nowych', markdown 'Kopiuj'/'strona wiki', 'Upusc, zeby zalaczyc', gate 'Dalej' - each becomes a t() key with an i18n-pl value). Tests: test/ui-*.test.ts, test/http/ui-moduly.test.ts, test/i18n.test.ts, test/fixes/*ui* imports of renamed modules.

## EN-6 tests
Scope: test/**: every test title to English (body identical except identifiers/strings already renamed), identifiers in tests, file renames test/dokumentacja.test.ts -> test/docs.test.ts, test/e2e/rozmowa.test.ts -> test/e2e/conversation.test.ts (test/jezyk.test.ts is renamed in EN-7 together with the gate extension). Synthetic Polish test VALUES that exercise Polish input (e.g. transliteration, diacritics handling, Polish UI translation) stay and get a one-line comment saying why.

## EN-7 docs, deploy, the language gate
Scope: every Markdown file (docs/** including audits, superpowers plans/specs and prototype docs, README.md, CONTRIBUTING.md, SECURITY.md, NEWS.md history sections, docs/docker.md: also fix TD-F8 drift: what the image contains, and that wiki attachments are readable by every signed-in actor), deploy/* renames per vocabulary with the env fallback (/etc/agenttalks/instance.env, fallback instancja.env) in both scripts and docker-compose.yml/Dockerfile comments, docs/obrazy -> docs/images (update README image links), and the extended language gate: rename test/jezyk.test.ts -> test/language.test.ts and extend it per spec criterion 1 (file names, test titles, string literals in src/** and bin/** except i18n-pl.js, identifiers, comments, Markdown; one allowlist file test/language-allowlist.txt with a reason per entry; each check with a negative probe that proves it fires). The gate must pass on the whole tree at the end of this slice.
