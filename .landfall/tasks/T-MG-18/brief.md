# Drop legacy storage import (D-MG-30); SSE gap catch-up pages; thread-edit focus; plugin diagnostics (T-MG-18)
<!-- Task brief (ORC-4), hand-written by the orchestrator. -->

Executor: landfall:implementer.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-18 (branch task/T-MG-18-storage-simplify from main at b8bae5e4697a970c5d43f201a88b62c57198bdd9; dependencies installed). You may commit there (add/commit, no push). Another agent works on T-MG-19 in a different worktree (server UI switch + docs); you touch only the files below.
Budget: 75 minutes.
Rules: COD-1 COD-2 COD-3; English code/comments/tests (test/language.test.ts), no em-dash; user-visible strings through t() with a Polish entry in src/http/ui/js/i18n-pl.js.

## Items (backlog; codex reproductions in /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-16/review-r2.json; decision D-MG-30)
1. D-MG-30 (closes B-MG-111..115), src/http/ui/js/state.js: REMOVE the legacy storage import entirely. At every sign-in (claimLocalData) and sign-out (clearLocalAccountData) delete every un-namespaced legacy key: `atalks_draft_<conv>`, `atalks_wiki_draft_<slug>`, `atalks_last_conv`, `atalks_recent`, `atalks_threads_seen`, `atalks_owner`, shared unsent lists `atalks_unsent_<conv>`, r5 per-actor unsent lists `atalks_unsent_<actor>_<conv>` (a list, not a per-message key), the tombstone sets `atalks_unsent_done_<actor>`, and `atalks_storage_v_since`; keep only the current namespaced layout (per-actor drafts/wiki drafts/last conv/recent/threads seen, per-message unsent keys `atalks_unsent_<actor>_<conv>_<clientMsgId>`). Remove the import/claim/move/tombstone/7-day code and its now-dead helpers; persistUnsent/restoreUnsent work only on per-message keys of the current actor; sign-out removes the leaving actor's namespaced keys. Be careful to recognise the formats exactly (a per-message key has a clientMsgId segment; ids are digits). Update the tests that asserted import/claim/tombstone behaviour to the new rule (legacy data is deleted, never shown to anyone, the current actor's live data is untouched) - this is a decided behaviour change (D-MG-30), say so in the commit; never weaken an isolation assertion (another account's namespaced data must stay invisible and untouched).
2. B-MG-116 (sse-events.js): the REST catch-up after a resume fetches only the newest 30 messages per loaded conversation. Use `GET /api/conversations/:id/messages?after=<floor>` (check the server route for the exact parameter and page size limit in src/http/routes) and page until a page is shorter than the limit, merging in order; keep the session-generation guard. Regression: codex's repro (loaded empty conversation 5, 31 messages arrive during the gap) ends with all 31, message 1 included.
3. B-MG-117 (view-chat.js inline edit): focus is lost when the SSE message_updated redraw arrives before the PATCH answer. Record a pending refocus intent when the edit is submitted from a focused editor; after the save settles (and after any intermediate redraw), focus #th-input / #composer-input unless the user deliberately focused something else meanwhile (a focusin outside the editor/composer since the submit). Regression: codex's repro with the real renderThread gives th-input.
4. B-MG-107 (integrations/claude-code-plugin/scripts/wake-tools.mjs ~118): when GET /api/me fails with an HTTP error (401/403/5xx) the tools return errors but print nothing. Emit ONE sanitized stderr notice per failure kind through the existing refuse() path (status code and a fixed sentence, never the token or server text), keep the retry for transient failures (5xx/network), make 401/403 final as today. Test: injected 401 -> one stderr line across the four handlers; a 503 then a success -> retried.
Tests first for 2-4 (keep RED excerpts); for 1 write the new-rule tests first (they fail while the import exists).

## Gate (no pipes)
```bash
node --test --test-concurrency=2 --test-timeout=20000 "test/**/*.test.ts"
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets --range b8bae5e4697a970c5d43f201a88b62c57198bdd9..HEAD
```
Report: final reply starting with `---` and red:/green: JSON lines, then `Status:`, per item what changed + evidence, files, net lines removed from state.js, gate; then 5 lines.
