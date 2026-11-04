---
red: {"command":"node --test test/fixes/t-mg-8-ui.test.ts","exit":1,"excerpt":"tests 13; pass 2; fail 11. B-MG-35: counters [2,2,2,2] instead of [1,1,1,1]. B-MG-36: duplicate reply. B-MG-37: composer replaced. B-MG-38: after=200 instead of after=100. B-MG-39: broken href and undefined placeholder. B-MG-41: account data retained. B-MG-43: keydown listener retained."}
green: {"command":"node --test test/fixes/t-mg-8-ui.test.ts test/ui-moduly.test.ts test/ui-start.test.ts","exit":0,"excerpt":"tests 21; pass 21; fail 0; cancelled 0; skipped 0. Includes 17 new regression tests."}
---

# Report: Fix C, web UI defects (T-MG-8)

Status: NEEDS_CONTEXT

Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-8
Branch: task/T-MG-8-fix-c-ui
Base: 0561f866f0737576cc087c30a3cdaff79a1ed8b3
Commits: none, as required by the External run instructions.
Push: no.
Review: left to the orchestrator, landfall:reviewer.

Six findings were fixed completely. B-MG-43 was fixed for
confirmModal; showNewsModal requires extending the scope to
src/http/ui/js/view-notifications.js. The scope-extension question
remains unanswered. This file was not changed.

## Changes and RED/GREEN

| ID | Problem and fix | Test and evidence |
|---|---|---|
| B-MG-35 | message_updated triggered new-message effects. An update now replaces the content without incrementing counts, notifying, announcing, or scrolling. | "edits, deletes and replayed updates replace messages without new-message effects": RED counts 2 instead of 1; GREEN. |
| B-MG-36 | The HTTP response added a reply already delivered by SSE a second time. Applied an upsert by id. | "a thread send response upserts the reply already received over SSE": RED two entries; GREEN one. |
| B-MG-37 | A successful send rebuilt the composer. It now compares text and preserves the element, focus, and new draft. Opening a thread after sending also preserves the main composer. | "Enter then further typing keeps the composer, focus and new draft after send": RED replaced element; GREEN. Additional tests cover identical subsequent text, conversation changes, sending a thread reply, and clearing unchanged text. |
| B-MG-38 | REST advanced the SSE resume cursor. Only the SSE handler now updates the cursor. | "REST upserts do not advance the cursor used to reconnect SSE": RED after=200; GREEN after=100. |
| B-MG-39 | Mention processing corrupted href and code; NUL impersonated a placeholder. Links and code are protected, NUL removed from input and wiki titles. | "mentions never rewrite link destinations or code" and "user NUL placeholders remain text instead of referencing code blocks": RED corrupted href/undefined; GREEN. HTML safety and wiki-title tests also pass. |
| B-MG-41 | Logout retained account data and drafts. It resets state, additional message caches, and keys for drafts, last and recent conversations. | "logout clears all account state and drafts while preserving browser preferences": RED retained data; GREEN. |
| B-MG-43 | confirmModal left a keydown listener behind. All exit paths remove the listener. | "confirmation closed by … releases every keydown listener" tests: buttons and backdrop RED → GREEN; Escape remains GREEN. showNewsModal still RED outside scope. |

First run: 13 tests, 2 PASS / 11 FAIL.
Final regression suite: 17 PASS / 0 FAIL.
Controlled mutations: 7/7 detected by assertions.
No existing tests were removed, skipped, or weakened.

## Files

Only these files changed:
- src/http/ui/js/sse-events.js
- src/http/ui/js/view-chat.js
- src/http/ui/js/actions.js
- src/http/ui/js/state.js
- src/http/ui/js/markdown.js
- src/http/ui/js/view-login.js
- src/http/ui/js/dom.js

Added:
- test/fixes/t-mg-8-ui.test.ts

No changes to view-sidebar.js, data.js, i18n, server code,
or dependencies.

## Gate

| Command | Result | Exit |
|---|---|---|
| npm test | 339 tests: 232 PASS, 107 FAIL; all failures are listen EPERM on 127.0.0.1 | 1 |
| npm run typecheck | PASS | 0 |
| landfall secrets --range 0561f866f0737576cc087c30a3cdaff79a1ed8b3..HEAD | Clean; empty range because the orchestrator makes commits | 0 |
| landfall secrets --artifact /tmp/t-mg-8-scoped-files | Clean; copy of all seven changed modules and the new test | 0 |
| Regression tests + existing ui-modules/ui-start | 21 PASS, 0 FAIL | 0 |
| git diff --check | PASS | 0 |

Baseline given in the task: 322 tests.
After the changes: 339 tests, meaning 17 new tests.

The listen EPERM restriction also occurred before the changes.
This is not a passing full gate; the orchestrator must rerun
npm test in an environment that allows opening local ports.

Failures by file:
- test/cli/atalk.test.ts: 3
- test/docs.test.ts: 1
- test/e2e/conversation.test.ts: 2
- test/http/api.test.ts: 71
- test/http/sse.test.ts: 12
- test/http/ui-modules.test.ts: 2
- test/mcp/mcp.test.ts: 16

