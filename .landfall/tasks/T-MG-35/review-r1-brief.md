# Review brief: Plugin monitor stops after ~29 min and Claude Code does not re-arm it: unattended agents go deaf silently (T-MG-35), round 1
<!-- Review brief (ORC-5), hand-edited by the orchestrator: the range is narrowed to the one fix commit. The reviewer is read-only. -->

Reviewer: landfall:reviewer (class: standard). Read-only: change no file, commit nothing, write only the review JSON (ORC-18).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Repository: /Users/michal/Documents/Code/AgentTalks (main checkout; read only).
Range: 1cb87c2..ccb88419382657b03352589fba3e84c6f6f03b3c (one commit, ccb8841, made directly on main). Later commits on main (T-MG-29 UI files, .landfall state) are OUT of scope.
Files: report /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-35/report.md; diff /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-35-r1.diff (git diff -U10 1cb87c2 ccb8841, state directory left out). There is no task brief: the acceptance points below replace it.
Rules: ORC-2 ORC-18 REV-1 REV-2 REV-3 REV-4 REV-6 REV-9 COD-2 COD-3 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14; read them with `landfall rule <ID…>`.

## Changed files
- integrations/claude-code-plugin/.claude-plugin/plugin.json
- integrations/claude-code-plugin/README.md
- integrations/claude-code-plugin/monitors/monitors.json
- integrations/claude-code-plugin/scripts/wake-tools.mjs
- integrations/claude-code-plugin/server/channel.mjs
- test/plugin/manifest.test.ts

## Problem
An agent left listening through the Claude Code plugin went deaf after about 29 minutes: the plugin monitor declared in monitors.json was started with `--max-seconds 1740`, so the monitor script exited on its own, and Claude Code does not restart plugin monitors. The fix passes `--max-seconds 0` (the script's existing "no deadline" mode).

## Acceptance (cite the number)
1. The plugin monitor in monitors.json runs with no deadline of its own (`--max-seconds 0`), and the monitor script really treats 0 as "no deadline" (read the script that parses `--max-seconds`; confirm 0 does not mean "exit immediately" or a default cap).
2. With no deadline, the script still ends cleanly when the session ends (stdin/stdout closed, parent gone, SIGTERM) and does not leak a process or a tight reconnect loop; describe what happens, do not guess.
3. The manifest test asserts the plugin monitor does not exit on its own; it would fail on the old value 1740 (check RED is real).
4. The README documents both uses correctly: plugin monitor (0) and a hand-armed Monitor tool watch (1740 with re-arm), with no contradiction to the code.
5. The version is bumped consistently to 0.2.1 in every place that carries it (plugin.json, wake-tools.mjs, channel.mjs); grep for any remaining 0.2.0 in the plugin that should have moved.
6. No test removed, skipped or weakened (COD-3).

## Previous findings
(first review: no previous findings)

## Risks (check each)
- a monitor with no deadline that keeps running after its session is gone (process leak, duplicate monitors after a plugin reload)
- concurrency: two monitors of the same session after a re-arm both delivering events

## Severity (REV-2)
blocking: data loss or corruption, a security hole, an outage, a functional defect, a violation of a rule or a Global Constraint; every blocking finding carries its reproduction (a command or test and its output, REV-3). minor: everything else. needs-fixes needs at least one blocking finding; approved has none.

## Output
One JSON object in /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-35-review-r1.json, per `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/review.schema.json`: {"verdict": "approved|needs-fixes", "reviewer": {"kind": "claude", "id": "claude:reviewer"}, "findings": [{"id": "F1", "severity": "blocking|minor", "path": "<repository-relative file>", "line": <n or null>, "rule": "<ID or null>", "text": "<what is wrong, the reproduction, how to fix>"}]}. The orchestrator records it with `landfall review record T-MG-35 --from <file>`.
Final reply: exactly 5 lines: status, verdict with the count of findings per severity, tests and reproductions you ran, concerns or "none", the JSON path.
