---
red: {"command": "node --test --test-timeout=20000 test/fixes/t-mg-6-auth.test.ts", "exit": 1, "excerpt": "tests 13, pass 1, fail 12. long-poll after revoke: actual 200 expected 401; disabled actor isWakeable actual true expected false; wake body exp undefined expected 1000300; isBlockedIp(64:ff9b::7f00:1) false expected true; passkey 5->0 missing expected exception; agent admin POST /api/actors actual 201 expected 403; 9th victim guess actual 401 expected 429; logout: pre-logout cookie still valid; no security: line on failed login"}
green: {"command": "npm test", "exit": 0, "excerpt": "tests 335, pass 335, fail 0 (baseline 322 + 13 new in test/fixes/t-mg-6-auth.test.ts). typecheck exit 0, landfall secrets --range 0561f86..HEAD clean"}
---
# Report: Fix A1 auth and sessions (T-MG-6)
<!-- Stored by the orchestrator: the implementer's harness refused the write; content is the implementer's reply verbatim. -->

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-6, task/T-MG-6-fix-a1-auth-sessions. Commits: 735eccb, 9f5eb38, d6c05b8. Push: no.
Scope touched: src/http/sse.ts, src/http/auth.ts, src/core/tokens.ts, src/core/wake.ts, src/core/webauthn.ts, src/http/routes/auth.ts, test/fixes/t-mg-6-auth.test.ts.
Status: DONE_WITH_CONCERNS

## Decisions
1. B-MG-2 + B-MG-50: the long-poll keeps the request and calls `stillAuthenticated(ctx, config, req, actorId)` (new, exported from src/http/auth.ts) right before reading messages, and every 20 s while waiting. If it fails, the promise rejects with 401 (with the authFailureNote diagnosis for a dead token) and the body carries no message. Covers revoked token, disabled actor, and cookie after password change (epoch). Helper for package B (MCP talk_read wait): `stillAuthenticated`; without a `req`, B can call `verifyToken(ctx, token)` and compare the actor id.
2. B-MG-3: `registerWake` reads `actors.disabled_at` in the same row read that precedes the send and skips; `isWakeable` returns false for a disabled actor. Wake is not token-bound (the secret lives on the actor).
3. B-MG-19: the wake body has `exp` (now + 300, WAKE_BODY_TTL_SEC) and `nonce` (16 random bytes, hex) inside the signed JSON. isBlockedIp blocks 64:ff9b::/96, 64:ff9b:1::/48 and 2002::/16. Sentence for AgentTalks.md (wake section): "Every wake body carries `exp` (a Unix time, 300 s after sending) and a random `nonce` inside the signed JSON; a receiver must reject a body whose `exp` has passed or whose `nonce` it has already seen, after verifying `x-agenttalks-signature`."
4. B-MG-5 + B-MG-52: reject when (stored > 0 or received > 0) and received <= stored; 5->0 and 5->5 rejected, 5->6 ok, 0->0 ok; stored value never lowered.
5. B-MG-8: `requireHumanAdmin` exported from src/http/auth.ts (same rule and code `tylko_admin_czlowiek` as routes/admin.ts); POST /api/actors uses it.
6. B-MG-44: password login counts failures under IP+handle (max 8), handle (max 20), IP (max 20), window 900 s; a success clears only IP+handle. The 9th guess on the victim gets 429. WebAuthn login keeps the old counter.
7. B-MG-45: logout bumps `session_epoch` (PER ACTOR: logout signs the human out of all devices; existing mechanism, no migration). CSRF required when the request carries a valid cookie session.
8. B-MG-51: `securityLog(event, fields)` in src/core/tokens.ts prints `security: {json}` via console.warn. Wired: login_failed, rate_limited, token_minted, token_revoked, admin_denied. No secret logged.

## Files
- src/http/sse.ts, src/http/auth.ts, src/core/tokens.ts, src/core/wake.ts, src/core/webauthn.ts, src/http/routes/auth.ts, test/fixes/t-mg-6-auth.test.ts (13 tests).

## RED / GREEN
- RED: 12 of 13 new tests failed (frontmatter); the always-zero authenticator test passed by design as a regression guard.
- GREEN: 335 pass, 0 fail.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | clean | 0 |
| tests | 335 pass, 0 fail (322 + 13) | 0 |
| secrets scan | clean for 0561f86..HEAD | 0 |

## Shared gaps (for the orchestrator)
- B-MG-51 events not wired (out of scope): invite minted (src/core/invites.ts or admin route), actor disabled/enabled (src/core/actors.ts setDisabled; PR #1 touches actors.ts).
- src/http/routes/admin.ts keeps a private requireHumanAdmin copy; can import the exported one.
- src/mcp/server.ts talk_read wait: reuse the re-check (package B, item 13).

## Open issues / deviations from the brief
- Per-handle cap (20) lets an attacker lock a victim's handle for 15 min (follows from per-handle counting in the brief).
- RED and GREEN not in separate commits; tests landed in d6c05b8; red output in scratchpad t-mg-6-red.txt.
