---
red: {"command": "node --test --test-timeout=20000 --test-concurrency=2 --test-reporter=tap test/ui-t18-catchup.test.ts", "exit": 1, "excerpt": "not ok 11 - B-MG-118 (codex repro): a message held from SSE during the newest-30 refresh keeps its REST reactions\n  + undefined\n  - { '+1': [ 'nestor' ] }\nnot ok 14 - B-MG-118: a held message edited live during the newest-30 refresh still gets its REST reactions\n  + undefined\n  - { '+1': [ 'nestor' ] }\nnot ok 15 - B-MG-119 (codex repro): after a failed retry the reconnect refreshes a held gap message older than the newest 30\n  expected: 'edited during outage'\n  actual: 'm1'\n# pass 13\n# fail 3"}
green: {"command": "landfall heavy -- node --test --test-timeout=20000 --test-concurrency=2 --test-reporter=tap test/**/*.test.ts", "exit": 0, "excerpt": "ok 11 - B-MG-118 (codex repro): a message held from SSE during the newest-30 refresh keeps its REST reactions\nok 12 - B-MG-118: a reaction refreshed by a live event during the after= page is not overwritten by the older page\nok 13 - B-MG-118: a reaction removed by a live event during the after= page stays removed\nok 14 - B-MG-118: a held message edited live during the newest-30 refresh still gets its REST reactions\nok 15 - F4 (T-MG-43): a message replaced by a REST reaction refresh during the after= page keeps that newer revision\nok 16 - B-MG-119 (codex repro): after a failed retry the reconnect refreshes a held gap message older than the newest 30\nok 17 - F4 (T-MG-43): a held gap message edited by a live event during the after= request keeps the live body\n# tests 1068\n# pass 1068\n# fail 0\n# skipped 0"}
---
# Report: UI SSE catch-up keeps REST reactions and newer revisions of held messages (T-MG-43)

