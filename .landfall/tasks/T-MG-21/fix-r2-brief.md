# Fix round 2: T-MG-21 review round 2 findings F2, F6, F3 (codex)
<!-- Fix brief (ORC-4), hand-written. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: critical; fix round 2 — the last round before a review-close decision).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21 (branch task/T-MG-21-plugin-login, HEAD 426bb1a9c5cf4df32ef85e1d2368dddd61332169; dependencies installed: yes, `node_modules` is an untracked symlink excluded locally — never commit it).
Budget: 40 minutes.
Rules: COD-1 COD-2 COD-3 ORC-7 ORC-17 REV-18 PRI-15; read them with `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall rule <ID…>`.
Context: task brief /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/brief.md (G1-G6, acceptance 1-10 still bind); round-1 fix brief /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/fix-r1-brief.md; review /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/review-r2.json (F2, F6, F3 with reproductions).

## Design (binding)
One lock module, one protocol, used by both writers:
- Put the lock in `integrations/claude-code-plugin/lib/trust.mjs` as `export function withTrustLock<T>(dir: string, fn: () => T, opts?: { timeoutMs?: number }): T` (synchronous, as today). `src/cli/atalk.ts` keeps its own copy ONLY if importing the .mjs from TS is impractical for the build (check `tsconfig.json` / how `bin/atalk.js` loads `src/cli/atalk.ts`); if you keep a copy, add a test that runs the SAME protocol scenarios against both implementations (a shared table of cases), so they cannot drift (COD-2).
- Lock = `trusted-projects.json.lock` created with `wx`, 0600, content `{"pid":<pid>,"host":<os.hostname()>,"at":<ms>}`.
- Eviction ONLY when the owner is provably dead: same host AND `process.kill(pid, 0)` throws ESRCH. Never evict by age. Unreadable/corrupt lock content: treat as held (wait), and after the timeout fail with a message naming the lock path so a human can remove it. Different host: treat as held.
- Retry every 50 ms up to `timeoutMs` (default 5000; test knob `AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS` stays).
- Release in `finally`, only if the lock file still holds OUR pid+at (do not unlink someone else's lock).

F6 + ordering (both login.mjs and `atalk login --local`): acquire the trust lock FIRST, before any write (gitignore, credential, trust list). Lock timeout => exit 1 with zero writes and an existing credential untouched. Inside the lock: gitignore, credential (temp `wx` + rename), trust list, with the existing rollback on failure. For atalk, change only `login --local`'s write path and `trustProject`; nothing else in atalk.

F3: every temp file (credential temp and trust-list temp) is unlinked in a `finally`/catch when write or rename fails.

## Tests (RED first, one commit; then fixes)
- F2: a lock held by a LIVE process (spawn a child that holds/keeps the lock file with its own pid and sleeps) with `at` = now-120 s → a login waits and times out (exit 1, nothing written) instead of evicting it; a lock naming a DEAD pid on this host → evicted, login proceeds, both entries present. Run the table against plugin and atalk implementations.
- F6: hold a fresh lock with a live pid, run `atalk login --local` in a git directory and login.mjs in a git directory → exit 1, no credential created, an existing credential's bytes unchanged, no .gitignore change.
- F3: inject a rename failure for the trust-list temp (test seam, env-only, e.g. `AGENTTALKS_LOGIN_TEST_FAIL_TRUST_RENAME=1`) → exit 1, no `*.tmp` left in the trust dir or the project dir, credential rolled back.
No test removed, skipped or weakened (COD-3); the round-1 stale-lock test changes from "age-stale" to "dead-owner" — that is a spec change made by this brief, say so in the report.

## Scope
Modify: integrations/claude-code-plugin/lib/trust.mjs, integrations/claude-code-plugin/scripts/login.mjs, src/cli/atalk.ts (login --local write path, trustProject, lock helper), test/plugin/onboarding.test.ts, test/fixes/t-mg-21-r1-trust-lock.test.ts (or a new test/fixes/t-mg-21-r2-trust-lock.test.ts). Nothing else; otherwise NEEDS_CONTEXT.

## Gate
```bash
cd /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21
npm run test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets
```
Secrets: the main branch currently has 11 findings (baseline drift, not yours); any finding not present on main is a failure.

## Report
Put the report (red/green frontmatter for THIS round, "## Fix round 2" with Status:, per-finding decision, RED/GREEN, gate) in your reply if the harness refuses /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/report-r2.md.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
