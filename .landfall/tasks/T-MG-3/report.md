---
red: {"command": "per slice: node --test test/ui-s0-scaffold.test.ts test/ui-s0b-primer.test.ts test/ui-s1-sidebar.test.ts ... test/ui-c2-components.test.ts (each written first against the previous wave)", "exit": 1, "excerpt": "S0b raw colors in app.css; S1 visibleRows missing; S2 no #side-panel; S3 conversationRoute missing; S4 wrapSelection missing; S5 commands.js missing; S6 filterPeople missing; S7 titleCount missing; S8 view-unreads.js missing; S9 no #btn-back; S10 view-threads.js missing; S11 view-search.js missing; S12 messageHtml/mention tint; S13 accountRowHtml; S14 wikiTreeKeyAction; C1 11/11; C2 13/13; S3b markUnread export missing; drafts owner claimLocalData missing"}
green: {"command": "npm test && npm run typecheck (worktree, after merging main)", "exit": 0, "excerpt": "tests 843, pass 843, fail 0; typecheck clean"}
---
# Report: human web UI on Slack's interaction model with GitHub's Primer design system (T-MG-3)
Status: DONE_WITH_CONCERNS
Pending: the screenshot UX review of Amendment 2 and its fix round.
Spec: docs/superpowers/specs/2026-11-04-ui-slack-parity.md + tasks/T-MG-3/spec.md amendments 1-2 (D-MG-18). Implemented in 6 waves by landfall:implementer agents (fable; sonnet for two small fixes), disjoint files per wave, orchestrator commits after the full gate.

| Wave | Commit | Slices | Gate |
|---|---|---|---|
| 1 | c18fbea | S0 scaffolding, S0b Primer (vendored MIT tokens/CSS/Octicons, light/dark/auto theme, no raw colors) | 626 |
| 2 | 3810b8d | S1 sidebar + rail places, S2 side panel column + join bar, S7 counters/unread truth | 656 |
| fix | d7b7b0a | drafts/last conversation/recent never cross accounts (automated security scan) | 661 |
| 3 | b80121c | S3 routing + permalinks + Mark unread, S3b server rewind route POST /api/conversations/:id/unread, S4 composer parity | 684 |
| 4 | c0bf37f | S5 slash commands + reports, S6 profiles + people picker | 709 |
| 5 | baaed73 | S8 shortcuts + all unreads, S9 mobile tabs, S10 threads + pinned, S11 search filters | 759 |
| 6 | 424cb94 | S12 messages, S13 admin + login, S14 wiki, C1/C2 clean-up of 30+ wave follow-ups | 807 |
| merge main | (merge) | plugin T-MG-14/15 | 843 |

Server-side changes: one new route (S3b, members only, rewind only, CSRF as /read) and the static vendor route for Primer (directory allowlist + file-name shape). Everything else is UI (src/http/ui/**) and tests.
Concerns: open follow-ups for the UX fix round are listed in tasks/T-MG-3/followups.md (W6-*, W3-S4-B and W4-S5-B live checks); keyboard-on-device (S9) verified by CSS/viewport code only; the Activity view keeps no channel sidebar per the owner's earlier report.

## Fix round 1
Status: DONE
Source: codex review-r1 F1-F3 + live W3-S4-B + automated scan (unsent owner). Commits: 4aa92d5, 8c92d64.
session generation drops stale answers; one overlay registry closed on teardown; unsent messages persist per conversation and come back after reload or 401 for the same account only; every unsent entry carries its owner.

## Fix round 2
Status: DONE
Source: UX review-r2 U1-U20 + wave follow-ups + U14 boot race + U21 human news. Commits: e7e0845, 097b8d5, 42aed7c.
composer never covers messages, Octicon toolbar, compact empty states, catch-up labels, mobile Activity, threads loading, More menu, filter-only search, Threads only in the sidebar, first batch drawn at once, humans see only human news.

## Fix round 3
Status: DONE
Source: codex review-r3 F1-F3 (D-MG-26). Commits: 4367c81.
submits re-check generation, conversation and thread after every await; per-actor storage keys; filter-only search keeps paging.

## Fix round 4
Status: DONE
Source: UX review-r4 U1, U30-U36 + round-3 leftovers (D-MG-26). Commits: 1a713b8.
list stays pinned through layout changes; new public channels announced (private only to the creator); compact thread toolbar; help dialog fade; question cards; ActionList + menu; PL rail; toast placement; threads-seen per actor; same-account also-send completes.

## Fix round 5
Status: DONE
Source: codex review-r5 F4-F6 + UX review-r6 U40-U43 (D-MG-27, last round). Commits: a193c2e.
unattributed legacy storage dropped, unsent keyed per account, slug lookup guarded by route/address/session; no toast over a visible failed row; wiki title ellipsis; search column; composer width.