Written here because the harness refused the write to /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-43/report.md (the brief's fallback path).

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-43, task/T-MG-43-sse-catchup-merge (from a85b76d). Commits: 6f69006 (tests and fix in one step, because both findings change the same merge rule in loadGapAfter). Push: no. Scope touched: src/http/ui/js/sse-events.js, src/http/ui/js/data.js, test/ui-t18-catchup.test.ts.
Status: DONE_WITH_CONCERNS

## Decisions
Approaches compared:
- A. A reference snapshot per request only (the loadMessages keepTouched rule from r3, applied to each gap page). Pro: no new state, and safe against ABA for message bodies because every writer replaces the object. Con: it misses a live write that landed during the earlier newest-30 request of the same catch-up (mutations M3/M6 below make the existing F4 newest-30 test fail). It also does not work for reactions: toggleReaction changes its map in place, and "no reactions" is `undefined` both before and after, so ABA applies.
- B. Live-write stamps only: one monotonic counter, live writers stamp, and a page skips anything stamped after its mark. Pro: one ordering rule for bodies and reactions, safe against ABA. Con: it misses non-live writers in flight, such as a reaction refresh that upserts a newer REST row or an own edit through applyMessageUpdate, so an older page would overwrite them (mutation M2).
- C (chosen). B for live writes, plus A for any other writer that replaced a held object while the page was in flight. Cost if wrong: a held row is refreshed when it should not be (a stale body until the next live event), or skipped when it should be refreshed (the F6 stale body). Success criterion: the 17 catch-up tests pass and each mutation M1-M8 kills at least one of them (met, see RED / GREEN).

1. B-MG-118 (F5): the page's reactions are merged for every message the page carries, whatever the body filter kept (`mergePageReactions` in data.js). The exception is a message whose reactions a live reaction refresh wrote after the mark. That refresh is `loadReactionsForMessage`, the handler of an SSE `reaction` event. It stamps only when it lands, so a failed refresh does not block the page's reactions. `loadMessages` (the newest-30 refresh) uses the same merge, because its touched filter dropped the REST reactions of a held message edited live during it (test 14: the same defect in the other half of the catch-up). Tests: 11 (the codex repro), 12 (a newer reaction during the page), 13 (a removal during the page), 14.
2. B-MG-119 (F6): a held gap message gets the page's revision unless it changed (rule in point 4). Test 16 is the codex repro: after the failed retry and the reconnect, body(1) is "edited during outage".
3. F4 still holds. Tests 9 and 10 (both delayed-response repros) are unchanged and pass. Two tests were added: 17 (a live edit of the held gap message during the after=0 request keeps the live body) and 15 (a non-live REST writer during the page: a reaction refresh upserted a newer row, and that row is kept).
4. The rule for "changed during the request", and why it cannot lose a newer state:
   - A REST page P of conversation C replaces a held message X unless one of two things happened. (a) A live SSE event wrote X after `mark`. The stamp comes from `liveStamp()` and is kept in a WeakMap keyed by the message object; `mark` is `liveMark()`, taken when C's catch-up began, before its newest-30 refresh. (b) The object held for X is no longer the one held when P was sent, meaning some writer replaced it while P was in flight. For reactions, P's reactions for X are merged unless a live reaction refresh stamped X after the mark. The newest-30 refresh uses its own send time as the mark.
   - Applying P to an UNCHANGED held X is safe. X's state was written before P was sent, from data the server cut before that write. The server cuts P after P was sent, so P's cut is later and P is at least as new as X.
   - Skipping P for a CHANGED X is safe. The change came from one of two sources. One is a live event: its payload is the row at emission, and the server's replay also reads current rows (src/http/sse.ts inboxAfter/updatedBefore). The other is a REST read made after the reconnect, so after the outage. Any revision newer than that write emits its own event on the stream, which is open during the catch-up (the catch-up runs from onopen), and onMessageEvent applies that event unconditionally. Reactions work the same way: every reaction change emits a `reaction` event, and the refresh it triggers is cut after the change. So a skipped page can only carry a state that is older than a live delivery or that a later live delivery replaces.
   - (a) uses the window "since this conversation's catch-up began" instead of "since this page was sent". The reason: a live revision delivered during the newest-30 request must not be replaced by the gap page either (existing test 10, whose fake server does not record the live edit).
5. No test was removed, skipped or weakened. Only the harness was extended. The fake route now answers `before=` (loadReactionsForMessage uses `before=<id+1>&limit=1`). It also returns reactions from a `reactions5` table, cut at request time; that table is empty in every earlier test, so those tests still get `{}`. `heldResume` takes an optional server table (default = the old one). beforeEach resets `state.reactions` and `threadOpen`.

## Files
- src/http/ui/js/data.js: `liveMark`/`liveStamp` (one counter); `loadReactionsForMessage` sets reaction stamps on success; new `mergePageReactions`; `loadMessages` merges page reactions independently of its touched filter.
- src/http/ui/js/sse-events.js: `onMessageEvent` stamps the object it upserts. `loadGapAfter` takes the catch-up mark, replaces a held row unless it changed (rule in point 4), and merges reactions through `mergePageReactions`. `catchUpLoadedHistories` takes the mark before the newest-30 refresh.
- test/ui-t18-catchup.test.ts: 7 new tests (11-17) and the harness extensions above.

## RED / GREEN
- RED (base a85b76d with the new tests in place): 11 and 14 failed with `state.reactions[...]` undefined instead of `{ '+1': ['nestor'] }`, because the held filter dropped the REST reactions. 16 (B-MG-119) failed with body 'm1' instead of 'edited during outage', because the held filter blocked the newer revision. 12, 13 and 17 passed on the base, because the base never applies a page to a held row. They guard the fix against a naive "merge everything" fix and are proven by mutation. Test 15 was added after the fix and is proven by M2.
- GREEN: 17/17 in the catch-up file; 1068/1068 in the full suite.
- Mutations (each applied alone, then restored with git checkout; the tree is clean afterwards):
  - M1, page reactions without the stamp filter: 12, 13, 15 fail.
  - M2, no in-flight reference check (b): 15 fails.
  - M3, no live stamp check (a): 10 fails.
  - M4, the base rule (never replace a held row): 16 fails.
  - M5, loadMessages merges reactions of fresh rows only: 14 fails.
  - M6, gap mark taken after the newest-30 refresh: 10 fails.
  - M7, reaction refresh not stamped: 12, 13, 15 fail.
  - M8, always replace held rows: 9, 10, 15, 17 fail.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck (npm run typecheck) | clean | 0 |
| lint | no lint script in package.json | - |
| tests (landfall heavy, TAP, 2 workers) | 1068 tests, 1068 pass, 0 fail, 0 skipped | 0 |
| secrets scan (landfall secrets) | 4 hits, all from the pre-existing baseline outside this task's files (D-MG-8): .landfall/decisions/D-MG-8.md:21, deploy/instance.env.example:33,39, docs/docker.md:105. None in the touched files. | 1 |

The shell guard refused the brief's `NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test` (SEC-3, expansion inside quotes). The equivalent ran instead: `landfall heavy -- node --test --test-timeout=20000 --test-concurrency=2 --test-reporter=tap "test/**/*.test.ts"`, which is the npm script's command plus the TAP reporter and 2 workers (COD-14). The first heavy attempt was refused (exit 7, stale scheduler lock). The retry started after the orchestrator cleared the lock and passed. No test was rerun as flaky.

## E2E assertions reviewed
None. The tests use the in-memory UI harness only, as the findings' repros do.

## Shared gaps (for the orchestrator)
- none

## Context
Read: the brief; B-MG-118.json and B-MG-119.json; D-MG-31; src/http/ui/js/sse-events.js (whole); data.js lines 1-170; state.js lines 160-195 (upsertMessage, mergeReactions); actions.js lines 188-202 (toggleReaction); src/http/sse.ts lines 20-45 and 100-150 (replay reads current rows). Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 REV-5 REV-9 ORC-7 PRI-2 PRI-6 PRI-15.

## Open issues / deviations from the brief
- D-MG-31 (active, scope sse-events.js) says "catch-up inserts missing messages, never overwrites". Following this brief and B-MG-119, the catch-up now overwrites a held row that did not change. The decision's intent, that a delayed page never replaces a live edit, is kept and tested (9, 10, 17). A decision that supersedes D-MG-31 with the rule in point 4 is needed.
- data.js changes go one step past the minimum the brief names: `loadMessages`' reaction merge has the same F5 defect in the newest-30 half of the catch-up (test 14). Its other callers (opening a conversation, the unreads view) now also keep a reaction refresh that landed during their request. That is the same protection; their behaviour is otherwise unchanged.
- One commit instead of one per step, because both findings are one merge rule in the same lines of loadGapAfter.
- The report could not be written to the brief's path (harness refusal), so it is at this fallback path.
- Follow-up (out of scope):
  - `loadOlderMessages` and the view-chat loaders (view-chat.js:98, 187) still overwrite rows and reactions without this rule.
  - `toggleReaction` (actions.js) changes reactions in place without a stamp. A page cut before the click and landing after it shows the old state until the click's SSE echo refreshes it (transient).
  - An outage edit to a message that is older than the newest 30 and not above a pending floor still arrives only through the server's 24 h `message_updated` replay, and only when the reconnect carries a cursor.
- Scratchpad note: my early RED/GREEN files used generic names (red.tap, green.tap, gate.json, gate2.json) in the shared scratchpad, and gate2.json overwrote a file that already existed.
