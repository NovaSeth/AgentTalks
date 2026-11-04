# Deploy gate: show failing tests and fix the flaky one that stops push-and-deploy.sh (T-MG-36)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: standard — 3 files > 2; 60 LOC > 30; kind: task). Deliverable kind: a working fix of the deploy script's test gate and of the flaky test(s).
Review: none
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-36 (branch task/T-MG-36-deploy-gate-flaky from main at 3b666b9eda33; dependencies installed: no — run `npm ci` in the worktree first). Update the branch only with `git merge origin/main`, never rebase. No dependencies on other tasks.
Budget: 40 minutes; when it nears, stop at a green commit and list the rest under Follow-up in the report.
Shared brief: none.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-12 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14; read them with `landfall rule <ID…>`. Decision D-MG-36 (read /Users/michal/Documents/Code/AgentTalks/.landfall/decisions/D-MG-36.md) allows replacing a wall-clock bound in a test by a load-independent check that still catches the regression; cite it next to the changed assertion (COD-12).

## Problem (Michal, the human owner, and the deploy notes, 2026-11-04)
`bash deploy/push-and-deploy.sh` stops on its local test gate although `npm test` run by hand passes: on 2026-11-04 the gate failed 2 out of 3 runs, while a manual `npm test` passed 3 out of 3. Two defects:
1. `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/deploy/push-and-deploy.sh:26` runs `npm test >/dev/null || fail "tests failed"`: all output is thrown away, so nobody can see WHICH test failed. Same for typecheck at line 27.
2. A test is load-sensitive. Main suspect (not proven): `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/test/fixes/t-mg-11-hardening.test.ts:121-144` "digestFor on 300k unread rows is fast (B-MG-94)" asserts `ms < 50` on wall-clock time; `npm test` (`node --test --test-timeout=20000 "test/**/*.test.ts"`, package.json) runs test files in parallel, so under load this bound can fail while the code is fine. There may be other wall-clock bounds or timing races; find them, do not guess.

## Scope
Modify: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/deploy/push-and-deploy.sh`, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/test/fixes/t-mg-11-hardening.test.ts`, and any other test file in `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/test/` that you PROVE is flaky (name it in the report with the evidence). Create if useful: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/test/deploy-gate.test.ts` (or extend `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/test/fixes/t-mg-2-deploy.test.ts`, which already covers the deploy scripts). No production code under src/ unless the evidence shows a real bug there: then stop with NEEDS_CONTEXT and describe it (ORC-17).

## Contracts
Consumes: package.json scripts `test` and `typecheck` (unchanged). Produces: the same deploy script contract (same steps, same order, same STOP semantics, exit 1 on a failed gate); only its failure output changes.

## Acceptance
1. When the test gate fails, push-and-deploy.sh prints the names of the failing tests and enough of their failure (assertion message, file) to act on, then STOPs with exit 1. On success it stays quiet (one "OK" line as now). The full log is kept in a temp file whose path is printed on failure. Same treatment for the typecheck gate (print tsc errors on failure).
2. The gate is NOT weakened or bypassed: no retry-until-green, no skipped tests, no `|| true`, no lowered concurrency hidden as a fix for a flaky test. (Running the suite with bounded concurrency is allowed only if you justify it as matching CI, not as hiding flakiness.)
3. Find the flaky test(s) with evidence: run the full suite repeatedly under load through the heavy queue (e.g. 5 runs of `npm test` via `landfall heavy -- npm test`, or the single file under concurrent load) and record which tests failed and how often. Report the counts. If the B-MG-94 test is not the culprit, say so and fix the one that is.
4. Each flaky test is made load-independent per D-MG-36 while still failing on the regression it guards: for B-MG-94 the check must still fail if `digestFor` (`/Users/michal/Documents/Code/AgentTalks-wt/T-MG-36/src/core/digest.ts`) stops capping per conversation at UNREAD_CAP and scans every unread row. Show this: temporarily break the cap locally (do not commit the break), run the test, paste the failure in the report, restore. Options include asserting the query plan (EXPLAIN QUERY PLAN), counting rows visited, or a relative comparison against the uncapped scan in the same process; choose one and justify it.
5. No test is removed or skipped (COD-3); the assertion change is cited with `// D-MG-36: ...` next to it.
6. A test covers acceptance point 1 (e.g. run the gate step of the script, or a function extracted from it, against a stub `npm` on PATH that fails, and assert that the failing test name reaches the output and the exit code is 1). It must not touch the network, git remotes, ssh or the real server.

## TDD
RED first: the test for point 1 fails on the base script (output swallowed). For point 4, the evidence of the broken-cap run is the RED proof of the rewritten guard.

## E2E
You run no real deployment, no ssh, no rsync, no gh. The orchestrator runs the real deploy afterwards. Existing flow assertions touched: test/fixes/t-mg-2-deploy.test.ts (deploy script content checks) — keep them passing.

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
If the shell guard refuses the NODE_OPTIONS line, run the equivalent TAP command through `landfall heavy` as T-MG-29 did. `landfall secrets` exits 1 on a pre-existing baseline (D-MG-8) outside this task's files: report it, do not fix it. One commit per step; no push. A full suite runs through the heavy queue: `landfall heavy` with the command after `--`.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-36/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/task/report.md). If the harness refuses that write, write it to /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-36-report.md and say so. Contents: the `Status:` line, decisions per acceptance point, files, RED/GREEN, the flakiness counts, gate, open issues.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
