# Fix round 1: T-MG-21 review findings F1-F5 (codex review, round 1)
<!-- Fix brief (ORC-4), hand-written. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: critical; fix round 1).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21 (branch task/T-MG-21-plugin-login, HEAD 4ee7ec38b2ecf6fe9f287f4c38553f13cc00d74d; dependencies installed: yes, `node_modules` is an untracked symlink excluded locally — never commit it). Update the branch only with `git merge origin/main`, never rebase.
Budget: 45 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: COD-1 COD-2 COD-3 ORC-7 ORC-17 REV-18 PRI-15; read them with `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall rule <ID…>`.
Context files: the task brief /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/brief.md (Global Constraints G1-G6, acceptance 1-10 still bind); the review /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/review-r1.json (findings F1-F5 with reproductions).

## Findings to fix (each: RED test first, then the fix; one commit per finding or per pair of red/fix)
F1 (integrations/claude-code-plugin/lib/trust.mjs:31) Trust must bind to the VERIFIED bytes, not to whatever is on disk at hashing time.
- Change `trustProjectFile(path, opts)` to take the exact bytes: `trustProjectFile(path: string, bytes: Buffer | string, opts?: { env?, home? }): void`; sha256 is computed from `bytes`, never from a re-read.
- In login.mjs, after the rename, re-read the target; if its bytes differ from what login wrote, exit 1 ("the file changed while saving; nothing trusted") and write no trust entry (if the trust entry was already written, remove it under the same lock as F2).
- Test: a hook that replaces the file between login's rename and trust (inject via an env-only test seam such as `AGENTTALKS_LOGIN_TEST_AFTER_RENAME=<script path>` that login runs synchronously only when that variable is set; or any equivalent seam you justify in the report) → exit 1, the trust list holds no entry whose sha matches the replacement, and `isTrustedProject` on the replaced file is false.

F2 (lib/trust.mjs:38 and src/cli/atalk.ts trustProject ~line 68) The trust-list read-modify-write is serialized by a lock both writers respect.
- Lock file: `<trust dir>/trusted-projects.json.lock`, created with flag `wx` (O_EXCL), mode 0600, content `{"pid":<pid>,"at":<ms>}`; retry every 50 ms up to 5 s; a lock older than 30 s (by its `at`, or mtime if unreadable) is stale: remove it and retry once. Release (unlink) in `finally`. Timeout → throw; login.mjs turns it into exit 1 "trust list is locked by another login; try again" with nothing trusted (roll back per F3).
- The SAME protocol in `src/cli/atalk.ts` trustProject (scope extension of this round: only `trustProject` and a private helper next to it; no other atalk change).
- Tests: (a) a pre-held fresh lock file → login.mjs waits; release it after ~300 ms → login exits 0 and BOTH the pre-existing entry and the new one are present; (b) a stale lock (at = now-60s) → login proceeds; (c) for atalk: the same as (a) via `atalk login --local` if the existing CLI test harness (see /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/test/fixes/t-mg-10-r1-cli.test.ts) makes it practical, else a unit test of the exported/inner helper; say which in the report.

F3 (scripts/login.mjs:153) Refuse every existing non-regular output, and never leave a credential behind on failure.
- Before ANY write, `lstat` each output: `<dir>/.agenttalks.json`, `<dir>/.gitignore` (when it will be touched), `<trust dir>` (must be a directory, not a symlink, if it exists), `<trust dir>/trusted-projects.json`. Anything existing that is not a regular file (dir for the trust dir) → exit 1, nothing written.
- Write order: `.gitignore` line first (so the credential is never unignored), then the credential (temp `wx` + rename), then the trust entry. If a later step fails: restore the previous credential bytes if one existed, else unlink the new credential; unlink any temp file. The `.gitignore` line may stay (harmless).
- Tests: a directory named `.gitignore` → exit 1, no `.agenttalks.json`, no trust list; a FIFO at `.agenttalks.json` → exit 1, FIFO still a FIFO; a symlink at the trust list → exit 1, the symlink target unchanged; a trust step forced to fail (e.g. the F2 lock timeout with `AGENTTALKS_LOGIN_LOCK_TIMEOUT_MS=200` test knob, or an equivalent seam) → no new `.agenttalks.json` remains, a pre-existing one keeps its old bytes.

F4 (scripts/login.mjs:55) No bearer token over plain HTTP to a non-loopback host.
- `http:` is accepted only for hostnames `localhost`, `127.0.0.0/8` addresses, `::1` / `[::1]`; any other `http:` URL → exit 1 "use https:// for a remote server" BEFORE any request. Also reject URLs with userinfo (`user:pass@`).
- Tests: `--url http://remote.example` and `--url https://u:p@x.example` → exit 1, stderr names https (resp. credentials in the URL), no `.agenttalks.json`, no trust list, and the token absent from output. Prove "zero requests" by structure: the URL check runs before `createApi` is constructed (cite the line in the report). Keep a passing test that `http://127.0.0.1:<port>` against fakeAt still works.

F5 (scripts/login.mjs:45) Never echo argument values.
- Unknown arguments → a fixed diagnostic that echoes nothing from argv, e.g. `unknown argument; usage: node login.mjs --url <server> --token - [--dir <path>]`. Same for any other error path that could include argv text.
- Test: `--token=atk_synthetic_fix_0001` (a `// SYNTH:` value) and `atk_synthetic_fix_0002` as a bare positional → exit 1, neither string appears in stdout or stderr.

## Scope
Modify: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/integrations/claude-code-plugin/scripts/login.mjs, /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/integrations/claude-code-plugin/lib/trust.mjs, /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/src/cli/atalk.ts (trustProject and one private helper only), tests in /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/test/plugin/onboarding.test.ts and, for atalk, a new file /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/test/fixes/t-mg-21-r1-trust-lock.test.ts. Docs only if a user-visible message changed (integrations/claude-code-plugin/README.md). Nothing else; anything more: stop with NEEDS_CONTEXT (ORC-17).
No test removed, skipped or weakened (COD-3).

## Gate (in order, no pipes, bounded test workers)
```bash
cd /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets
```
The secrets scan's known baseline (decision D-MG-8) is 10 findings; any NEW finding is a failure — list the count in the report.

## Report
Append a new section "## Fix round 1" with its own `Status:` line, per-finding decision, RED/GREEN (test names + failing reason before, pass after), and gate results, to /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/report-r1.md (create it; template /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md, with the red/green frontmatter for THIS round). When your harness refuses that write, put the whole report in your reply.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
