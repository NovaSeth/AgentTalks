---
red: {"command": "node --test --test-timeout=20000 test/plugin/onboarding.test.ts test/plugin/project-trust.test.ts (at b9c1eb0, tests only)", "exit": 1, "excerpt": "✖ S1: a project file hand-written like the old skill says -> the monitor stays offline and names login.mjs ...\n✖ S3: a literal token on argv is refused ...\n✖ S4 + G4 + G6: login twice leaves one trust entry ...\n✖ S5: the served skill has no command that redirects into .agenttalks.json ...\n✖ S5b: the installer page does not tell agents to write a project file by hand\n✖ identity: an untrusted project file ... (notice must name login.mjs)\nℹ tests 9\nℹ pass 3\nℹ fail 6"}
green: {"command": "node --test --test-timeout=20000 test/plugin/onboarding.test.ts test/plugin/project-trust.test.ts test/plugin/monitor.test.ts (at 4ee7ec3); full suite: landfall heavy -- npm run test", "exit": 0, "excerpt": "ℹ tests 18\nℹ pass 18\nℹ fail 0\nfull suite (implementer, 4ee7ec3): 1021 of 1021 pass; npm run typecheck exit 0"}
---
# Report: Plugin onboarding: plugin login command, actionable notice, skills stop hand-writing .agenttalks.json (T-MG-21)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21, task/T-MG-21-plugin-login from 92d2199. Commits: b9c1eb0 (RED), 14f8958, 929c9fe, f4f57d3 (GREEN a-c); a4ec1bc/655ec80 (amendment 7+8 red/fix), 70695d1/372ebe0 (9), 1853fa4/4ee7ec3 (10). Push: no. Scope touched: as briefed, plus src/http/ui/install.html (allowed by the brief's grep clause) and test/plugin/fake-at.ts (additive optional meStatus, allowed).
Status: DONE_WITH_CONCERNS

## Decisions
1. S1: spawned monitor on the old printf file exits 0, empty stdout, stderr names login.mjs; after login.mjs (token on stdin) a second monitor prints exactly 1 line for a mention; token absent from all stdout/stderr.
2. S2/S3: 401 or non-actor /api/me, or a literal argv token -> non-zero exit, nothing written; AGENTTALKS_TOKEN works without --token.
3. S4/G4/G6: two runs = one entry for the path, unrelated entry kept, new sha256 replaces old, 0600/0700, AGENTTALKS_CONFIG_DIR and --dir honoured.
4. S5: skill section in P3 order (atalk, plugin login.mjs, global file), says a hand-written project file is ignored; guard test on SKILL.md and install.html.
5. Notice names `atalk login --local` and the absolute plugin login.mjs path; no project path in model context (S6). The anchored regex on UNTRUSTED_PROJECT_CONTEXT became an assert.equal on the full new text (equally strict) plus a no-newline assertion; nothing removed (orchestrator checked the diff).
6. Gate green (see frontmatter).
7. Amendment 7: symlinked .agenttalks.json/.gitignore refused in preflight; temp file with wx + rename; trust list via wx too.
8. Amendment 8: git-tracked .agenttalks.json -> refuse, file untouched.
9. Amendment 9: git spawned with -c core.fsmonitor=false -c core.hooksPath=/dev/null -C dir, cwd tmpdir, minimal env (GIT_CONFIG_NOSYSTEM=1); fsmonitor marker test.
10. Amendment 10: only exit 1 from ls-files --error-unmatch = not tracked; 128/timeout/missing git inside a git tree refuses; -c safe.directory=<repo top>; fake-git test with 128, 2 and 1.

## Files
- created: integrations/claude-code-plugin/scripts/login.mjs, integrations/claude-code-plugin/lib/trust.mjs, test/plugin/onboarding.test.ts
- modified: integrations/claude-code-plugin/lib/identity.mjs (notice), integrations/claude-code-plugin/README.md, integrations/claude-skill/SKILL.md, docs/install.md, src/http/ui/install.html, test/plugin/fake-at.ts, test/plugin/project-trust.test.ts

## RED / GREEN
- RED: 6 of 9 failed at b9c1eb0: login.mjs missing, notice/skill/installer unchanged (reproduced by the orchestrator in a detached worktree).
- GREEN: plugin tests 18/18 (orchestrator re-run at 4ee7ec3); full suite 1021/1021 (implementer).

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | pass | 0 |
| lint | none configured | - |
| tests | 1021/1021 | 0 |
| secrets scan | 10 findings = known false-alarm baseline D-MG-8 | 1 |

## Concerns
- The implementer read the brief before the amendment section was written; points 7-10 came from messages with the same text, now in brief.md.
- login.mjs refuses inside a git tree when git cannot answer (fail closed by design, amendment 10).

## Fix round 1

# Report: T-MG-21 plugin login (fix round 1)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21, task/T-MG-21-plugin-login. Commits: 0f23c65 (RED), e4c91d5 (GREEN, plugin), 426bb1a (GREEN, atalk lock). Push: no. Scope touched: integrations/claude-code-plugin/scripts/login.mjs, integrations/claude-code-plugin/lib/trust.mjs, src/cli/atalk.ts (withTrustLock + trustProject only), test/plugin/onboarding.test.ts, test/fixes/t-mg-21-r1-trust-lock.test.ts.

