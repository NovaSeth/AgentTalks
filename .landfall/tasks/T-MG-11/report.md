---
red: {"command":"node --test test/fixes/t-mg-11-hardening.test.ts (digest, read-all, wiki before the fix; at_dev against base auth.ts)","exit":1,"excerpt":"digestFor over 300k unread rows: 258.2 ms; read-all changed actual 2 expected 1; wiki revisions actual 2 expected 1; 'Missing expected exception' (no 429); at_dev value parts actual 3 expected 5, epoch-bumped cookie actual 200 expected 429"}
green: {"command":"landfall heavy -- npm test","exit":0,"excerpt":"tests 408, pass 408, fail 0; typecheck exit 0; landfall secrets --range 0394bdd..HEAD clean; digestFor 300k rows 18.0 ms"}
---
# Report: tests for unguarded controls + small hardening (T-MG-11)
<!-- Stored by the orchestrator: the implementer's harness refused the write. -->
Commits: 364fe30 (SSE and DB-race tests, injectable ping), 0bc7d89 (at_dev and guard tests), c38a945 (digest, notifications, wiki). Tree clean.
Status: DONE_WITH_CONCERNS

Items 1-7 (tests; each proven to fail under its mutation in a scratch copy):
1. B-MG-86 well-formed 4-part forged cookie: timingSafeEqual compare -> if(false): 200 vs 401.
2. B-MG-87 private-channel mention of a non-member: canRead filter on mentions removed: row count 1 vs 0 (read side also blocked by READABLE_NOW).
3. B-MG-88 non-admin human on POST /api/actors and the admin panel: isAdmin dropped in requireHumanAdmin: 201 vs 403, 200 vs 403.
4. B-MG-89 SSE closes after revoke and after disable; setSsePingMsForTests(ms|null) in src/http/sse.ts, default 20 s: revalidation -> if(false): stream still open.
5. B-MG-90 pin by non-member; markRead by non-member: canRead removed from pin(): pin row 1 vs 0; guard removed from markRead: joined 1 vs 0.
6. B-MG-91 Set-Cookie attributes (session and at_dev): SameSite and Secure deletions each fail.
7. B-MG-92 3 processes migrate one fresh file x4 rounds: `from = 0` -> "table actors already exists".
8. B-MG-96 + epoch: at_dev = <hmac>.<nonce>.<actorId>.<issuedAt>.<epoch>, HMAC over dev|actorId|nonce|issuedAt|epoch; rejected when > 180 days, > 60 s in the future, wrong part count (legacy 3-part), bad MAC, or epoch != current; password change, logout-everywhere, disable+enable revoke it.
9. B-MG-94 digestFor capped per conversation with UNREAD_CAP via a LIMIT subquery: 258.2 ms -> 18.0 ms on 300k rows (test asserts < 50 ms).
10. B-MG-95 markNotificationsRead (all and by ids) applies READABLE_NOW; `changed` counts readable rows only.
11. B-MG-33 identical save (title, body, placement) is a no-op returning the current revision (no event, no notification); > 60 saves per actor per page per hour -> 429 with an English hint; sliding window; creation not limited.

Concerns / out of scope: hasDeviceCookie/makeDeviceCookie take ctx (epoch) -> three call sites changed in src/http/routes/auth.ts (needed by the epoch extension). No baseUrl-based Secure logic exists (Secure from trustProxy, x-forwarded-proto or TLS); requestIsSecure honours x-forwarded-proto without trustProxy (only adds Secure; pinned by a test). No existing test modified.
Gate: 408 pass / 0 fail; typecheck clean; secrets clean for 0394bdd..HEAD.
