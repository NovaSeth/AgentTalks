# UI catch-up reconcile: keep owed ranges after a failed read and past the round cap (B-MG-121, B-MG-122) (T-MG-46)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:designer (class: standard; concurrent client-state code, strongest model). Deliverable kind: a working fix in the shipped web UI's SSE catch-up reconcile.
Review: cross-provider (Codex) after your report.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-46 (branch task/T-MG-46-reconcile-owed-ranges from main at 56aeb7a22d25; dependencies installed: no — run `npm ci` first). Never rebase. Another task (T-MG-44, unread highlights) may add a small read-confirmed hook in data.js's markReadDebounced: do not touch that function.
Budget: 45 minutes.
Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 REV-5 ORC-7 PRI-2 PRI-6 PRI-15; read them with `landfall rule <ID…>`. Decision in force: D-MG-40 (the catch-up refreshes held rows unless a live event changed them during the request; reactions merge separately); D-MG-43 (why this is a follow-up).

## Background
T-MG-43 (merged in 56aeb7a) added a reconcile pass in `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-46/src/http/ui/js/data.js` (~lines 150-180): reads of a conversation that overlap re-read their message range once nothing is in flight, so the server answers last; at most 3 rounds. Read T-MG-43's report for the rule and ordering argument: `/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-43/report.md` (sections "Fix round 1" and "Fix round 2").

## Findings to fix (Codex review r3 of T-MG-43, filed in the backlog; each has an in-memory ui-t18 repro)
- B-MG-121 (`/Users/michal/Documents/Code/AgentTalks/.landfall/findings/B-MG-121.json`), data.js:177: repeat the F2 scenario but return HTTP 500 once for after=0&limit=2; after reconnect body(1)='m1' and reactions[1]=undefined instead of the outage edit and reaction. reconcile deletes owed ranges before reading and discards them on failure. Keep unfinished ranges and retry after reconnect/backoff.
- B-MG-122 (`/Users/michal/Documents/Code/AgentTalks/.landfall/findings/B-MG-122.json`), data.js:157: the 3-round cap discards unresolved overlaps; three times delay reconciliation before its cut and hold a later reaction refresh after its cut, edit/react message 1, deliver reconciliation then refresh; append 3..32 and reconnect → body/reaction remain 'round2', expected 'round3'. Keep owed ranges when yielding at the cap and schedule further repair (bounded, no busy loop).

## Scope
Modify: data.js (the reconcile functions only). Tests: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-46/test/ui-t18-catchup.test.ts` (extend). Nothing else; a gap → NEEDS_CONTEXT.

## Acceptance
1. B-MG-121's repro is a test, RED on 56aeb7a, GREEN after: owed ranges survive a failed read and are re-read after reconnect/backoff.
2. B-MG-122's repro is a test, RED on 56aeb7a, GREEN after: owed ranges survive the cap and a later repair resolves them.
3. No unbounded loop or request storm: show the bound (retry/backoff, a pending flag) in a test.
4. All existing catch-up tests stay green (F4 rule of T-MG-18, T-MG-43 rounds 1-2). No test removed or weakened (COD-3).
5. The report states the owed-range lifecycle (created, retried, cleared) and why no newer state can be overwritten.

## Gate
`landfall heavy -- npm run test`, `npm run typecheck`. One commit per step; no push.

## Report
/private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-46-report.md, starting with the frontmatter `---` / `red: {"command": …, "exit": 1, "excerpt": …}` / `green: {"command": …, "exit": 0, "excerpt": …}` / `---`, then the Status line and per-point decisions. Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
