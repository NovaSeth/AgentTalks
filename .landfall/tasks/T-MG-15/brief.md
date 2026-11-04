# Plugin: woken runs use only principal-checked tools and can read the conversation (B-MG-105, B-MG-106) (T-MG-15)
<!-- Task brief (ORC-4), hand-written by the orchestrator from the rendered template. -->

Executor: landfall:designer (security + concurrency in the wake path; class standard, reviewed by codex anyway).
Review: landfall:external (codex), scoped to B-MG-105 and B-MG-106 plus the new tools server.
Ignore skills, plugins and MCP tools you may have; never call an AI provider EXCEPT the bounded empirical check in acceptance 4; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-15 (branch task/T-MG-15-plugin-woken-tools from main at 796c834463080ef0590ec00bd0439ad45b80a963, which includes T-MG-14; run `npm ci` once). Update the branch only with `git merge origin/main`, never rebase.
Budget: 120 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14; read them with `landfall rule <ID…>`. Code, comments, tests and docs in English (D-MG-6; test/language.test.ts enforces it, also for string literals in integrations/**/*.mjs). No em-dash.

## Problem (codex cross-review of T-MG-14, round 3: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-14/review-r3.json; decision D-MG-23)
The wake bridge (integrations/claude-code-plugin/lib/wake.mjs, ~line 501, the argv of the woken `claude -p --resume` run) verifies the principal (server A, actor nestor) and binds the plugin channel to it with AGENTTALKS_EXPECT_SERVER_URL / AGENTTALKS_EXPECT_ACTOR. Two holes remain:
- F4 / B-MG-105: `--disallowedTools "mcp__agenttalks__*"` only covers a server literally named `agenttalks`. An AgentTalks MCP server the user configured under another name (e.g. `other_at`, remote HTTP /mcp with bob's token on server B) whose tools the user pre-approved in settings stays callable in the woken run. Codex repro: in-memory bridge/permission check returns 202 for A/nestor while `mcp__other_at__*` is callable=true.
- F6 / B-MG-106: T-MG-14 narrowed `--allowedTools` to the channel's `reply` and `mark_read`, so the woken run can no longer read the conversation: tools/list = [reply, mark_read], read_messages -> -32602, the fresh feed starts at the triggering id with delivered=[], and text beyond the 400-character wake preview is in neither the prompt nor the hook summary. The woken run cannot do what its prompt asks.

## Scope
Create: integrations/claude-code-plugin/scripts/wake-tools.mjs (or a "tools" mode of the existing channel server - choose and justify), test/plugin/wake-tools.test.ts. Modify: integrations/claude-code-plugin/lib/wake.mjs, lib/mcp.mjs / lib/identity.mjs / lib/frame.mjs only as needed, integrations/claude-code-plugin/README.md, existing tests under test/plugin/ that assert the argv shape. Nothing under src/. Something missing in a shared part: stop with NEEDS_CONTEXT.

## Contracts
Consumes: the verified principal from the bridge (server URL + actor handle + actorId from GET /api/me), the identity resolution of lib/identity.mjs (trusted project file / global config / plugin options; never a token on argv or in a world-readable file), the untrusted-text framing of lib/frame.mjs (every server text returned to the model is quoted as data). Produces: a woken run whose ONLY AgentTalks access is a principal-checked tools server; README section "What a woken run can do".

## Acceptance
1. The woken run starts with `--strict-mcp-config --mcp-config <generated file>`; the generated config contains exactly one MCP server: the principal-checked tools server (command node + script path + EXPECT env; NO token in the file - the server resolves its identity itself from the same sources and refuses unless server and actor match EXPECT; if a token must be passed, pass it only through the child's env, never on disk). The file is created 0600 in a private directory (mkdtemp under the plugin's state dir or os.tmpdir) and removed when the run exits (also on spawn failure).
2. `--allowedTools` lists only that server's tools; `--disallowedTools` keeps `mcp__agenttalks__*` and adds the channel plugin's own server name pattern if the plugin server is still loaded (see 4). Codex's alias scenario (pre-approved `mcp__other_at__*` for B/bob) -> no tool of `other_at` is loadable or callable in the woken run (assert on the generated config + argv: other servers are not in the config and strict mode is on).
3. Read access (F6): the tools server exposes `read_conversation` (conversationId, optional around/after message id, limit <= 50) and `read_thread` (messageId), plus `reply` and `mark_read`; every tool checks the principal before its first request (server URL match before any request, actor match via GET /api/me) and returns server text through the untrusted framing. The wake prompt names these tools and tells the run to read the full message/thread before acting. Regression for codex's DM 41 scenario: the woken run's tools can return the full text of message 41 (longer than 400 chars), quoted.
4. Empirical check of `--strict-mcp-config` vs plugin MCP servers (the docs do not say): run at most TWO tiny headless runs on this machine, e.g. `claude -p "Reply with the single word OK" --model haiku --max-turns 1 --strict-mcp-config --mcp-config <file with only the tools server> --output-format stream-json --verbose`, and read the init event's MCP server and tool list. Report what loaded (whether installed plugins' servers still appear). If plugin servers still load in strict mode, state which and whether any of them can reach AgentTalks with another identity; if one can, refuse to wake when it is present. Do not do anything else with the model run.
5. Principal mismatch in the tools server (other server URL, other actor behind the resolved token, unresolvable identity) -> the tool returns an error, no AgentTalks request beyond GET /api/me on the expected server; one stderr line.
6. Nothing regresses: T-MG-14 tests (wake-bridge, expected-principal, mention-restart, delivery-property, project-trust) stay green; full suite and typecheck green.

## TDD
Write first and see fail: (a) argv/config test for strict mode + single-server config + no token on disk + cleanup (acceptance 1-2); (b) codex alias scenario; (c) read_conversation returns the full >400-char message quoted (DM 41); (d) mismatch cases for the tools server. Keep each RED excerpt for the report.

## E2E
You run no devices or queues. Flow assertions touched: test/plugin/wake-bridge.test.ts (argv shape, D-MG-17 allowed-tools test), expected-principal.test.ts.

## Gate (in order, no pipes, bounded test workers)
```bash
node --test --test-concurrency=2 --test-timeout=20000 "test/**/*.test.ts"
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets --range 796c834463080ef0590ec00bd0439ad45b80a963..HEAD
```
One commit per acceptance group; no push.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-15/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md): first line `---`, red:/green: JSON lines, `---`, then the `Status:` line, decisions per acceptance point, files, RED/GREEN, gate, the empirical finding of acceptance 4 verbatim, open issues. When your harness refuses that write, put the whole report in your reply.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
