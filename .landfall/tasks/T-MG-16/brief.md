# UI: upgrade-safe unsent storage, error notice outside the chat view, SSE resume gap, focus after inline edit (T-MG-16)
<!-- Task brief (ORC-4), hand-written by the orchestrator. -->

Executor: landfall:designer (browser storage concurrency + live delivery).
Review: landfall:external (codex), scoped to the five findings.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-16 (branch task/T-MG-16-ui-final-fixes from main at 367a5885bf9128d7d1594f8c237efd42518c12da, which contains T-MG-3; dependencies installed). Update only with `git merge origin/main`.
Budget: 75 minutes.
Rules: COD-1 COD-2 COD-3 REV-9 SPC-13; English code/comments/tests (test/language.test.ts), no em-dash; every user-visible string through t() with a Polish entry in src/http/ui/js/i18n-pl.js (test/i18n.test.ts). Commit per item group (you may run git in this worktree: add/commit only, no push).

## Findings (backlog; the codex reproductions are in /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-3/review-r7.json, the decision D-MG-28)
1. B-MG-108 / F7 (state.js ~285): the storage migration deletes attributable unsent messages written after the upgrade: A upgrades; an unreloaded tab B running the previous code persists b2 with ownerId=2 into the old shared key; A.clearLocalAccountData(1); B reloads: [] (expected [b2]). Fix: entries with a valid ownerId found in the legacy shared list are moved to their owner's per-actor key on EVERY sweep (not only the first run); only unattributed entries are discarded.
2. B-MG-109 / F8 (state.js ~312): concurrent migrations overwrite another account's newer unsent write (A pauses after reading atalks_unsent_2_5, B migrates and persists b2, A resumes and writes [b1]). The read-modify-write over one key per conversation is not atomic across tabs. Fix: store each unsent message under its own key (`atalks_unsent_<actorId>_<conv>_<clientMsgId>`) so no write ever rewrites another message (listing = scanning the prefix); migration and cleanup add/remove single keys only. Keep two tabs of the same account consistent (no lost entry). Regression: codex's interleaving keeps [b1, b2] after reload; F5's and F7's interleavings too.
3. B-MG-110 / F9 (actions.js ~122): the "no toast while the failed row is visible" rule (U40) suppresses the error when the user left the chat view (wiki) during the send: activeId is unchanged but the row is not on screen. Fix: suppress only when the failed row is actually in the DOM and visible (chat view active, row element connected; viewport intersection if cheap); otherwise toast. Regression: codex's repro (hold POST in channel 5, open the wiki, reject 503) -> one toast; visible-chat control -> none.
4. B-MG-97 (sse-events.js): until the first SSE event arrives the replay cursor is 0, so a reconnect sends no ?after and the server treats it as future-only; messages posted in the gap are lost for loaded conversations. Fix: seed the cursor at connect time from the newest loaded message id (or the server's status watermark if the UI has one), or on resume reload the active conversation since its newest loaded id; test with a stubbed EventSource that drops before its first event.
5. B-MG-98 (view-chat.js inline edit): after saving an inline edit with Enter (or Escape), focus returns to the composer so an immediate ArrowUp edits the last message again. Test (source or stubbed DOM) plus a live check if cheap.

## Gate (in order, no pipes)
```bash
node --test --test-concurrency=2 --test-timeout=20000 "test/**/*.test.ts"
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets --range 367a5885bf9128d7d1594f8c237efd42518c12da..HEAD
```

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-16/report.md (template /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md): first line `---`, red:/green: JSON lines, `---`, then `Status:`, per item what changed + evidence, files, gate, open issues. When the harness refuses the write, put the whole report in your reply.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
