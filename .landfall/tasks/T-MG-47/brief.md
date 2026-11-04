# Unread highlight: initialize the read watermark from the server on every path, incl. hidden-tab inserts (B-MG-123) (T-MG-47)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: trivial; kind: task). Deliverable kind: a small fix in the shipped web UI.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-47 (branch task/T-MG-47-highlight-server-watermark from main at 8d225efd6918; dependencies installed: no — run `npm ci` first). Never rebase. Budget 20 minutes.
Rules: ORC-2 COD-3 ORC-7; read them with `landfall rule <ID…>`.

## Problem (Codex review r3 of T-MG-44, filed as /Users/michal/Documents/Code/AgentTalks/.landfall/findings/B-MG-123.json)
`/Users/michal/Documents/Code/AgentTalks-wt/T-MG-47/src/http/ui/js/view-chat.js:63` — the unread-highlight state keeps `h.read` (confirmed read watermark) and a separate server watermark (`serverRead`); hidden-tab inserts still compare with `h.read`=0 and bypass the server watermark. Repro in the node harness of `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-47/test/ui-t44-unread-highlight.test.ts`: setup(520); await open(); cancelMarkRead(); hide tab; append/upsert 512,514; show tab; noteTabVisible(); renderMessages() → highlighted [512,514], expected []. Codex: initializing and maintaining h.read from the server watermark across every path passes all 19 tests.

## Scope
Modify view-chat.js (the highlight state only) and extend the test file. Nothing else.

## Acceptance
1. The repro above is a test: RED on 8d225ef, GREEN after.
2. One watermark: h.read starts at the server's read mark and only moves up (server state or a confirmed read); every classification path (open, render, live upsert, hidden-tab insert, tab return) uses it.
3. All existing tests in the file stay green; no test removed or weakened (COD-3).

## Gate
`landfall heavy -- npm run test`, `npm run typecheck`. One commit per step; no push.

## Report
/private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-47-report.md, starting with the frontmatter `---` / `red: {"command": …, "exit": 1, "excerpt": …}` / `green: {"command": …, "exit": 0, "excerpt": …}` / `---`, then the Status line. Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
