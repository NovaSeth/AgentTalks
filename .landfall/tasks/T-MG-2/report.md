---
red: {"command": "node --test test/fixes/t-mg-2-codes.test.ts (EN-1) and the extended test/language.test.ts against the pre-T-MG-2 tree", "exit": 1, "excerpt": "219 Polish error-code literals detected; language gate: Polish file names, test titles, string literals, identifiers and markdown in src/, test/, docs/, deploy/, integrations/"}
green: {"command": "npm test && npm run typecheck && node e2e.mjs <worktree>", "exit": 0, "excerpt": "597 pass, 0 fail (after merging main incl. the plugin); typecheck clean; E2E 22/22; deploy scripts pass bash -n; language gate green with negative probes"}
---
# Report: the whole AgentTalks project in English (T-MG-2)
Status: DONE_WITH_CONCERNS
Implemented by codex in 7 sequential slices (landfall exec codex-T-MG-2-implementer-1..7), each committed by the orchestrator after the full gate outside the codex sandbox. Spec, plan and vocabulary: tasks/T-MG-2/spec.md, vocabulary.md; decisions D-MG-6, D-MG-15, D-MG-16, D-MG-20.

| Slice | Commit | Result |
|---|---|---|
| EN-1 error codes + legacyCode | 1915e3f | 491 pass |
| EN-2 agent surface (MCP, tags, skills, hook, NEWS) | e4838a5 | 491 pass (one api.test assertion updated to the translated prompt) |
| EN-3 CLI | 56fbbeb | 497 pass |
| EN-4 server identifiers + avatars.ts; JSON fields limits/note (skill + NEWS updated) | 4a2d292 | 497 pass |
| EN-5 UI modules renamed (view-*.js etc.), CSS, strings | e7d6245 | 504 pass, E2E 22/22 |
| EN-6 test titles 1:1 (count unchanged), test file renames | 659dd86 | 504 pass (SSE helper 'timeout:' prefix restored) |
| EN-7 docs, deploy renames + env fallback, extended language gate | be94491 | 518 pass, E2E 22/22 |
| fix: Landfall records untouched, gate skips the state dir | 30a28d4 | 597 pass after merging main |

Contract changes for agents (announced in NEWS.md and both SKILL.md files): English error codes with `legacyCode` until 0.4.0; MCP tags <handle:human>, QUESTION, answer, file, thread:, deleted; JSON fields limits (was limity), note (was uwaga).
Deploy: deploy/deploy-production.sh, deploy/push-and-deploy.sh, deploy/instance.env.example; default env /etc/agenttalks/instance.env with fallback to instancja.env.
Concerns: (1) EN-7 had edited Landfall process records - reverted (D-MG-20); (2) the git history keeps Polish commit messages (not rewritten, PRI-17); (3) i18n-pl.js values stay Polish by design.

## Fix round 1 (claude:reviewer review-r1 F1-F3)
Status: DONE
F1: code/tag/field tables in both SKILL.md files with a sync test against LEGACY and NEWS.md. F2: language gate scans .json (not package-lock), .py, .svg, .txt, extensionless hook/cli scripts, string literals in integrations/**/*.mjs and src/http/ui/js (not i18n-pl.js values), each with a negative probe. F3: UI ERRORS covers every human-facing code with English + Polish messages; agent-only codes listed with a reason; test enforces it.
Implemented by codex (codex-T-MG-2-implementer-8); verified by the orchestrator (REV-20: docs, gate and i18n dictionary - no data, writes, authorization or concurrency): full gate 615/0, typecheck clean, skills grep shows the tables.
