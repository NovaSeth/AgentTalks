---
red: {"command":"node --test test/fixes/t-mg-13-privacy.test.ts test/fixes/t-mg-13-ui.test.ts","exit":1,"excerpt":"removed uploader /api/files/..: 200; PATCH body contained topic 'launch codes'; TypeError: Cannot set properties of null (setting 'scrollTop'); thread 91 changed"}
green: {"command":"npm test","exit":0,"excerpt":"tests 492, pass 492, fail 0"}
---
# T-MG-13 report (gate T-MG-1 round 5 fixes)
<!-- Stored by the orchestrator: the implementer's harness refused the write. -->
Status: DONE
- B-MG-99: src/core/files.ts getFileInfo: a conversation file requires canRead for every actor, uploader included; wiki attachments public; files with neither owner-only. Tests: removed uploader 404/403 on both routes; member 200; owner of a conversation-less file 200, others 404; wiki file readable.
- B-MG-100: PATCH /api/conversations/:id returns {ok:true, id} to an actor who cannot read the conversation (route-level, src/http/routes/conversations.ts; core updateConversation keeps its type); readers still get {conversation}. Test: non-member admin body has no topic; channel admin gets the full conversation.
- B-MG-101: src/http/ui/js/widok-czat.js thread submit captures conversation id and root id before the await; panel/list/scroll/failed-text restore only when view, conversation and root still match; null-safe scroll. Tests: send in 90, switch to 91 -> 91 unchanged, reply stored for 90; close during send -> no error, nothing inserted; same thread -> reply shown.
Commits: 9eaeea1 (B-MG-99, B-MG-100), b23191f (B-MG-101). Gate: 492/0, typecheck clean, secrets 76515ba..HEAD clean. DISPUTED: none.
