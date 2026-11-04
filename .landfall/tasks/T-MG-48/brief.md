# Test B-MG-94/B-MG-32 ratio guards: interleave small/large runs and widen the margin so CPU load cannot trip them (T-MG-48)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: standard; kind: task). Deliverable kind: test-only robustness fix.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-48 (branch task/T-MG-48-ratio-guards-load from main at e78f107f8d17; dependencies installed: no — run `npm ci` first). Never rebase. Budget 25 minutes.
Rules: ORC-2 COD-3 COD-12 ORC-7; read them with `landfall rule <ID…>`. Decision D-MG-36 (/Users/michal/Documents/Code/AgentTalks/.landfall/decisions/D-MG-36.md): a wall-clock bound may become a load-independent check that still catches the regression.

## Problem (the production deploy gate, 2026-11-04 ~21:00, machine load ~34)
`bash deploy/push-and-deploy.sh` stopped on: `test/fixes/t-mg-11-hardening.test.ts:148` "digestFor on 300k unread rows is fast (B-MG-94)" — "digestFor cost grew with history: 25.02 ms at 20k rows, 128.44 ms at 300k" (ratio 5.13 > threshold 5). T-MG-36 turned the absolute bound into a ratio of best-of-7 timings measured back to back (all small runs, then all large runs), so a load spike during one block skews the ratio. Its own evidence: the real regression (cap removed) gave 417 ms vs 17 ms (~24x); capped it is ~1-2x normally. The sibling B-MG-32 unreadFor guard in `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-48/test/fixes/t-mg-7-data.test.ts` uses the same pattern (capped ratio 2.2 vs threshold 5).

## Scope
Modify only the two tests' measurement helpers and thresholds in `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-48/test/fixes/t-mg-11-hardening.test.ts` and `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-48/test/fixes/t-mg-7-data.test.ts`. Test titles unchanged. No production code.

## Acceptance
1. Interleave the measurements (small, large, small, large, ... — e.g. 9 pairs) on the two datasets built once each, and compare robust statistics (e.g. the median of per-pair ratios, or min/min over interleaved runs) so a load spike hits both sides.
2. Threshold set with margin on both sides and justified in a `// D-MG-36:` comment: well above the capped ratio under load, well below the regression ratio (~24x for digestFor; measure it for unreadFor).
3. Prove both guards still catch their regression: remove the cap locally (do not commit), run each test, paste the failure in the report, restore.
4. Prove load tolerance: run each test 10 times while the machine is loaded (e.g. run them concurrently with `landfall heavy -- npm run test` in another process, or 4 parallel copies); report pass counts (must be 10/10).
5. No test removed, skipped or weakened beyond D-MG-36 (COD-3).

## Gate
`landfall heavy -- npm run test`, `npm run typecheck`. One commit; no push.

## Report
/private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-48-report.md, starting with the frontmatter `---` / `red: {"command": …, "exit": 1, "excerpt": …}` (the cap-removed run) / `green: {"command": …, "exit": 0, "excerpt": …}` / `---`, then the Status line, the regression ratios, the load pass counts. Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
