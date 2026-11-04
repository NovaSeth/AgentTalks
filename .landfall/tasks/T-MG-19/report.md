---
red: {"command": "node --test --test-timeout=20000 test/http/api-only-mode.test.ts", "exit": 1, "excerpt": "pass 1 / fail 4 (config.ui and the ui_disabled routes did not exist yet)"}
green: {"command": "node --test --test-concurrency=2 --test-timeout=20000 \"test/**/*.test.ts\"; npm run typecheck; landfall secrets --range b8bae5e..HEAD", "exit": 0, "excerpt": "1004 pass, 0 fail; typecheck clean; secrets clean; links 0 bad"}
---
# Report: install guide and plugin setup; API-only mode switch (T-MG-19)
<!-- Stored by the orchestrator from the implementer's reply. -->
Status: DONE
Commits: b951dd4 (API-only mode), ba698a0 (install guide and links).
Part A: AGENTTALKS_UI (0/false/no/off; empty keeps the default on) and `serve --no-ui`; with the UI off the shell, /js, /app.css, /vendor, icons, /api/ui-version and the site gate return 404 ui_disabled; /api, /api/events, /mcp, /skill.md, /skill.version, /install, /robots.txt stay; the gate is inactive with the UI off; POST /api/login stays for humans over the API; /api/health reports ui; serve prints the mode; compose and instance.env.example pass the variable. Tests: test/http/api-only-mode.test.ts (5).
Part B: docs/install.md (1104 lines): choices and requirements; local install from scratch (run for real with the observed outputs); server with Docker (env file explained, first admin, TLS proxy examples for Caddy, nginx + certbot, Apache with SSE settings, TRUST_PROXY, the site gate, firewall, backups, upgrades, logs); systemd without Docker; API-only mode; first steps (invites, enrolling with or without a clone, where the token lives, MCP, REST, served agent pages); the Claude Code plugin from scratch (install, identity, trust, live delivery, verify, wake bridge, uninstall, troubleshooting); a troubleshooting table. README Quick start links the guide and mentions API-only; the plugin README points to the guide; docs/docker.md links to it and its gate-password command now creates the file owned by uid 1000 (it was root-owned, which the container cannot read).
Not run (no tool on the machine): the nginx/Apache snippets, Docker Compose and systemd steps (written from the repo files and tool docs; the guide says so); Caddy validated with `caddy validate`.

## Fix round 1 (codex review-r1 F1-F2)
Status: DONE
F1: every trust instruction (docs/install.md trust section, project-file note, troubleshooting row; plugin README identity list, trust paragraph, enroll paragraph) now says `atalk login --local --url <server> --token -`, verified for real in a temp project against a local server (exit 0, saved, trusted; whoami works; a hand-written file is trusted by re-running login with its url and token). Orchestrator follow-up (7da54b6): the CLI error and the plugin's untrusted-project sentence give the same working command (pinning test updated).
F2: test/http/api-only-mode.test.ts mints real agent tokens and asserts, with the UI off, a non-empty MCP tools/list including talk_read and an SSE message event for a message posted over REST; the invalid-token MCP check asserts exactly 401. Mutation check: a 500 /mcp handler fails the test.
