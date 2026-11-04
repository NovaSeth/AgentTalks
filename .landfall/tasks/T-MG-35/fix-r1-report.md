---
red: {"command": "node --test --test-name-pattern=\"max-seconds 0\" test/plugin/monitor.test.ts", "exit": 1, "excerpt": "fail 2: Claude-gone test: waitFor timeout (monitor still alive after the fake claude was SIGKILLed); stdout test: exited code 1 (uncaught EPIPE crash, cursor not saved), expected 0"}
green: {"command": "landfall heavy -- npm run test", "exit": 0, "excerpt": "tests 1052, pass 1052, fail 0"}
---
# Report: fix round 1, monitor orphan (T-MG-35)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-35, task/T-MG-35-monitor-orphan. Commits: 952e3e8 (tests + fix in one commit; the RED run was shown before the fix but not committed separately). Push: no. Scope touched: monitor.mjs, README.md, plugin version, monitor.test.ts, manifest.test.ts (comment).
Status: DONE_WITH_CONCERNS

## Decisions
1. F1 ADDRESSED. monitor.mjs: when a claude ancestor was found (`claudeProc`), an unref'd interval (AGENTTALKS_ORPHAN_POLL_MS, default 15 s) calls `processAlive` (reused from lib/heartbeat.mjs) and `finish(0)` once it is gone. No ancestor found: unchanged. `process.stdout.on("error")` also calls `finish(0)`.
2. stdin: NOT used as a signal. The existing tests spawn the monitor with stdio `ignore` for stdin, and a monitor normally starts with stdin closed, so stdin end would kill healthy monitors. I did not verify how Claude Code itself wires stdin; the decision rests on the tests plus that risk. A test asserts that `stdin.end()` does not stop it.
3. stdout closure is detected only on a write (EPIPE); an idle monitor with a destroyed stdout pipe is caught only by the Claude-gone check.
4. F2 ADDRESSED: manifest.test.ts comment now says "T-MG-35 (formerly T-MG-23)".
5. F3 ADDRESSED: README states how the monitor ends when the session is gone.
6. Version 0.2.2 in plugin.json, wake-tools.mjs, channel.mjs (no test pinned it).

## Files
- integrations/claude-code-plugin/scripts/monitor.mjs, README.md, .claude-plugin/plugin.json, scripts/wake-tools.mjs, server/channel.mjs
- test/plugin/monitor.test.ts (2 new tests), test/plugin/manifest.test.ts (comment)

## RED / GREEN
- RED on the base: both new tests failed as in the frontmatter.
- GREEN: both pass; full suite 1052/1052.

## Gate
| Command | Result | Exit |
|---|---|---|
| tests (landfall heavy) | 1052 pass | 0 |
| typecheck | no errors | 0 |
| secrets scan | 10 findings, all pre-existing in test/http/api.test.ts, test/ui-english.test.ts etc. (D-MG-8 baseline), none in my files | 1 |

## Follow-up
- A zombie claude process (not yet reaped) would still pass `kill -0`; in practice init reaps it quickly.
- I did not run the gate with NODE_OPTIONS TAP reporter; I used `landfall heavy -- npm run test`.
