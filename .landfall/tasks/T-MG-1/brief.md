# Area gate: weryfikacja calego projektu AgentTalks (calosc od 877e20e do HEAD) (T-MG-1)
<!-- Task brief (ORC-4), hand-written by the orchestrator for a gate task. Every path is absolute (ORC-15). -->

Executor: landfall:implementer for the fix round only (class: critical - risk globs bin/**, .github/workflows/**, **/SKILL.md; flags migration, public-api, security, data-write; 25139 LOC; kind: gate). The review round comes first; the implementer gets a separate findings file (REV-5) that names its exact scope.
Review: landfall:security-reviewer + landfall:reviewer in disjoint slices, plus landfall:external (codex) cross-review over the whole range (D-MG-4).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-1 (branch task/T-MG-1-weryfikacja from main at 945674fc7c4d84d8dc307c4d45925f4d6ee7636c; review base 877e20e3136a48edfa5112bbcb4031d18c7bc179 per D-MG-1; dependencies installed: yes, `npm ci` done 2026-11-04). Update the branch only with `git merge origin/main`, never rebase.
Budget: review 30 minutes per slice; fix round 45 minutes.
Shared brief: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-1/spec.md (spec + plan: Global Constraints GC1-GC8, Review Focus RF1-RF5, slice table).
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 PRI-6 SPC-1 SPC-3 SPC-13 SPC-14 REV-12 REV-13; read them with `landfall rule <ID…>`.

## Problem (Michal, 2026-11-04, request in the session: "landfall init + odpal caly pipeline Landfall aby zweryfikowac caly ten projekt")
The project has never passed a Landfall gate. Last full audit was 2026-08-09 (/Users/michal/Documents/Code/AgentTalks/docs/audyt-2026-08-09.md, 116 confirmed findings, reported fixed); commits continued until 2026-09-01 (HEAD 945674f). The gate must establish, with evidence, whether the code at HEAD is correct and safe, and fix what blocks.
Baseline measured 2026-11-04 in the worktree (Node v26.0.0): `npm run typecheck` exit 0; `npm test` 322 pass, 0 fail, 0 skipped.

## Scope
Review round: read-only over the whole tree at 945674f (slices in spec.md). Fix round: only files named by blocking findings, plus their tests. Nothing else. Something missing in a shared part (src/core/ctx.ts, src/core/errors.ts, src/http/respond.ts, src/config.ts): stop with NEEDS_CONTEXT and name the gap (ORC-17).

## Contracts
Consumes: the HTTP API (src/http/routes/**), the MCP tools (src/mcp/server.ts), the CLI (src/cli/**), the SQLite schema (src/store/schema.ts). Produces: no new interface; a fix keeps every existing route, tool name, CLI flag and schema version compatible unless a decision says otherwise.

## Acceptance
1. RF1 - privacy: a non-member of a private conversation gets no content through any path (messages GET, FTS search, notifications, digest, unread, SSE, MCP talk_* tools, files download, wiki, pins, reactions, questions). Each path checked; a leak is blocking.
2. RF2 - revocation: a revoked token, a disabled account or a password change loses access at once on HTTP, SSE (closed within one ping cycle) and MCP.
3. RF3 - injection: content from agents/humans rendered in the UI never executes script (XSS in markdown, names, file names, wiki, notifications); content returned to agents via MCP/skill/AgentTalks.md is framed as data, not instructions (LLM-1, AGT-*).
4. RF4 - concurrency and data: concurrent writes (wiki edits, messages, reactions, read markers, migrations at startup) neither lose nor corrupt data; events are emitted only after commit (GC4); migrations are idempotent and forward-only (GC8).
5. RF5 - files and network: upload limits, content type, file name (traversal, %-encoding), download authorization; any server-side fetch by URL is SSRF-safe.
6. Authentication and sessions: password hashing, cookie flags (Secure/HttpOnly/SameSite), CSRF for cookie-authenticated writes, rate limits, WebAuthn verification (challenge, origin, rpId, signature counter), invite and token minting rules, bootstrap (first admin only from the console).
7. Authorization: every admin route requires a human admin; every write checks the actor's right on the target (owner/admin/member); identity never comes from the client's declaration (GC3).
8. Deploy and supply chain: Dockerfile (non-root user, no secrets baked in), docker-compose, deploy scripts (no secret on a command line, safe quoting), CI workflow (pinned actions, permissions), npm dependencies.
9. Tests are real controls: a test named as a guard can fail when the guarded behavior breaks ("czy ta kontrola potrafi odpowiedziec INACZEJ?"); a blind check is a minor finding unless it hides a real defect.
10. Docs match code: README.md, AgentTalks.md, SECURITY.md, docs/docker.md, CONTRIBUTING.md, integrations/**/SKILL.md describe commands, flags, routes and defaults that exist and behave as written; a doc that would make a user or agent do something unsafe or broken is blocking.
11. Global Constraints GC1-GC8 of spec.md hold in the whole tree (GC6 amended 2026-11-04 by D-MG-6: everything English).
12. English (D-MG-6): measured separately by task T-MG-2 (inventory done: Polish file names, test titles, API error codes, identifiers, docs/). Reviewers do NOT list individual Polish names; report only a Polish string that a user or agent sees and that the inventory would miss (CLI output, HTTP error message text, MCP tool description, log line).
13. A2A first (Michal 2026-11-04: "AgentTalks to ma byc przede wszystkim srodowisko A2A"): an agent can join, identify, discover conversations, read, write, mention, ask and answer questions, claim leases, be woken, and recover from every error using only MCP/CLI/API and the docs it is given (AgentTalks.md, /install, SKILL.md); every error an agent can get says what to do next.
14. Human UI (Michal: "musi byc mega intuicyjne dlatego najlepiej aby w pelni odwzorowywalo Slacka"): the web UI follows Slack's interaction model (workspace sidebar with channels/DMs and unread state, channel header, message list with grouping, threads in a side panel, composer with mentions/formatting/attachments, reactions, search, notifications, keyboard shortcuts, mobile layout) without copying Slack's brand; a human can command and talk to agents without reading docs. Checked live by the G1-UX slice (D-MG-5).
Do not guess: describe what happens, with `file:line` and a reproduction for each blocking finding (REV-3).

## TDD
Fix round: for each blocking finding, the reproduction becomes a test in the matching test file under /Users/michal/Documents/Code/AgentTalks-wt/T-MG-1/test/ that fails on 945674f for the stated reason, then passes after the fix.

## E2E
You run no E2E. The orchestrator runs it on a fresh checkout (D-MG-3): server on an empty database, health, admin -> agent token -> message -> second actor reads -> SSE push -> MCP tool call -> CLI atalk.

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
Exit 0 prints `secrets: clean`. One commit per step; no push. A full suite or build runs through the heavy queue: `landfall heavy` with the command after `--`.

## Assignments (only when several agents share one worktree)
Review round: read-only, no shared worktree writes. Fix round: one implementer at a time.

## Report
Fix round: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-1/report-src.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md): the `Status:` line, decisions per acceptance point, files, RED/GREEN, gate, shared gaps, open issues. When your harness refuses that write, put the whole report in your reply.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
