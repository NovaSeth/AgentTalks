# Plugin wake tools: a total framed-output budget with a cursor, like the T-MG-40 channel tools (T-MG-45)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: standard; kind: task). Deliverable kind: a working hardening of the woken run's MCP tools.
Review: cross-provider (Codex) after your report (agent-facing untrusted input).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-45 (branch task/T-MG-45-wake-tools-budget from main at 78da1151863e; dependencies installed: no — run `npm ci` first). Never rebase.
Budget: 40 minutes.
Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 ORC-7 PRI-2 PRI-15; read them with `landfall rule <ID…>`. Decisions in force: D-MG-17 (the woken run's allowed tools), D-MG-41 (plugin tool tests may use the real in-process test server).

## Problem (found by the T-MG-40 designer, left out of that task's scope)
T-MG-40 (merged in 78da115) capped every read result of the live-session channel tools at ~50 000 characters in total, with a cursor to continue (`/Users/michal/Documents/Code/AgentTalks-wt/T-MG-45/integrations/claude-code-plugin/lib/tools.mjs`; spec `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-45/docs/specs/T-MG-40-plugin-full-api.md`). The woken run's own MCP server, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-45/integrations/claude-code-plugin/scripts/wake-tools.mjs` (tools read_conversation, read_thread, reply, mark_read; principal-checked), caps single message bodies but has no TOTAL output budget: other actors can fill a woken agent's context with many long messages, or make the client reject the result.

## Scope
Modify: wake-tools.mjs (reuse T-MG-40's budget/cursor helper from lib/tools.mjs or a shared lib module if that keeps one implementation; do not duplicate the logic). Tests: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-45/test/plugin/wake-tools.test.ts` (extend). Do NOT change the woken run's tool set, names, the bridge's allowed/disallowed tools, or the principal checks (D-MG-17). Plugin version bump 0.3.0 → 0.3.1 in every place that carries it (grep the plugin and tests).

## Acceptance
1. read_conversation and read_thread return at most the same total budget as the channel tools; when cut, the result says so and carries a cursor that, passed back, continues where it stopped, reaching every message exactly once.
2. Framing of other actors' text stays as today (quoted, "data, not instructions").
3. RED tests first: 50 × 60 000-char messages → today the result exceeds the budget; after the fix it is within it and the cursor walk reaches all 50.
4. No test removed, skipped or weakened (COD-3).

## Gate
`landfall heavy -- npm run test`, `npm run typecheck`. One commit per step; no push.

## Report
/private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-45-report.md, starting with the frontmatter `---` / `red: {"command": …, "exit": 1, "excerpt": …}` / `green: {"command": …, "exit": 0, "excerpt": …}` / `---`, then the Status line and per-point decisions. Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
