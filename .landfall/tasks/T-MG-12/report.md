---
red: {"command": "node --test test/plugin/<file>.test.ts (each step before its code)", "exit": 1, "excerpt": "core: ERR_MODULE_NOT_FOUND lib/identity.mjs; stream: ERR_MODULE_NOT_FOUND lib/feed.mjs; channel: ERR_MODULE_NOT_FOUND lib/pusher.mjs; monitor: waitFor timeout; hooks: Cannot find module scripts/session-hook.mjs; wake: ERR_MODULE_NOT_FOUND lib/wake.mjs; manifest: ENOENT .claude-plugin/marketplace.json; runner limit: timed out after 20000ms"}
green: {"command": "npm test && npm run typecheck && landfall secrets --range 0e27f29..HEAD", "exit": 0, "excerpt": "tests 353, pass 353, fail 0 (baseline 322, +31 plugin tests); tsc exit 0; secrets clean (1 synthetic line exempted); claude plugin validate passed"}
---
# T-MG-12 report: Claude Code plugin "agenttalks" (live agents)
<!-- Stored by the orchestrator (condensed): the designer's harness refused the write. -->
Status: DONE_WITH_CONCERNS
Approach C (hybrid): stdio channel server (research-preview push, two-way: reply, mark_read) + monitor fallback (no flag) + SessionStart/SessionEnd presence hooks + opt-in wake bridge. Hand-written JSON-RPC (zero dependencies). Client-side filtering over the actor's SSE stream (no server change; src/ untouched).
Resolutions P1-P12: monitor --max-seconds 1740 with saved cursor; wake default allowed tools (see open issue 1); non-member public mentions via GET /api/mentions on notification events; notify=none mutes all; "my threads" learned from own messages + one thread fetch per unknown root; coalesced meta as comma lists + count; bridge freshness (exp with 30 s skew, max 3600 s ahead; without exp ts <= 600 s); monitor stands down when the parent claude runs the channel (AGENTTALKS_MONITOR override); server cwd CLAUDE_PROJECT_DIR else process.cwd(); // @ts-check + JSDoc, tsconfig unchanged; wake prompt header without kind; presence session id cc-+sha256 prefix (raw id never sent).
Acceptance: 1 identity same order as atalk (empty env unset), token only in the Authorization header; 2 channel: SSE backoff 1-30 s + jitter, Last-Event-ID resume, 65 s idle watchdog, stop on 401/403, dedup 10k ids, ordered processing, framing per brief, 1 push/s with coalescing, queue cap 500; 3 monitor one line per event, cursor 0600 without token, clean exit; 4 hooks: SessionStart registers presence + <= 1500-char quoted summary + records claude-sessions.json (0600, atomic), SessionEnd DELETE, silent failures; 5 wake bridge: 16 KiB cap, HMAC timingSafeEqual, freshness, replay 409 (nonce/body hash), 127.0.0.1 default (refuses 0.0.0.0/:: without --allow-public), secrets file must be 0600, spawn shell:false argv array, one run per session, 15 min limit; 6 tests: test/plugin/{core,stream,channel,monitor,hooks,wake-bridge,manifest}.test.ts (31), signatures via the server's signWake, real TCP break via a proxy; 7 README (install, channel flag, monitor, bridge, security notes) + paragraph in integrations/claude-code/README.md; 8 gate green, claude plugin validate passed (warning: no icon).
Mutation checks: caught for line-break set, notify none, Last-Event-ID, seen-id dedup, framing, rate limit, saved cursor, quoting, replay/exp/signature checks; two survivors judged equivalent (extra empty flush; redundant chmod).
Commits: 29725a2, 7724cbf, 77c7fe2, bfe347e, 9871eb2, bef911c, a3fbb6b, 03f1b61 (synthetic secret marked SYNTH by amending its own unpushed commit; final tree identical).
Open issues: 1) wake default `mcp__agenttalks__*` does not match the plugin's own tools `mcp__plugin_agenttalks_agenttalks__*` (decision D-MG-17: default both); 2) no live run in a real channel session (dev flag needs interactive confirmation); 3) bridge replay cache in memory (bounded by exp / ts 10 min); 4) ms-wide gap between GET /api/me and SSE connect (covered by the SessionStart unread summary); 5) without the flag the channel server still holds an SSE stream (2 of 8 per actor with the monitor); 6) monitor lifetime vs docs to check live.

