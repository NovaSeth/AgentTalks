---
red: {"command": "node --test --test-concurrency=2 --test-timeout=20000 test/plugin/wake-tools.test.ts (new tests against unchanged 796c834)", "exit": 1, "excerpt": "pass 0, fail 10: strict MCP mode off; unhandledRejection E2BIG; --strict-mcp-config missing; prompt lacks read_thread; DM 41 read and 5 mismatch cases time out (no tools server)"}
green: {"command": "node --test --test-concurrency=2 --test-timeout=20000 \"test/**/*.test.ts\"; npm run typecheck; landfall secrets --range 796c834..HEAD", "exit": 0, "excerpt": "tests 651, pass 651, fail 0; typecheck clean; secrets clean"}
---
# Report: woken runs use only principal-checked tools and can read the conversation (T-MG-15, B-MG-105, B-MG-106)
<!-- Stored by the orchestrator (condensed): the designer's harness refused the write. -->
Status: DONE_WITH_CONCERNS
Commits: 50741db (tools server, acc 3+5), 2c61de9 (strict MCP mode, acc 1+2), ad1e542 (README + empirical check, acc 4), plus an orchestrator one-line usage comment fix in bin/agenttalks-wake-bridge.mjs.
Approach: a separate request/response server scripts/wake-tools.mjs ("atwake") - no feed, no heartbeat, independent of plugin options; chosen over a tools mode of the channel (riskier live path) and over prompt-stuffing (F4 stays open).
1 The woken run: -p --resume <id> --permission-mode dontAsk --strict-mcp-config --mcp-config <0600 file in a 0700 mkdtemp dir> --tools "" --allowedTools <4 atwake tools> --disallowedTools "mcp__agenttalks__*,mcp__plugin_agenttalks_agenttalks__*" -- <prompt>; the config has exactly one server (node + script + --cwd + EXPECT env, no token); removed when the run settles or fails to start; a runner's synchronous throw is a failed start (was an unhandled rejection).
2 Allowed tools are exactly mcp__atwake__{read_conversation,read_thread,reply,mark_read}; anything wider is a startup error. Codex alias scenario: strict mode on, single-server config, nothing of other_at/channel/remote/builtins pre-approved.
3 read_conversation (around/after, limit <= 50) and read_thread return whole messages quoted through lib/frame.mjs; the prompt says the preview is partial and names the tools. DM 41 (>1000 chars) comes back whole.
4 Empirical, claude 2.1.318: plugin MCP servers do NOT load under --strict-mcp-config (figma plugin loaded, its MCP server absent); run 2 with the bridge's exact flags shows tools = the 4 atwake tools only, permissionMode dontAsk.
5 Mismatch (no expectation, no identity, other server, other handle/actor id): error, no request beyond one GET /api/me on the expected server, one stderr line.
6 T-MG-14 tests green; 4 wake-bridge argv tests updated to the new shape (stricter, COD-3).
Concerns: the strict-mode finding is version-specific (README tells operators to re-check after upgrades; the channel deny rule stays as a backstop); a bridge killed mid-run leaves a token-free temp dir; reply/mark_read duplicated in channel.mjs and wake-tools.mjs; resumed history may mention old (now denied) tool names.
