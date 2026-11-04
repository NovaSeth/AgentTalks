---
red: {"command": "node --test --test-timeout=30000 test/plugin/typing-heartbeat.test.ts (at 997e3a5)", "exit": 1, "excerpt": "8 of 9 failed: S1 typing (no typing tool offered), S1 no session id, S5 (instructions lack 'typing tool'), S4 (skill lacks `typing`), heartbeat module (ERR_MODULE_NOT_FOUND lib/heartbeat.mjs), S2 / acceptance 4 / channel beat (waitFor timeout: no POST /api/sessions). S3 passes vacuously before the change."}
green: {"command": "landfall heavy -- npm run test (at ec44d2f)", "exit": 0, "excerpt": "tests 1018, pass 1018, fail 0 (includes the 9 tests of test/plugin/typing-heartbeat.test.ts); npm run typecheck exit 0"}
---
# Report: Plugin typing tool and presence heartbeat (T-MG-24)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24, task/T-MG-24-plugin-typing. Commits: 997e3a5 (RED), b57ba9b (heartbeat), 5569075 (typing tool), ec44d2f (skill). Push: no. Scope touched: plugin lib/server/scripts/skill, test/plugin/typing-heartbeat.test.ts, one assertion in test/plugin/channel.test.ts (exact tool list extended with `typing`, as the brief allows).
Status: DONE_WITH_CONCERNS

## Decisions
1. S1: `typing` tool in channel.mjs posts {kind,in:"c:<id>",sec} or {...,stop:true} to /api/sessions/<derived id>/signal with the same principalOk check as reply; `seconds` outside 5..300 is rejected (not clamped) so the agent sees its mistake; no session id -> error result, nothing sent.
2. S2/S3: lib/heartbeat.mjs (startHeartbeat, presenceBody, heartbeatMs, processAlive); the monitor beats once it delivers (run mode or after taking over), only with a live Claude ancestor and CLAUDE_CODE_SESSION_ID, and stops first in finish(); standby sends none; the channel beats while its stream is open and stops on pause/down/exit.
3. presenceBody lives in heartbeat.mjs (importing the hook would run its main()); the hook imports it and sends the same body as before.
4. Acceptance 4: a failed beat is caught, logged once per failure kind, never throws; a busy flag prevents overlap.
5. S4/S5: skill flow typing -> write -> reply, typing stop:true when not answering; one INSTRUCTIONS sentence.

## Files
- integrations/claude-code-plugin/lib/heartbeat.mjs (new), server/channel.mjs, scripts/monitor.mjs, scripts/session-hook.mjs, skills/agenttalks-live/SKILL.md, test/plugin/typing-heartbeat.test.ts (new), test/plugin/channel.test.ts (tool list extended).

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | clean | 0 |
| lint | none configured | - |
| tests | 1018/1018 | 0 |
| secrets scan | 11 findings, identical set on main (orchestrator diffed both: no finding only in the branch); the D-MG-8 baseline count drifted from 10 to 11 on main | 1 |

## Open issues
- The secrets baseline in D-MG-8 says 10; main now has 11 (the decision file itself is one hit). Needs a baseline refresh decision, not part of this task.

## Fix round 1

# Report: T-MG-24 (fix round 1)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24, task/T-MG-24-plugin-typing. Commits: 8e6b76e. Push: no.

## Fix round 1
Status: DONE

## Decisions
1. F1: the channel's presence beat starts once, on the first open stream, keeps its schedule across reconnects, stops only on unauthorized/closed/process exit; liveness guard unchanged. The monitor starts its beat once at process start (no per-connection shape), left alone. Test: SSE cut every 40 ms for 700 ms with AGENTTALKS_HEARTBEAT_MS=100 -> 0 beats before, >= 4 after.
2. F2 (test only): new test "acceptance 4: delivery continues while every heartbeat fails" with fakeAt answering /api/me, conversations and SSE normally and 500 only on POST /api/sessions; after >= 2 failed beats one mention is injected; asserts exactly one [901] line, process still running, one stderr line for the failure kind. The original acceptance-4 test is untouched. test/plugin/fake-at.ts gained optional `sessionsStatus` (default 404, unchanged).

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | pass | 0 |
| tests | typing-heartbeat 11/11; full suite 1019 pass, 1 fail: unrelated perf test "digestFor on 300k unread rows" under full-suite load, passes alone (16/16) | see verify |
| secrets scan | 11 = main baseline, none new | 1 |
