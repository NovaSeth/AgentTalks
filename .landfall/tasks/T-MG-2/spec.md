# T-MG-2 - spec and plan: the whole AgentTalks project in English

Owner's words (2026-11-04): "projekt Agenttalks musi byc po angielsku caly" ("the whole AgentTalks project must be in English") (D-MG-6). Starts after the T-MG-1 fix packages (T-MG-6, T-MG-8, T-MG-10, T-MG-11) and the plugin (T-MG-12) are merged, from that merged main.

## Current state (measured 2026-11-04 at 945674f, scratchpad en/inventory.txt)
- Comments: already English, guarded by test/jezyk.test.ts (K1 diacritics + K2 Polish word list, quotes excluded).
- Not guarded and Polish: 24 file names (src/http/ui/js/widok-*.js, akcje.js, dane.js, stan.js, szukaj.js, toasty.js, ikony.js, zdarzenia-sse.js, src/core/awatary.ts, test/dokumentacja.test.ts, test/jezyk.test.ts, test/e2e/rozmowa.test.ts, deploy/uruchom-produkcje.sh, deploy/wypchnij-i-wdroz.sh, deploy/instancja.env.przyklad, docs/obrazy/*, one superpowers spec); 262 of 322 test titles; ~666 user/agent-visible string literals (src/mcp/server.ts 144, src/cli/atalk.ts 61, src/cli/main.ts 34, src/core/wiki.ts 27, webauthn.ts 20, ...); 50 API error codes (`brak_dostepu`, `konflikt_wiki`, `token_wygasl`, ...); ~250 identifiers (`trescKomentarza`, `KORZEN`, `nazwaAktora`, ...); MCP output tags (`<michal:czlowiek>`, `PYTANIE`, `watek:`); CLI help and output; 8 docs in docs/ (audits, superpowers plans/specs, prototype docs) in Polish.
- No Polish names in the SQLite schema (checked src/store/schema.ts) -> no data migration.
- The UI keeps an English source (src/http/ui/js/i18n.js) and a Polish translation (i18n-pl.js): that is a product feature and stays. The UI maps server error codes to messages by code (src/http/ui/js/api.js:45 `ERRORS = { brak_dostepu: ..., sesja: ... }`), so codes must change atomically across server, UI, CLI, MCP and tests.

## Success criteria
1. An extended language gate (test/language.test.ts, successor of test/jezyk.test.ts) passes on the whole tree with these checks at ZERO hits, each with a negative probe that proves it can fire: file names; test titles; string literals in src/** and bin/** except src/http/ui/js/i18n-pl.js and explicitly quoted Polish samples; identifiers (camelCase/snake_case split, K1+K2); comments (existing); Markdown in the repo except quoted Polish samples. Allowed exceptions are listed in ONE allowlist file with a reason per entry (e.g. the Polish UI translation, the transliteration table, `@wszyscy` alias).
2. `npm test` passes with the test count >= the count before T-MG-2 (renames are renames: same body, new title - COD-3).
3. `npm run typecheck` clean; E2E (scratchpad e2e.mjs, adapted to English codes) passes 100 %.
4. Agents keep working across the deploy: every HTTP error body carries the English `code` and, for one minor version (0.3.x), `legacyCode` with the old Polish code; NEWS.md (served to agents as news) and both SKILL.md files describe the change and the table of renamed codes and MCP tags.

## Approaches (SPC-4)
- A. One big codex run over everything. Fast to start, but one 45-minute cap, unreviewable diff, and a failure in the middle leaves a half-renamed tree. Rejected.
- B. Sequential slices in ONE worktree, each a codex implementer run with a shared vocabulary file (the rename tables), the orchestrator running the full gate and committing between slices; the language gate is extended LAST so it verifies every earlier slice (chosen). Cost if wrong: a later slice may need to touch a file an earlier slice already renamed - mitigated by the rename table being fixed before slice 1.
- C. Parallel slices in several worktrees. Rejected: renames ripple through imports and tests; merge conflicts would cost more than they save.

## Decisions to record (P1..P6)
- P1 error codes: English snake_case codes in one module (src/core/error-codes.ts: `export const CODES` + `LEGACY` map English -> old Polish); `respond.ts` adds `legacyCode` to every error body until 0.4.0. Table fixed in the shared vocabulary file.
- P2 MCP/agent-visible tags: `<handle:czlowiek>` -> `<handle:human>`, `<handle:agent>` unchanged; `PYTANIE` -> `QUESTION`, `odpowiedz` -> `answer`, `plik` -> `file`, `watek:` -> `thread:`, `skasowana` -> `deleted`; announced in NEWS and both skills.
- P3 file renames: the table in the shared vocabulary file; `src/http/ui.ts` module whitelist updated in the same slice; deploy env default `/etc/agenttalks/instance.env` with fallback to the old `/etc/agenttalks/instancja.env` (production VPS keeps working without a manual step).
- P4 the Polish UI translation (i18n-pl.js) and the aliases agents already use (`@wszyscy`) stay, listed in the allowlist.
- P5 historical docs (audits, superpowers plans/specs, prototype docs) are translated in full, not deleted; git history is not rewritten (irreversible, PRI-17).
- P6 commit messages from now on are English (existing history stays).

## Plan
Global Constraints for every slice: GC1 no new dependency; GC2 strip-only TS; renames keep test bodies identical (COD-3); behavior unchanged except the strings, codes and tags named in P1/P2; the shared vocabulary file is the single source of every rename (no ad-hoc names); tests stay green after every slice (orchestrator runs the full gate outside the codex sandbox and commits).

Shared vocabulary: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-2/vocabulary.md (written by the orchestrator before slice 1: file rename table, error code table, MCP tag table, identifier conventions).

Slices (codex implementer, one run each, sequential, same worktree):
| Slice | Scope | Acceptance |
|---|---|---|
| EN-1 contract | src/core/error-codes.ts (new), every `badRequest/forbidden/notFound/...` code in src/**, respond.ts legacyCode, src/http/ui/js/api.js ERRORS keys, CLI/MCP code checks, tests asserting codes | grep finds no Polish code outside LEGACY; all tests green |
| EN-2 agent surface | src/mcp/server.ts strings, tags (P2), tool descriptions; src/core/guidelines.ts; src/core/news.ts; src/core/digest.ts literal; AgentTalks.md; both SKILL.md; integrations hook text | MCP output English; tests green |
| EN-3 CLI | src/cli/atalk.ts, src/cli/main.ts help/output/identifiers; bin/* | `atalk help` and `agenttalks help` English; tests green |
| EN-4 server identifiers | src/core/**, src/http/** (non-UI), src/store/**, src/importer/**, src/config.ts identifiers and remaining strings; src/core/awatary.ts -> avatars.ts | no Polish identifier; tests green |
| EN-5 UI | src/http/ui/js/** renames + identifiers + strings (not i18n-pl.js values), src/http/ui.ts whitelist, app.css classes/comments, index.html/gate.html/install.html | UI loads (ui-start/ui-moduly tests), E2E green |
| EN-6 tests | test/** titles, identifiers, file renames | count unchanged, titles English |
| EN-7 docs, deploy, gate | docs/** translation, README/CONTRIBUTING/SECURITY/NEWS check, deploy renames with env fallback, docker-compose/Dockerfile comments, test/language.test.ts (extended gate + allowlist) | language gate green with probes; criterion 1 met |

Review: landfall:reviewer after EN-1+EN-2 (contract, agent surface) and at the end (whole diff), codex cross-review at the end. E2E by the orchestrator after EN-5 and at the end.
