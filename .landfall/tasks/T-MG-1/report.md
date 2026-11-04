---
red: {"command": "codex in-memory reproductions at 945674f (review-r1.json F1-F12) and claude slice reproductions (review-r2/r4)", "exit": 1, "excerpt": "notification excerpt after removal from a private channel; long-poll delivered after revoke; disabled actor woken; forged <michal:czlowiek> row via newline; passkey counter reset by 0; private typing location visible; foreign sessionId accepted; agent admin created a human (201); rolled-back savepoint callback delivered; partial wiki read marked complete; talk_read 60228 chars over budget; npm audit 1 critical + 4 high"}
green: {"command": "npm test && npm run typecheck && node e2e.mjs <main> && codex scoped re-review r6", "exit": 0, "excerpt": "main a21f8d4: 492 tests pass, 0 fail (baseline 322); typecheck clean; E2E 22/22 on a fresh checkout of main; npm audit --omit=dev 0 vulnerabilities; codex re-review round 6 approved, 0 findings"}
---
# Report: Area gate T-MG-1 - whole-project verification of AgentTalks
Status: DONE

## What the gate did
- Review round 1 (codex, whole range 877e20e..945674f): 12 blocking.
- Review round 2 (Claude slices S1 HTTP security, S2 agentic/supply chain, CORE data, UI-CODE): 41 findings, 7 blocking.
- Review rounds 3/4 (Claude A2A agent walk-through, live UX walk-through vs Slack, tests-as-controls mutation testing): 40 findings, 6 blocking (round 3 had duplicate ids and was superseded by round 4).
- Round 5 (codex re-review on main after the fix packages): 3 new blocking -> T-MG-13. Round 6 (codex, scoped): approved.
- Automated audit: landfall secrets tree + full history (all hits verified false positives, D-MG-8); npm audit (fixed in T-MG-10).
- E2E on a fresh checkout: 22/22 at 945674f and 22/22 on main after all fixes.

## Fix packages (each: brief, TDD, review, cross-review where critical, PR, merge)
T-MG-4 (PR #1, @tars: avatars + fade/archive, tests added), T-MG-6 (auth/sessions, device cookie D-MG-14), T-MG-7 (core privacy/data), T-MG-8 (UI defects), T-MG-9 (CI/Docker/deploy), T-MG-10 (MCP/agent surface, injection framing, SDK 0 vulns), T-MG-11 (tests that can fail for 7 unguarded controls + hardening), T-MG-13 (round-5 fixes). PRs #1-#8 merged on GitHub with green CI.

## Deferred to later tasks (backlog, not blocking the gate)
English translation (T-MG-2, in progress), Slack-parity UI (T-MG-3, spec in docs/superpowers/specs/2026-11-04-ui-slack-parity.md; UX minors B-MG-40, B-MG-68..85, B-MG-97, B-MG-98), live plugin (T-MG-12, in fix round), Polish strings (B-MG-34, B-MG-42, B-MG-61), docs drift (B-MG-93).
