# Plugin: a typing tool for agents and a presence heartbeat so a listening agent never shows offline (T-MG-24)
<!-- Task brief (ORC-4), hand-written. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: critical — matches risk glob **/SKILL.md; kind: task).
Review: any reviewer (cross-provider, after you).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24 (branch task/T-MG-24-plugin-typing from main at 92d2199239762262514b9573db9ad392e65e644a; dependencies installed: yes, `node_modules` is an untracked symlink excluded locally — never commit it). Update the branch only with `git merge origin/main`, never rebase.
Budget: 45 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 REV-18 ORC-7 PRI-15 SPC-13; read them with `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall rule <ID…>`.
Parallel task: T-MG-21 runs at the same time in another worktree and changes `integrations/claude-code-plugin/lib/identity.mjs`, `lib/trust.mjs`, `scripts/login.mjs`, `README.md`, `test/plugin/onboarding.test.ts`, `test/plugin/project-trust.test.ts`, `test/plugin/fake-at.ts`. Do NOT touch those files. If you need a fake-server capability `test/plugin/fake-at.ts` lacks, put a small local fake in your own test file instead.

## Problem (reported by Michal, the human admin, on AgentTalks #general [36], 2026-11-04)
1. Web users never see "typing…" from plugin agents. The server and the web UI support it: `POST /api/sessions/:id/signal {"kind":"typing","in":"c:<convId>","sec":<n>}` (/Users/michal/Documents/Code/AgentTalks-wt/T-MG-24/src/http/routes/messages.ts:170-190, TTL/max in src/core/presence.ts:36-37), the bubble renders in src/http/ui/js/view-chat.js:683-720, and a message sent with the same `sessionId` clears it at once (src/core/messages.ts:239-240). But the plugin's MCP server exposes only `reply` and `mark_read` (integrations/claude-code-plugin/server/channel.mjs:~80-150), so an agent has no way to say "I am writing".
2. A listening agent shows offline after 15 minutes: the plugin registers presence once, in the SessionStart hook (integrations/claude-code-plugin/scripts/session-hook.mjs:140-146), and nothing refreshes `last_seen_at`; `ONLINE_WINDOW` is 900 s (src/core/presence.ts:39). Observed today: @agenttalk listening (monitor alive) but `online:false` in /api/presence.

Desired flow (Michal's words, translated): the agent reads what is new; if it decides to answer it sends "typing"; once it has written, the answer appears at once and the typing state disappears.

## Spec
Approaches for the heartbeat:
- A. CHOSEN: the delivering process (the monitor in run mode; the channel server when it delivers, i.e. when the monitor stands by) re-POSTs the same `/api/sessions` registration body the hook sends, every 240 s, only while the Claude Code ancestor process is alive (`claudeAncestor` in integrations/claude-code-plugin/lib/launch.mjs). The upsert (src/core/presence.ts:95-103) refreshes `last_seen_at` and leaves typing columns alone.
- B. Rejected: heartbeat via `signal kind=typing stop=true` — it would clear a typing bubble the agent just set from another process.
- C. Rejected: server-side "SSE stream keeps the session seen" — needs a server deploy and a protocol change; out of scope today.
Known cost of A: the upsert clears `ended_at`, so a beat right after SessionEnd could resurrect the session for up to 15 min. Guard: no beat when the ancestor is gone, and the monitor/channel stop beating on SIGTERM/stdin close before exit.

Typing tool: a third MCP tool in channel.mjs, `typing`, input `{ conversation_id: integer (required), seconds?: integer 5..300 (default 60), stop?: boolean }`, which calls `POST /api/sessions/<sessionId>/signal` with `{"kind":"typing","in":"c:<conversation_id>","sec":seconds}` or `{"kind":"typing","in":"c:<id>","stop":true}`. `reply` already sends `sessionId`, so the server clears the bubble when the reply lands. No sessionId (no `CLAUDE_CODE_SESSION_ID`) → the tool returns a clear error and sends nothing. The same principal checks as `reply` (`principalOk`).

Success criteria (each a test):
- S1 `typing` tool: a call with conversation_id 7 makes exactly one POST to `/api/sessions/<derived id>/signal` with body `{"kind":"typing","in":"c:7","sec":60}`; `seconds: 400` is rejected (or clamped — choose, justify) ; `stop: true` sends `stop:true`; without CLAUDE_CODE_SESSION_ID it sends nothing and returns an error result.
- S2 heartbeat: with a beat interval shortened for tests (env `AGENTTALKS_HEARTBEAT_MS`, test-only knob, default 240000), a running monitor in run mode POSTs `/api/sessions` with the session id at least twice within 3 intervals; in standby mode the monitor sends none (the channel does).
- S3 no beat when the Claude Code ancestor is not alive / no session id: zero `/api/sessions` POSTs from the monitor.
- S4 the live skill (integrations/claude-code-plugin/skills/agenttalks-live/SKILL.md) tells the agent: decide to answer → call `typing` with the conversation_id → write → `reply` (clears the bubble); if it decides not to answer after signalling, call `typing` with `stop: true`. A guard test checks the skill names the `typing` tool and `stop`.
- S5 the channel server INSTRUCTIONS string (channel.mjs ~line 67) mentions the typing tool in one sentence.

## Scope
Create: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24/integrations/claude-code-plugin/lib/heartbeat.mjs (`export function startHeartbeat(opts: { api, sessionId: string, body: object, intervalMs: number, alive: () => boolean, log?: (s: string) => void }): { stop(): void }`), /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24/test/plugin/typing-heartbeat.test.ts.
Modify: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24/integrations/claude-code-plugin/server/channel.mjs (typing tool, INSTRUCTIONS sentence, heartbeat when it is the delivering process), /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24/integrations/claude-code-plugin/scripts/monitor.mjs (heartbeat in run mode), /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24/integrations/claude-code-plugin/scripts/session-hook.mjs (only to export/share the registration body builder so all three send the same body), /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24/integrations/claude-code-plugin/skills/agenttalks-live/SKILL.md.
Nothing else. Missing shared part: stop with NEEDS_CONTEXT (ORC-17). No test removed, skipped or weakened (COD-3); existing tests in test/plugin/channel.test.ts, monitor.test.ts, hooks.test.ts, liveness.test.ts must pass unchanged unless an assertion lists the exact tool set (then extend it with `typing`, never remove).

## Acceptance
1. S1 passes.
2. S2 and S3 pass.
3. S4 and S5 pass; the skill wording follows the flow above.
4. A heartbeat failure (server down, 401) never crashes or blocks delivery: it logs one stderr line per failure kind and keeps delivering (test with a fake that answers 500 on /api/sessions).
5. Full gate green.

## TDD
First commit: the new test file with S1–S5 and acceptance 4, failing (no `typing` tool, no heartbeat module). Paste the failing test names and reasons as RED. Then implement: (a) heartbeat.mjs + monitor/channel wiring, (b) typing tool + INSTRUCTIONS, (c) skill — one commit each.

## Gate (in order, no pipes, bounded test workers)
```bash
cd /Users/michal/Documents/Code/AgentTalks-wt/T-MG-24
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets
```
The secrets scan's known baseline (decision D-MG-8) is 10 findings; any NEW finding is a failure.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-24/report.md (template /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md, with red/green frontmatter). When your harness refuses that write, put the whole report in your reply.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
