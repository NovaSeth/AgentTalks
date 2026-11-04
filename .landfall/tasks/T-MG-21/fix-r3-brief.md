# Fix round 3: T-MG-21 review round 3 finding F2 (codex) — remove automatic lock eviction
<!-- Fix brief (ORC-4), hand-written. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: critical; fix round 3, the final one).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21 (branch task/T-MG-21-plugin-login, HEAD 6fc872c2680dd0ca0181ee65be310de452e77372; `node_modules` is an untracked symlink excluded locally — never commit it).
Budget: 20 minutes.
Rules: COD-1 COD-2 COD-3 ORC-7 ORC-17 REV-18 PRI-15; read them with `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall rule <ID…>`.
Context: review /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/review-r3.json (F2: two writers both see a dead owner; B evicts and takes the lock, A — paused before its unlink — then unlinks B's fresh lock, both proceed, one entry is lost).

## Design decision (binding, made by the orchestrator)
Remove automatic eviction entirely from `withTrustLock` in /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/integrations/claude-code-plugin/lib/trust.mjs.
- Acquire ONLY by creating the lock file with `wx`. Never unlink a lock you did not create. Release in `finally` only when the file still holds our pid+host+at (keep this check).
- On timeout (default 5 s, knob `AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS`), fail with a message that names the lock path, the pid/host recorded in it, and whether that pid is alive on this host (`process.kill(pid,0)`), e.g. `trust list is locked by pid 1234 on <host> (not running): if no login is running, delete <path> and retry`. The liveness check is diagnostic ONLY and never deletes anything.
- Why: a stale lock exists only if a login crashed inside its sub-second critical section; the failure is fail-closed (no trust, nothing written) and the message tells the human the exact fix. Any automatic eviction reintroduces the race.
- Remove the now-dead eviction code paths; atalk imports the same function, so it follows automatically.

## Tests (RED first, then fix; one commit each)
- Change the round-2 "dead owner -> evicted" scenario (plugin and atalk rows of the shared table in test/fixes/t-mg-21-r2-trust-lock.test.ts, and any onboarding.test.ts equivalent) to the new spec: a dead-owner lock → login waits, exits 1 after the (shortened) timeout, writes nothing, the message names the lock path and says "not running"; the lock file is still there afterwards. This is a spec change made by this brief — state it in the report; it is not a weakening.
- Add the codex race as a regression: two child processes run login concurrently against a pre-existing dead-owner lock with a short timeout → both exit 1, the trust list is unchanged, the lock file is unchanged. Then remove the lock (as the human would) and run two concurrent logins (different --dir) → both exit 0, both entries present.
- Keep every existing live-owner, F6 and F3 test passing.

## Gate
```bash
cd /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21
npm run test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets
```
Secrets: any finding not present on main (main has 11) is a failure.

## Report
In your reply: red/green frontmatter for THIS round, "## Fix round 3" with Status:, decision, RED/GREEN, gate.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path ("in reply").
