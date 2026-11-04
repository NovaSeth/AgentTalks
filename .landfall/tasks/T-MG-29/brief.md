# Web UI: any click (closing the side panel etc.) re-renders the message list and scrolls it top to bottom (T-MG-29)
<!-- Task brief (ORC-4). "landfall" is the plugin's CLI. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: standard — 4 files > 2; 80 LOC > 30; kind: task). Deliverable kind: a working bug fix in the shipped web UI.
Review: none
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-29 (branch task/T-MG-29-ui-scroll-jump from main at ccb88419382657b03352589fba3e84c6f6f03b3c; dependencies installed: no — run `npm ci` in the worktree first). Update the branch only with `git merge origin/main`, never rebase. No dependencies on other tasks.
Budget: 30 minutes; when it nears, stop at a green commit and list the rest under Follow-up in the report.
Shared brief: none.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14; read them with `landfall rule <ID…>`.

## Problem (Michal, the human owner, in this session, 2026-11-04)
His words (Polish): "every time I click somewhere, e.g. close the side panel, click on something, the whole message list goes from the very top to the bottom, and it is a disaster."

Cause chain (verified by the orchestrator by reading the code, not yet by a test):
1. `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/src/http/ui/js/view-chat.js:254` `renderMain()` rebuilds the whole chat column with `el.innerHTML = ...`, including a brand-new `#messages` element. It is called on every side-panel open/close and many other clicks (e.g. view-chat.js:240, 245, 247, 458, 542, 548, 678; closeThread/closeProfile/closePinnedPanel paths; 19 call sites in `src/http/ui/js/*.js`).
2. view-chat.js:339 then calls `renderMessages()` on the fresh element. In `renderMessages()` (view-chat.js:780) `keepAtBottom = isScrolledToBottom()` and `scrollTop = el.scrollTop` are read from the NEW element (scrollTop 0, empty), so the old reading position is lost: a user scrolled up is thrown to the bottom, and the list always starts at scrollTop 0.
3. view-chat.js:843 `el.scrollTop = keepAtBottom ? el.scrollHeight : scrollTop;` — and `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/src/http/ui/app.css:234-235` gives `.messages{...;scroll-behavior:smooth}`, so this plain assignment is ANIMATED by the browser from 0 to the bottom: the visible "ride from the top to the bottom".
4. Same CSS makes every `scrollTo({behavior:"auto"})` smooth too (`behavior:"auto"` defers to the CSS property): `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/src/http/ui/js/dom.js:29` `scrollBehavior(false)` returns "auto", used by `repinIfPinned` (dom.js:397), the unread-line `scrollIntoView` (view-chat.js:142), deep-link `scrollIntoView` (view-chat.js:130) and `scrollToBottom(false)`.

## Scope
Create: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/test/ui-t29-scroll.test.ts`. Modify: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/src/http/ui/js/view-chat.js`, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/src/http/ui/js/dom.js`, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/src/http/ui/app.css`. Nothing else. If another file must change, stop with NEEDS_CONTEXT and name it (ORC-17).

## Contracts
Consumes: `state` (src/http/ui/js/state.js, owner UI core), `isScrolledToBottom`/`repinIfPinned`/`watchListPin`/`scrollToBottom`/`scrollBehavior` (dom.js). Produces: the same exports with the same signatures; no new public API is required (a small new dom.js helper is allowed if it is used).

## Acceptance
1. A `renderMain()` while a conversation is open and already loaded (side panel open/close, details toggle, profile, pinned, thread open/close) keeps the message list's reading position: if the list was at the bottom it stays at the bottom; if the user had scrolled up, the same `scrollTop` (same messages in view) is restored. The position is captured from the OLD `#messages` element before the column is replaced.
2. Restoring that position never animates: no frame shows the list at the top. A plain re-render / re-pin / restore is instant.
3. Smooth scrolling stays where it was intended: `scrollToBottom(true)` (the "jump to newest" pill, own sent message) still scrolls smoothly unless the user prefers reduced motion. Choose how (e.g. drop `scroll-behavior:smooth` from `.messages` in app.css and/or make `scrollBehavior(false)` return "instant") and justify it in the report; keep the reduced-motion rule in app.css working.
4. Opening a DIFFERENT conversation keeps today's behaviour (positions at the unread line or the bottom, view-chat.js:139-143); only same-conversation re-renders preserve the old position.
5. No existing test is removed, skipped or weakened (COD-3); the full suite stays green.
6. Describe in the report which call sites of `renderMain()` you checked, and whether any click path still replaces `#messages` in a way that loses the position (do not guess: describe what happens).

## TDD
Write `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/test/ui-t29-scroll.test.ts` first, using the stubbed-DOM pattern of `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-29/test/ui-t16-chat.test.ts` (production modules run unchanged over a small stubbed DOM). RED tests, each must fail on the base commit:
- a scrolled-up list (old `#messages` scrollTop e.g. 400, not at bottom) keeps scrollTop 400 after `renderMain()` for the same conversation (today it jumps to scrollHeight);
- an at-bottom list ends at the bottom after `renderMain()` with no smooth behaviour involved (assert the non-smooth path: e.g. `scrollBehavior(false)` is not "auto"/"smooth", or the `.messages` rule in app.css has no `scroll-behavior:smooth`, whichever your design makes the contract);
- `scrollToBottom(true)` still requests `behavior: "smooth"` when reduced motion is off.

## E2E
You run no devices or browsers (the orchestrator checks the real UI). Existing flow assertions touched: the pin/re-pin logic in dom.js (`watchListPin`, `repinIfPinned`, U1 r4) and the unread-line positioning in view-chat.js; run the existing UI tests that cover them (`test/ui-r4-ux.test.ts`, `test/ui-s7-counters.test.ts`, `test/ui-t16-chat.test.ts`, `test/ui-s2-panel.test.ts`) as part of the full suite.

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
Exit 0 prints `secrets: clean`. One commit per step; no push. A full suite or build runs through the heavy queue: `landfall heavy` with the command after `--`.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-29/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/task/report.md): the `Status:` line, decisions per acceptance point, files, RED/GREEN, gate, shared gaps, open issues. When your harness refuses that write, put the whole report in your reply: the orchestrator stores it with `landfall report <id> --from <file>`.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
