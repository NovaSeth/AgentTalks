# T-MG-3 side fix: drafts never cross accounts (automated security scan of wave 2, S7)
Worktree /Users/michal/Documents/Code/AgentTalks-wt/T-MG-3 (shared: two other agents work there on S3 routing and S4 composer; you touch ONLY the files below). Run no git. English code/comments/tests, no em-dash; every user-visible string through t() with a Polish entry in i18n-pl.js (you need none, probably).

## Problem
After a lost session (src/http/ui/js/sse-events.js onSessionLost, ~line 16) the drafts are kept in memory (`state.drafts` survives `resetState()`) and in localStorage (`atalks_draft_<convId>`, src/http/ui/js/state.js:185-215; also `atalks_wiki_draft_*`, `atalks_last_conv`, `atalks_recent`). A different person who signs in next in the same tab/browser gets the previous account's drafts restored into their composer, plus its last conversation and recent list. Drafts are not tied to an account.

## Fix (files: src/http/ui/js/state.js, src/http/ui/js/sse-events.js, src/http/ui/js/view-login.js; test: test/ui-draft-owner.test.ts)
1. state.js: a single owner marker for all persisted per-account UI data: localStorage `atalks_owner` = the actor id of the account that wrote it. Export `claimLocalData(actorId)`: if the stored owner exists and differs from actorId, remove every `atalks_draft_*`, `atalks_wiki_draft_*`, `atalks_last_conv`, `atalks_recent` key and clear `state.drafts`; then store actorId as the owner. saveDraft writes the marker for the current actor too (so a draft is never stored without an owner).
2. sse-events.js onSessionLost: keep the in-memory drafts only together with their owner (`state.draftsOwner = state.actor.id` before resetState, restored after).
3. view-login.js: every path that establishes the signed-in actor (session resume ~line 15-36, password login doLogin ~line 39, passkey login ~line 182) calls `claimLocalData(actor.id)` right after `state.actor` is set; if `state.draftsOwner` differs from the new actor, `state.drafts = {}`.
4. doLogout behavior unchanged (it already clears the keys); it may call the same helper for the removal to avoid two lists.

## Tests first (node, document/localStorage stubs like test/ui-s7-counters.test.ts)
- account A has a draft in conv 5 (localStorage + memory), session lost, account B signs in -> no draft for conv 5 in memory or localStorage, last_conv/recent gone, owner = B.
- the same account A signs in again after a lost session -> the draft for conv 5 is restored (S7 acceptance 5 keeps working).
- a legacy draft without an owner marker and a sign-in of any account -> kept once and claimed (no data loss on upgrade) - choose this or "dropped" and justify in the report.
Gate (no pipes): `node --test --test-concurrency=2 --test-timeout=20000 "test/**/*.test.ts"` (failures inside S3/S4 test files are not yours: list them), `npm run typecheck`.
Final reply: starts with `---` and red:/green: JSON lines, then what you changed per point, files, gate counts, then 5 lines (status, files, tests, concerns, "report inline").
