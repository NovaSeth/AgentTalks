# UI SSE catch-up: keep REST reactions and newer revisions of held messages (B-MG-118, B-MG-119) (T-MG-43)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:designer (class: standard; concurrent client-state merge code, so the strongest model). Deliverable kind: a working fix in the shipped web UI's SSE reconnect catch-up.
Review: a scoped review by another agent after your report.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-43 (branch task/T-MG-43-sse-catchup-merge from main at a85b76d43d96; dependencies installed: no — run `npm ci` first). Update only with `git merge origin/main`, never rebase. Other tasks run in parallel on view-chat.js/app.js/view-sidebar.js/router.js (T-MG-38) and the plugin (T-MG-40): do not touch those files.
Budget: 45 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 REV-5 REV-9 ORC-7 PRI-2 PRI-6 PRI-15; read them with `landfall rule <ID…>`.

## Problem (two blocking findings from a Codex review of T-MG-18, round 4, filed in the backlog)
Read both in full: `/Users/michal/Documents/Code/AgentTalks/.landfall/findings/B-MG-118.json` and `/Users/michal/Documents/Code/AgentTalks/.landfall/findings/B-MG-119.json` (each has the exact in-memory reproduction).
Code: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-43/src/http/ui/js/sse-events.js` — `loadGapAfter` (~lines 137-157) inserts only ids not already held (`held` set, the F4 rule from T-MG-18 r3: a held message may come from a live SSE event newer than the REST page), and `mergeReactions(fresh, ...)` therefore drops the REST reactions of held messages; `catchUpLoadedHistories` (~163+) refreshes the newest 30 then pages the gap.
- B-MG-118 (F5): SSE message events carry no reactions; a message that arrived by SSE during the catch-up is held, so its REST reactions are discarded → reactions[2] undefined. Fix: merge reactions independently of the insert filter, protected against a NEWER reaction update that arrived by SSE during the request.
- B-MG-119 (F6): after a failed retry, a held gap message older than the newest-30 window keeps its pre-outage body; the held-id filter blocks the newer revision from REST. Fix: refresh held gap messages unless they changed (by a live event) during the request — e.g. track a per-message revision/edit stamp or a "touched during this request" set — while keeping F4 (a live event newer than the page must win).

## Scope
Modify: sse-events.js (and `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-43/src/http/ui/js/data.js` only if the merge helpers live there and must change). Tests: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-43/test/ui-t18-catchup.test.ts` (extend; it already has the in-memory harness the findings used). Nothing else; a gap → NEEDS_CONTEXT (ORC-17).

## Acceptance
1. B-MG-118's reproduction (from its finding text) is a test that fails on the base and passes: the REST reaction on a message held from SSE survives the catch-up; and a reaction update delivered by SSE DURING the request is not overwritten by the older REST state.
2. B-MG-119's reproduction is a test that fails on the base and passes: after the failed retry and reconnect, body(1) is the edited revision.
3. F4 still holds: the existing T-MG-18 tests in ui-t18-catchup.test.ts (both delayed-response repros) stay green; add one asserting a message edited by a live SSE event during the request keeps the live body.
4. Describe in the report the rule you implemented for "changed during the request" and why it cannot lose a newer state (ordering argument).
5. No test removed, skipped or weakened (COD-3).

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
If the shell guard refuses the NODE_OPTIONS line, run the equivalent TAP command through `landfall heavy`. `landfall secrets` exits 1 on a pre-existing baseline (D-MG-8) outside this task's files: report it, do not fix it. One commit per step; no push.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-43/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/task/report.md). If the harness refuses that write, write it to /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-43-report.md and say so.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