Full list of names and locations:
 /tmp/t-mg-8-gate-failures.txt

## E2E assertions reviewed

Module tests run the real SSE handlers, actions,
composer and thread rendering, and modal closure lifecycle.
DOM, HTTP transport, EventSource, and Notification are replaced
with controlled test adapters. No visual
browser E2E was performed.

## Shared gaps / required decisions

B-MG-43: showNewsModal is in
src/http/ui/js/view-notifications.js:37, outside the Modify list.

Reproducing three openings and button closures leaves
3 listeners above baseline instead of 0:
- script: /tmp/t-mg-8-news-repro.test.ts
- result: /tmp/t-mg-8-news-red.log

Scope-extension permission or a separate task is required.
No workaround was applied in dom.js.

## Evidence

- /tmp/t-mg-8-red.log
- /tmp/t-mg-8-red-followup.log
- /tmp/t-mg-8-ui-final.log
- /tmp/t-mg-8-mutations.json
- /tmp/t-mg-8-gate-tests.log
- /tmp/t-mg-8-gate-typecheck.log
- /tmp/t-mg-8-gate-secrets.log
- /tmp/t-mg-8-gate-secrets-artifact.log

## Context

Read fix-common.md, the T-MG-1 spec, the report template,
the indicated reproductions, full B-MG-39/B-MG-41/B-MG-43,
the modules in scope, and existing UI tests.

Rules: COD-1, COD-2, COD-3, ORC-17, REV-9, PRI-15.

## DISPUTED

None.

## Deviations

Changes remain uncommitted for the orchestrator, as required
by the External run instructions. The full gate requires execution
outside the sandbox's current network restriction.

The target report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-8/report.md
was not saved: the path is outside the writable worktree.
The full report was delivered in the final response.

## Orchestrator gate re-run (outside the codex sandbox)
npm test: 339 pass, 0 fail. npm run typecheck: clean. Committed as 1f1754b. B-MG-43 showNewsModal part continues in brief amendment 1 (scope extended to view-notifications.js).

## Fix round 1

## Amendment 1

Status: DONE_WITH_CONCERNS

Worktree: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-8`  
Branch: `task/T-MG-8-fix-c-ui`  
Commits: none; changes left uncommitted for the orchestrator. HEAD remains `1f1754b`. No push.

| Finding | Fix and regression evidence |
|---|---|
| **B-MG-43** | News-modal cleanup removes its document keydown listener on button, backdrop and Escape closure. Three tests repeat each closure three times and verify listener baseline and exactly one queue callback. RED reproduced leaks; GREEN: 3/3. |
| **B-MG-58 / UX-F3** | Successful PATCH removes the editor before applying the message update. Escape, unchanged text and empty text close editing. Failed saves and unrelated redraws preserve drafts. Tests include a save completing after a redraw. RED reproduced stuck editors; GREEN: 7/7. |
| **B-MG-59 / UX-F4** | Shared conversation navigation opens the target reply’s thread, loads uncached roots, scrolls and flashes the reply. Initial refreshes finish before highlighting. Guards reject stale navigation responses. Tests exercise notification and search clicks, top-level targets and delayed responses. RED reproduced missing destinations and races; GREEN: 8/8. |

Files changed:

- `src/http/ui/js/view-notifications.js`
- `src/http/ui/js/actions.js`
- `src/http/ui/js/view-chat.js`
- New `test/fixes/t-mg-8-ui-2.test.ts`

Both entry points use the shared navigation fix; `search.js` required no edit. No dependencies added or existing tests changed.

| Gate | Result | Exit |
|---|---|---:|
| Amendment tests | 18 passed | 0 |
| Combined UI regression, parsing and startup checks | 39 passed | 0 |
| `npm test` | 357 total: 250 passed, 107 failed | 1 |
| `npm run typecheck` | Passed | 0 |
| Secrets range `0561f866f0737576cc087c30a3cdaff79a1ed8b3..HEAD` | Clean | 0 |
| Secrets artifact scans of all four changed files | Clean, including uncommitted changes | 0 |
| `git diff --check` | Passed | 0 |

All eight mutation checks failed as expected; fixes were restored and tests rerun.

The full-suite failures are unchanged from baseline: **339 total, 232 passed, 107 failed** before this amendment. Every failure reports `listen EPERM: operation not permitted 127.0.0.1`. Affected files: `test/cli/atalk.test.ts` (3), `test/docs.test.ts` (1), `test/e2e/conversation.test.ts` (2), `test/http/api.test.ts` (71), `test/http/sse.test.ts` (12), `test/http/ui-modules.test.ts` (2), and `test/mcp/mcp.test.ts` (16). No new failing tests.

Validation runs real UI modules with DOM/HTTP boundary doubles; no live-browser run was performed. The orchestrator must rerun the full suite outside this restricted sandbox before accepting the gate.

Rules applied: COD-1, COD-2, COD-3, ORC-17, REV-9, PRI-15.  
DISPUTED: none. Shared scope gaps: none.

## Orchestrator gate re-run
npm test 357 pass / 0 fail; typecheck clean; committed as the commit above (amendment 1).
Status: DONE
