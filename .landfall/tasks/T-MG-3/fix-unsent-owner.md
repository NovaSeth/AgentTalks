# T-MG-3 fix 1a-follow-up: unsent messages carry their owner per entry (automated scan of 4aa92d5, MEDIUM)
Worktree /Users/michal/Documents/Code/AgentTalks-wt/T-MG-3. You are the only agent editing it now (a UX reviewer reads a separate snapshot). Run no git. English code/comments/tests, no em-dash.

## Problem
src/http/ui/js/state.js persistUnsent (fix round 1a) merges the entries already stored under `atalks_unsent_<convId>` that other tabs wrote (`others`, filtered only by clientMsgId) and then re-stamps the global owner marker `atalks_owner` with the current actor. With two accounts signed in in two tabs of one browser, account A's unsent messages are merged into the list and become "owned" by B; restoreUnsent then shows A's text to B.

## Fix (files: src/http/ui/js/state.js; test: test/ui-unsent-owner.test.ts; nothing else unless a caller must pass the actor - say so)
1. Every unsent entry stores `ownerId` (the actor id that wrote it).
2. persistUnsent: writes the current actor's entries; keeps entries of OTHER owners untouched in storage (never re-owned, never shown) - or drops them if keeping them cannot be done safely; choose and justify. It never writes `atalks_owner`.
3. restoreUnsent (and anything that reads the list): returns only entries whose `ownerId` equals the signing-in actor; entries without `ownerId` (written by 4aa92d5 before this fix) are treated as foreign unless the global owner marker equals the actor (one-time upgrade path), then claimed.
4. claimLocalData keeps its role for drafts/last_conv/recent; for unsent it may stay as is if 1-3 make it safe.
Tests first: (a) A and B entries in one conversation key -> A restores only A's, B only B's; (b) B persists after A wrote -> A's entry still not visible to B and not re-owned; (c) legacy entry without ownerId and owner marker = A -> A gets it once, B never; (d) the 1a tests (test/ui-r1a-isolation.test.ts) stay green.
Gate (no pipes): `node --test --test-concurrency=2 --test-timeout=20000 "test/**/*.test.ts"`, `npm run typecheck`.
Final reply: starts with `---` and red:/green: JSON lines, then what changed, files, gate counts, then 5 lines.