## Fix round 1
Status: DONE

## Decisions
1. F1: trustProjectFile(path, bytes, opts) hashes the passed bytes; login re-reads after rename; differing bytes -> exit 1 "the file changed while saving; nothing trusted"; trust is the last step so no entry exists to remove. Test seam AGENTTALKS_LOGIN_TEST_AFTER_RENAME=<script> (env-only).
2. F2: lock trusted-projects.json.lock (wx, 0600, {pid, at}), 50 ms retry up to 5 s, stale after 30 s; same protocol in lib/trust.mjs and atalk.ts withTrustLock; timeout -> exit 1 with credential rolled back; knob AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS. atalk test runs real `atalk login --local` in-process.
3. F3: lstat preflight on .agenttalks.json, .gitignore, trust dir, trust list; non-regular -> exit 1 before any write; order .gitignore, credential, trust; undo restores previous bytes or unlinks.
4. F4: http only for localhost, 127/8, [::1]; userinfo rejected; cleanUrl at login.mjs:140 precedes createApi at :159.
5. F5: unknown arguments get a fixed message echoing nothing from argv.

## RED / GREEN
- RED: R1-F1..F5 failed (12 pass / 5 fail); atalk lock test failed "waited for the lock".
- GREEN: onboarding 17/17; full suite 1027/1027.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | pass | 0 |
| lint | none configured | - |
| tests | 1027/1027 | 0 |
| secrets scan | 10 = D-MG-8 baseline, none new | 1 |

## Follow-up
- atalk trustProject still hashes the file from disk after writing it (the F1 pattern on the atalk path); out of this round's scope.

## Fix round 2

# Report: T-MG-21 plugin login (fix round 2)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21, task/T-MG-21-plugin-login. Commits: 9c39484 (RED), 6fc872c (GREEN). Push: no.

## Fix round 2
Status: DONE

## Decisions
1. Spec change made by fix-r2-brief: round-1 age-stale lock tests became dead-owner tests (held = live pid + host; stale = an exited child's pid). Nothing removed, skipped or weakened.
2. F2: one withTrustLock(dir, fn, opts) in integrations/claude-code-plugin/lib/trust.mjs (wx, 0600, {pid,host,at}); eviction only on same host + process.kill(pid,0) ESRCH, never by age; other host / unreadable / live pid = held; timeout error names the lock path; release only if the file still holds our pid+host+at. atalk imports it (allowJs; the package ships integrations), so no copy. Shared scenario table in test/fixes/t-mg-21-r2-trust-lock.test.ts runs against login.mjs and bin/atalk.js login --local as child processes.
3. F6: both writers take the lock first; gitignore, credential (temp wx + rename), trust list inside it with rollback (atalk gained rollback). Lock timeout: exit 1, no credential, existing credential bytes unchanged, no .gitignore change.
4. F3: trust-list temp and credential temp unlinked on write/rename failure; seam AGENTTALKS_LOGIN_TEST_FAIL_TRUST_RENAME=1; test checks no *.tmp, credential rolled back/restored, lock released.
5. login.mjs: refusals inside the lock are thrown (Refusal) and reported after release, since process.exit would skip finally.
6. atalk.ts scope: saveClientConfig local branch, writeFileAtomic helper, imports, removal of the old lock and trustProject.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | pass | 0 |
| lint | none configured | - |
| tests | 1033/1033 | 0 |
| secrets scan | 10 findings, all in untouched files (main has 11) | 1 |

## Fix round 3

# Report: T-MG-21 plugin login (fix round 3)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21, task/T-MG-21-plugin-login. Commits: 3fcc046 (RED), 167af93 (fix), 005fba4 (test-only cleanup of a stray leftover in the r1 test file). Push: no.

## Fix round 3
Status: DONE

## Decisions
1. D-MG-34: withTrustLock no longer evicts any lock; acquires only by wx create; finally releases only a lock holding our pid+host+at; timeout message `trust list is locked by pid N on <host> (running|not running): if no login is running, delete <path> and retry`; process.kill(pid,0) is diagnostic only. atalk imports the same function.
2. Spec changes made by fix-r3-brief (not weakenings): dead-owner scenarios now expect wait, exit 1 after the shortened timeout, nothing written, message names the lock path and "not running", lock file untouched (shared table in t-mg-21-r2-trust-lock.test.ts, t-mg-21-r1-trust-lock.test.ts, onboarding.test.ts). Live-owner assertions match `/locked by pid \d+ on .*\(running\)/` instead of `/locked by another login/` (message text changed).
3. New regression test/fixes/t-mg-21-r3-trust-lock.test.ts: two concurrent logins against a dead-owner lock (600 ms timeout) -> both exit 1, trust list and lock unchanged; after removing the lock, two concurrent logins from different dirs -> both exit 0, all three entries present.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | pass | 0 |
| tests | 1034/1034 | 0 |
| secrets scan | 10 findings, all in untouched files (main has 11) | 1 |
