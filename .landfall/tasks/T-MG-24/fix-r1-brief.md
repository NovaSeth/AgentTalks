# Fix round 1: T-MG-24 review findings F1, F2 (codex, round 1)
<!-- Fix brief (ORC-4), hand-written. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: critical; fix round 1).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24 (branch task/T-MG-24-plugin-typing, HEAD ec44d2fb806bf56bbd953affbe6651c2515ed66e; dependencies installed: yes, `node_modules` is an untracked symlink excluded locally — never commit it).
Budget: 25 minutes.
Rules: COD-1 COD-2 COD-3 ORC-7 ORC-17 REV-18 PRI-15; read them with `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall rule <ID…>`.
Context: task brief /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-24/brief.md (S1-S5, acceptance 1-5 still bind); review /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-24/review-r1.json.

## Findings
F1 (integrations/claude-code-plugin/server/channel.mjs:247) Reconnects reset the heartbeat deadline, so a stream recycled more often than the interval never beats.
- Fix: the heartbeat lives for the life of the channel PROCESS while it is the delivering side, not per connection: start it once, keep its schedule across reconnects (a reconnect must neither restart nor postpone the next beat), keep the liveness guard (ancestor alive + session id), stop it on pause/standby/exit. Apply the same rule to the monitor if its wiring has the same per-connection shape (check and say so).
- RED test: with `AGENTTALKS_HEARTBEAT_MS=100`, a fake that closes the SSE stream every ~40 ms (forcing reconnects) for ~700 ms → at least 4 POSTs to /api/sessions (it was 0).

F2 (test/plugin/typing-heartbeat.test.ts:230) Acceptance 4 does not prove continued delivery.
- Fix the TEST: the fake answers /api/me and the feed endpoints normally (as in the passing S2 test) and returns 500 ONLY for POST /api/sessions; inject one eligible event (a mention of the actor) AFTER at least 2 failed beats; assert the monitor prints exactly 1 delivery line for it, plus the one-line-per-failure-kind stderr assertion already there. This strengthens an existing test (allowed); do not delete its current assertions.

## Gate
```bash
cd /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24
npm run test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets
```
Secrets: main has 11 findings (baseline drift); any finding not on main is a failure.

## Report
In your reply (the harness refuses state-dir writes): red/green frontmatter for THIS round, "## Fix round 1" with Status:, per-finding decision, RED/GREEN, gate.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path ("in reply").