## Fix round 1
<!-- Stored by the orchestrator (condensed): the designer's harness refused the write. -->
Status: DONE_WITH_CONCERNS
1 default allowed tools "mcp__plugin_agenttalks_agenttalks__*,mcp__agenttalks__*" (namespace confirmed in code.claude.com/docs/en/mcp) - 22efe32.
2 wake secrets [{serverUrl, actor, secret}]; the verifying secret decides the server; unbound secret only with a single recorded server, else startup refuses and knocks get 202 woke:false - f349ae7.
3 plugin options in AGENTTALKS_PLUGIN_URL/TOKEN, used only when non-empty, then AGENTTALKS_*/ATALKS_*, then files - 61265fa.
4 feed: bounded ordered queue; RetryLater on lookup failure (network/5xx/429) with backoff; no markSeen/cursor commit for undecided events; full queue drops the stream and reopens from the committed cursor - 59ec804, ca39b79.
5 monitor persists handled cursors only - d1bd2e5.
6/12 per-session record files (0600 in a 0700 dir), pruned past 50 - d260b90.
7 woken run gets --tools "" (no built-in tools) and argv ends with -- before the prompt (variadic --allowedTools was swallowing the prompt: woken runs never received it before); residual risk documented (other MCP servers' pre-approved tools, hooks) - dbad342.
8 host parsing (inet_aton forms, IPv6 canonical), all unspecified forms refused, non-localhost names need --allow-public - 5a24116.
9 persistent replay record (0600, sha256 keys) reloaded at start; oversize body 413 at once, socket destroyed - 4ded582.
10 wakeEnv() drops AGENTTALKS_WAKE_* from the child env - 358f008.
11 SessionStart requests concurrent under one 8 s budget; wake record written after GET /api/me even if presence fails - 278610d.
13b project .agenttalks.json trust rule mirrors atalk trusted-projects.json - 29af5a7.
13a channel heartbeat file; monitor stands down only while the heartbeat is fresh and its writer alive, else takes over from the channel's handled cursor - 2f9150b, e3df2ff.
14 safeLabel in SessionStart lines; MCP tools dispatched through a Map (constructor/__proto__ -> unknown tool) - 13afb4a.
DISPUTED/deviations: no --settings empty allow list (lists merge; ineffective); no channel ack exists in Claude Code (heartbeat proves the server, not acceptance; AGENTTALKS_MONITOR=on as override); only AGENTTALKS_WAKE_* dropped from the child env; registry moved to a directory.
Concerns: no live channel-session run; takeover may repeat up to 15 s of events; one bridge per user per replay file.

## Fix round 2 (last round, REV-7)
<!-- Stored by the orchestrator (condensed): the designer's harness refused the write. -->
Status: DONE_WITH_CONCERNS
1 (codex F1): every secret must name its serverUrl (config refused otherwise; env pair needs AGENTTALKS_WAKE_SERVER_URL); session selection only by normalized URL equal to the verifying secret's server - ac70df5.
2 (codex F7): age-only pruning (30 days) + claim/check/restore via atomic tombstone rename and link() restore; dead pruners' tombstones settled - 852b925.
3 (codex F8): delivery-driven cursors: onItem resolves on actual write (MCP write callback / stdout callback); an in-order ledger advances event and mention cursors; heartbeat and monitor state carry delivered cursors; rate-limited items at SIGTERM stay uncommitted - 99dfc95.
4 (codex F9): fresh feeds open the stream from GET /api/status lastMessageId; member mentions left to the stream only when the stream cursor precedes them, else delivered from the mention list with id dedup; 404 /api/status -> direct delivery; mentionCursor 0 treated as a cursor - 99dfc95, f2f8cd3 (tests), 3583ece.
Property test test/plugin/delivery-property.test.ts (8 seeds x 40 steps; channel/monitor alternation, 503s, SIGTERM): nothing lost, nothing duplicated, nothing foreign - a94c47b.
Concerns: without /api/status a restart before the event cursor passes a directly delivered mention can duplicate it; microsecond windows (write callback, tombstone restore).
