---
red: {"command": "node --test --test-timeout=20000 test/cli/atalk.test.ts test/plugin/onboarding.test.ts (on abb077c, implementation absent)", "exit": 1, "excerpt": "5 new tests failed: 4x 'atalk login --local ...' (subdirectory, tracked, symlink, negation) and S11 (negated .gitignore line not refused); S9b failed on the moved git code. Base login.mjs/atalk.ts never ran check-ignore."}
green: {"command": "landfall heavy -- node --test --test-reporter=tap --test-timeout=20000 --test-concurrency=4 test/**/*.test.ts", "exit": 0, "excerpt": "# tests 1055\n# pass 1055\n# fail 0"}
---
# Report: Credential write: confirm with git check-ignore; atalk login --local uses login.mjs preflight (T-MG-37)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-37, task/T-MG-37-credential-check-ignore. Commits: abb077c (RED tests + credguard.mjs), 3462642 (GREEN). Push: no. Scope touched: login.mjs, atalk.ts, new lib/credguard.mjs, two test files.
Status: DONE_WITH_CONCERNS

## Decisions
1. check-ignore in login.mjs runs right after the ignore line is written and BEFORE the credential is written, so the credential is never written un-ignored and the rollback is only restoring .gitignore. Not ignored, or git failed/timeout: .gitignore restored, refusal ends "nothing was written".
2. atalk --local uses the same preflight via the shared module (git tree found upward incl. subdirs and worktrees, tracked refusal, file-kind refusals, check-ignore), all before the first write; the existing credential rollback is kept.
3. Shared module integrations/claude-code-plugin/lib/credguard.mjs: inside the plugin dir (no import from src/); src/ already imports lib/trust.mjs from there.
4. Hardened git: same flags as before plus `-c core.excludesFile=/dev/null`. Exit 0/1/other = ignored / not ignored / unknown (fail closed).
5. Outside a git tree atalk behaviour is unchanged.

## Files
- integrations/claude-code-plugin/lib/credguard.mjs: new shared guard.
- integrations/claude-code-plugin/scripts/login.mjs: uses it.
- src/cli/atalk.ts: saveClientConfig(local) uses it.
- test/plugin/onboarding.test.ts: new S11; S9b/S10b read credguard.mjs (same assertions plus check-ignore); S10 fake git answers 0 for check-ignore.
- test/cli/atalk.test.ts: 4 new tests.

## RED / GREEN
- RED: new tests failed on base; negation case verified with real git (exit 1).
- GREEN: 1055 tests, 0 failed.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | clean | 0 |
| tests (heavy, TAP) | 1055 pass | 0 |
| secrets scan | 10 pre-existing findings (D-MG-8), none from this task | 1 |

## Open issues / deviations from the brief
- NODE_OPTIONS gate line blocked by the shell guard; ran TAP through landfall heavy.
- S10, S9b, S10b adapted, not weakened; reviewer should check.
- atalk does not check the trust-dir kinds (login.mjs does); not in the brief.
- The harness refused writing the report to the .landfall path; written here.
