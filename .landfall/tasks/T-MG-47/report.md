---
red: {"command": "node --test --test-timeout=20000 test/ui-t44-unread-highlight.test.ts", "exit": 1, "excerpt": "T-MG-47 B-MG-123 hidden-tab inserts: actual [512, 514], expected []"}
green: {"command": "node --test --test-timeout=20000 test/ui-t44-unread-highlight.test.ts", "exit": 0, "excerpt": "tests 19, pass 19, fail 0"}
---
Status: DONE_WITH_CONCERNS

Change: view-chat.js gets readMark(h, convId): h.read = max(h.read, server lastReadMessageId), returned; used by tintMissed (render, tab return), noteListDrawn (open) and the hidden-tab insert in upsertMessageNode. Test added, no existing test touched.

Gate: typecheck exit 0. Full suite via landfall heavy: 1145 tests, 1144 pass, 1 fail: "at_dev is revoked by a password change..." (B-MG-96, test/fixes/t-mg-11-hardening.test.ts) timed out at 20s under load; in isolation it passes 8/8. Unrelated to the UI.

Follow-up: none. Secrets scan not run (not in the brief's gate).
