---
red: {"command": "node --test --test-timeout=60000 \"test/fixes/*.test.ts\"", "exit": 1, "excerpt": "tests 20, pass 0, fail 20. B-MG-24: 409 konflikt_wiki despite force=true. B-MG-28: second notify within 1 s swept again (0 !== 1). B-MG-30: unread 0 !== 1. B-MG-31: same message returned in channel 2. B-MG-32: unread 1500 !== cap; unreadFor took 229.5 ms. B-MG-47: 500 !== 400. B-MG-9: fired ['outer-before','phantom','outer-after']. B-MG-25: database is locked. B-MG-26: Missing expected exception. B-MG-1: conversationIds [2,1] vs [2]. B-MG-6: [{handle:'alice',in:'c:1'}] vs []. B-MG-53: HTTP body leaks c:1, s-alice, /home/alice. B-MG-7/B-MG-48: 's-alice' !== null. B-MG-23: Missing expected exception."}
green: {"command": "npm test", "exit": 0, "excerpt": "unreadFor 200 channels / 300k messages: 10.5 ms per call; tests 342, pass 342, fail 0"}
---
# Report: Fix A2, privacy and data integrity in the core (T-MG-7)
<!-- Stored by the orchestrator: the designer's harness refused the write; content is the designer's reply. -->
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-7. Commits: 3e4269d, 63915bf, b7036bb (each with its tests; RED taken before any fix). Push: no.
Status: DONE_WITH_CONCERNS

## Decisions
1. B-MG-1 + B-MG-29: listNotifications and unreadNotificationCount check current access in SQL (READABLE_NOW: public conversation or current member); wiki notifications still show.
2. B-MG-6 + B-MG-53: new presenceFor(ctx, viewerId) for GET /api/presence; presence(ctx) keeps its signature for MCP. A typing signal in an unreadable c:<id> is turned off entirely (typing=false, typingIn=null) so the UI does not show it as global. sessionId and cwd only to the owner and human admins. whoIsTyping drops unreadable places. doing stays free text.
3. B-MG-7 + B-MG-48: ownSessionOrNull drops a foreign sessionId in postMessage and lease acquire; the post/lease still succeeds (files and questions go through postMessage).
4. B-MG-9 + B-MG-27: savepoint rollback truncates the after-commit queue to its length at entry; clearTyping announces presence only after commit.
5. B-MG-23: edit/delete check current read access before authorship; edit refused (403) in an archived conversation.
6. B-MG-24: force checked first.
7. B-MG-25: busy_timeout before WAL; WAL switch retries on busy/locked up to 5 s (test: 4 rounds x 6 processes on one new file).
8. B-MG-26: newer schema refused: "database was created by a newer AgentTalks (schema vN; this binary knows vM); upgrade the binary".
9. B-MG-28: sweep at most once per 60 s per DB handle.
10. B-MG-30: markRead clamped to the last message id.
11. B-MG-31: dedup key v2:<conv>:<actor>:<clientMsgId>; old keys still dedup within their conversation.
12. B-MG-32: UNREAD_CAP = 100; unreadFor 10.5 ms (was 229.5 ms) on 200 channels / 300k messages.
13. B-MG-47: wiki upload decodes X-File-Name safely -> 400 zla_nazwa.

## Files
src/core/presence.ts, notifications.ts, messages.ts, leases.ts, unread.ts, wiki.ts; src/store/db.ts; src/http/routes/messages.ts, wiki.ts; tests test/fixes/t-mg-7-privacy.test.ts (8), t-mg-7-db.test.ts (4), t-mg-7-data.test.ts (8).

## Gate
npm test 342 pass / 0 fail; typecheck clean; secrets 0561f86..HEAD clean.

## Shared gaps
- src/mcp/server.ts presence calls (~585, ~893) should use presenceFor(ctx, actor.id) (package B item 13).
- src/core/digest.ts digestFor still counts every unread row.
- Duplicate file-name decoder in extras.ts and wiki.ts (move to respond.ts later).
- Clients should render the unread cap 100 as "99+".

## Open issues / deviations
- Unread cap 100, not 1000 (1000 measured 66 ms without a covering index migration).
- doing not filtered (free text).
- A never-registered sessionId is dropped from posts too.
