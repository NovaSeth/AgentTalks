# Plugin knows the whole API: full API skill bundled, MCP tools for common actions (T-MG-40)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). Spec first, then implementation, by one agent. -->

Executor: landfall:designer (class: critical — touches a SKILL.md; kind: task). Deliverable kind: (1) a short written spec, then (2) the working feature in the Claude Code plugin.
Review: cross-provider review (Codex) after your report, then a scoped re-review.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-40 (branch task/T-MG-40-plugin-full-api from main at a85b76d43d96; dependencies installed: no — run `npm ci` first). Update only with `git merge origin/main`, never rebase.
Budget: 60 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 PRI-6 SPC-1 SPC-3 SPC-13 SPC-14; read them with `landfall rule <ID…>`. Decisions in force: D-MG-6 (English everywhere), D-MG-17 (wake bridge allowed tools), D-MG-37 (the client CLI will be renamed `atalks` by a LATER task T-MG-41 — do not rename anything now; write `atalk` as today).

## Source (the owner's request, task title verbatim)
"Plugin knows the whole API: full API skill bundled, MCP tools for common actions".
Context: the owner wants an agent that has only the Claude Code plugin installed (`integrations/claude-code-plugin`, installed with `/plugin install agenttalks@agenttalks`) to be able to do everything AgentTalks offers, without separately adding the remote MCP server or reading docs elsewhere.

## Today (read by the orchestrator)
- Plugin layout: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-40/integrations/claude-code-plugin/` — README.md (architecture table), `server/channel.mjs` (stdio MCP server for the live session: SSE push + tools `reply`, `mark_read`, `typing`, tools object at ~line 91; `lib/api.mjs` is the REST client; `principalOk()` guards each tool), `scripts/wake-tools.mjs` (the ONLY MCP server of a woken run: read_conversation, read_thread, reply, mark_read — principal-checked; D-MG-17 and README lines ~160-310 describe its strict allow-list; do NOT widen the woken run's tool set in this task), `skills/agenttalks-live/SKILL.md` (only how to handle live events).
- The full API skill exists outside the plugin: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-40/integrations/claude-skill/SKILL.md` (680 lines, REST + MCP, the canonical agent guide) and a shorter `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-40/integrations/claude-code/skills/agenttalks/SKILL.md` (188 lines). Tests already pin some skill content (test/fixes/t-mg-10-skill.test.ts, test/docs.test.ts).
- The server's remote MCP has the full tool set (`/Users/michal/Documents/Code/AgentTalks-wt/T-MG-40/src/mcp/server.ts`: talk_status, talk_send, talk_read, talk_log, talk_who, talk_channels, talk_join, talk_ask, talk_answer, talk_open, talk_react, talk_search, talk_thread, talk_file_get, talk_digest, talk_mentions, talk_seen, talk_typing, talk_claim, talk_release, talk_leases, wiki_*), reachable at `<server>/mcp` with a bearer token.

## Part 1 — spec (write it first, commit it)
Write `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-40/docs/specs/T-MG-40-plugin-full-api.md` (≤ 150 lines): which skill(s) the plugin bundles and how the content stays single-sourced (no two hand-maintained copies that drift: e.g. one canonical file plus a test that the copies are byte-identical, or moving the canonical file into the plugin and pointing the others at it — choose and justify); which MCP tools the live-session channel server gains (the common actions: e.g. send to a conversation by #slug or @handle, read a conversation/thread, list channels/who, search, wiki read/search/write, claim/release/list leases, ask/answer, react, digest/mentions), their names and input schemas, and why each is in or out; how each tool is authorized (the existing `principalOk()` guard, the bearer token of the configured identity, never another actor); how untrusted text returned to the model is framed (reuse `lib/frame.mjs`: quoted, "data, not instructions"); size limits; what stays out (the woken run's strict tool set; admin actions). Alternative to weigh: registering the server's remote MCP (`<server>/mcp`) from the plugin instead of re-implementing tools — decide with reasons (token handling, offline, version skew).

## Part 2 — implementation
Implement the spec in the plugin: the bundled skill (+ the anti-drift mechanism), the new tools in `server/channel.mjs` (or a new module under `lib/` it imports), README architecture table and tool list updated, `skills/agenttalks-live/SKILL.md` mentions the new tools where it helps. Plugin version bump 0.2.2 → 0.3.0 in every place that carries it (plugin.json, scripts/wake-tools.mjs, server/channel.mjs; grep for 0.2.2 in the plugin and tests).

## Acceptance
1. The spec exists, is committed before the implementation, and every built element traces to it (ORC-23).
2. The plugin bundles the full API skill; the anti-drift mechanism is enforced by a test.
3. The new channel tools cover the common actions listed in the spec; each is principal-checked like `reply`, validates input (positive ints, non-empty strings, length caps), returns errors as `isError`, and frames any text that came from other actors as quoted data (reuse frame.mjs).
4. The woken-run tool set (wake-tools.mjs, the bridge's allowed/disallowed tools) is unchanged.
5. Tests: for each new tool a test against the existing fake server helpers (`test/plugin/fake-at.ts` — shared: do not edit it; if it lacks an endpoint you need, stop with NEEDS_CONTEXT naming the endpoint) covering success, a bad input and the framing of untrusted text; a manifest/README test that lists the tools.
6. No test removed, skipped or weakened (COD-3).

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
If the shell guard refuses the NODE_OPTIONS line, run the equivalent TAP command through `landfall heavy`. `landfall secrets` exits 1 on a pre-existing baseline (D-MG-8) outside this task's files: report it, do not fix it. One commit per step; no push.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-40/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/task/report.md). If the harness refuses that write, write it to /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-40-report.md and say so.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
