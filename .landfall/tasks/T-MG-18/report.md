---
red: {"command": "node --test test/ui-d-mg-30-legacy-delete.test.ts test/ui-t18-catchup.test.ts test/ui-t16-chat.test.ts test/plugin/wake-tools-diagnostics.test.ts (before each fix)", "exit": 1, "excerpt": "D-MG-30 7/7 fail (legacy keys kept/imported); B-MG-116 message 1 missing; B-MG-117 focus null instead of th-input; B-MG-107 4/4 no stderr line"}
green: {"command": "node --test --test-concurrency=2 --test-timeout=20000 \"test/**/*.test.ts\"; npm run typecheck; landfall secrets --range b8bae5e..HEAD", "exit": 0, "excerpt": "996 pass, 0 fail; typecheck clean; secrets clean"}
---
# Report: drop legacy storage import (D-MG-30); SSE gap catch-up pages; thread-edit focus; plugin diagnostics (T-MG-18)
<!-- Stored by the orchestrator from the implementer's reply. -->
Status: DONE
Commits: 3ea4441, 2752594, 510e78f, c215702, ba47c18.
1 D-MG-30 (state.js, -168 lines net): purgeLegacyStorage deletes every legacy key (drafts, wiki drafts, last conv, recent, threads seen, owner marker, shared and r5 unsent lists, unsent_done_*, storage_v keys) at sign-in and sign-out; no import, claim, move, tombstone or 7-day code; persist/restore use only the current actor's per-message keys; sign-out removes only the leaving actor's namespaced keys. Tests asserting the removed import behaviour were rewritten or removed (decided behaviour change D-MG-30); isolation assertions kept.
2 B-MG-116 (sse-events.js): after the resume refresh, pages GET /api/conversations/:id/messages?after=<newest held before the break>&limit=200 until a short page; generation guards kept. Tests: 31-message repro, 1203 messages over 7 pages, generation change mid-catch-up.
3 B-MG-117 (view-chat.js): a refocus intent recorded on Enter from a focused editor, honoured after the save settles unless focus moved elsewhere. Tests: SSE-redraw-first repro, user moved focus.
4 B-MG-107 (wake-tools.mjs): one fixed stderr line per failure kind; 401/403 final, other statuses and network failures retried.

## Fix round 1 (codex review-r1 F1)
Status: DONE
sse-events.js: captureReplayFloor records each loaded conversation's floor once at the break (gapFloors); the catch-up reads it instead of the cached newest id, so live events and refreshes during the gap cannot raise it; a floor is deleted only after that conversation's loadMessages and paged catch-up both succeed; a failed page keeps it for the next resume; disconnectSSE clears it. Tests: codex's three reproductions (SSE message during another conversation's catch-up, refresh during the gap, failed page then reconnect) end with 1..31.

## Fix round 2 (codex review-r2 F2-F3)
Status: DONE
sse-events.js: captureGapFloors() runs at every break and first connect and sets a pending floor for each loaded conversation that has none (an unresolved older floor is never overwritten; gapFloors is no longer reset with replayFloor). The catch-up runs on every resume and pages each conversation from its own pending floor regardless of sseCursor; a floor is cleared only after that conversation's full paged catch-up succeeded. Tests: codex's F2 (second break after a successful catch-up delivers 32) and F3 (retained floor retried after the cursor advanced) reproductions, red before, green after; the three F1 tests stay green.

## Fix round 3 (D-MG-31, codex review-r3 F4)
Status: DONE
Commits: f5b1f4b (tests), 61adbcd (fix).
loadGapAfter (sse-events.js) inserts only ids not already held for the conversation and never replaces a held message; the paging cursor still advances by every id on the page; reactions merged only for inserted messages. The resume loadMessages refresh had the same race: loadMessages(convId, { keepTouched: true }) (data.js) snapshots the held objects before the request and skips any message whose held object changed while in flight (writers replace objects, so the reference comparison is exact; editedAt is not a reliable revision); untouched messages are still refreshed so edits made during the break arrive. Tests: codex's delayed-page repro and the same race on the resume refresh, red before and green after; earlier catch-up tests stay green.
