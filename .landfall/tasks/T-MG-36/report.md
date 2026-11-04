---
red: {"command": "node --test test/deploy-gate.test.ts (base push-and-deploy.sh)", "exit": 1, "excerpt": "AssertionError: the failing test name reaches the output; actual: '== local tests and types\nSTOP: tests failed\n'. Typecheck test: expected /error TS2322/, got 'STOP: tsc reports errors'. Guard proof: B-MG-94 with cap removed (LIMIT -1) fails (300k rows 416.70 ms vs 20k rows 17.49 ms)."}
green: {"command": "landfall heavy -- npm test", "exit": 0, "excerpt": "tests 1053 pass 1053 fail 0 (typecheck exit 0)"}
---
# Report: Deploy gate shows failing tests, flaky wall-clock tests made load-independent (T-MG-36)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-36, task/T-MG-36-deploy-gate-flaky. Commits: dccf3ad (RED test + gate fix), ae69636 (B-MG-94 guard), 547db89 (B-MG-32 and R1-F5 guards). Push: no.
Status: DONE_WITH_CONCERNS

## Decisions
1. Gate output: npm test / typecheck write to a mktemp log; success deletes it and prints only "  OK". Test failure prints node:test's "failing tests:" section (names, file, assertion; max 150 lines; tail 60 if absent), "full log: <path>", STOP, exit 1. Typecheck: first 60 tsc lines + log path.
2. No retry, skip, `|| true` or lowered concurrency.
3. The B-MG-94 suspect is NOT the culprit. Proven flaky: B-MG-32 unreadFor `< 50 ms` (t-mg-7-data.test.ts) and R1-F5 `ms < 200` (t-mg-10-r1-mcp.test.ts).
4. B-MG-94 and B-MG-32: best-of-7 cost at 20k vs 300k rows in one process, assert big < 5 x small (D-MG-36 comments). EXPLAIN QUERY PLAN rejected: the plan is the same with and without LIMIT. Broken-cap proof: B-MG-94 with LIMIT -1 fails (416.70 ms vs 17.49 ms). B-MG-32 with LIMIT -1 fails, but on the earlier `unread === UNREAD_CAP` assertion, the ratio line was not reached. Breaks reverted, not committed. R1-F5: clock bound removed; the 60 MB body is never sent, so any answer proves the early 413; a server waiting for the body hits the no-response timeout (now 15 s).
5. No test removed or skipped, names unchanged.
6. test/deploy-gate.test.ts (3 tests): real script in a throwaway git repo, stub npm, stub ssh/rsync/gh that fail if reached.

## Files
- deploy/push-and-deploy.sh; test/deploy-gate.test.ts (new); test/fixes/t-mg-11-hardening.test.ts; test/fixes/t-mg-7-data.test.ts; test/fixes/t-mg-10-r1-mcp.test.ts.

## RED / GREEN
- RED: deploy-gate tests failed on the base script (output to /dev/null).
- GREEN: full suite 1053 pass, 0 fail.

## Flakiness counts
- 5 plain full `npm test` runs via landfall heavy (worktree changed during runs 3-5): 1 failure, run 4, B-MG-32 "unreadFor took 56.8 ms".
- Base tests under 24 CPU burners, 5 runs each: R1-F5 5/5 failed (378-550 ms), B-MG-32 4/5 failed (52-103 ms), B-MG-94 0/5 (17-27 ms; also 0/5 under 10 burners).
- After fixes, same load: 0/5 each.
- Other wall-clock bounds not proven flaky, left alone: hooks.test.ts <3000, sse <1000/<5000, t-mg-10-mcp-limits <1000, wake-bridge <5000, t-mg-21-r1 >=300.

## Gate
| Command | Result | Exit |
|---|---|---|
| tests (landfall heavy -- npm test) | 1053 pass, 0 fail | 0 |
| typecheck | clean | 0 |
| secrets scan | 10 findings outside this task (baseline D-MG-8) | 1 |

## Open issues
- Evidence is by reproduction under artificial load, not the original failing log.
- B-MG-32 capped ratio is 2.2 against threshold 5 (uncapped about 15-24x).
- The report could not be written to the .landfall path (harness refused); stored here instead.

## Fix round 1 (coordinator message: SIGPIPE under pipefail)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| `sed ... | head -n 150` can die with exit 141 under `set -euo pipefail` before "full log:" and STOP print | replaced by `awk '/failing tests:/{p=1} p && n++ < 150' "$GATE_LOG"` (no pipe); new test with a 100000-line failing section asserts exit 1, "full log:", "STOP: tests failed", output capped | RED: the new test failed on the sed version (exit not 1; 600 lines was too small to trigger SIGPIPE, 100000 lines reproduces it). GREEN: deploy-gate + t-mg-2-deploy 6 pass | ec7ddaa |
Gate: `landfall heavy -- npm test` 1054 pass, 0 fail (exit 0). Typecheck and secrets unchanged from round 0 (no src or type changes).
Status: DONE_WITH_CONCERNS
