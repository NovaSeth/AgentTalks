# Naming: the client CLI becomes `atalks` (the domain's name); `atalk` stays as a compatibility alias (T-MG-41, part A)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: external implementer (Codex) (class: critical — touches bin/**, docs/agents.md and a SKILL.md; kind: task). Deliverable kind: a working rename of the client CLI's user-facing name, with the old name still working.
Review: cross-provider review by a Claude reviewer after your report.
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context.
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-41 (branch task/T-MG-41-atalks-cli-name from main at a85b76d43d96; dependencies installed: no — run `npm ci` first). Never rebase.
Budget: 40 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Decision: /Users/michal/Documents/Code/AgentTalks/.landfall/decisions/D-MG-37.md — the owner chose `atalks` (same as the domain atalks.monokoda.com); `atalk` remains a working alias. The server admin CLI `agenttalks` is unchanged.

## Problem
People confuse `atalk` (the client CLI) with `atalks` (the domain). Fix: the client CLI's name everywhere a person or agent reads it becomes `atalks`; `atalk` keeps working so no script breaks.

## Scope (part A — everything EXCEPT the Claude Code plugin)
In: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-41/package.json` (bin), `bin/` (the CLI entry), `src/cli/atalk.ts` and `src/cli/main.ts` (help/usage/error text), server-side text that tells people to run the client (e.g. `src/core/untrusted.ts`, `src/core/presence.ts`, `src/mcp/server.ts`, `src/http/ui/install.html`, `src/http/ui/js/view-admin.js`, `src/http/ui/js/view-login.js`, `src/http/ui/js/i18n-pl.js` — only the strings that name the CLI), docs (`README.md`, `NEWS.md` — add an entry, `docs/install.md`, `docs/agents.md`), `integrations/claude-skill/SKILL.md`, `integrations/claude-code/` (README, skills, hooks: the hook script `integrations/claude-code/hooks/atalk-hook.sh` may keep its file name; its text and the commands it runs use `atalks`), and the tests that pin those strings.
Out (do NOT edit): anything under `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-41/integrations/claude-code-plugin/` (another task is changing it; part B renames it later), `src/http/ui/js/app.js`, `view-sidebar.js`, `router.js`, `sse-events.js`, `view-chat.js`, `dom.js`, `app.css` (other tasks). Historical documents (`docs/audit-*.md`, `docs/superpowers/**`) stay as they are: history is not rewritten. Internal file and identifier names (`src/cli/atalk.ts`, function names, `test/cli/atalk.test.ts`) may stay; renaming them is optional and only if it costs nothing.

## Acceptance
1. `npm i -g .` installs BOTH `atalks` and `atalk`, the same program (package.json `bin` has both; one entry file, or `bin/atalks.js` plus `bin/atalk.js` that only imports it). A test asserts both bin entries exist and resolve to the same implementation.
2. `atalks --help` / usage / every error and hint the client prints name `atalks`. Invoked as `atalk`, it works identically (the help may say "atalk is an alias of atalks" once; choose and justify).
3. Every user-facing text in scope that tells a person or an agent to run the client says `atalks` (e.g. "run `atalks login --local ...`"). Grep the scope for the word `atalk` and list in the report every remaining occurrence with the reason it stays (alias, history, file name, out-of-scope plugin).
4. NEWS.md gets an entry: the new name, the alias, nothing breaks.
5. The `.agenttalks.json` / config file names, environment variables and API are unchanged.
6. Tests that pin old strings are updated to the new strings (changing an expected string is not a weakening); no test removed or skipped; the suite is green.

## Gate (in order)
```bash
npm run test
npm run typecheck
```
One commit per step; no push. Write your report (Status line DONE / DONE_WITH_CONCERNS / BLOCKED, decisions per acceptance point, files, the remaining `atalk` occurrences list, test results) to `/private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-41-report.md`, and print it as your final answer as well.
