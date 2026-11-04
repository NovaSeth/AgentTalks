---
red: {"command": "node --test --test-timeout=20000 test/ui-t16-storage.test.ts test/ui-t16-chat.test.ts test/ui-t16-sse.test.ts (base 367a588)", "exit": 1, "excerpt": "25 tests, 3 controls pass, 22 fail: F7 [] vs ['b2']; F8 ['b1'] vs ['b1','b2']; F9 toasts 0 vs 1; B-MG-98 focus stays in the edit field; B-MG-97 reconnect '/api/events' vs '/api/events?after=40'"}
green: {"command": "node --test --test-concurrency=2 --test-timeout=20000 \"test/**/*.test.ts\"; npm run typecheck; landfall secrets --range 367a588..HEAD", "exit": 0, "excerpt": "980 pass, 0 fail; typecheck clean; secrets clean"}
---
# Report: UI upgrade-safe unsent storage, error notice outside the chat view, SSE resume gap, focus after inline edit (T-MG-16)
<!-- Stored by the orchestrator (condensed): the designer's harness refused the write. -->
Status: DONE_WITH_CONCERNS
Commits: 3adfef1, 6294e70, a6eb184, ed216fb.
1 B-MG-108/F7: legacy shared unsent lists are moved on every sweep: entries with a valid ownerId go to their owner, unattributed ones only on the first run to the marker's actor, later deleted.
2 B-MG-109/F8: one key per unsent message (atalks_unsent_<actor>_<conv>_<clientMsgId>); persist writes and removes single keys; the move writes a key only if absent and re-reads the source before each write (stops if gone, restarts if changed, max 4), removing it only while unchanged. Codex's interleaving, injections after every storage call, and two same-account tabs keep [b1, b2].
3 B-MG-110/F9: the toast is skipped only when the failed row is on screen (chat view, own conversation, row connected in #messages and overlapping the visible list box).
4 B-MG-97: a stream that opened and drops before any event pins the cursor to the newest loaded message id; the client takes over the browser's own retry (which would carry no ?after); a never-opened stream seeds from the newest loaded id at connect; the first connection stays future-only.
5 B-MG-98: after Enter or Escape the focus returns to the thread or main composer unless the user moved it elsewhere.
Concerns: an old unreloaded tab that sends after the move can show a message once more as "not sent" (resend deduplicated by the server's clientMsgId); localStorage has no cross-tab compare-and-set, the re-read only narrows the window; a stream that never opened can still miss a message in a conversation whose history ends below another's newest id (as before); existing tests adapted to the per-message keys, no assertion weakened.

## Fix round 1 (codex review-r1 F1-F5 + automated-scan sign-out add-on)
<!-- Stored by the orchestrator (condensed): the designer's harness refused the write. -->
Status: DONE_WITH_CONCERNS
Commits: d8a4584, 29df019, 99d321f, 6d36e09, b3dfe42.
F1+F2: migration and restore only read the old lists and copy entries into absent per-message keys; every send/discard writes a tombstone (atalks_unsent_done_<actor>, 500 newest) before removing its key; restore = last import pass minus tombstones; old lists collected 7 days after first sight. Codex repros pass with injections at every storage call.
Sign-out add-on: the account's r5 lists and per-message keys and tombstones are removed; shared lists are written back without this account's entries (one read, one write); a failed tombstone write removes the copies instead of failing open. A scan of all stored values finds none of A's text after A signs out; B's entries survive.
F3: a replay floor captured before the first attempt; every retry without a received event uses it; a CONNECTING drop is closed and reconnected by the client.
F4: newestLoadedId distinguishes none (undefined) from empty (0); 0 is not sent as after=0 (it would replay everything) - the reconnect is future-only and every loaded conversation is re-fetched over REST once open.
F5: finishEdit returns a refocus step run after the save's redraws, re-querying #th-input or #composer-input.
Concerns: one tombstone id can be lost between two same-account tabs finishing at once (a stale bubble, resend deduplicated); untagged entries the first-run marker claimed outlive sign-out up to 7 days; REST catch-up fetches 30 per conversation; tabs still running main's r5 code run their own migration.
