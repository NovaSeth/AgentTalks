# Web UI: Wiki and claimed resources as their own left-nav item above Admin (T-MG-38)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). -->

Executor: landfall:implementer (class: standard — 6 files > 2; 120 LOC > 30; kind: task). Deliverable kind: a working feature in the shipped web UI ("their own left-nav item").
Review: none (the orchestrator checks the real UI in a browser).
Ignore skills, plugins and MCP tools you may have; never call an AI provider; this brief and the files it names are your only context (PRI-3).
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-38 (branch task/T-MG-38-wiki-rail-place from main at 3b666b9eda33; dependencies installed: no — run `npm ci` first). Update only with `git merge origin/main`, never rebase. A later task (T-MG-39, unread highlights) waits for this one and will touch the same UI files.
Budget: 40 minutes; when it nears, stop at a green commit and list the rest under Follow-up.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14; read them with `landfall rule <ID…>`. Decisions in force: D-MG-6 (everything in English in code; Polish only in i18n-pl.js), D-MG-18 (GitHub Primer is the visual layer, Slack the interaction model).

## Source (the owner's request, task title verbatim)
"Web UI: Wiki and claimed resources as their own left-nav item above Admin".

## Today (read by the orchestrator)
- The left rail is built in `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/src/http/ui/js/app.js:63-70` with `railButton(...)` (app.js:153-161): Home (`rail-chats`, place "home"), DMs (`rail-dms`, place "dms"), Activity (`rail-notif`), Admin (`rail-users`, only for a human admin), Search (`rail-search`, phone only). Click handlers app.js:75-87; `goPlace(place)` app.js:165-186; `paintRail()` app.js:187-196 paints the `on` state for the two places; `inConversations()` app.js:103-105 is `chat` or `wiki` view.
- The sidebar sections per place: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/src/http/ui/js/view-sidebar.js:45-51` — `SECTIONS_HOME = ["catchup","channels","discover","directs","people","wiki","leases"]`, `SECTIONS_DMS = ["directs","people"]`, `sectionsFor`, `getSidebarPlace`, `setSidebarPlace` (only "home"/"dms" accepted). The wiki tree section (view-sidebar.js:276-335, 398) and the "Claimed resources" leases section (view-sidebar.js:399-412) live in Home.
- Routes: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/src/http/ui/js/router.js` (`#/dms` at :26/:60, `#/wiki/<slug>` at :36/:58); app.js:389 and app.js:507 map the `dms` route to `goPlace("dms")`.
- Icons: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/src/http/ui/js/icons.js` has `iconDoc` (Primer book).

## Scope
Modify: app.js, view-sidebar.js, router.js, `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/src/http/ui/js/i18n-pl.js` (Polish strings for any new English UI strings), `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/src/http/ui/app.css` only if needed. Create: `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/test/ui-t38-wiki-place.test.ts`. Existing tests that pin the rail/sections (e.g. `/Users/michal/Documents/Code/AgentTalks-wt/T-MG-38/test/ui-s1-sidebar.test.ts:149`, `test/ui-s3-router.test.ts`, `test/ui-s14-wiki.test.ts`, the i18n/english tests) may be EXTENDED for the new place, never weakened (COD-3). Nothing else; a gap → NEEDS_CONTEXT (ORC-17).

## Acceptance
1. The rail has a new item "Wiki" (id `rail-wiki`, icon `iconDoc`, tooltip e.g. "Wiki and claimed resources") placed directly ABOVE Admin, i.e. after Activity: Home, DMs, Activity, Wiki, Admin (Search stays last, phone only). It is shown for every signed-in actor (not only admins).
2. Clicking it selects a third sidebar place "wiki" whose sidebar shows exactly the wiki tree and the "Claimed resources" sections (in that order). Home no longer shows those two sections (they moved, they are not duplicated). DMs is unchanged.
3. The rail's `on` state and `aria-current="page"` follow the place: on while the "wiki" place is selected (in the chat or wiki view), like Home/DMs today; `paintRail` handles all three places.
4. Opening a wiki page (sidebar row, a `[[link]]`, a `#/wiki/<slug>` deep link, a search result) puts the rail on the Wiki place, so the tree of the page you are reading is visible. Opening a conversation from the Wiki place behaves like from DMs today (choose and justify; do not trap the user in a sidebar without channels — e.g. returning to Home is acceptable).
5. A route for the place itself (e.g. `#/wiki` with no slug) selects the Wiki place, like `#/dms` does; the existing `#/wiki/<slug>` keeps working.
6. Phone layout (max-width 760px): the place works as Home/DMs do there (drawer toggle on the same place). Collapsed-section storage (`atalks_sb_collapsed`) keeps working for the wiki and leases sections.
7. Polish translations for every new string in i18n-pl.js; the English/i18n tests stay green.
8. No test removed, skipped or weakened (COD-3).

## TDD
RED first in test/ui-t38-wiki-place.test.ts (follow the stubbed-DOM / pure-function style of test/ui-s1-sidebar.test.ts and test/ui-s3-router.test.ts): `sectionsFor("wiki")` is ["wiki","leases"] and `sectionsFor("home")` contains neither; `setSidebarPlace("wiki")` is kept; the rail markup has `rail-wiki` between `rail-notif` and `rail-users`; the `#/wiki` route parses to the wiki place.

## E2E
You run no browser; the orchestrator checks the real UI. Existing flow assertions touched: rail ids (ui-s1-sidebar), routes (ui-s3-router), wiki tree (ui-s14-wiki).

## Gate (in order, no pipes, bounded test workers)
```bash
NODE_OPTIONS="$NODE_OPTIONS --test-reporter=tap" npm run test
npm run typecheck
landfall secrets
```
If the shell guard refuses the NODE_OPTIONS line, run the equivalent TAP command through `landfall heavy`. `landfall secrets` exits 1 on a pre-existing baseline (D-MG-8) outside this task's files: report it, do not fix it. One commit per step; no push.

## Report
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-38/report.md (template: /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.6.0/templates/task/report.md). If the harness refuses that write, write it to /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/2dea6f5e-308e-479c-9e35-22ed866d2337/scratchpad/T-MG-38-report.md and say so.
Final reply: exactly 5 lines: status, commits, tests, concerns, report path.
