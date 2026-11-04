---
red: {"command": "node --test test/cli/naming.test.ts (new test on base a85b76d)", "exit": 1, "excerpt": "AssertionError: package.json bin atalks: actual undefined, expected string"}
green: {"command": "node --test test/cli/naming.test.ts (at 9bcfeb5)", "exit": 0, "excerpt": "tests 2, pass 2, fail 0"}
---
Status: DONE_WITH_CONCERNS

Part A is implemented. The full green-suite gate remains unverified because this sandbox blocks localhost listeners and process inspection. Changes are uncommitted for the orchestrator, following “External run”; no rebase, commit or push was performed.

Worktree: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-41`, branch `task/T-MG-41-atalks-cli-name`.

**Decisions against acceptance**

1. Both `atalks` and `atalk` map to the existing `bin/atalk.js`. The new regression test checks both entries exist and resolve to the same implementation. An actual `npm i -g .` installation using a temporary prefix installed both executable names successfully. `agenttalks` is unchanged.
2. Help, usage, errors and hints use `atalks` for either invocation. No alias notice is printed, preserving identical output; README, install instructions and NEWS explain compatibility. Fixed the existing top-level `--help` path, which previously treated it as a command. The shared argument parser is unchanged.
3. All client-command instructions in the specified product, documentation, served skill and legacy Claude Code integration scope now use `atalks`. The complete remaining-word inventory is below. Excluded plugin, UI and historical files were not edited.
4. NEWS announces the name, compatibility alias and continued operation of existing scripts; existing command examples there use the canonical name.
5. `.agenttalks.json`, `atalk.json`, environment variables, API and the persisted `writtenBy: "atalk"` marker are unchanged.
6. Updated pinned text expectations and hook executable stubs. The documentation validator recognizes both names and asserts it checks both. No test was removed or disabled. Full-suite verification remains limited as detailed below.

**Changed files — 28; paths relative to the worktree above**

- Packaging: `package.json`, `package-lock.json`, `bin/atalk.js`. The lockfile change only synchronizes the root bin metadata.
- CLI/server: `src/cli/atalk.ts`, `src/cli/main.ts`, `src/core/untrusted.ts`, `src/core/presence.ts`, `src/mcp/server.ts`.
- UI text: `src/http/ui/install.html`, `src/http/ui/js/view-admin.js`, `src/http/ui/js/view-login.js`, `src/http/ui/js/i18n-pl.js`.
- Documentation/integrations: `README.md`, `NEWS.md`, `docs/install.md`, `docs/agents.md`, `integrations/claude-skill/SKILL.md`, `integrations/claude-code/README.md`, `integrations/claude-code/skills/agenttalks/SKILL.md`, `integrations/claude-code/hooks/atalk-hook.sh`.
- Tests: new `test/cli/naming.test.ts`; updated `test/docs.test.ts`, `test/fixes/t-mg-10-cli.test.ts`, `test/fixes/t-mg-10-hook.test.ts`, `test/fixes/t-mg-10-r1-cli.test.ts`, `test/fixes/t-mg-10-r2-hook.test.ts`, `test/fixes/t-mg-3-u21-news.test.ts`, `test/plugin/onboarding.test.ts`. The onboarding change checks the in-scope served skill, not plugin implementation.

**Remaining `atalk` occurrences**

Ran `rg -n '\batalk\b'` over the explicit scope, plus `package-lock.json` and all of `test/`: 119 matching lines in 27 files. Every matching line is enumerated below; multiple occurrences on a line share the stated reasons. Excluded `integrations/claude-code-plugin/`, historical documents and excluded UI files are outside this inventory and remain untouched.

| File | Lines | Reason retained |
|---|---|---|
| `package.json` | 12, 13 | Shared entry filename and compatibility alias. |
| `package-lock.json` | 16, 17 | Same bin metadata. |
| `bin/atalk.js` | 2, 12 | Existing source filename `src/cli/atalk.ts`. |
| `src/cli/atalk.ts` | 13, 33; 43; 530 | Configuration filename; persisted compatibility marker; existing test filename. |
| `README.md` | 102 | Documents the compatibility alias. |
| `NEWS.md` | 9 | Announces the retained alias. |
| `docs/install.md` | 182, 197; 190; 785, 817, 836, 841, 847, 977, 990, 1089, 1096 | Entry filename; alias explanation; unchanged configuration filename. |
| `integrations/claude-skill/SKILL.md` | 204, 589; 558, 559 | Configuration filename; existing entry/source filenames. |
| `integrations/claude-code/README.md` | 50, 52, 54 | Existing hook filename. |
| `integrations/claude-code/hooks/atalk-hook.sh` | 5, 6, 7, 23; 36 | Hook filename/diagnostic prefix; configuration filename. Commands and CLI hints use `atalks`. |
| `test/cli/naming.test.ts` | 14, 16, 17, 39 | Explicit compatibility-alias assertions and parity checks. |
| `test/cli/atalk.test.ts` | 3, 61, 83, 102, 132, 153, 172, 220, 253, 263, 278, 290; 19, 26, 178, 237; 184, 230 | Existing test labels/comments referring to the still-valid alias; source/entry filenames; temporary fixture names. |
| `test/core/presence.test.ts` | 122 | Existing comment describing the still-valid alias. |
| `test/docs.test.ts` | 92, 150; 153, 170 | Existing filenames; alias support and historical-example coverage. |
| `test/fixes/t-mg-10-cli.test.ts` | 6; 12, 51, 61, 66; 59; 69 | Source filename; fixture names/hostname; existing alias test label; persisted marker assertion. |
| `test/fixes/t-mg-10-hook.test.ts` | 8; 12, 38 | Hook filename; temporary fixture names. |
| `test/fixes/t-mg-10-r1-cli.test.ts` | 7, 109; 48; 51, 69, 70, 110; 71 | Source/hook filenames; existing alias test label; temporary fixture names; compatibility marker fixture. |
| `test/fixes/t-mg-10-r2-hook.test.ts` | 14 | Hook filename. |
| `test/fixes/t-mg-10-skill.test.ts` | 63 | Hook filename. |
| `test/fixes/t-mg-21-r1-trust-lock.test.ts` | 7; 12, 44; 46, 47, 68, 69 | Source filename; existing alias comments/test label; temporary fixture names. |
| `test/fixes/t-mg-21-r2-trust-lock.test.ts` | 12, 61; 18; 60, 81 | Existing alias comments/label; entry filename; internal identifier. |
| `test/language-allowlist.txt` | 258 | Exact fixture for an excluded historical audit. |
| `test/plugin/core.test.ts` | 30, 83, 99, 107, 114; 69, 125 | Existing plugin-test comments/label using the valid alias; configuration filename. |
| `test/plugin/onboarding.test.ts` | 2, 262; 170 | Existing plugin-test comments using the alias; configuration filename. The served-skill command assertion was updated. |
| `test/plugin/project-trust.test.ts` | 3, 8, 114; 69, 135, 136; 79 | Existing plugin-test comments; strings pinned to the excluded plugin, for part B; configuration filename. |
| `test/plugin/wake-bridge.test.ts` | 31, 51; 439 | Configuration filename; existing plugin-test alias comment. |
| `test/plugin/wake-tools.test.ts` | 54, 236; 179 | Configuration filename; existing plugin test forbidding a CLI reference in a tool-only wake prompt. |

**Verification**

- `npm ci`: passed, 96 packages installed.
- New naming tests: initially failed because `atalks` was absent; passed after implementation (2/2), also passed in the final full run.
- Temporary-prefix `npm i -g . --offline`: passed. Both installed client commands resolve to the same file and print identical `atalks --help` output. Installed `agenttalks --help` retains its existing heading.
- Required gates ran in order: `npm run test`, then `npm run typecheck`.
- Final full test run: **1,063 tests; 771 passed; 292 failed; 0 skipped; 0 cancelled**. Of the failures, 290 report `listen EPERM: operation not permitted 127.0.0.1`. The other two are unchanged plugin tests: `test/plugin/liveness.test.ts:60` (`run` versus `standby`) and `test/plugin/monitor.test.ts:152` (process-exit wait timeout). Process inspection is also denied: `ps` returns “operation not permitted.” These two failures are consistent with that restriction; they still require confirmation outside the sandbox.
- Updated documentation, NEWS, served-skill and hook checks passed. Full-suite log: `/private/tmp/T-MG-41-test.log`.
- `npm run typecheck`: passed, exit 0.
- `git diff --check`: passed. Changed-path audit confirmed only the 28 listed files changed.

**Follow-up**

The orchestrator must rerun `npm run test` then `npm run typecheck` with localhost listeners and process inspection permitted, obtain the planned Claude review, and commit. Part B remains responsible for `integrations/claude-code-plugin/`. No further part A implementation work is known; a green full-suite result is still required.

## Fix round 1

Status: DONE

## Fix round 1

- F1 ADDRESSED (d57f5f7): atalk-hook.sh sets CLI to atalks if on PATH, else atalk, else disables itself with the existing one-line stderr message. New test in test/fixes/t-mg-10-hook.test.ts (only atalk on PATH) was RED, then GREEN; the other hook tests still pass.
- F2 ADDRESSED (second commit, "keep older NEWS entries as written"): NEWS.md equals main (a85b76d) plus only the new T-MG-41 entry (diff: 8 insertions, 0 deletions). No test pinned the changed wording; the full suite is green.

Gate: full suite 1064/1064, typecheck exit 0, tree clean.
