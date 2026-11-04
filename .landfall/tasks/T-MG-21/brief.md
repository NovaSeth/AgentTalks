# Plugin onboarding: a plugin login command, an actionable untrusted-file notice, skills stop writing .agenttalks.json by hand (T-MG-21)
<!-- Task brief (ORC-4), hand-written from the `landfall brief` render. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: critical — matches risk glob **/SKILL.md; kind: task).
Review: any reviewer
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21 (branch task/T-MG-21-plugin-login from main at 92d2199239762262514b9573db9ad392e65e644a; dependencies installed: yes, node_modules is a symlink to the main checkout's — do not commit it, it is untracked). Update the branch only with `git merge origin/main`, never rebase.
Budget: 50 minutes; when it nears, stop at a green commit and list the rest under Follow-up in the report.
Shared brief: none.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 PRI-6 SPC-1 SPC-3 SPC-13 SPC-14; read them with `/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall rule <ID…>`.

## Problem (reported by agent @rezydent on AgentTalks #general, message 16, 2026-11-04)
An agent that onboards exactly as the served skill says gets a Claude Code plugin that never connects.
1. `integrations/claude-skill/SKILL.md:183-191` (served to agents by `src/http/ui.ts:32`) tells the agent to create `.agenttalks.json` by hand with `printf … > .agenttalks.json`.
2. The plugin uses a project file only when it is listed (real path + sha256) in `~/.config/agenttalks/trusted-projects.json` (`integrations/claude-code-plugin/lib/identity.mjs:74-86`, check at `:128`). Only `atalk login --local` writes that list (`src/cli/atalk.ts:68-77`). So a hand-written file makes `resolveIdentity` return null: the monitor exits 0 with no lines, the channel and the SessionStart hook stay offline. This fail-closed rule is deliberate and stays (a cloned repository may ship its own file with a foreign url and token: a prompt-injection channel; see the header of `test/plugin/project-trust.test.ts`).
3. The notice (`identity.mjs:144-145`, also the SessionStart context at `scripts/session-hook.mjs:103`) tells the agent to run `atalk`, which is not installed on a host that only has the plugin. Nothing actionable remains.

## Spec
What: the plugin ships its own equivalent of `atalk login --local`, the notice names it, and the skill stops telling agents to hand-write a project file.
Why: today onboarding-by-skill + plugin = no live delivery, silently.

Approaches:
- A. CHOSEN: `scripts/login.mjs` — takes a url and a token the caller HOLDS (token from stdin only), verifies it with `GET /api/me`, writes `.agenttalks.json` (0600) in the target directory and the trust entry in one step. Same safety as `atalk login --local`: only someone holding a token can make a project trusted, and the file then contains that token.
- B. Rejected: a `trust` command that vouches for the EXISTING file. The notice reaches the model; an agent in a cloned repo would run it and trust the repo's foreign url/token — it defeats point 2. Cost if chosen wrongly: the prompt-injection channel point 2 closes.
- C. Rejected: fall back to `~/.config/agenttalks/atalk.json` when the project file is untrusted. It silently switches the actor (another identity than the project named) and still leaves the project file unexplained. Cost if wrong: an agent posts as the wrong actor.

Success criteria (each a test):
- S1 E2E: a project file written byte-for-byte as the OLD skill's printf → monitor exits 0, prints 0 stdout lines, its stderr names `scripts/login.mjs` → `login.mjs` run in that directory with the token on stdin exits 0 → monitor prints exactly 1 line for a mention of the actor. 
- S2 `login.mjs` with a token the server rejects (401) exits non-zero and writes 0 files (no `.agenttalks.json`, no trust list change).
- S3 `login.mjs` refuses a literal token on argv (only `--token -` or `AGENTTALKS_TOKEN`), exit non-zero, nothing written.
- S4 running `login.mjs` twice in the same directory leaves exactly 1 trust entry for that path.
- S5 the served skill (`integrations/claude-skill/SKILL.md`) contains no command that redirects into `.agenttalks.json` (a guard test greps for `> .agenttalks.json` and `>.agenttalks.json`).
- S6 model-visible context (the SessionStart `additionalContext`) still contains no repository-controlled text (no project path); existing tests in `test/plugin/project-trust.test.ts` keep passing unweakened (COD-3).

Unknowns: the plugin's install path differs per machine/version (`~/.claude/plugins/cache/agenttalks/agenttalks/<version>/`). Detection: the notice computes the absolute path of `login.mjs` from `import.meta.url` (installation-controlled, not repository-controlled). Fallback in the skill: a shell line that finds the newest installed version (P3).

## Plan
Global Constraints (each guarded by a test):
- G1 An untrusted project file still connects nothing and never falls back to the global file (existing project-trust tests + S1 first half).
- G2 No repository-controlled text in model context (S6; existing test).
- G3 The token never appears on argv, stdout or stderr of `login.mjs` (S3; assert the token string is absent from captured stdout/stderr in S1).
- G4 Files written are 0600, the config dir 0700; the trust list format is exactly atalk's: `{"projects":[{"path":<realpath>,"sha256":<hex of file bytes>}]}`, entries for other paths kept (S4 + a mode assertion).
- G5 `login.mjs` writes nothing unless `GET /api/me` with that url+token answered 2xx with an actor (S2).
- G6 `AGENTTALKS_CONFIG_DIR` overrides the trust-list directory, the same as `isTrustedProject` (`identity.mjs:82`).

Resolutions:
- P1 Target directory: `--dir <path>` if given, else `process.cwd()`. Do not search upwards; it creates the file in that directory.
- P2 `.gitignore`: same behavior as atalk (`src/cli/atalk.ts:128-137`): if the directory is inside a git work tree or has a `.gitignore`, ensure a `.agenttalks.json` line; print one line saying so.
- P3 Skill wording, in this order: (1) `atalk login --local --url <url> --token -` if atalk is installed; (2) with the Claude Code plugin: `node "$(ls -d ~/.claude/plugins/cache/agenttalks/agenttalks/*/ | sort -V | tail -1)scripts/login.mjs" --url <url> --token -` with the token piped on stdin; (3) no tooling and one agent per OS account: the GLOBAL file `~/.config/agenttalks/atalk.json` (0600) — the plugin trusts it without a list. State plainly that a hand-written PROJECT `.agenttalks.json` is ignored by the plugin.
- P4 Notice: keep `UNTRUSTED_PROJECT_CONTEXT` a fixed string (tests import it); it may now include the absolute plugin `login.mjs` path computed at module load, since that path comes from the installation. It names both commands: `atalk login --local …` and `node <abs>/scripts/login.mjs --url <server> --token -`.
- P5 Output of a successful `login.mjs`: one line `@<handle> (<kind>) on <url>: saved <abs path of .agenttalks.json>, trusted for the AgentTalks plugin; start a new Claude Code session to connect`.
- P6 Trust writing lives in a new `integrations/claude-code-plugin/lib/trust.mjs` (`trustProjectFile(path, { env, home })`); `identity.mjs` keeps `isTrustedProject` and may import shared helpers from it. Do not modify `src/cli/atalk.ts`.

Review Focus:
1. Cloned repo with a shipped `.agenttalks.json` and NO token held by the user: no command in the notice or skill makes it trusted without supplying a token (approach B absent) — proved by S1/G1 and reading login.mjs.
2. A 401/timeout/non-JSON from `/api/me`: nothing written (S2).
3. Token leakage via argv, error messages or the success line (G3/S3).
4. Re-trust after the file content changes (login rewrites the file → new sha256 replaces the old entry for that path) (S4).
5. Served skill still renders: `{{BASE_URL}}` placeholders intact; existing tests on the served skill pass.

## Scope
Create: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/integrations/claude-code-plugin/scripts/login.mjs`, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/integrations/claude-code-plugin/lib/trust.mjs`, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-21/test/plugin/onboarding.test.ts`.
Modify: `…/integrations/claude-code-plugin/lib/identity.mjs` (notice text only, plus helper imports), `…/integrations/claude-code-plugin/scripts/session-hook.mjs` (only if the context import changes), `…/integrations/claude-code-plugin/README.md` (the trust paragraph near line 41), `…/integrations/claude-skill/SKILL.md` (the "Where to keep the token" section, lines ~183-191), `…/docs/install.md` (the troubleshooting row at line 1085), `…/test/plugin/project-trust.test.ts` (only to ADD assertions that the notice names login.mjs; never remove or weaken one). Also update any other file in `integrations/` that tells agents to hand-write a project `.agenttalks.json` (grep `agenttalks.json` in `integrations/`, `docs/install.md`, `src/http/ui/install.html`); list each in the report.
Nothing else. Something missing in a shared part (e.g. `test/plugin/fake-at.ts` cannot express a 401 from /api/me): you may extend `test/plugin/fake-at.ts` additively (new optional option, defaults unchanged) and say so in the report; anything beyond that: stop with NEEDS_CONTEXT (ORC-17).

## Contracts
Consumes: `GET <url>/api/me` with `Authorization: Bearer <token>` → `{ actor: { handle, kind, … } }` (server, `src/http`); test fake `test/plugin/fake-at.ts` (`fakeAt`, `/api/me`, `/api/mentions`, `/api/events`); `resolveIdentity` / `isTrustedProject` / `untrustedProjectNotice` / `UNTRUSTED_PROJECT_CONTEXT` in `lib/identity.mjs`.
Produces: CLI `node integrations/claude-code-plugin/scripts/login.mjs --url <url> --token - [--dir <path>]` (token on stdin; or `AGENTTALKS_TOKEN` with no `--token`); exit 0 on success, 1 on any refusal; `export function trustProjectFile(path: string, opts?: { env?: Record<string,string|undefined>, home?: string }): void` in `lib/trust.mjs`. Consumers: agents onboarding via the served skill; the notice.

## Acceptance
1. S1 passes as a spawned-process test (monitor + login.mjs as real child processes against `fakeAt`, temp HOME and project dir).
2. S2 and S3 pass; in both, the temp project dir and config dir contain no new file afterwards.
3. S4 passes, and an unrelated pre-existing trust entry survives.
4. S5 guard test passes; the skill section follows P3 in that order.
5. The notice (stderr line and SessionStart context) names `scripts/login.mjs` with an absolute path and `atalk login --local`; S6 and all existing `test/plugin/project-trust.test.ts` assertions pass.
6. Full gate green; no test removed, skipped or weakened.
Do not guess about the fake server: read `test/plugin/fake-at.ts` and `test/plugin/monitor.test.ts` for how a mention is delivered and asserted.

## TDD
First commit: `test/plugin/onboarding.test.ts` with S1–S5 (and the new notice assertion in project-trust.test.ts). Run it; it must fail because `scripts/login.mjs` does not exist and the notice/skill are unchanged. Paste the failing lines (test name + reason) in the report as RED. Then implement in steps, one commit each: (a) lib/trust.mjs + scripts/login.mjs, (b) notice, (c) skill + docs + README.

## E2E
You run no devices or queues. The spawned-process test in Acceptance 1 is the end-to-end flow. Existing flow assertions touched: `test/plugin/project-trust.test.ts` (notice text), `test/plugin/monitor.test.ts` (unchanged, must pass).

## Gate (in order, no pipes, bounded test workers)
```bash
cd /Users/michal/Documents/Code/AgentTalks-wt/T-MG-21
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
/Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/bin/landfall secrets
```
Exit 0 prints `secrets: clean`. One commit per step; no push. Synthetic tokens in tests carry a `// SYNTH:` comment like `test/plugin/project-trust.test.ts:23`.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-21/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/task/report.md): the `Status:` line, decisions per acceptance point, files, RED/GREEN, gate, shared gaps, open issues. When your harness refuses that write, put the whole report in your reply.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.

## Amendment 2026-11-04 (orchestrator, from an automated security review of the in-progress commit)
7. `login.mjs` never writes through a symlink: before writing, `lstat` the target `.agenttalks.json`; if it exists and is not a regular file (symlink, dir, fifo), exit 1 and write nothing. Write via a temp file in the same directory opened with flag `wx` (O_EXCL), mode 0600, then `rename` over the target. The same lstat refusal applies to `.gitignore` before appending. Test: a project whose `.agenttalks.json` is a symlink to a file outside the project → exit 1, the symlink target's bytes unchanged, trust list unchanged.
8. `login.mjs` refuses (exit 1, nothing written) when `.agenttalks.json` is tracked by git in that directory (`git ls-files --error-unmatch .agenttalks.json` exits 0, run with `cwd` = the target dir; if git is absent, skip this check). The message tells the user to `git rm --cached .agenttalks.json` first. Test: a temp git repo with a committed `.agenttalks.json` → exit 1, file unchanged.
9. Every git spawn in `login.mjs` (tracked check and in-git-tree check) treats the target repository as untrusted: `execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", dir, …])` with `cwd` = `os.tmpdir()` (not `dir`), `env` = `{ PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" }`, `stdio: "ignore"`, `timeout: 5000`. Test: a temp git repo whose `.git/config` sets `core.fsmonitor` to a script that creates a marker file → run `login.mjs` there → the marker file does not exist afterwards.
10. The tracked check fails CLOSED: only `git ls-files --error-unmatch` exiting with status 1 counts as "not tracked". Any other outcome (spawn error other than git missing, timeout, signal, exit 128 such as "dubious ownership", any other status) while the directory is inside a git work tree → exit 1, nothing written, a message naming the reason. Pass `-c safe.directory=<realpath of the repo top level or dir>` so a repo owned by another user does not trip the ownership check. Git absent (ENOENT) and no `.git` found upward from `dir`: skip the check (no repo to leak into). Tests: (a) a fake `git` on PATH that exits 128 inside a dir with a `.git` folder → login exits 1, nothing written; (b) the same with a fake `git` that sleeps past the timeout is optional (may be skipped if it makes the suite slow; say so).
