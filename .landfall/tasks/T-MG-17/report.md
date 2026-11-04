---
red: {"command": "git grep -nE 'cli/talk|talk-file|talk-lock|docs/talk|nestor\\.md|talk-ui|chat\\.jpg|wiki\\.jpg|notifications\\.jpg' -- . ':!.landfall'", "exit": 1, "excerpt": "stale references in README.md (4), prototype files cli/* and docs/talk*.md, docs/nestor.md, 10 allowlist entries, Polish CI step names, the nestor.service section in docs/docker.md; version 0.2.0 while the skills say English codes since 0.3.0"}
green: {"command": "node --test --test-concurrency=2 --test-timeout=20000 \"test/**/*.test.ts\"; npm run typecheck; landfall secrets --range de5d3db..HEAD", "exit": 0, "excerpt": "999 pass, 0 fail; typecheck clean; secrets clean"}
---
# Report: docs refresh, prototype leftovers removed, release 0.3.0 (T-MG-17)
Status: DONE
Commits: 2340153 (prototype files and old screenshots removed, 4 new UI screenshots), eedbc36 (README rewritten; agents.md, docker.md, SECURITY.md, CONTRIBUTING.md, AgentTalks.md, integrations/claude-code/README.md, CI step names, historical notes on the audits and the source analysis), 7cb3ede (orchestrator: version 0.3.0 in package.json, lock, HTTP VERSION, MCP server; NEWS phone tabs; deploy header comment).
README claims checked against code by the implementer: 29 MCP tools, atalk commands, routes (/api/enroll, /skill.md, /skill.version, /api/events, /mcp), slash commands, search grammar, shortcuts, themes, mobile tabs, env variables and defaults, CSRF header, device cookie, rate limits, clientMsgId, wiki_conflict, legacyCode until 0.4.0, deploy script gates, Primer MIT credit.
Concerns: docs/audit-2026-08-09.md quotes two historical links (README.pl.md) that no longer resolve - historical text, left as is.
