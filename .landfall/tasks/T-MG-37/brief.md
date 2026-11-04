# Credential write: confirm with git check-ignore; atalk login --local uses login.mjs preflight (T-MG-37)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: standard — 4 files > 2; 120 LOC > 30; kind: task). Deliverable kind: a working hardening of the two code paths that write an AgentTalks token into a project directory.
Review: a security review by another agent after your report (the orchestrator dispatches it).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-37 (branch task/T-MG-37-credential-check-ignore from main at 3b666b9eda33; dependencies installed: no — run `npm ci` in the worktree first). Update only with `git merge origin/main`, never rebase. Another task (T-MG-35) works in parallel on `integrations/claude-code-plugin/scripts/monitor.mjs`, README.md and the plugin version strings: do NOT touch those files and do NOT bump the plugin version (the orchestrator does it at merge).
Budget: 45 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14; read them with `landfall rule <ID…>`.

## Problem (task title from the owner; cause chain read by the orchestrator)
Two code paths write a project-local credential file `.agenttalks.json` (contains a bearer token) and try to keep it out of git:
A. The plugin's `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-37/integrations/claude-code-plugin/scripts/login.mjs` has a careful preflight (lines ~170-195: file kinds, `inGitTree`, `trackedState` via hardened `git ls-files --error-unmatch` at ~102-121, refusal before any write), then appends `.agenttalks.json` to `.gitignore` (~205-213). But it never CONFIRMS the file is actually ignored afterwards. An exact-line `.gitignore` entry can still be defeated: a later `!.agenttalks.json` negation, the line landing in a `.gitignore` that is not the one governing the file, a `.gitignore` in a subdirectory when `dir` is not the repo root, etc. Title: "Credential write: confirm with git check-ignore".
B. The CLI `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-37/src/cli/atalk.ts` `saveClientConfig(..., local=true)` (~126-160, used by `atalk login --local` and `atalk enroll --local`) has a much weaker check: it treats the directory as git only if `./.git` exists (misses subdirectories of a repo and worktrees, where `.git` is a file or lives higher up), does not check whether the file is already TRACKED by git, does not check file kinds (link/FIFO/dir), and does not confirm the ignore either. Title: "atalk login --local uses login.mjs preflight".

## Scope
Modify: login.mjs, atalk.ts. Create if it removes duplication: a small shared module only if both an `.mjs` plugin script (the plugin is installed on its own from `integrations/claude-code-plugin/`, it must NOT import from `src/`) and `src/` can use it — otherwise keep two implementations with the same behaviour and say why. Tests: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-37/test/plugin/onboarding.test.ts` (or `project-trust.test.ts`, whichever already runs login.mjs) and `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-37/test/cli/atalk.test.ts`. Do not edit `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-37/test/plugin/fake-at.ts` (shared); if you need it changed, stop with NEEDS_CONTEXT (ORC-17).

## Contracts
Consumes: git CLI, run the way login.mjs's `trackedState` already runs it (hardened: `-c core.fsmonitor=false -c core.hooksPath=/dev/null`, `safe.directory`, minimal env, `cwd: tmpdir()`, timeout). Produces: unchanged command-line interfaces and success messages; new refusal messages in the existing style ("...; nothing was written").

## Acceptance
1. login.mjs: after the ignore line is written (and before the credential is written, or before trust is granted — choose and justify; the credential must never end up both written and un-ignored), it runs `git check-ignore` (hardened like `trackedState`; mind that check-ignore exit 1 = not ignored, 128 = error) for the target file in a git tree. Not ignored → refuse, roll back exactly as the existing rollback does, message ends "nothing was written" (or states precisely what was undone). Git missing/failed/timeout in a git tree → refuse like `trackedState` "unknown" does.
2. atalk.ts `--local` gets the same preflight as login.mjs: git tree detection that works in a subdirectory and in a worktree, the tracked-file refusal, the file-kind refusals (target file, `.gitignore`), the check-ignore confirmation from point 1, all refusals BEFORE the first write, and rollback on failure. Existing atalk behaviour outside a git tree is unchanged.
3. The hardened git invocation never runs a program named by the repository's config (fsmonitor, hooks) and never reads the global/system git config — keep the existing pattern; a test proves a repo-local `core.fsmonitor` command is not executed (if such a test already exists for trackedState, extend it to the new call).
4. RED tests first, each failing on the base commit: (a) login.mjs in a repo whose `.gitignore` ends with `!.agenttalks.json` after the appended line… design the case so the appended line is defeated (e.g. a negation in a `.git/info/exclude`-independent way, or a `.gitignore` in the parent that re-includes, whichever actually defeats it — verify with real git, do not guess) → refusal, no credential on disk; (b) `atalk login --local` in a SUBDIRECTORY of a git repo → `.agenttalks.json` ignored (check-ignore passes) or a refusal, never an un-ignored token; (c) `atalk login --local` where `.agenttalks.json` is already tracked → refusal, nothing written; (d) a symlinked `.agenttalks.json` target → refusal for atalk too.
5. No test removed, skipped or weakened (COD-3). No network: use the existing fake server helpers.

## TDD
Write the RED tests of point 4 first and show them failing on the base in the report.

## E2E
You run no real server or deployment. Existing flow assertions touched: the onboarding/login tests for login.mjs and the atalk CLI login tests; keep them green.

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
If the shell guard refuses the NODE_OPTIONS line, run the equivalent TAP command through `landfall heavy`. `landfall secrets` exits 1 on a pre-existing baseline (D-MG-8) outside this task's files: report it, do not fix it. One commit per step; no push.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-37/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/task/report.md). If the harness refuses that write, write it to /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-37-report.md and say so.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
