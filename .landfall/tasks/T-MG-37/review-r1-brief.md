# Security review brief: Credential write confirms git check-ignore; atalk login --local uses login.mjs preflight (T-MG-37), round 1
<!-- Review brief (ORC-5), hand-written by the orchestrator. The reviewer is read-only. -->

Reviewer: landfall:security-reviewer (class: standard; security focus because the change guards a bearer token against reaching a git repository and runs git on untrusted repositories). Read-only: change no file, commit nothing, write only the review JSON (ORC-18).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree (read only): /Users/michal/Documents/Code/AgentTalks-wt/T-MG-37 (branch task/T-MG-37-credential-check-ignore).
Range: 3b666b9eda33..3462642. Diff: /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-37-r1.diff
Files: task brief /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-37/brief.md (Acceptance 1-5 to cite); report /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-37/report.md.
Rules: ORC-2 ORC-18 REV-1 REV-2 REV-3 REV-4 REV-9 COD-2 COD-3 ORC-7 PRI-2 PRI-15; read them with `landfall rule <ID…>`.

## Changed files
- integrations/claude-code-plugin/lib/credguard.mjs (new, shared by the plugin's login.mjs and src/cli/atalk.ts)
- integrations/claude-code-plugin/scripts/login.mjs
- src/cli/atalk.ts
- test/cli/atalk.test.ts
- test/plugin/onboarding.test.ts

## Check each
1. The token can never end up written while not ignored by git, in any order of events: ignore line → check-ignore → credential → trust; every failure path rolls back what this run wrote and nothing else (never clobbers a file someone else changed). Try to defeat check-ignore: negation rules, `.git/info/exclude`, `core.excludesFile` (note the hardened git ignores global config — is that right for check-ignore, or does it make a globally-ignored file look un-ignored → harmless refusal?), a `.gitignore` that is a symlink, a subdirectory, a worktree (`.git` file), a submodule, a bare repo, `GIT_DIR`/`GIT_WORK_TREE` in the environment.
2. Git is run on an untrusted repository: no program from repo config may run (core.fsmonitor, hooks, core.pager, diff/filter drivers, `core.sshCommand`, includeIf); minimal env; cwd outside the repo; timeouts; exit-code semantics (check-ignore: 0 ignored, 1 not ignored, 128 error → must refuse). Reproduce a planted `core.fsmonitor` command and confirm it does not execute for every new git call.
3. TOCTOU between preflight and write: symlink planted at the target or at `.gitignore` after preflight (login.mjs's atomic `wx` + rename pattern; does atalk.ts's `writeFileAtomic` give the same guarantee?).
4. The three EXISTING tests the implementer adapted (the S10 fake git now answers 0 for `check-ignore`; S9b and S10b now read credguard.mjs): confirm the assertions were not weakened (COD-3), compare against the base.
5. src/cli/atalk.ts now imports `integrations/claude-code-plugin/lib/credguard.mjs`: the package `files` includes `integrations`, the Docker image copies it — confirm the CLI still works when installed (`npm i -g .`) and that the plugin does not import from `src/`.
6. Acceptance 2's behaviour outside a git tree is unchanged.

## Severity (REV-2)
blocking: data loss or corruption, a security hole, an outage, a functional defect, a violation of a rule or a Global Constraint; every blocking finding carries its reproduction (a command or test and its output, REV-3). minor: everything else. needs-fixes needs at least one blocking finding; approved has none. Keep each finding's "text" under 500 characters.

## Output
One JSON object in /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-37-review-r1.json, per `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/review.schema.json`: {"verdict": "approved|needs-fixes", "reviewer": {"kind": "claude", "id": "claude:security-reviewer"}, "findings": [...]}.
Final reply: exactly 5 lines: status, verdict with the count of findings per severity, tests and reproductions you ran, concerns or "none", the JSON path.
