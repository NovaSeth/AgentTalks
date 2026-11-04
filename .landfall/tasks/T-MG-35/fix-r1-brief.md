# Fix round 1: Plugin monitor with no deadline must end when its Claude Code session is gone (T-MG-35)
<!-- Fix brief (REV-5), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: standard, fix round 1). Deliverable kind: a working fix in the Claude Code plugin's monitor process.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-35 (branch task/T-MG-35-monitor-orphan from main at 3b666b9eda33; dependencies installed: no — run `npm ci` in the worktree first). Update only with `git merge origin/main`, never rebase.
Budget: 40 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 REV-5 REV-6 REV-9 ORC-7 PRI-2 PRI-15; read them with `landfall rule <ID…>`.

## Background
Commit ccb8841 (already on main) made the plugin monitor declared in `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/integrations/claude-code-plugin/monitors/monitors.json` run with `--max-seconds 0` (no deadline), because Claude Code never restarts a plugin monitor and the old 1740 s cap left unattended agents deaf after ~29 min. Keep that: the monitor must run for the whole session.

## Findings to fix (review r1: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-35/review-r1.json)
F1 (blocking). `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/integrations/claude-code-plugin/scripts/monitor.mjs` with `--max-seconds 0` ends only on SIGTERM/SIGINT (monitor.mjs:212-213) or a 401 (onState, ~line 172). It does not notice that the Claude Code process it belongs to is gone: `claudeProc = claudeAncestor()` (monitor.mjs:182) is used only by the presence heartbeat's `alive()` (monitor.mjs:190), which skips beats but never calls `finish()`. Nor does it end on stdout EPIPE / stdin end. If Claude Code dies without signalling (crash, SIGKILL), the orphan lives forever and the next session starts a second monitor on the same state file (duplicate delivery). Reviewer's repro: spawn `monitor.mjs --max-seconds 0` against an unreachable server, close its stdin and destroy its stdout: still running 6 s later.
F2 (minor). `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/test/plugin/manifest.test.ts:68` comment cites T-MG-23; it is now T-MG-35 (T-MG-23 was cancelled and recreated). Mention both ("T-MG-35, formerly T-MG-23").
F3 (minor). `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/integrations/claude-code-plugin/README.md`: after F1, state how the monitor ends when the session is gone.

## Scope
Modify: monitor.mjs; if a helper belongs in a lib, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/integrations/claude-code-plugin/lib/heartbeat.mjs` or `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/integrations/claude-code-plugin/lib/launch.mjs` (reuse the existing `processAlive` / `claudeAncestor`, do not duplicate them); README.md; manifest.test.ts (comment only); the plugin version bump 0.2.1 → 0.2.2 in every place that carries it (`.claude-plugin/plugin.json`, `scripts/wake-tools.mjs`, `server/channel.mjs` — grep for 0.2.1 inside integrations/claude-code-plugin and in tests that pin it). Tests: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/test/plugin/monitor.test.ts` (or liveness.test.ts, whichever already spawns the monitor). Nothing else; a gap elsewhere → NEEDS_CONTEXT (ORC-17).

## Acceptance
1. With `--max-seconds 0`, the monitor calls `finish(0)` (cursor saved, presence beat stopped) within a bounded time (say ≤ 2 poll intervals, interval ≤ 30 s, configurable for tests via the existing env pattern) after the Claude Code process it found with `claudeAncestor()` is gone. When no Claude ancestor is found (run by hand, tests), the behaviour today is kept unless you justify a change.
2. The monitor also ends via `finish(0)` when its stdout is closed (write error EPIPE / 'error' on stdout) — there is nobody left to deliver to. Decide whether stdin end should end it too: check how Claude Code starts plugin monitors and how the existing tests spawn the monitor (stdin may be closed or /dev/null from the start in normal operation — then stdin end must NOT end it). Describe what you found; do not guess.
3. The fix must not end a healthy monitor: a running Claude ancestor and an open stdout keep it alive indefinitely; the existing tests that run the monitor stay green.
4. A test reproduces F1 (RED on the base commit): spawn the monitor with `--max-seconds 0` with a fake "Claude" parent/ancestor process that then exits (or the stdout pipe destroyed), and assert the monitor process exits within a bound. Use the existing test helpers (`/Users/michal/Documents/Code/AgentTalks-wt/T-MG-35/test/plugin/fake-at.ts` is shared — do not edit it; if you need a change there, stop with NEEDS_CONTEXT).
5. F2 and F3 done; version 0.2.2 consistent; no test removed, skipped or weakened (COD-3).

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
If the shell guard refuses the NODE_OPTIONS line, run the equivalent TAP command through `landfall heavy`. `landfall secrets` exits 1 on a pre-existing baseline (D-MG-8) outside this task's files: report it, do not fix it. One commit per step; no push.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-35/fix-r1-report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/task/report.md). If the harness refuses that write, write it to /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-35-fix-r1-report.md and say so. For each finding: ADDRESSED with the evidence, or why not.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
