# Review brief: client CLI renamed to atalks, atalk kept as alias (T-MG-41 part A), round 1 — cross-provider review
<!-- Review brief (ORC-5), hand-written by the orchestrator. The implementation was done by Codex; this review is by Claude. The reviewer is read-only. -->

Reviewer: landfall:reviewer (class: critical). Read-only: change no file, commit nothing, write only the review JSON (ORC-18).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree (read only): /Users/michal/Documents/Code/AgentTalks-wt/T-MG-41 (branch task/T-MG-41-atalks-cli-name).
Range: a85b76d43d96..9bcfeb5. Diff: /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-41-r1.diff
Files: task brief /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-41/brief.md (Acceptance 1-6, Scope In/Out); report /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-41/report.md (includes the inventory of remaining `atalk` occurrences); decision /Users/michal/Documents/Code/AgentTalks/.landfall/decisions/D-MG-37.md.
Rules: ORC-2 ORC-18 REV-1 REV-2 REV-3 REV-4 REV-9 COD-2 COD-3 ORC-7 PRI-2 PRI-15; read them with `landfall rule <ID…>`.

## Check each
1. Acceptance 1-6 of the task brief, citing numbers. In particular: both bin names install and run the same program (run `node bin/atalk.js --help` and check the text; read package.json and the lockfile change); the `--help` fix the implementer mentions did not change other argument handling.
2. Scope: nothing under integrations/claude-code-plugin/, nor app.js, view-sidebar.js, router.js, sse-events.js, view-chat.js, dom.js, app.css, nor docs/audit-*.md or docs/superpowers/** was edited.
3. COD-3: every changed test only updates expected strings or adds coverage; no assertion removed or loosened (compare each changed test hunk with the base). The docs validator change "recognizes both names" — confirm it did not stop checking something it checked before.
4. Nothing persisted changed: config file names, env vars, API, the `writtenBy: "atalk"` marker (changing it would break reading old files).
5. The remaining-occurrence inventory in the report: spot-check that the kept `atalk` words are only the alias, file names, the persisted marker, history, or out-of-scope files.
6. Polish strings in i18n-pl.js: only the CLI name changed, the sentences still read correctly.

## Severity (REV-2)
blocking: a defect, a broken command or script, a violation of a rule; every blocking finding carries its reproduction (REV-3). minor: everything else. needs-fixes needs at least one blocking finding; approved has none. Keep each finding's "text" under 500 characters.

## Output
One JSON object in /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-41-review-r1.json, per `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/review.schema.json`: {"verdict": "approved|needs-fixes", "reviewer": {"kind": "claude", "id": "claude:reviewer"}, "findings": [...]}.
Final reply: exactly 5 lines: status, verdict with the count of findings per severity, tests and reproductions you ran, concerns or "none", the JSON path.
