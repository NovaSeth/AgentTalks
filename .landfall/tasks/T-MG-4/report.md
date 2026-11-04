---
red: {"command":"node --test test/core/actors.test.ts test/ui-sidebar-presence.test.ts","exit":1,"excerpt":"19 tests: 14 passed, 5 failed. Token activity: 1300 !== 2000. Sidebar classifier: undefined !== function."}
green: {"command":"node --test test/core/actors.test.ts test/ui-sidebar-presence.test.ts test/ui-moduly.test.ts test/ui-start.test.ts test/jezyk.test.ts","exit":0,"excerpt":"32 tests: 32 passed, 0 failed."}
---

# Report: T-MG-4, implementation round 1

Status: DONE_WITH_CONCERNS

Worktree: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-4`  
Branch: `task/T-MG-4-pr1-sidebar-avatary-fade`  
HEAD: `1119b04`. No commits or pushes; the final External run instruction leaves committing to the orchestrator.

All five findings are addressed. Full-suite verification remains blocked by sandbox networking restrictions.

## Findings and RED/GREEN evidence

| Finding | Problem and fix | RED / GREEN |
|---|---|---|
| 1 | Added fixed-timestamp tests for every activity source winning and creation-only fallback. Extracted and tested `presenceBucket`. Added avatar-cache coverage. | Missing classifier failed four assertions. Existing activity cases initially passed. Temporarily omitting avatar propagation made its test fail: `undefined !== 'h123'`; restored implementation passes. |
| 2 / F4 | Included `tokens.last_used_at` in the activity maximum. | Token-winning fixture returned `1300` instead of `2000`; now passes. |
| 3 / F5 | Restricted message activity to undeleted messages in public conversations. | Private, DM, group, and deleted-public fixtures each returned `2000` instead of `1000`; all four now pass. |
| 4 / F3 | Replaced whole-history aggregates with correlated, indexed actor lookups. Existing indexes suffice; no migration added. | Query-plan test detected message/session scans; now confirms indexed searches. Timing below. |
| 5 / F2 | SSE message handling updates both cached and listed activity, redraws the sidebar immediately, and prevents older replayed messages from moving activity backwards. | Message events left actors `faded` or `archived`; both now become `active`, without another fetch. |

Added **17 tests**. No existing tests removed or weakened. No dependencies added.

## Files

- `src/core/actors.ts`: activity calculation, visibility filtering, indexed queries.
- `src/http/ui/js/data.js`: retain activity timestamp alongside avatar.
- `src/http/ui/js/view-sidebar.js`: exported classifier used by rendering.
- `src/http/ui/js/sse-events.js`: immediate local activity updates.
- [test/core/actors.test.ts](/Users/michal/Documents/Code/AgentTalks-wt/T-MG-4/test/core/actors.test.ts): source, privacy, and query-plan tests.
- [test/ui-sidebar-presence.test.ts](/Users/michal/Documents/Code/AgentTalks-wt/T-MG-4/test/ui-sidebar-presence.test.ts): classifier, avatar, SSE, and rendering tests.

## Performance

Node v26.0.0; in-memory SQLite; 50 actors and 10,000 public messages; 20 warmups followed by 100 measured calls.

| Measurement | Median | p95 | Maximum |
|---|---:|---:|---:|
| `listActors` | 2.60 ms | 2.84 ms | 3.86 ms |
| Authenticated `GET /api/actors` handler, including JSON serialization | 2.65 ms | 2.80 ms | 3.43 ms |

The handler measurement runs in-process. Actual HTTP transport timing could not be measured: the sandbox rejects localhost listeners with `listen EPERM`.

## Gates

Required commands ran in order, without pipes.

| Command | Result | Exit |
|---|---|---:|
| `npm test` | 339 tests: 232 passed, 107 failed; every failure reports `listen EPERM` | 1 |
| `npm run typecheck` | Passed | 0 |
| `landfall secrets --staged` | Clean; index contains no staged changes | 0 |

Additional verification:

- Focused regression, UI parsing/startup, and comment-language checks: **32 passed, 0 failed**.
- `landfall secrets --artifact <file>`: all six changed files clean.
- `git diff --check`: passed.

Every full-suite failure is named with its stack trace in [.r1-npm-test.log](/Users/michal/Documents/Code/AgentTalks-wt/T-MG-4/.r1-npm-test.log). Failures comprise API (71), MCP (16), SSE (12), CLI (3), E2E (2), HTTP UI modules (2), and documentation (1).

The additional whole-worktree secrets scan exited 1 with 10 findings in unchanged files: `deploy/instance.env.example:25,31`, `docs/docker.md:87`, `integrations/claude-skill/SKILL.md:366`, `src/http/ui/install.html:83`, `test/cli/atalk.test.ts:210`, and `test/http/api.test.ts:1126,1137,1143,1239`.

## E2E assertions reviewed

Real UI modules execute against minimal browser and EventSource substitutes. Tests verify restored sidebar HTML, preserved avatars, unchanged network-request count, and replay protection. Live HTTP/E2E execution requires an environment permitting localhost listeners.

## Shared gaps and deviations

- Orchestrator must rerun the full gates and live HTTP benchmark outside this sandbox.
- Changes remain uncommitted for orchestrator review.
- The requested report destination is outside the writable worktree; this response contains the complete report.
- No findings disputed.
## Orchestrator gate re-run (outside the codex sandbox)
npm test: 339 pass, 0 fail. npm run typecheck: clean. landfall secrets --range 1119b04..HEAD: clean. Committed as 6940177.
Status: DONE
