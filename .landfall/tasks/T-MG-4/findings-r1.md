# T-MG-4 (PR #1, sidebar avatars + fade/archive of silent actors): findings for round 1 (claude:reviewer, Needs fixes)
<!-- Findings file (REV-5) for a fresh implementer with no session history. Authoring task: implementation + tests. -->

Executor: implementer (codex via landfall exec). Class: standard.
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-4 (branch task/T-MG-4-pr1-sidebar-avatary-fade, HEAD 1119b04, base ccd183c; npm ci done). Work ONLY in this worktree. Commit on this branch (one commit per numbered item below); never push, never rebase, never touch other branches.
Task brief with the acceptance points 1-6: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-4/brief.md (read it first).
Binding rules: write the test FIRST, run it, see it fail for the stated reason, then fix (COD-1); never remove or weaken an existing test (COD-3); Node >= 24 runs .ts directly (strip-only TypeScript: no enum, no parameter properties, no namespaces); zero new dependencies; code comments in English, no em-dash characters (test/language.test.ts enforces English comments).
Reference for tests: test/core/actors.test.ts and test/helpers.ts (temp DB, ctx), test/ui-modules.test.ts and test/ui-start.test.ts (how UI ES modules are loaded and executed under node).

## Findings
1. (Important, blocking) No test for the new behavior. src/core/actors.ts:113 (listActors lastActiveAt), src/http/ui/js/data.js:145 (avatar kept in the actor cache), src/http/ui/js/view-sidebar.js (fade >= 14 days, archive >= 90 days, online wins, back on activity). Fix: add tests.
   Tests (exact assertions):
   a. test/core/actors.test.ts: with an injected clock or fixed timestamps, lastActiveAt == max(last message ts, last session heartbeat, last token use, created_at); one case per source winning; an actor with nothing has lastActiveAt == created_at.
   b. a UI module test (new file test/ui-sidebar-presence.test.ts, same loading style as test/ui-modules.test.ts): the classifier used by view-sidebar.js returns "active" for 13 days of silence, "faded" for 14, "archived" for 90; an online actor is "active" regardless of age. If the thresholds live inline in a render function, extract a small pure exported function (e.g. presenceBucket(lastActiveAt, online, now)) and test it.
   c. the actor cache in data.js keeps the avatar field: an actor record with avatar "h123" put into the cache comes back with avatar "h123".
2. (Minor, F4) src/core/actors.ts:121: include tokens.last_used_at (tokens.ts:126, throttled to 1 min) in the MAX for lastActiveAt, because sessions rows are deleted 7 days after they die (presence.ts MARTWA_SESJA_SEK), so a read-only agent that works through its token would fade after real use. Covered by test 1a.
3. (Minor, F5) src/core/actors.ts:119: the message part of lastActiveAt must not reveal timing of messages the viewer may not see: exclude soft-deleted messages (deleted_at IS NULL) and messages in dm/group/private conversations from the MAX (activity there is still covered by sessions and token use). Test: an actor whose only message is in a private channel has lastActiveAt not equal to that message's ts.
4. (Minor, F3) src/core/actors.ts:120: avoid one full scan per call: compute the per-actor max with a correlated subquery or a GROUP BY that an index serves; add migration-free index only if the schema module has a safe place for it (src/store/schema.ts: append a new forward-only migration step, never edit an old one). Keep GET /api/actors under 5 ms on 10k messages / 50 actors (state the measured number in the report).
5. (Minor, F2) src/http/ui/js/view-sidebar.js:165 / sse-events.js:123: an archived or faded actor who posts must come back at once in an open tab: on a message event from an actor in the cache, set its lastActiveAt to the message ts locally (no extra fetch). Test in the UI module test: after applying a message event, the bucket is "active".

## Gate (run in the worktree, in order, no pipes)
```bash
npm test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets --staged
```
Baseline: 322 tests pass; after this round the count must be higher and 0 fail.

## Report
Write /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-4/report-r1-impl.md from the template /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md, with frontmatter `red:` (the failing test output before the fix, short) and `green:` (the passing output after), a `Status:` line (DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED), per finding: problem, fix, RED/GREEN; the gate results; anything DISPUTED (ID, argument, evidence) instead of fixing it. If you cannot write that file, print the whole report as your final output.
