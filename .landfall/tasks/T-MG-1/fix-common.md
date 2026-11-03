# Fix packages from gate T-MG-1 - common part (read first, then your task brief)

Source: gate T-MG-1 (whole-project verification of AgentTalks at 945674f). Reviews: codex (round 1, /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/reviews/codex.json) and Claude slices (round 2: s1.json, s2.json, core.json, uicode.json in the same directory, with reproductions in `<slice>.json.repro.md` and scripts under `<slice>/`).
Full text of a backlog finding: `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall findings show <B-MG-n>` (read-only command, run it from /Users/michal/Documents/Code/AgentTalks).
Spec with Global Constraints GC1-GC8 and Review Focus RF1-RF5: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-1/spec.md. GC6 is amended: everything is English (comments, identifiers you ADD, test titles you ADD). Do not translate existing Polish names or strings outside your findings: task T-MG-2 does that later in one sweep, and touching them now only creates merge conflicts.

Binding rules (read with `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall rule <ID...>`): COD-1 (test first: write it, run it, keep the failure output, then fix), COD-2, COD-3 (never remove, skip or weaken an existing test), ORC-17, REV-9 (a finding you disagree with: do not fix, describe it under DISPUTED with argument and evidence), PRI-15.
Project constraints: Node >= 24 runs .ts directly (strip-only TypeScript: no enum, no parameter properties, no namespace, `import type` for types); zero new runtime dependencies (GC1); identity only from the token/session, never from the request body (GC3); events only after commit (GC4); every content read goes through canRead (GC5); migrations forward-only, appended as a new step in src/store/schema.ts, never editing an old one (GC8); code comments English, no em-dash character (test/jezyk.test.ts).

Tests: put NEW tests in NEW files under test/fixes/ named after your task (e.g. test/fixes/t-mg-6-auth.test.ts), so the parallel fix packages never conflict in shared test files. Reuse helpers from test/helpers.ts and test/http-helpers.ts (temp DB, startTestServer, bearer, cookieAuth, openSse). One test per finding at least, asserting the exact behavior named in the brief.

Git: work only in your worktree, on your task branch. One commit per finding or per small group of related findings, message `fix(<area>): <what> (B-MG-n)`. Never push, never rebase, never touch main or other branches. The tree must be clean at the end.

Gate (run in your worktree, in order, no pipes; the full suite takes about 5 s):
```bash
npm test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets --range <base>..HEAD
```
`<base>` is the base commit named in your task brief. Baseline: 322 tests pass, 0 fail. Known false positives of `landfall secrets` on the whole tree are listed in decision D-MG-8; your range must add none.

Report: write the file your task brief names, from the template /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md, with YAML frontmatter keys `red:` (short failing output of your new tests before the fix) and `green:` (passing output after), a `Status:` line (DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED), per finding ID: problem, fix, test name, RED/GREEN; the gate output summary (test count); DISPUTED items; anything outside your file scope you needed (do not change it - name it).
Final reply: exactly 5 lines: status, commits, tests (count before/after), concerns, report path.
