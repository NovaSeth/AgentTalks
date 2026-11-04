# T-MG-2 English slices - common part for every codex run (read first, then your slice section)

Task: translate the whole AgentTalks project to English (owner: "projekt Agenttalks musi byc po angielsku caly"). Spec and plan: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-2/spec.md. THE single source of every rename: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-2/vocabulary.md (error codes, MCP tags, file renames, conventions). Decisions: D-MG-6, D-MG-15 (codes/tags + legacyCode), D-MG-16 (renames, env fallback, i18n-pl stays, docs translated, history untouched).

Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-2 (branch task/T-MG-2-english). The orchestrator commits between slices; you do NOT commit (your sandbox cannot write .git). Do not push. Work only inside the worktree.

Rules:
- Behavior does not change except the strings, codes and tags the vocabulary names. Every rename is total within your slice: definition, every use, imports, tests that assert it, docs that quote it.
- Test titles: translate the title only; the test body stays identical except for strings/codes the vocabulary renames (COD-3: a rename is not a removal). Never delete, skip or weaken a test.
- Strip-only TypeScript (no enum, no parameter properties, no namespace). No new dependency.
- Plain, actionable English for user/agent-visible text; error messages say what to do next.
- Keep src/http/ui/js/i18n-pl.js VALUES Polish (it is the Polish UI translation); its keys follow the English source.
- Comments English, no em-dash character.
- A Polish name not in the vocabulary: choose an English one by the conventions, use it consistently, and list it under "Vocabulary additions" in your report.

Verification you can run in the sandbox (no localhost listeners there): `npm run typecheck`; `node --test` on test files that do not start a server (core/, store/, ui-moduly, ui-start, i18n, jezyk/language); grep checks for leftovers in your scope. The orchestrator runs the full suite outside the sandbox after your run.

Report (your final output, start with the line `---`):
```
---
red: {"command": "<a check that showed Polish leftovers before your change>", "exit": 1, "excerpt": "<counts>"}
green: {"command": "<the same check after>", "exit": 0, "excerpt": "<zero leftovers + tests you ran>"}
---
## Slice <EN-n>
Status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
Files changed / renamed: ...
Vocabulary additions: ...
Checks run and results: ...
Left for later slices (outside your scope): ...
```
