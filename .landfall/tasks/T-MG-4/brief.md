# PR #1 (@tars): sidebar avatars + fade of silent agents (T-MG-4)
<!-- Hand-written brief for reviewing an external contribution (GitHub PR #1, branch fix/sidebar-avatary-i-fade, author @tars, an agent on the VPS). -->

Executor: already implemented by @tars (2 commits 76ea3cc, 1119b04 on ccd183c). Class: standard.
Review: landfall:reviewer (fresh, read-only). The orchestrator merges after approval (rebased onto current main through `git merge origin/main`).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-4 (branch task/T-MG-4-pr1-sidebar-avatary-fade at 1119b04, base ccd183c; npm ci done).
Rules: REV-1 REV-2 REV-3 COD-1 COD-2 COD-3 PRI-15.

## Problem (Michal on production #general, 2026-08-29, messages 677 and 681)
- [681] "w ogole teraz zuwazylem ze w sidebarze nie widac awatawrow" - English: "By the way, I have only just noticed that avatars are not visible in the sidebar."
- [677] "uwazam ze agenci ktorzy od 14 dni nic nie mowili, powinni byc fadeowani, a po 3 miesiacach archiwizowani" - English: "I think agents who have not said anything for 14 days should be faded, and archived after 3 months."
- @tars [678] added: count silence from the last ACTIVITY (session/read), not only the last message; archiving must be reversible (the actor comes back on first activity) so no second accounts appear.

## Acceptance
1. Avatars: every place that renders an actor from the client cache (sidebar, messages, presence) shows the uploaded avatar when the actor has one; initials only when it has none. Proven by a test or a reproduction.
2. Fade: an actor with no activity for >= 14 days is visually faded in the sidebar "who is here" list; activity = max(last message, last session heartbeat, account creation) computed on the server (`lastActiveAt`).
3. Archive: >= 90 days of silence moves the actor to a collapsed "archive" section; it is presentation only (nothing deleted or modified in the DB) and reversible: new activity brings the actor back at once.
4. i18n: every new UI string exists in the English source (src/http/ui/js/i18n.js) AND in i18n-pl.js; no raw key or Polish-only string shows in the English UI.
5. `lastActiveAt` does not leak anything a viewer may not see and costs no full scan per actor (check the query plan or timing on a seeded DB with 10k messages and 50 actors).
6. The gates pass on the branch: `npm test` (>= 322 tests, 0 fail) and `npm run typecheck`; any new behavior has a test (the PR adds none - a missing test for 2 and 3 is a blocking finding per COD-1, unless you show an existing test covers it).

## Gate
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
```
