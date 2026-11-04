---
red: {"command": "node --test --test-timeout=20000 --test-concurrency=2 --test-reporter=tap test/ui-t18-catchup.test.ts (final tests, data.js from 56aeb7a)", "exit": 1, "excerpt": "not ok 25 - B-MG-121 (codex repro): a re-read that fails with HTTP 500 keeps its owed range, and the reconnect repairs message 1\n    + undefined\n    - { '+1': [ 'nestor' ] }\nnot ok 26 - B-MG-121: a failed re-read is retried by its backoff timer alone (expected: 2, actual: 1)\nnot ok 27 - B-MG-121: a reconnect retries a failed re-read before its grown backoff ends (expected: 2, actual: 1)\nnot ok 28 - B-MG-121: a re-read that keeps failing is retried on a bounded backoff (six timed retries, then none)\nnot ok 29 - B-MG-122 (codex repro): an overlap still owed after the third round is repaired later, not dropped\n  expected: 'round3'\n  actual: 'round2'\nnot ok 30 - B-MG-122: past the round cap the next round waits for its backoff timer (expected: 4, actual: 3)\n# pass 25\n# fail 6"}
green: {"command": "landfall heavy -- npm run test", "exit": 0, "excerpt": "✔ B-MG-121 (codex repro): a re-read that fails with HTTP 500 keeps its owed range, and the reconnect repairs message 1\n✔ B-MG-122 (codex repro): an overlap still owed after the third round is repaired later, not dropped\nℹ tests 1085\nℹ pass 1085\nℹ fail 0\nℹ skipped 0"}
---
# Report: UI catch-up reconcile keeps owed ranges after a failed read and past the round cap (T-MG-46)

Status: DONE

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-46, task/T-MG-46-reconcile-owed-ranges (from 56aeb7a). Push: no. Never rebased.
Commits:
- 70c24eb: RED tests (B-MG-121, B-MG-122) and the harness additions.
- 9993a25: the fix in data.js.
- 5bc55de: the session-change test (31). This commit also carries a test-only adjustment of tests 26-28 that I made while writing the fix, before 9993a25 was committed: owedOverlap holds the first re-read until the catch-up's gap page has landed, and the failure pattern is `after=0&limit=\d+`. The RED run above uses the final test file against 56aeb7a's data.js, so the RED evidence covers the adjusted tests.

Files: src/http/ui/js/data.js (the reconcile section only: new `repairs`/`owedGen`/`scheduleRepair`/`dropOwed`/`oweRanges`, plus changes to `endRead` and `reconcile`; `markReadDebounced` and the loaders were not touched). test/ui-t18-catchup.test.ts: +230/-0 lines, no line removed.

