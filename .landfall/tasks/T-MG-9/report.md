---
red: {"command": "node --test test/fixes/t-mg-9-infra.test.ts", "exit": 1, "excerpt": "✖ CI: every action is pinned to a full commit SHA (B-MG-12, B-MG-16)\n✔ CI: the pin check can fire (a tag reference is reported)\n✖ CI: the workflow token is read-only by default (B-MG-16)\n✖ Docker: the base image is pinned by digest and only /data is owned by the runtime user (B-MG-17)\n✖ deploy: the site password becomes valid JSON even with quotes and backslashes (B-MG-22)\nℹ tests 5 ℹ pass 1 ℹ fail 4"}
green: {"command": "node --test test/fixes/t-mg-9-infra.test.ts", "exit": 0, "excerpt": "ℹ tests 5\nℹ pass 5\nℹ fail 0"}
---
# Report: Fix D - infra: CI pinned to SHAs + permissions, Dockerfile digest/chown, deploy password JSON (T-MG-9)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-9, task/T-MG-9-fix-d-infra. Commits: e32cd3d (test + fix, one green commit; an earlier two-commit split left a red tree in between, so it was squashed before any push). Push: no. Scope touched: .github/workflows/ci.yml, Dockerfile, deploy/uruchom-produkcje.sh, test/fixes/t-mg-9-infra.test.ts.
Implemented by the orchestrator (mechanical, PRI-5/ORC-21); review goes to a fresh reviewer (PRI-6).
Status: DONE

## Decisions
1. B-MG-12, B-MG-16 (CI pins): actions/checkout and actions/setup-node pinned to the commit SHAs of v4.4.0 (11d5960a..., 49933ea5...; resolved with `gh api repos/actions/<name>/commits/v4.4.0`), with the version in a trailing comment. Stayed on major v4 (no upgrade to v7) to change one thing at a time. Added top-level `permissions: contents: read`.
2. B-MG-17 (Docker): FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 (Docker Hub, last_updated 2026-10-28). chown now covers /data only; checked that every runtime write goes to the data dir (src/config.ts:75-84, src/core/files.ts:298, src/core/awatary.ts:81).
3. B-MG-22 (deploy): new password_json() builds the body with python3 json.dumps, reading the password file itself (never on argv); both former printf sites use it. python3 exists on the VPS (`ssh ovh-claude command -v python3` -> /usr/bin/python3).

## Files
- .github/workflows/ci.yml: SHA pins (3 uses), permissions block.
- Dockerfile: digest pin, chown /data only.
- deploy/uruchom-produkcje.sh: password_json(), 2 call sites.
- test/fixes/t-mg-9-infra.test.ts: 5 tests (pins, a probe proving the pin check fires, permissions, Docker digest + chown, password JSON round-trip with a quote and a backslash).

## RED / GREEN
- RED: 4 of 5 failed for the stated reasons (unpinned uses, no permissions block, FROM without digest, no password_json); the probe passed.
- GREEN: 5/5; full suite 327/327 (baseline 322 + 5).

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | clean | 0 |
| lint | none configured | - |
| tests | 327 pass, 0 fail | 0 |
| secrets scan (--range 0561f86..HEAD) | clean | 0 |

## E2E assertions reviewed
The CI docker job (build + /api/health smoke) exercises the pinned image on the PR.

## Shared gaps (for the orchestrator)
- Digest pins go stale: consider Dependabot (github-actions + docker ecosystems) in a later task.
- deploy/uruchom-produkcje.sh defines ENV_FILE and ENV_PLIK with the same value (lines 17, 26): duplicate, harmless; cleaned up in T-MG-2.

## Open issues / deviations from the brief
None.

## Fix round 1
Problem: review r1 F1 (minor): password_json ran inside `$( ... | curl ...)`; without python3, curl got an empty body and the script reported the misleading "gate rejects the right password".
Fix: password_json checks `command -v python3` first and returns 1 with "STOP: python3 is required ..." on stderr; under `set -euo pipefail` the failing substitution stops the script with that message. Commit 2f453bf.
RED/GREEN: new test runs the helper with PATH=/nonexistent-bin -> failed before (helper exited 127 silently into the pipe, no message), passes after (exit 1, message on stderr).
Gate: npm test 328 pass / 0 fail; typecheck clean; secrets range clean.
Status: DONE
