# Review brief: Plugin monitor with no deadline must end when its session is gone (T-MG-35), round 2 — scoped re-review
<!-- Review brief (ORC-5), hand-edited by the orchestrator: range narrowed to the fix-round commit. The reviewer is read-only. -->

Reviewer: landfall:reviewer (class: standard). Read-only: change no file, commit nothing, write only the review JSON (ORC-18).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree (read only): /Users/michal/Documents/Code/AgentTalks-wt/T-MG-35 (branch task/T-MG-35-monitor-orphan).
Range: 3b666b9eda33..952e3e8 (the fix-round commit only). Diff: /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-35-r2.diff
Files: fix brief /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-35/fix-r1-brief.md (its Acceptance points 1-5 are the ones to cite); fix report /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-35/fix-r1-report.md; round-1 review /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-35/review-r1.json.
Rules: ORC-2 ORC-18 REV-1 REV-2 REV-3 REV-4 REV-6 REV-9 COD-2 COD-3 ORC-7 PRI-2 PRI-15; read them with `landfall rule <ID…>`.

## Changed files
- integrations/claude-code-plugin/.claude-plugin/plugin.json
- integrations/claude-code-plugin/README.md
- integrations/claude-code-plugin/scripts/monitor.mjs
- integrations/claude-code-plugin/scripts/wake-tools.mjs
- integrations/claude-code-plugin/server/channel.mjs
- test/plugin/manifest.test.ts
- test/plugin/monitor.test.ts

## Previous findings (mark each ADDRESSED or NOT ADDRESSED by repeating its reproduction on the new code, REV-6)
- F1 blocking, monitor.mjs: with --max-seconds 0 the monitor ended only on SIGTERM/SIGINT or 401; ignored a dead Claude Code process and a closed stdout, so an orphan lived forever and a new session started a second monitor on the same state file. Repro then: spawn monitor.mjs --max-seconds 0, close stdin, destroy stdout: still running 6 s later.
- F2 minor, test/plugin/manifest.test.ts:68: comment cited T-MG-23 instead of T-MG-35.
- F3 minor, README.md: state how the monitor ends when the session is gone.

## Risks (check each)
- process lifecycle and concurrency: the new orphan poll and stdout 'error' handler both call finish(); finish() is guarded by `finishing`; check no double save or exit race, and that finish() saves the DELIVERED cursor only.
- a healthy monitor must never be stopped (fix brief acceptance 3): claudeAncestor() result, processAlive() semantics on EPERM, PID reuse, the `.unref()` interval.
- the implementer chose not to treat stdin end as a stop signal and did not verify how Claude Code wires a plugin monitor's stdin; judge whether that leaves F1 open in the real case (Claude Code killed: does the monitor's ancestor detection still find the right pid?).

## Severity (REV-2)
blocking: data loss or corruption, a security hole, an outage, a functional defect, a violation of a rule or a Global Constraint; every blocking finding carries its reproduction (a command or test and its output, REV-3). minor: everything else. needs-fixes needs at least one blocking finding; approved has none. Keep each finding's "text" under 500 characters.

## Output
One JSON object in /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-35-review-r2.json, per `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/review.schema.json`: {"verdict": "approved|needs-fixes", "reviewer": {"kind": "claude", "id": "claude:reviewer"}, "findings": [...]}.
Final reply: exactly 5 lines: status, verdict with the count of findings per severity, tests and reproductions you ran, concerns or "none", the JSON path.