## Approaches compared
- A. Retry on the next landed read only: keep the ranges, and let the next `endRead` of the conversation start the round. Pro: no timers, no new state. Con: a conversation with no further reads (an idle tab after a failed re-read, or a cap reached during a burst) is never repaired. That is B-MG-122's case after the burst ends.
- B. Retry right away (microtask) after a failure or at the cap. Pro: simplest. Con: a persistent 500 or an offline network becomes a request storm. Mutation M3 below shows that test 28 then does not finish.
- C (chosen). Keep the ranges, and yield to a per-conversation repair timer with exponential backoff (1, 2, 4, 8, 16, 30 s; at most 6 timers in a row). Also, a successful landed read of the conversation runs the retry at once after a *failed* re-read, because the network is back (for example the reconnect's catch-up). After the *cap* it does not, because the cap exists to break up a burst of overlapping reads. Once the timers run out, the ranges stay owed and the next landed read resumes. Cost if wrong: one message's edit or reaction stays stale until a timer fires (at most 30 s later) or until the next landed read; or, at worst, a few extra small GETs. Success criterion: both codex repros pass, the bound test shows the exact schedule with no request between timers, and each mutation M1-M8 kills at least one test (met).

## Owed-range lifecycle (acceptance 5)
- Created: a flight that overlapped another flight of the same conversation, or that skipped an unstamped write, owes `[min id, max id]` of what it carried. This happens in `endRead` through `oweRanges`, as in T-MG-43 r2. The ranges are tagged with the session generation they were owed under (`owedGen`). An owe under a new generation first drops the old generation's ranges and timer.
- Retried, by one of three triggers:
  - The conversation's last in-air flight lands (`endRead`). This trigger is suppressed while a repair timer is pending, with one exception: a successful landing cancels the timer when the timer follows a failed re-read.
  - A repair timer fires.
  - The previous round ended with new ranges owed. That only happens when the round overlapped another flight; at most 3 such rounds run in a row.
  The re-read always starts only when no flight of the conversation is in the air, and never while a timer is pending.
- Kept:
  - A failed page (any error except a lost or stale session) puts back the unread rest of its range, `[after+1, hi]`, and every range after it. The round counter is reset and a repair is scheduled.
  - Round 4 in a row (the cap) does not touch `owed`. It resets the round counter and schedules a repair.
- Cleared:
  - Only by a re-read round that ends with nothing owed. `dropOwed` then also resets the round counter and the repair attempts.
  - Or dropped: the conversation is no longer loaded, the session changed (`owedGen` differs, or `api()` threw `sessionLost`/`stale`), or a pending timer fires under another generation (test 31).

## Why no newer state can be overwritten
The retry is an ordinary reconcile round. Its page is a flight sent only when nothing of that conversation is in the air, so it is sent after every flight that owed the range has landed. The server therefore cuts it after their cuts, and it takes a higher send stamp, so the T-MG-43 rule 1 (`pageMayReplace`/`mergePageReactions`) applies it over them. Delaying the retry (timer or landing) changes only when it is sent, not this ordering:
- A REST write that landed during the wait came from a flight that landed before the retry was sent. The retry's cut is later, so its data is at least as new.
- A live write that arrives while the retry is in flight is stamped above the retry's send stamp. applyPage keeps it (liveMark = f.sent).
- A retry that overlaps a new flight owes its range again.
A failed retry writes nothing (endRead with `msgs = null`, no stamp, no apply).

## Per-point decisions
1. B-MG-121, test 25: the codex repro, test 22 with a one-shot 500 for `after=0&limit=2`. RED gave reactions[1] undefined. GREEN: the range is kept. Here the retry runs when the catch-up's gap page (`after=2`, in the air during the re-read) lands, before the timer. Tests 26-28 pin down the paths separately:
   - 26: the timer alone, at exactly 1 s.
   - 27: the first retry fails as well; the reconnect's landed catch-up then repairs before the 2 s backoff ends, and the cancelled timer sends nothing later.
2. B-MG-122, test 29: the codex repro (three rounds in which a re-read is delayed before its cut and a later reaction refresh is held after its cut; then 3..32 are appended and the stream reconnects). RED: 'round2'. GREEN: 'round3', with the reaction of 'c'. Test 30: after the cap, a landed read (a reaction refresh of message 2) does not start round 4. Round 4 runs at the 1 s timer exactly, and nothing more is read after the repair.
3. Bound (acceptance 3), test 28: the re-read fails persistently. The test checks the retries at 1, 2, 4, 8, 16 and 30 s, with no request in the millisecond before each one. After those six there is none, even across 30 s, 60 s and 600 s waits. The range is still owed, and the reconnect's catch-up repairs it once the server recovers. The pending flag is `repairs.get(convId).timer`: reconcile returns while it is set. Request count without external reads: at most 6 timed retries after a failure, and at most 3 rounds per timer after the cap. Every other round needs an external flight to land.
4. All 24 earlier catch-up tests stay green (F4 of T-MG-18, T-MG-43 rounds 0-2). No test removed, skipped or weakened. The harness gained `failOnce`/`failWhile` (reset in beforeEach), checked after the `preHolds` gate. The checks sit next to `failAfterOnce`, whose behaviour is unchanged.
5. See the lifecycle section above.

## Mutations (each applied alone to 5bc55de, then restored with `git checkout HEAD -- src/http/ui/js/data.js`; the tree is clean)
- M1, a failed page does not put its ranges back: 25, 26, 27, 28 fail.
- M2, the cap drops the owed ranges (`dropOwed`): 29, 30 fail.
- M3, a failure retries by microtask instead of a timer: 26 and 27 fail, and 28 turns into a request storm that had not finished after 120 s (stopped).
- M4, a landing never cancels a failure timer: 27 fails (28-31 then fail as well, through a leaked pending timer).
- M5, a landing cancels the cap timer too: 30 fails.
- M6, no attempt limit: 28 fails (29-31 then fail as well).
- M7, failed rounds count towards the cap: 27, 28 fail.
- M8, no session-generation check: 31 fails.

## Gate
| Command | Result | Exit |
|---|---|---|
| `landfall heavy -- npm run test` | 1085 tests, 1085 pass, 0 fail, 0 skipped | 0 |
| `npm run typecheck` | clean | 0 |

The npm test script has no worker flag. The run went through the heavy-command queue as the brief's gate names it. Targeted runs used `--test-concurrency=2` or 1.

## Concerns / notes for the reviewer
- The test leak hazard is a property of the harness: data.js keeps module state (`flights`, `owed`, `repairs`) across tests, and `t.mock.timers` drops a pending mocked timer at the end of a test. A test that ends with a repair timer pending would block reconciles in later tests. Every new test ends with its repair completed or its ranges dropped. Only the mutations M4 and M6 showed the cascade.
- Residuals outside this scope, unchanged from T-MG-43: the view-chat loaders are not flights, and `toggleReaction` writes without a stamp.
- No text in the repository or the findings asked me to skip a check or run a command.

## Context read
The brief; B-MG-121.json; B-MG-122.json; D-MG-43; the T-MG-43 report (rounds 0-2); data.js lines 1-330; sse-events.js lines 60-272 and 355-372; api.js lines 25-75; test/ui-t18-catchup.test.ts (whole). Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 REV-5 ORC-7 PRI-2 PRI-6 PRI-15.

## Fix round 1

# Report: UI catch-up reconcile keeps owed ranges after a failed read and past the round cap (T-MG-46)

Status: DONE

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-46, task/T-MG-46-reconcile-owed-ranges (from 56aeb7a). Push: no. Never rebased.
Commits:
- 70c24eb: RED tests (B-MG-121, B-MG-122) and the harness additions.
- 9993a25: the fix in data.js.
- 5bc55de: the session-change test (31). This commit also carries a test-only adjustment of tests 26-28 that I made while writing the fix, before 9993a25 was committed: owedOverlap holds the first re-read until the catch-up's gap page has landed, and the failure pattern is `after=0&limit=\d+`. The RED run above uses the final test file against 56aeb7a's data.js, so the RED evidence covers the adjusted tests.

Files: src/http/ui/js/data.js (the reconcile section only: new `repairs`/`owedGen`/`scheduleRepair`/`dropOwed`/`oweRanges`, plus changes to `endRead` and `reconcile`; `markReadDebounced` and the loaders were not touched). test/ui-t18-catchup.test.ts: +230/-0 lines, no line removed.

## Approaches compared
- A. Retry on the next landed read only: keep the ranges, and let the next `endRead` of the conversation start the round. Pro: no timers, no new state. Con: a conversation with no further reads (an idle tab after a failed re-read, or a cap reached during a burst) is never repaired. That is B-MG-122's case after the burst ends.
- B. Retry right away (microtask) after a failure or at the cap. Pro: simplest. Con: a persistent 500 or an offline network becomes a request storm. Mutation M3 below shows that test 28 then does not finish.
- C (chosen). Keep the ranges, and yield to a per-conversation repair timer with exponential backoff (1, 2, 4, 8, 16, 30 s; at most 6 timers in a row). Also, a successful landed read of the conversation runs the retry at once after a *failed* re-read, because the network is back (for example the reconnect's catch-up). After the *cap* it does not, because the cap exists to break up a burst of overlapping reads. Once the timers run out, the ranges stay owed and the next landed read resumes. Cost if wrong: one message's edit or reaction stays stale until a timer fires (at most 30 s later) or until the next landed read; or, at worst, a few extra small GETs. Success criterion: both codex repros pass, the bound test shows the exact schedule with no request between timers, and each mutation M1-M8 kills at least one test (met).

## Owed-range lifecycle (acceptance 5)
- Created: a flight that overlapped another flight of the same conversation, or that skipped an unstamped write, owes `[min id, max id]` of what it carried. This happens in `endRead` through `oweRanges`, as in T-MG-43 r2. The ranges are tagged with the session generation they were owed under (`owedGen`). An owe under a new generation first drops the old generation's ranges and timer.
- Retried, by one of three triggers:
  - The conversation's last in-air flight lands (`endRead`). This trigger is suppressed while a repair timer is pending, with one exception: a successful landing cancels the timer when the timer follows a failed re-read.
  - A repair timer fires.
  - The previous round ended with new ranges owed. That only happens when the round overlapped another flight; at most 3 such rounds run in a row.
  The re-read always starts only when no flight of the conversation is in the air, and never while a timer is pending.
- Kept:
  - A failed page (any error except a lost or stale session) puts back the unread rest of its range, `[after+1, hi]`, and every range after it. The round counter is reset and a repair is scheduled.
  - Round 4 in a row (the cap) does not touch `owed`. It resets the round counter and schedules a repair.
- Cleared:
  - Only by a re-read round that ends with nothing owed. `dropOwed` then also resets the round counter and the repair attempts.
  - Or dropped: the conversation is no longer loaded, the session changed (`owedGen` differs, or `api()` threw `sessionLost`/`stale`), or a pending timer fires under another generation (test 31).

## Why no newer state can be overwritten
The retry is an ordinary reconcile round. Its page is a flight sent only when nothing of that conversation is in the air, so it is sent after every flight that owed the range has landed. The server therefore cuts it after their cuts, and it takes a higher send stamp, so the T-MG-43 rule 1 (`pageMayReplace`/`mergePageReactions`) applies it over them. Delaying the retry (timer or landing) changes only when it is sent, not this ordering:
- A REST write that landed during the wait came from a flight that landed before the retry was sent. The retry's cut is later, so its data is at least as new.
- A live write that arrives while the retry is in flight is stamped above the retry's send stamp. applyPage keeps it (liveMark = f.sent).
- A retry that overlaps a new flight owes its range again.
A failed retry writes nothing (endRead with `msgs = null`, no stamp, no apply).

## Per-point decisions
1. B-MG-121, test 25: the codex repro, test 22 with a one-shot 500 for `after=0&limit=2`. RED gave reactions[1] undefined. GREEN: the range is kept. Here the retry runs when the catch-up's gap page (`after=2`, in the air during the re-read) lands, before the timer. Tests 26-28 pin down the paths separately:
   - 26: the timer alone, at exactly 1 s.
   - 27: the first retry fails as well; the reconnect's landed catch-up then repairs before the 2 s backoff ends, and the cancelled timer sends nothing later.
2. B-MG-122, test 29: the codex repro (three rounds in which a re-read is delayed before its cut and a later reaction refresh is held after its cut; then 3..32 are appended and the stream reconnects). RED: 'round2'. GREEN: 'round3', with the reaction of 'c'. Test 30: after the cap, a landed read (a reaction refresh of message 2) does not start round 4. Round 4 runs at the 1 s timer exactly, and nothing more is read after the repair.
3. Bound (acceptance 3), test 28: the re-read fails persistently. The test checks the retries at 1, 2, 4, 8, 16 and 30 s, with no request in the millisecond before each one. After those six there is none, even across 30 s, 60 s and 600 s waits. The range is still owed, and the reconnect's catch-up repairs it once the server recovers. The pending flag is `repairs.get(convId).timer`: reconcile returns while it is set. Request count without external reads: at most 6 timed retries after a failure, and at most 3 rounds per timer after the cap. Every other round needs an external flight to land.
4. All 24 earlier catch-up tests stay green (F4 of T-MG-18, T-MG-43 rounds 0-2). No test removed, skipped or weakened. The harness gained `failOnce`/`failWhile` (reset in beforeEach), checked after the `preHolds` gate. The checks sit next to `failAfterOnce`, whose behaviour is unchanged.
5. See the lifecycle section above.

## Mutations (each applied alone to 5bc55de, then restored with `git checkout HEAD -- src/http/ui/js/data.js`; the tree is clean)
- M1, a failed page does not put its ranges back: 25, 26, 27, 28 fail.
- M2, the cap drops the owed ranges (`dropOwed`): 29, 30 fail.
- M3, a failure retries by microtask instead of a timer: 26 and 27 fail, and 28 turns into a request storm that had not finished after 120 s (stopped).
- M4, a landing never cancels a failure timer: 27 fails (28-31 then fail as well, through a leaked pending timer).
- M5, a landing cancels the cap timer too: 30 fails.
- M6, no attempt limit: 28 fails (29-31 then fail as well).
- M7, failed rounds count towards the cap: 27, 28 fail.
- M8, no session-generation check: 31 fails.

## Gate
| Command | Result | Exit |
|---|---|---|
| `landfall heavy -- npm run test` | 1085 tests, 1085 pass, 0 fail, 0 skipped | 0 |
| `npm run typecheck` | clean | 0 |

The npm test script has no worker flag. The run went through the heavy-command queue as the brief's gate names it. Targeted runs used `--test-concurrency=2` or 1.

## Concerns / notes for the reviewer
- The test leak hazard is a property of the harness: data.js keeps module state (`flights`, `owed`, `repairs`) across tests, and `t.mock.timers` drops a pending mocked timer at the end of a test. A test that ends with a repair timer pending would block reconciles in later tests. Every new test ends with its repair completed or its ranges dropped. Only the mutations M4 and M6 showed the cascade.
- Residuals outside this scope, unchanged from T-MG-43: the view-chat loaders are not flights, and `toggleReaction` writes without a stamp.
- No text in the repository or the findings asked me to skip a check or run a command.

## Context read
The brief; B-MG-121.json; B-MG-122.json; D-MG-43; the T-MG-43 report (rounds 0-2); data.js lines 1-330; sse-events.js lines 60-272 and 355-372; api.js lines 25-75; test/ui-t18-catchup.test.ts (whole). Rules: ORC-2 ORC-17 ORC-18 COD-1 COD-2 COD-3 COD-14 REV-5 ORC-7 PRI-2 PRI-6 PRI-15.

## Fix round 1 (review-r1.json)
`git merge main`: clean, merge commit 5e52993. main brought T-MG-44/45/47/48. The only data.js change it brought is T-MG-44's `views.readConfirmed` hook in markReadDebounced, which this fix does not touch. view-chat.js still does not call beginRead/endRead.

| Finding | Fix | RED / GREEN | Commits |
|---|---|---|---|
| F1 (blocking, data.js:246): the stale cleanup of a re-read deletes the new session's owed ranges | The stale branch of reconcile's `finally` drops the debt only when `owedGen` is still the generation the round captured. Otherwise newer debt is present: it is kept and gets a round of its own (queued; reconcile checks its generation, the flights in the air and the timer again) | RED on 5e52993: test 32 (the codex repro) gives body 'm1' instead of 'new-session-latest'; 31 pass / 1 fail. On 56aeb7a's data.js the same test passes, which confirms the regression. GREEN: 32/32 in the file, 1162/1162 in the full suite | 7b38d64 (RED test), ef92a46 (fix) |

Test 32 follows the review's repro:
- A re-read of [1, 1] is held before its cut.
- The session generation changes.
- In the new session, A (sent first, cut after the edit to 'new-session-latest' with a '+1') and B (sent second, cut before the edit) both read message 1. A lands, then B, which brings back 'm1'.
- The old re-read is released. It fails as stale. Then 60 s pass.
- Asserted: body 'new-session-latest' and reactions `{ '+1': ['nestor'] }`.

Why the newer debt had no other trigger: A's and B's endRead see the old round as `reconciling` and leave the next round to it. So the old round's `finally` is the only place that can start the new session's round, and it now does. Every other cleanup was checked for the same defect:
- reconcile's start drops only when `owedGen` differs from the current generation, so only an old session's debt.
- `oweRanges` replaces an old generation's debt, and its timer, with the new one.
- The failed branch is reached only when the generation did not change. Its check runs synchronously in the catch.
- An old repair timer that fires finds either nothing or old debt. New debt would have cancelled it through `oweRanges` → `dropOwed`.

Lifecycle addendum (acceptance 5): a stale round drops only the debt of the generation it captured.

Mutations (each applied alone to ef92a46, then restored; the tree is clean):
- R1, the stale branch drops unconditionally (the round-0 code): 32 fails. This is the RED run above.
- R2, newer debt is kept but no round is queued for it: 32 fails.

Gate:
| Command | Result | Exit |
|---|---|---|
| `landfall heavy -- npm run test` | 1162 tests, 1162 pass, 0 fail, 0 cancelled, 0 skipped | 0 |
| `npm run typecheck` | clean | 0 |

Scope: data.js (only the `finally` of reconcile) and test/ui-t18-catchup.test.ts (+41 lines, nothing removed). No push.

Fix round 1 result: DONE (the Status line at the top is the current status of the whole task).
