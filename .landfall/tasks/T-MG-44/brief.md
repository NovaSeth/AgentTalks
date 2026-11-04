# Web UI unread highlights like Slack (only after absence, fade after read) (T-MG-44)
<!-- Task brief (ORC-4). Fill every <…>; "landfall" is the plugin's CLI. Every path is absolute (ORC-15). An authoring task says so in its first line. -->

Executor: landfall:implementer (class: standard — 5 files > 2; 150 LOC > 30; kind: task).
Review: none
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: <absolute path> (branch task/T-MG-44-unread-highlight from <base branch> at 550d269269d01a638a3eff95cc7c61d612c8025c; dependencies installed: <yes/no>). Update the branch only with `git merge origin/main`, never rebase.
Budget: <minutes> minutes (default 15, more for more acceptance points); when it nears, stop at a green commit and list the rest under Follow-up in the report.
Shared brief: <path of the shared brief for this kind of task, if one exists>.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14; read them with `landfall rule <ID…>`.

## Problem (<who reported it, where>)
<symptom> and the chain of causes as `file:line`.

## Scope
Create: <files>. Modify: <files>. Tests: <test files>. Nothing else. Something missing in a shared part: stop with NEEDS_CONTEXT and name the gap (file, field, consumer) (ORC-17).

## Contracts
Consumes: <interfaces, files and fields this task reads, each with its owner>. Produces: <what it exposes, and for whom>.

## Acceptance
1. <acceptance point: the reviewer cites its number>
2. <…>
<"Choose X or Y and justify it in the report"; "do not guess: describe what happens">

## TDD
<which tests must fail first, and why>

## E2E
<You run no devices or queues (the orchestrator does) | you run them through the queue: …>. List the existing flow assertions the change touches.

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
Exit 0 prints `secrets: clean`. One commit per step; no push. A full suite or build runs through the heavy queue: `landfall heavy` with the command after `--`.

## Assignments (only when several agents share one worktree)
<agent → its disjoint file list>. Agents run no git; the orchestrator commits. Shared vocabulary: <the names, headings and contract terms that must agree between the agents, as a table>.

## Report
<absolute path>/report.md (template: <absolute path of the report template>): the `Status:` line, decisions per acceptance point, files, RED/GREEN, gate, shared gaps, open issues. When your harness refuses that write, put the whole report in your reply: the orchestrator stores it with `landfall report <id> --from <file>`.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
<!-- rendered by `landfall brief`; sha256 c7267f306e7905b29b8a306220bfd7d8e6d304272b9a49b3645c7dd5f7c54f50: an edit makes this brief hand-written -->
