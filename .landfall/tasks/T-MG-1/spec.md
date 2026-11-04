# T-MG-1 - gate spec and plan: whole-project verification of AgentTalks

Date: 2026-11-04. Requested by: Michal ("landfall init + run the entire Landfall pipeline to verify this whole project").
Class: critical (route T-MG-1). Decisions: D-MG-1 (scope), D-MG-4 (review split), D-MG-2 (fix round, no push/deployment), D-MG-3 (E2E).

## Spec - what and why

AgentTalks (v0.2.0, DB schema v14+, ~25k LOC TS/JS, Node >= 24 strip-only) is a communication server for agents and humans:
HTTP API + SSE + UI (ES modules) + MCP (`src/mcp/server.ts`) + CLI (`src/cli/atalk.ts`, `src/cli/main.ts`).
It runs in production (atalks.monokoda.com). Last full audit: 2026-08-09 (`docs/audyt-2026-08-09.md`, 116 confirmed
findings, fixed). Since then, commits continued through 2026-09-01 (HEAD 945674f). The gates have never been checked
using the Landfall method.

Initial state (measured on 2026-11-04 in a fresh worktree, Node v26.0.0):
- `npm run typecheck` exit 0; `npm test` 322 pass / 0 fail / 0 skip (4.3 s).
- Runtime dependencies: only `@modelcontextprotocol/sdk` (`package.json:28`).
- CI: `.github/workflows/ci.yml` - tests on Node 24/26, typecheck as a hard gate, image build + `/api/health` smoke test.

Success criteria (metrics with thresholds):
1. Profile gates pass again: typecheck exit 0, test failures = 0, test count >= 322 (baseline does not decrease).
2. Review: every code slice (listed below) has a review with a verdict; 100% of blocking findings have a reproduction (test or script with output).
3. Security: zero open Critical/High findings after the fix round; OWA-1..10 checked across all HTTP, LLM-1..10 and AGT-1..10 across MCP/wake/skill.
4. Secrets: `landfall secrets` exit 0 on the tree and `landfall secrets --range 877e20e..HEAD` without hits (or every hit explained).
5. Dependencies: `npm audit --omit=dev` zero High/Critical.
6. E2E on a fresh checkout: server starts on an empty database, health 200, flow admin -> agent token -> message -> read
   by a second actor -> SSE push -> MCP tool call -> CLI `atalk` - every step with assertions about behavior and data.
7. Report for the PO (REV-14) in Polish.

Approaches (SPC-4):
- A. One reviewer for the entire scope - cheap, but 25k LOC exceeds a reliable context; rejected.
- B. Disjoint slices + whole-project cross-review by another provider (chosen, D-MG-4): coverage without duplication; codex catches interface issues.
- C. A 12-perspective workflow as in the 2026-08-09 audit - deepest, but ~150 agents and 8 million tokens; disproportionate
  for post-audit verification; we take its principle "can this control answer DIFFERENTLY?" and its initial-state checklist.
Cost of a mistake with B: a defect at a slice boundary - mitigated by codex + an interface list.

Unknowns (SPC-5):
- U1 Docker (colima off): detect with `docker info`; fallback E2E through node on a fresh checkout (D-MG-3), CI covers the image.
- U2 No semgrep/gitleaks/osv-scanner: fallback `landfall secrets --range` + `npm audit` + manual review; disclose the gap in the PO report.

## Plan

Global Constraints (bind every fix):
- GC1 Zero new runtime dependencies beyond `@modelcontextprotocol/sdk` (guard: `package.json` diff, review).
- GC2 Node strip-only TS: no `enum`, parameter properties, namespace (guard: `npm test` loads files through node; typecheck).
- GC3 Identity never comes from the client's declaration - always from the token/session (guard: `test/http/api.test.ts` 401/403 tests).
- GC4 Events (SSE/notifications) emitted after the transaction commits (onCommitted) (guard: core tests).
- GC5 Every read of conversation content passes a canRead check (guard: private-channel tests).
- GC6 Comments in Polish without diacritics, without em-dash (guard: repository hook, `test/jezyk.test.ts`).
- GC7 No test is removed or weakened without a decision (COD-3; guard: `landfall verify` baseline).
- GC8 Schema migrations are idempotent and forward-only (guard: `test/store/db.test.ts`).

Review Focus (3-5 risk scenarios):
- RF1 A non-member of a private channel sees no content through any path: messages GET, FTS search, notifications, digest,
  SSE, MCP talk_log/talk_search, files, wiki - expected 403/404/no entry. Evidence: canRead tests + S1/S2 review.
- RF2 Revoked token / disabled account / password change loses access immediately: HTTP 401, SSE closed in the ping cycle, MCP 401.
- RF3 Content from agents (messages, wiki, names) displayed in the UI does not execute scripts (XSS) or inject instructions into agents
  through MCP/skill (prompt injection: instructions in content treated as data). Evidence: UI + S2 review.
- RF4 Concurrent writes (two wiki edits, two message POSTs, migration at startup) neither lose nor corrupt data:
  409 konflikt_wiki, BEGIN IMMEDIATE, savepoints. Evidence: core review.
- RF5 File upload and download: size limit, type, name (path traversal, %-encoding), SSRF when fetching by URL.

Gate tasks (disjoint slices; shared files: `src/core/ctx.ts`, `src/core/errors.ts`, `src/http/respond.ts`, `src/config.ts`
- changed only by the fix round, one at a time):

| ID | Who | Files (reads) | Output |
|----|-----|---------------|-------|
| G1-S1 | landfall:security-reviewer | src/http/auth.ts, src/http/server.ts, src/http/router.ts, src/http/respond.ts, src/http/sse.ts, src/http/routes/**, src/core/{tokens,invites,actors,webauthn,files}.ts, src/config.ts | review-s1.json |
| G1-S2 | landfall:security-reviewer | src/mcp/server.ts, src/core/{wake,guidelines,leases}.ts, src/cli/**, bin/**, cli/**, integrations/**, AgentTalks.md, deploy/**, Dockerfile, docker-compose.yml, .github/workflows/** | review-s2.json |
| G1-C | landfall:reviewer | src/core/** (excluding S1/S2 files), src/store/**, src/importer/** | review-core.json |
| G1-U | landfall:reviewer (fable) | src/http/ui/**, src/http/ui.ts | review-ui.json |
| G1-T | landfall:reviewer | test/**, README.md, docs/docker.md, SECURITY.md, CONTRIBUTING.md, NEWS.md vs code | review-tests-docs.json |
| G1-X | landfall:external (codex) | entire range 877e20e..HEAD | review-codex |
| G2 | orchestrator | npm audit, landfall secrets (tree + range) | audit.txt |
| G3 | orchestrator | E2E fresh checkout | e2e.log |
| G4 | landfall:implementer | only files from blocking findings, TDD | report.md |
| G5 | reviewer (fresh) | scoped re-review of round G4 | review-r2 |
| G6 | orchestrator | verify, task done, local merge, PO report | po-report.md |

Acceptance G1: every reviewer returns JSON per `templates/review.schema.json`, blocking findings with a reproduction, `file:line`.
Acceptance G4: every blocking finding has a RED test before the fix and GREEN after; profile gates green; baseline >= 322.
Contradiction check (SPC-8): G1 slices are disjoint (checked above); G4 may touch shared files - only one
implementer at a time, so no conflict; GC1..GC8 do not conflict with one another.
