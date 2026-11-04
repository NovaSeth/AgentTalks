---
red: {"command": "node --test --test-timeout=20000 test/ui-t38-wiki-place.test.ts", "exit": 1, "excerpt": "ℹ pass 1 / ℹ fail 6. AssertionError: Expected values to be strictly deep-equal (sectionsFor(\"wiki\") was the Home list); 'home' !== 'wiki' (setSidebarPlace(\"wiki\") fell back to home); 'no #general' (the wiki place rendered Home's rows); 'app.js rail has #rail-wiki'; parseRoute(\"#/wiki\") was { view: 'home' }; i18n-pl.js has \"Wiki and claimed resources\""}
green: {"command": "landfall heavy -- npm run test", "exit": 0, "excerpt": "ℹ tests 1057 / ℹ pass 1057 / ℹ fail 0 / ℹ skipped 0 / ℹ todo 0"}
---
# Report: Web UI: Wiki and claimed resources as their own left-nav item above Admin (T-MG-38)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-38, task/T-MG-38-wiki-rail-place (from main at 3b666b9). Commits: 542c3f7 (RED), 0450e43 (GREEN). Push: no. Scope touched: src/http/ui/js/app.js, view-sidebar.js, router.js, i18n-pl.js; test/ui-t38-wiki-place.test.ts (new); test/ui-s1-sidebar.test.ts, ui-s3-router.test.ts, ui-fx3-r2.test.ts (extended). app.css untouched.
Status: DONE_WITH_CONCERNS

## Decisions
1. Rail item: `railButton("rail-wiki", t("Wiki"), t("Wiki and claimed resources"), iconDoc(), ...)` placed after `rail-notif`, before the admin-gated `rail-users`; Search stays last. Not gated on `adminHuman`. Home's tooltip "Conversations and wiki" became "Channels and conversations" (the wiki is no longer there; the old key was removed from i18n-pl.js because the i18n test rejects unused keys).
2. Third place: `SECTIONS_WIKI = ["wiki", "leases"]`; `SECTIONS_HOME` lost both ids (moved, not duplicated); `SECTIONS_DMS` unchanged. `sectionsFor`/`setSidebarPlace` work through a `PLACES` map; an unknown place still falls back to Home.
3. `paintRail` iterates three pairs; the shell's initial `on`/`aria-current` for `rail-wiki` uses `inConv && getSidebarPlace() === "wiki"` like Home/DMs.
4. Opening a wiki page: `openWikiPage` (view-wiki.js, out of scope) is the single funnel for sidebar rows, `[[links]]`, deep links, search results, notifications and SSE, and it calls `views.sidebar()` right after setting `state.view = "wiki"` and the slug. app.js now registers `sidebar: renderSidebarFollowingWiki`, which on the TRANSITION into the wiki view (or to another slug) sets the place to "wiki" and calls `paintRail()`, then `renderSidebarList()`. Transition, not state: presence ticks also redraw the sidebar and must not drag a reader who chose Home back to Wiki. Opening a conversation from the Wiki place keeps the place, exactly as DMs does today (Home is one rail click away; the rail is always visible, on the phone too, so nobody is trapped).
5. Route: `#/wiki` parses to `{ view: "wikiPlace" }`, `buildRoute` inverts it; `applyRoute` maps it to `goPlace("wiki")` like `#/dms`; the rail click does `syncRoute("#/wiki"); goPlace("wiki")`. `#/wiki/<slug>` unchanged.
6. Phone: `goPlace` is shared, so the drawer toggle on the same place and open-with-new-filter on another place apply to Wiki with no extra code. Collapsed storage is per section id, untouched; covered by a test in the new place.
7. Polish: "Wiki and claimed resources" -> "Wiki i zajęte zasoby", "Channels and conversations" -> "Kanały i rozmowy". "Wiki" and "Claimed resources" already existed.
8. No test removed or skipped. One existing assertion flipped (see Open issues).

## Files
- src/http/ui/js/view-sidebar.js: SECTIONS_WIKI, PLACES map, sectionsFor/setSidebarPlace accept "wiki"; comments.
- src/http/ui/js/router.js: `#/wiki` <-> `{ view: "wikiPlace" }` in parseRoute/buildRoute; header comment.
- src/http/ui/js/app.js: iconDoc import; rail-wiki button, click handler, paintRail third pair, `renderSidebarFollowingWiki` registered as `views.sidebar`, `wikiPlace` route case, Home tooltip.
- src/http/ui/js/i18n-pl.js: two new keys, one obsolete key removed.
- test/ui-t38-wiki-place.test.ts: new (7 tests).
- test/ui-s1-sidebar.test.ts: rail-id list extended with rail-wiki; the "home contains wiki" assertion flipped plus a sibling asserting the new place.
- test/ui-s3-router.test.ts: `#/wiki` row added to the parse/build table.
- test/ui-fx3-r2.test.ts (W6-S14-C): selects the Wiki place before rendering the tree; assertions unchanged.

## RED / GREEN
- RED: test/ui-t38-wiki-place.test.ts, 6 of 7 failing: sectionsFor("wiki") returned Home's list, setSidebarPlace("wiki") fell back to home, the wiki place rendered #general, no `railButton("rail-wiki"` in app.js, `#/wiki` parsed to home, no Polish key. Exit 1.
- GREEN: full suite 1057 tests, 1057 pass, 0 fail, exit 0. (The first full run had 1 fail: W6-S14-C in ui-fx3-r2 rendered the tree on the default place; extended with `setSidebarPlace("wiki")`, rerun green.)

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck (`npm run typecheck`) | ok | 0 |
| lint | none in the brief | - |
| tests (`landfall heavy -- npm run test`) | 1057/1057 | 0 |
| secrets scan (`landfall secrets`) | 10 findings, all the D-MG-8 baseline (test/http/api.test.ts, test/ui-english.test.ts, ...), none in this task's files | 1 |
The brief's `NODE_OPTIONS=... npm run test` line is refused by the shell guard (expansion in quotes); the suite ran through `landfall heavy -- npm run test`, as the brief allows.

## E2E assertions reviewed
- ui-s1-sidebar: rail ids and sections per place (extended). ui-s3-router: route table (extended). ui-s14-wiki: tree keyboard tests do not depend on the place; untouched, green. ui-fx3-r2 W6-S14-C: tree roles, extended with the place.
- For the orchestrator's browser check: rail order Home, DMs, Activity, Wiki, Admin (Search on the phone); click Wiki -> only "Wiki" and "Claimed resources"; a wiki row / `[[link]]` / `#/wiki/<slug>` lights Wiki; `#/wiki` selects the place; Home chosen while reading a page stays Home across presence ticks.

## Shared gaps (for the orchestrator)
- None blocking. view-wiki.js (`openWikiPage`) was out of scope, hence the `views.sidebar` hook in app.js; a one-line `setSidebarPlace("wiki")` in `openWikiPage` would be the more direct form if that file is ever in scope.

## Context
Brief; app.js:19,55-110,150-200,200-245,280-320,349-440,495-535; view-sidebar.js:1-120,196-230,270-440; router.js whole; view-wiki.js:120-152,331-346; view-chat.js:25-50; dom.js:303-310; app.css:104-110,1040-1062,1330; i18n-pl.js:55-60,125-128; tests ui-s1-sidebar, ui-s3-router (head), ui-s14-wiki (grep), ui-english:85-130, i18n.test.ts:59-66, ui-fx3-r2:205-235. Rules: COD-3, ORC-17.

## Open issues / deviations from the brief
- Report path: the harness refused to write /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-38/report.md; written here instead, as the brief instructs.
- COD-3 note: test/ui-s1-sidebar.test.ts:79 asserted `sectionsFor("home").includes("wiki")`; acceptance point 2 requires the opposite, so the assertion was flipped (and a sibling pins the new place). The brief is the decision behind it; flagged so it is a conscious change, not a weakening.
- test/ui-fx3-r2.test.ts was not in the brief's example list but pins the wiki tree in the sidebar; extended by two lines (place selection), body otherwise unchanged.
- Edge not covered: a sign-out and sign-in landing on the same wiki page while the place was Home keeps the rail on Home (the hook follows transitions and sees the same slug); a fresh page load is unaffected.

## Fix round 2

# Report: Web UI: Wiki and claimed resources as their own left-nav item above Admin (T-MG-38)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-38, task/T-MG-38-wiki-rail-place (from main at 3b666b9). Commits: 542c3f7 (RED), 0450e43 (GREEN). Push: no. Scope touched: src/http/ui/js/app.js, view-sidebar.js, router.js, i18n-pl.js; test/ui-t38-wiki-place.test.ts (new); test/ui-s1-sidebar.test.ts, ui-s3-router.test.ts, ui-fx3-r2.test.ts (extended). app.css untouched.
Status: DONE_WITH_CONCERNS

## Decisions
1. Rail item: `railButton("rail-wiki", t("Wiki"), t("Wiki and claimed resources"), iconDoc(), ...)` placed after `rail-notif`, before the admin-gated `rail-users`; Search stays last. Not gated on `adminHuman`. Home's tooltip "Conversations and wiki" became "Channels and conversations" (the wiki is no longer there; the old key was removed from i18n-pl.js because the i18n test rejects unused keys).
2. Third place: `SECTIONS_WIKI = ["wiki", "leases"]`; `SECTIONS_HOME` lost both ids (moved, not duplicated); `SECTIONS_DMS` unchanged. `sectionsFor`/`setSidebarPlace` work through a `PLACES` map; an unknown place still falls back to Home.
3. `paintRail` iterates three pairs; the shell's initial `on`/`aria-current` for `rail-wiki` uses `inConv && getSidebarPlace() === "wiki"` like Home/DMs.
4. Opening a wiki page: `openWikiPage` (view-wiki.js, out of scope) is the single funnel for sidebar rows, `[[links]]`, deep links, search results, notifications and SSE, and it calls `views.sidebar()` right after setting `state.view = "wiki"` and the slug. app.js now registers `sidebar: renderSidebarFollowingWiki`, which on the TRANSITION into the wiki view (or to another slug) sets the place to "wiki" and calls `paintRail()`, then `renderSidebarList()`. Transition, not state: presence ticks also redraw the sidebar and must not drag a reader who chose Home back to Wiki. Opening a conversation from the Wiki place keeps the place, exactly as DMs does today (Home is one rail click away; the rail is always visible, on the phone too, so nobody is trapped).
5. Route: `#/wiki` parses to `{ view: "wikiPlace" }`, `buildRoute` inverts it; `applyRoute` maps it to `goPlace("wiki")` like `#/dms`; the rail click does `syncRoute("#/wiki"); goPlace("wiki")`. `#/wiki/<slug>` unchanged.
6. Phone: `goPlace` is shared, so the drawer toggle on the same place and open-with-new-filter on another place apply to Wiki with no extra code. Collapsed storage is per section id, untouched; covered by a test in the new place.
7. Polish: "Wiki and claimed resources" -> "Wiki i zajęte zasoby", "Channels and conversations" -> "Kanały i rozmowy". "Wiki" and "Claimed resources" already existed.
8. No test removed or skipped. One existing assertion flipped (see Open issues).

## Files
- src/http/ui/js/view-sidebar.js: SECTIONS_WIKI, PLACES map, sectionsFor/setSidebarPlace accept "wiki"; comments.
- src/http/ui/js/router.js: `#/wiki` <-> `{ view: "wikiPlace" }` in parseRoute/buildRoute; header comment.
- src/http/ui/js/app.js: iconDoc import; rail-wiki button, click handler, paintRail third pair, `renderSidebarFollowingWiki` registered as `views.sidebar`, `wikiPlace` route case, Home tooltip.
- src/http/ui/js/i18n-pl.js: two new keys, one obsolete key removed.
- test/ui-t38-wiki-place.test.ts: new (7 tests).
- test/ui-s1-sidebar.test.ts: rail-id list extended with rail-wiki; the "home contains wiki" assertion flipped plus a sibling asserting the new place.
- test/ui-s3-router.test.ts: `#/wiki` row added to the parse/build table.
- test/ui-fx3-r2.test.ts (W6-S14-C): selects the Wiki place before rendering the tree; assertions unchanged.

## RED / GREEN
- RED: test/ui-t38-wiki-place.test.ts, 6 of 7 failing: sectionsFor("wiki") returned Home's list, setSidebarPlace("wiki") fell back to home, the wiki place rendered #general, no `railButton("rail-wiki"` in app.js, `#/wiki` parsed to home, no Polish key. Exit 1.
- GREEN: full suite 1057 tests, 1057 pass, 0 fail, exit 0. (The first full run had 1 fail: W6-S14-C in ui-fx3-r2 rendered the tree on the default place; extended with `setSidebarPlace("wiki")`, rerun green.)

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck (`npm run typecheck`) | ok | 0 |
| lint | none in the brief | - |
| tests (`landfall heavy -- npm run test`) | 1057/1057 | 0 |
| secrets scan (`landfall secrets`) | 10 findings, all the D-MG-8 baseline (test/http/api.test.ts, test/ui-english.test.ts, ...), none in this task's files | 1 |
The brief's `NODE_OPTIONS=... npm run test` line is refused by the shell guard (expansion in quotes); the suite ran through `landfall heavy -- npm run test`, as the brief allows.

## E2E assertions reviewed
- ui-s1-sidebar: rail ids and sections per place (extended). ui-s3-router: route table (extended). ui-s14-wiki: tree keyboard tests do not depend on the place; untouched, green. ui-fx3-r2 W6-S14-C: tree roles, extended with the place.
- For the orchestrator's browser check: rail order Home, DMs, Activity, Wiki, Admin (Search on the phone); click Wiki -> only "Wiki" and "Claimed resources"; a wiki row / `[[link]]` / `#/wiki/<slug>` lights Wiki; `#/wiki` selects the place; Home chosen while reading a page stays Home across presence ticks.

## Shared gaps (for the orchestrator)
- None blocking. view-wiki.js (`openWikiPage`) was out of scope, hence the `views.sidebar` hook in app.js; a one-line `setSidebarPlace("wiki")` in `openWikiPage` would be the more direct form if that file is ever in scope.

## Context
Brief; app.js:19,55-110,150-200,200-245,280-320,349-440,495-535; view-sidebar.js:1-120,196-230,270-440; router.js whole; view-wiki.js:120-152,331-346; view-chat.js:25-50; dom.js:303-310; app.css:104-110,1040-1062,1330; i18n-pl.js:55-60,125-128; tests ui-s1-sidebar, ui-s3-router (head), ui-s14-wiki (grep), ui-english:85-130, i18n.test.ts:59-66, ui-fx3-r2:205-235. Rules: COD-3, ORC-17.

## Open issues / deviations from the brief
- Report path: the harness refused to write /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-38/report.md; written here instead, as the brief instructs.
- COD-3 note: test/ui-s1-sidebar.test.ts:79 asserted `sectionsFor("home").includes("wiki")`; acceptance point 2 requires the opposite, so the assertion was flipped (and a sibling pins the new place). The brief is the decision behind it; flagged so it is a conscious change, not a weakening.
- test/ui-fx3-r2.test.ts was not in the brief's example list but pins the wiki tree in the sidebar; extended by two lines (place selection), body otherwise unchanged.
- Edge not covered: a sign-out and sign-in landing on the same wiki page while the place was Home keeps the rail on Home (the hook follows transitions and sees the same slug); a fresh page load is unaffected.

## Fix round 1 (coordinator's browser check, no findings file)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| `#/wiki/nowosci` left the rail on Home (acceptance 4, first half) | `followPlace()` in view-sidebar.js: on a NAVIGATION into the wiki view (key `wiki:<slug>` differs from the last one) the place becomes "wiki"; called at the top of `renderSidebarList` (every path: route, row, `[[link]]`, search, notification) and in `renderShell` before the rail markup; `views.sidebar` now repaints the rail after each refresh. Root cause of round 0: `openConversation` redraws through `views.render`, not `views.sidebar`, and the old app.js-only hook sat on the wrong funnel. | RED `node --test test/ui-t38-wiki-place.test.ts` exit 1 (7 pass / 3 fail: "the page's tree is visible", "renderShell settles the place before the rail markup", placeAfterNavigation missing). GREEN `landfall heavy -- npm run test` exit 0, 1060/1060. | 1dcb8c2 (RED), 3b3a13a (GREEN) |
| `#/c/general` from the Wiki place kept a sidebar without channels (acceptance 4, second half) | `placeAfterNavigation(place, view)` (pure, exported): a conversation opened while the place is "wiki" returns to "home"; DMs keeps itself as before. Transition-keyed (`chat:<id>`), so a presence tick in the same conversation never moves a Wiki place the reader picked from the rail; `setSidebarPlace` records the current key as the baseline. | same tests | same |
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 0 (1060 pass, 0 fail; the first attempt was refused by the heavy queue while the orchestrator's `landfall verify T-MG-38` held the worktree's slot, rerun after it exited); `landfall secrets` exit 1, the same 10 D-MG-8 baseline findings, none in this task's files. Tree clean, no push.
Files: src/http/ui/js/view-sidebar.js (placeAfterNavigation, followPlace, navigationKey, setSidebarPlace baseline, followPlace in renderSidebarList), src/http/ui/js/app.js (followPlace import and call in renderShell; views.sidebar = renderSidebarList + paintRail; the round-0 hook removed), test/ui-t38-wiki-place.test.ts (+3 tests).
Status: DONE_WITH_CONCERNS

## Fix round 2 (coordinator's second browser check, no findings file)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| `#/c/general` from a wiki page kept the Wiki place (step 3); `#/wiki/nowosci` from `#/dms` kept DMs (step 6) | `settleRoutePlace()` in app.js, called after the `wiki`, `chat` and `dm` routes landed (openWikiPage / openConversation / startDirect): a wiki page on screen -> place "wiki"; a conversation on screen while the place is "wiki" -> "home"; whatever the reader came from, no transition memory (a route is always a navigation). `paintRail()` + `renderSidebarList()` when the place moved. followPlace (round 1) stays for the non-route paths (row, [[link]], search, Cmd+K) and for the rail-choice baseline. | RED: test "T38-r2" drives the REAL hashchange listener of app.js through #/c/general -> #/wiki/nowosci -> #/c/general -> #/dms -> #/wiki/nowosci with a small browser stub (elements by id, fetch answering the wiki and messages GETs). Honest note: in node, at 3b3a13a, the place assertions of that sequence already held (home after step 3, wiki after step 6); the only RED was a stub artefact (a stale `on` class on a rail button that a browser's full render would have replaced; the stub now clears rail classes when the app root is rewritten). The browser finding was NOT reproduced in node; see Open issues. GREEN: `landfall heavy -- npm run test` 1061 tests, 1060 pass, 1 fail (B-MG-32 wall-clock, below), the extracted-route harness and the task file green. | 7cc12eb (RED), b01c47f (GREEN) |
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 1 with 1060/1061: the one failure is test/fixes/t-mg-7-data.test.ts "B-MG-32: unreadFor ... stays under 50 ms" (69.1 ms, then 78.8 ms alone, then 12.2 ms alone and green: load average 77 on the machine at the time; the branch touches no src outside src/http/ui/js, and the same test passes from the main checkout) - a wall-clock bound under load (D-MG-36 territory), not this task; the first full run of this round had 3 failures in ui-r5-sec (the extracted applyRoute lacked the new collaborator) fixed by adding `settleRoutePlace: () => {}` to that harness's deps (extension, body unchanged); `landfall secrets` exit 1, the same 10 D-MG-8 baseline findings, none in this task's files. Tree clean, no push.
Files: src/http/ui/js/app.js (settleRoutePlace + three call sites), test/ui-t38-wiki-place.test.ts (browser stub with element map and captured hashchange listener; T38-r2 route-driving test), test/ui-r5-sec.test.ts (+1 stub dep).
Open issues for the orchestrator:
- The browser findings of rounds 1 and 2 do not reproduce in node against the same code paths (route handler -> openConversation -> views.render -> renderShell -> followPlace). Two things worth ruling out on the checking side: (a) src/http/ui.ts:135 `moduleCache` keeps every UI module's body in the server process for its lifetime, so a server started before a checkout serves the previous build's modules until it is restarted (a page reload does not help; the `?v=` stamp is per process too); (b) the `chat` route awaits `conversationBySlug` before `openConversation`, so a read taken synchronously right after `location.hash = ...` sees the previous rail and sections, while a wiki route flips synchronously - matching "wiki OK, chat WRONG" in both rounds. Step 6 of round 2 is consistent with step 3 never having opened the conversation in that session (the place baseline then stayed on the page).
- After this round the rule is applied in two places (route: settleRoutePlace; everything else: followPlace); if view-wiki.js / view-chat.js ever come into scope, one line in openWikiPage / openConversation would replace both.
Status: DONE_WITH_CONCERNS

## Fix round 3

# Report: Web UI: Wiki and claimed resources as their own left-nav item above Admin (T-MG-38)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-38, task/T-MG-38-wiki-rail-place (from main at 3b666b9). Commits: 542c3f7 (RED), 0450e43 (GREEN). Push: no. Scope touched: src/http/ui/js/app.js, view-sidebar.js, router.js, i18n-pl.js; test/ui-t38-wiki-place.test.ts (new); test/ui-s1-sidebar.test.ts, ui-s3-router.test.ts, ui-fx3-r2.test.ts (extended). app.css untouched.
Status: DONE_WITH_CONCERNS

## Decisions
1. Rail item: `railButton("rail-wiki", t("Wiki"), t("Wiki and claimed resources"), iconDoc(), ...)` placed after `rail-notif`, before the admin-gated `rail-users`; Search stays last. Not gated on `adminHuman`. Home's tooltip "Conversations and wiki" became "Channels and conversations" (the wiki is no longer there; the old key was removed from i18n-pl.js because the i18n test rejects unused keys).
2. Third place: `SECTIONS_WIKI = ["wiki", "leases"]`; `SECTIONS_HOME` lost both ids (moved, not duplicated); `SECTIONS_DMS` unchanged. `sectionsFor`/`setSidebarPlace` work through a `PLACES` map; an unknown place still falls back to Home.
3. `paintRail` iterates three pairs; the shell's initial `on`/`aria-current` for `rail-wiki` uses `inConv && getSidebarPlace() === "wiki"` like Home/DMs.
4. Opening a wiki page: `openWikiPage` (view-wiki.js, out of scope) is the single funnel for sidebar rows, `[[links]]`, deep links, search results, notifications and SSE, and it calls `views.sidebar()` right after setting `state.view = "wiki"` and the slug. app.js now registers `sidebar: renderSidebarFollowingWiki`, which on the TRANSITION into the wiki view (or to another slug) sets the place to "wiki" and calls `paintRail()`, then `renderSidebarList()`. Transition, not state: presence ticks also redraw the sidebar and must not drag a reader who chose Home back to Wiki. Opening a conversation from the Wiki place keeps the place, exactly as DMs does today (Home is one rail click away; the rail is always visible, on the phone too, so nobody is trapped).
5. Route: `#/wiki` parses to `{ view: "wikiPlace" }`, `buildRoute` inverts it; `applyRoute` maps it to `goPlace("wiki")` like `#/dms`; the rail click does `syncRoute("#/wiki"); goPlace("wiki")`. `#/wiki/<slug>` unchanged.
6. Phone: `goPlace` is shared, so the drawer toggle on the same place and open-with-new-filter on another place apply to Wiki with no extra code. Collapsed storage is per section id, untouched; covered by a test in the new place.
7. Polish: "Wiki and claimed resources" -> "Wiki i zajęte zasoby", "Channels and conversations" -> "Kanały i rozmowy". "Wiki" and "Claimed resources" already existed.
8. No test removed or skipped. One existing assertion flipped (see Open issues).

## Files
- src/http/ui/js/view-sidebar.js: SECTIONS_WIKI, PLACES map, sectionsFor/setSidebarPlace accept "wiki"; comments.
- src/http/ui/js/router.js: `#/wiki` <-> `{ view: "wikiPlace" }` in parseRoute/buildRoute; header comment.
- src/http/ui/js/app.js: iconDoc import; rail-wiki button, click handler, paintRail third pair, `renderSidebarFollowingWiki` registered as `views.sidebar`, `wikiPlace` route case, Home tooltip.
- src/http/ui/js/i18n-pl.js: two new keys, one obsolete key removed.
- test/ui-t38-wiki-place.test.ts: new (7 tests).
- test/ui-s1-sidebar.test.ts: rail-id list extended with rail-wiki; the "home contains wiki" assertion flipped plus a sibling asserting the new place.
- test/ui-s3-router.test.ts: `#/wiki` row added to the parse/build table.
- test/ui-fx3-r2.test.ts (W6-S14-C): selects the Wiki place before rendering the tree; assertions unchanged.

## RED / GREEN
- RED: test/ui-t38-wiki-place.test.ts, 6 of 7 failing: sectionsFor("wiki") returned Home's list, setSidebarPlace("wiki") fell back to home, the wiki place rendered #general, no `railButton("rail-wiki"` in app.js, `#/wiki` parsed to home, no Polish key. Exit 1.
- GREEN: full suite 1057 tests, 1057 pass, 0 fail, exit 0. (The first full run had 1 fail: W6-S14-C in ui-fx3-r2 rendered the tree on the default place; extended with `setSidebarPlace("wiki")`, rerun green.)

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck (`npm run typecheck`) | ok | 0 |
| lint | none in the brief | - |
| tests (`landfall heavy -- npm run test`) | 1057/1057 | 0 |
| secrets scan (`landfall secrets`) | 10 findings, all the D-MG-8 baseline (test/http/api.test.ts, test/ui-english.test.ts, ...), none in this task's files | 1 |
The brief's `NODE_OPTIONS=... npm run test` line is refused by the shell guard (expansion in quotes); the suite ran through `landfall heavy -- npm run test`, as the brief allows.

## E2E assertions reviewed
- ui-s1-sidebar: rail ids and sections per place (extended). ui-s3-router: route table (extended). ui-s14-wiki: tree keyboard tests do not depend on the place; untouched, green. ui-fx3-r2 W6-S14-C: tree roles, extended with the place.
- For the orchestrator's browser check: rail order Home, DMs, Activity, Wiki, Admin (Search on the phone); click Wiki -> only "Wiki" and "Claimed resources"; a wiki row / `[[link]]` / `#/wiki/<slug>` lights Wiki; `#/wiki` selects the place; Home chosen while reading a page stays Home across presence ticks.

## Shared gaps (for the orchestrator)
- None blocking. view-wiki.js (`openWikiPage`) was out of scope, hence the `views.sidebar` hook in app.js; a one-line `setSidebarPlace("wiki")` in `openWikiPage` would be the more direct form if that file is ever in scope.

## Context
Brief; app.js:19,55-110,150-200,200-245,280-320,349-440,495-535; view-sidebar.js:1-120,196-230,270-440; router.js whole; view-wiki.js:120-152,331-346; view-chat.js:25-50; dom.js:303-310; app.css:104-110,1040-1062,1330; i18n-pl.js:55-60,125-128; tests ui-s1-sidebar, ui-s3-router (head), ui-s14-wiki (grep), ui-english:85-130, i18n.test.ts:59-66, ui-fx3-r2:205-235. Rules: COD-3, ORC-17.

## Open issues / deviations from the brief
- Report path: the harness refused to write /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-38/report.md; written here instead, as the brief instructs.
- COD-3 note: test/ui-s1-sidebar.test.ts:79 asserted `sectionsFor("home").includes("wiki")`; acceptance point 2 requires the opposite, so the assertion was flipped (and a sibling pins the new place). The brief is the decision behind it; flagged so it is a conscious change, not a weakening.
- test/ui-fx3-r2.test.ts was not in the brief's example list but pins the wiki tree in the sidebar; extended by two lines (place selection), body otherwise unchanged.
- Edge not covered: a sign-out and sign-in landing on the same wiki page while the place was Home keeps the rail on Home (the hook follows transitions and sees the same slug); a fresh page load is unaffected.

## Fix round 1 (coordinator's browser check, no findings file)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| `#/wiki/nowosci` left the rail on Home (acceptance 4, first half) | `followPlace()` in view-sidebar.js: on a NAVIGATION into the wiki view (key `wiki:<slug>` differs from the last one) the place becomes "wiki"; called at the top of `renderSidebarList` (every path: route, row, `[[link]]`, search, notification) and in `renderShell` before the rail markup; `views.sidebar` now repaints the rail after each refresh. Root cause of round 0: `openConversation` redraws through `views.render`, not `views.sidebar`, and the old app.js-only hook sat on the wrong funnel. | RED `node --test test/ui-t38-wiki-place.test.ts` exit 1 (7 pass / 3 fail: "the page's tree is visible", "renderShell settles the place before the rail markup", placeAfterNavigation missing). GREEN `landfall heavy -- npm run test` exit 0, 1060/1060. | 1dcb8c2 (RED), 3b3a13a (GREEN) |
| `#/c/general` from the Wiki place kept a sidebar without channels (acceptance 4, second half) | `placeAfterNavigation(place, view)` (pure, exported): a conversation opened while the place is "wiki" returns to "home"; DMs keeps itself as before. Transition-keyed (`chat:<id>`), so a presence tick in the same conversation never moves a Wiki place the reader picked from the rail; `setSidebarPlace` records the current key as the baseline. | same tests | same |
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 0 (1060 pass, 0 fail; the first attempt was refused by the heavy queue while the orchestrator's `landfall verify T-MG-38` held the worktree's slot, rerun after it exited); `landfall secrets` exit 1, the same 10 D-MG-8 baseline findings, none in this task's files. Tree clean, no push.
Files: src/http/ui/js/view-sidebar.js (placeAfterNavigation, followPlace, navigationKey, setSidebarPlace baseline, followPlace in renderSidebarList), src/http/ui/js/app.js (followPlace import and call in renderShell; views.sidebar = renderSidebarList + paintRail; the round-0 hook removed), test/ui-t38-wiki-place.test.ts (+3 tests).
Status: DONE_WITH_CONCERNS

## Fix round 2 (coordinator's second browser check, no findings file)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| `#/c/general` from a wiki page kept the Wiki place (step 3); `#/wiki/nowosci` from `#/dms` kept DMs (step 6) | `settleRoutePlace()` in app.js, called after the `wiki`, `chat` and `dm` routes landed (openWikiPage / openConversation / startDirect): a wiki page on screen -> place "wiki"; a conversation on screen while the place is "wiki" -> "home"; whatever the reader came from, no transition memory (a route is always a navigation). `paintRail()` + `renderSidebarList()` when the place moved. followPlace (round 1) stays for the non-route paths (row, [[link]], search, Cmd+K) and for the rail-choice baseline. | RED: test "T38-r2" drives the REAL hashchange listener of app.js through #/c/general -> #/wiki/nowosci -> #/c/general -> #/dms -> #/wiki/nowosci with a small browser stub (elements by id, fetch answering the wiki and messages GETs). Honest note: in node, at 3b3a13a, the place assertions of that sequence already held (home after step 3, wiki after step 6); the only RED was a stub artefact (a stale `on` class on a rail button that a browser's full render would have replaced; the stub now clears rail classes when the app root is rewritten). The browser finding was NOT reproduced in node; see Open issues. GREEN: `landfall heavy -- npm run test` 1061 tests, 1060 pass, 1 fail (B-MG-32 wall-clock, below), the extracted-route harness and the task file green. | 7cc12eb (RED), b01c47f (GREEN) |
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 1 with 1060/1061: the one failure is test/fixes/t-mg-7-data.test.ts "B-MG-32: unreadFor ... stays under 50 ms" (69.1 ms, then 78.8 ms alone, then 12.2 ms alone and green: load average 77 on the machine at the time; the branch touches no src outside src/http/ui/js, and the same test passes from the main checkout) - a wall-clock bound under load (D-MG-36 territory), not this task; the first full run of this round had 3 failures in ui-r5-sec (the extracted applyRoute lacked the new collaborator) fixed by adding `settleRoutePlace: () => {}` to that harness's deps (extension, body unchanged); `landfall secrets` exit 1, the same 10 D-MG-8 baseline findings, none in this task's files. Tree clean, no push.
Files: src/http/ui/js/app.js (settleRoutePlace + three call sites), test/ui-t38-wiki-place.test.ts (browser stub with element map and captured hashchange listener; T38-r2 route-driving test), test/ui-r5-sec.test.ts (+1 stub dep).
Open issues for the orchestrator:
- The browser findings of rounds 1 and 2 do not reproduce in node against the same code paths (route handler -> openConversation -> views.render -> renderShell -> followPlace). Two things worth ruling out on the checking side: (a) src/http/ui.ts:135 `moduleCache` keeps every UI module's body in the server process for its lifetime, so a server started before a checkout serves the previous build's modules until it is restarted (a page reload does not help; the `?v=` stamp is per process too); (b) the `chat` route awaits `conversationBySlug` before `openConversation`, so a read taken synchronously right after `location.hash = ...` sees the previous rail and sections, while a wiki route flips synchronously - matching "wiki OK, chat WRONG" in both rounds. Step 6 of round 2 is consistent with step 3 never having opened the conversation in that session (the place baseline then stayed on the page).
- After this round the rule is applied in two places (route: settleRoutePlace; everything else: followPlace); if view-wiki.js / view-chat.js ever come into scope, one line in openWikiPage / openConversation would replace both.
Status: DONE_WITH_CONCERNS

## Fix round 3 (review-r1.json, Codex: F1, F2, F3 blocking)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| F1 Wiki chosen from Activity opened Home (setSidebarPlace recorded a null key, followPlace overrode the choice) | The rule has ONE home now. router.js: `onNavigate(fn)`; `syncRoute` reports every call to its listeners before touching the address bar, the same hash or not. app.js: one listener applies `placeAfterNavigation(place, route.view)` (view-sidebar.js, pure; now also `dm`) and paints the rail + list when the place moved. Nothing moves on a render or on a route's completion: followPlace / navigationKey / the baseline in setSidebarPlace and settleRoutePlace are deleted. goPlace("wiki") from Activity therefore stands. | RED `node --test test/ui-t38-wiki-place.test.ts` exit 1: 8 pass / 5 fail - "T38-r3 F1" {view chat, place home}, "F2" place home after the second openWikiPage, "F3" "the late completion changes nothing" (place wiki after release), the pure-function `dm` case, and the design check (no onNavigate). GREEN `landfall heavy -- npm run test` exit 0, 1077/1077 (main merged). | b57e564 (RED), e7bc363 (GREEN) |
| F2 reopening the current page by a non-route entry kept the tree hidden | Every openWikiPage calls syncRoute at its start (view-wiki.js:128) even for the page on screen; the listener treats a `wiki` route as a navigation every time. | same | same |
| F3 a delayed route completion overrode a newer place | The place moves when the navigation STARTS (syncRoute precedes every await in openWikiPage and openConversation); completion does nothing, so #/dms chosen while GET /api/wiki/slow is pending wins; the symmetric case (a conversation's load finishing after a rail Wiki click) is covered by the same test. A conversation's own later address rewrites (view-chat.js:90,108 drop a dead `/m/<id>`) report the same conversation: the listener keys conversation navigations on `c:<slug>` / `dm:<handles>` and acts only on a change (reset by a wiki navigation, so returning to the same conversation from a page counts). | same | same |
Merge: `git merge origin/main` was "Already up to date" - origin/main sits at 082a954 while local `main` holds T-MG-36's 547db89 and T-MG-41; merged local `main` (the base branch the brief names) as 8d5b20e, clean, no conflicts.
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 0, 1077 pass / 0 fail (B-MG-32 is load-independent after T-MG-36); `landfall secrets` exit 1 with 12 findings: the 10 D-MG-8 baseline plus 2 new in test/cli/naming.test.ts:35-36, which came with the merge of main (T-MG-41), outside this task's files - reported, not fixed. Tree clean, no push.
Files: src/http/ui/js/router.js (onNavigate, syncRoute reports first), src/http/ui/js/app.js (listener next to paintRail; followPlace/settleRoutePlace and their call sites removed; views.sidebar back to renderSidebarList), src/http/ui/js/view-sidebar.js (placeAfterNavigation with `dm`; followPlace block removed; setSidebarPlace plain), test/ui-t38-wiki-place.test.ts (bootApp: held GETs, goNoWait, views; T38-r3 tests; the round-1 follow-on-render tests removed with the design they pinned - the behaviours they covered, page -> Wiki and conversation-from-Wiki -> Home and "a redraw keeps the choice", are asserted again in T38-r2/T38-r3), test/ui-r5-sec.test.ts (round-2 stub dep removed, harness back to its original body).
COD-3 note: three round-1 tests of this task (T38-r1) were removed, not weakened: they asserted the transition-keyed follow-on-render mechanism Codex rejected; their observable behaviours are re-asserted by T38-r2 and T38-r3 against the real route handler.
Status: DONE_WITH_CONCERNS

## Fix round 4

# Report: Web UI: Wiki and claimed resources as their own left-nav item above Admin (T-MG-38)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-38, task/T-MG-38-wiki-rail-place (from main at 3b666b9). Commits: 542c3f7 (RED), 0450e43 (GREEN). Push: no. Scope touched: src/http/ui/js/app.js, view-sidebar.js, router.js, i18n-pl.js; test/ui-t38-wiki-place.test.ts (new); test/ui-s1-sidebar.test.ts, ui-s3-router.test.ts, ui-fx3-r2.test.ts (extended). app.css untouched.
Status: DONE_WITH_CONCERNS

## Decisions
1. Rail item: `railButton("rail-wiki", t("Wiki"), t("Wiki and claimed resources"), iconDoc(), ...)` placed after `rail-notif`, before the admin-gated `rail-users`; Search stays last. Not gated on `adminHuman`. Home's tooltip "Conversations and wiki" became "Channels and conversations" (the wiki is no longer there; the old key was removed from i18n-pl.js because the i18n test rejects unused keys).
2. Third place: `SECTIONS_WIKI = ["wiki", "leases"]`; `SECTIONS_HOME` lost both ids (moved, not duplicated); `SECTIONS_DMS` unchanged. `sectionsFor`/`setSidebarPlace` work through a `PLACES` map; an unknown place still falls back to Home.
3. `paintRail` iterates three pairs; the shell's initial `on`/`aria-current` for `rail-wiki` uses `inConv && getSidebarPlace() === "wiki"` like Home/DMs.
4. Opening a wiki page: `openWikiPage` (view-wiki.js, out of scope) is the single funnel for sidebar rows, `[[links]]`, deep links, search results, notifications and SSE, and it calls `views.sidebar()` right after setting `state.view = "wiki"` and the slug. app.js now registers `sidebar: renderSidebarFollowingWiki`, which on the TRANSITION into the wiki view (or to another slug) sets the place to "wiki" and calls `paintRail()`, then `renderSidebarList()`. Transition, not state: presence ticks also redraw the sidebar and must not drag a reader who chose Home back to Wiki. Opening a conversation from the Wiki place keeps the place, exactly as DMs does today (Home is one rail click away; the rail is always visible, on the phone too, so nobody is trapped).
5. Route: `#/wiki` parses to `{ view: "wikiPlace" }`, `buildRoute` inverts it; `applyRoute` maps it to `goPlace("wiki")` like `#/dms`; the rail click does `syncRoute("#/wiki"); goPlace("wiki")`. `#/wiki/<slug>` unchanged.
6. Phone: `goPlace` is shared, so the drawer toggle on the same place and open-with-new-filter on another place apply to Wiki with no extra code. Collapsed storage is per section id, untouched; covered by a test in the new place.
7. Polish: "Wiki and claimed resources" -> "Wiki i zajęte zasoby", "Channels and conversations" -> "Kanały i rozmowy". "Wiki" and "Claimed resources" already existed.
8. No test removed or skipped. One existing assertion flipped (see Open issues).

## Files
- src/http/ui/js/view-sidebar.js: SECTIONS_WIKI, PLACES map, sectionsFor/setSidebarPlace accept "wiki"; comments.
- src/http/ui/js/router.js: `#/wiki` <-> `{ view: "wikiPlace" }` in parseRoute/buildRoute; header comment.
- src/http/ui/js/app.js: iconDoc import; rail-wiki button, click handler, paintRail third pair, `renderSidebarFollowingWiki` registered as `views.sidebar`, `wikiPlace` route case, Home tooltip.
- src/http/ui/js/i18n-pl.js: two new keys, one obsolete key removed.
- test/ui-t38-wiki-place.test.ts: new (7 tests).
- test/ui-s1-sidebar.test.ts: rail-id list extended with rail-wiki; the "home contains wiki" assertion flipped plus a sibling asserting the new place.
- test/ui-s3-router.test.ts: `#/wiki` row added to the parse/build table.
- test/ui-fx3-r2.test.ts (W6-S14-C): selects the Wiki place before rendering the tree; assertions unchanged.

## RED / GREEN
- RED: test/ui-t38-wiki-place.test.ts, 6 of 7 failing: sectionsFor("wiki") returned Home's list, setSidebarPlace("wiki") fell back to home, the wiki place rendered #general, no `railButton("rail-wiki"` in app.js, `#/wiki` parsed to home, no Polish key. Exit 1.
- GREEN: full suite 1057 tests, 1057 pass, 0 fail, exit 0. (The first full run had 1 fail: W6-S14-C in ui-fx3-r2 rendered the tree on the default place; extended with `setSidebarPlace("wiki")`, rerun green.)

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck (`npm run typecheck`) | ok | 0 |
| lint | none in the brief | - |
| tests (`landfall heavy -- npm run test`) | 1057/1057 | 0 |
| secrets scan (`landfall secrets`) | 10 findings, all the D-MG-8 baseline (test/http/api.test.ts, test/ui-english.test.ts, ...), none in this task's files | 1 |
The brief's `NODE_OPTIONS=... npm run test` line is refused by the shell guard (expansion in quotes); the suite ran through `landfall heavy -- npm run test`, as the brief allows.

## E2E assertions reviewed
- ui-s1-sidebar: rail ids and sections per place (extended). ui-s3-router: route table (extended). ui-s14-wiki: tree keyboard tests do not depend on the place; untouched, green. ui-fx3-r2 W6-S14-C: tree roles, extended with the place.
- For the orchestrator's browser check: rail order Home, DMs, Activity, Wiki, Admin (Search on the phone); click Wiki -> only "Wiki" and "Claimed resources"; a wiki row / `[[link]]` / `#/wiki/<slug>` lights Wiki; `#/wiki` selects the place; Home chosen while reading a page stays Home across presence ticks.

## Shared gaps (for the orchestrator)
- None blocking. view-wiki.js (`openWikiPage`) was out of scope, hence the `views.sidebar` hook in app.js; a one-line `setSidebarPlace("wiki")` in `openWikiPage` would be the more direct form if that file is ever in scope.

## Context
Brief; app.js:19,55-110,150-200,200-245,280-320,349-440,495-535; view-sidebar.js:1-120,196-230,270-440; router.js whole; view-wiki.js:120-152,331-346; view-chat.js:25-50; dom.js:303-310; app.css:104-110,1040-1062,1330; i18n-pl.js:55-60,125-128; tests ui-s1-sidebar, ui-s3-router (head), ui-s14-wiki (grep), ui-english:85-130, i18n.test.ts:59-66, ui-fx3-r2:205-235. Rules: COD-3, ORC-17.

## Open issues / deviations from the brief
- Report path: the harness refused to write /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-38/report.md; written here instead, as the brief instructs.
- COD-3 note: test/ui-s1-sidebar.test.ts:79 asserted `sectionsFor("home").includes("wiki")`; acceptance point 2 requires the opposite, so the assertion was flipped (and a sibling pins the new place). The brief is the decision behind it; flagged so it is a conscious change, not a weakening.
- test/ui-fx3-r2.test.ts was not in the brief's example list but pins the wiki tree in the sidebar; extended by two lines (place selection), body otherwise unchanged.
- Edge not covered: a sign-out and sign-in landing on the same wiki page while the place was Home keeps the rail on Home (the hook follows transitions and sees the same slug); a fresh page load is unaffected.

## Fix round 1 (coordinator's browser check, no findings file)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| `#/wiki/nowosci` left the rail on Home (acceptance 4, first half) | `followPlace()` in view-sidebar.js: on a NAVIGATION into the wiki view (key `wiki:<slug>` differs from the last one) the place becomes "wiki"; called at the top of `renderSidebarList` (every path: route, row, `[[link]]`, search, notification) and in `renderShell` before the rail markup; `views.sidebar` now repaints the rail after each refresh. Root cause of round 0: `openConversation` redraws through `views.render`, not `views.sidebar`, and the old app.js-only hook sat on the wrong funnel. | RED `node --test test/ui-t38-wiki-place.test.ts` exit 1 (7 pass / 3 fail: "the page's tree is visible", "renderShell settles the place before the rail markup", placeAfterNavigation missing). GREEN `landfall heavy -- npm run test` exit 0, 1060/1060. | 1dcb8c2 (RED), 3b3a13a (GREEN) |
| `#/c/general` from the Wiki place kept a sidebar without channels (acceptance 4, second half) | `placeAfterNavigation(place, view)` (pure, exported): a conversation opened while the place is "wiki" returns to "home"; DMs keeps itself as before. Transition-keyed (`chat:<id>`), so a presence tick in the same conversation never moves a Wiki place the reader picked from the rail; `setSidebarPlace` records the current key as the baseline. | same tests | same |
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 0 (1060 pass, 0 fail; the first attempt was refused by the heavy queue while the orchestrator's `landfall verify T-MG-38` held the worktree's slot, rerun after it exited); `landfall secrets` exit 1, the same 10 D-MG-8 baseline findings, none in this task's files. Tree clean, no push.
Files: src/http/ui/js/view-sidebar.js (placeAfterNavigation, followPlace, navigationKey, setSidebarPlace baseline, followPlace in renderSidebarList), src/http/ui/js/app.js (followPlace import and call in renderShell; views.sidebar = renderSidebarList + paintRail; the round-0 hook removed), test/ui-t38-wiki-place.test.ts (+3 tests).
Status: DONE_WITH_CONCERNS

## Fix round 2 (coordinator's second browser check, no findings file)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| `#/c/general` from a wiki page kept the Wiki place (step 3); `#/wiki/nowosci` from `#/dms` kept DMs (step 6) | `settleRoutePlace()` in app.js, called after the `wiki`, `chat` and `dm` routes landed (openWikiPage / openConversation / startDirect): a wiki page on screen -> place "wiki"; a conversation on screen while the place is "wiki" -> "home"; whatever the reader came from, no transition memory (a route is always a navigation). `paintRail()` + `renderSidebarList()` when the place moved. followPlace (round 1) stays for the non-route paths (row, [[link]], search, Cmd+K) and for the rail-choice baseline. | RED: test "T38-r2" drives the REAL hashchange listener of app.js through #/c/general -> #/wiki/nowosci -> #/c/general -> #/dms -> #/wiki/nowosci with a small browser stub (elements by id, fetch answering the wiki and messages GETs). Honest note: in node, at 3b3a13a, the place assertions of that sequence already held (home after step 3, wiki after step 6); the only RED was a stub artefact (a stale `on` class on a rail button that a browser's full render would have replaced; the stub now clears rail classes when the app root is rewritten). The browser finding was NOT reproduced in node; see Open issues. GREEN: `landfall heavy -- npm run test` 1061 tests, 1060 pass, 1 fail (B-MG-32 wall-clock, below), the extracted-route harness and the task file green. | 7cc12eb (RED), b01c47f (GREEN) |
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 1 with 1060/1061: the one failure is test/fixes/t-mg-7-data.test.ts "B-MG-32: unreadFor ... stays under 50 ms" (69.1 ms, then 78.8 ms alone, then 12.2 ms alone and green: load average 77 on the machine at the time; the branch touches no src outside src/http/ui/js, and the same test passes from the main checkout) - a wall-clock bound under load (D-MG-36 territory), not this task; the first full run of this round had 3 failures in ui-r5-sec (the extracted applyRoute lacked the new collaborator) fixed by adding `settleRoutePlace: () => {}` to that harness's deps (extension, body unchanged); `landfall secrets` exit 1, the same 10 D-MG-8 baseline findings, none in this task's files. Tree clean, no push.
Files: src/http/ui/js/app.js (settleRoutePlace + three call sites), test/ui-t38-wiki-place.test.ts (browser stub with element map and captured hashchange listener; T38-r2 route-driving test), test/ui-r5-sec.test.ts (+1 stub dep).
Open issues for the orchestrator:
- The browser findings of rounds 1 and 2 do not reproduce in node against the same code paths (route handler -> openConversation -> views.render -> renderShell -> followPlace). Two things worth ruling out on the checking side: (a) src/http/ui.ts:135 `moduleCache` keeps every UI module's body in the server process for its lifetime, so a server started before a checkout serves the previous build's modules until it is restarted (a page reload does not help; the `?v=` stamp is per process too); (b) the `chat` route awaits `conversationBySlug` before `openConversation`, so a read taken synchronously right after `location.hash = ...` sees the previous rail and sections, while a wiki route flips synchronously - matching "wiki OK, chat WRONG" in both rounds. Step 6 of round 2 is consistent with step 3 never having opened the conversation in that session (the place baseline then stayed on the page).
- After this round the rule is applied in two places (route: settleRoutePlace; everything else: followPlace); if view-wiki.js / view-chat.js ever come into scope, one line in openWikiPage / openConversation would replace both.
Status: DONE_WITH_CONCERNS

## Fix round 3 (review-r1.json, Codex: F1, F2, F3 blocking)
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| F1 Wiki chosen from Activity opened Home (setSidebarPlace recorded a null key, followPlace overrode the choice) | The rule has ONE home now. router.js: `onNavigate(fn)`; `syncRoute` reports every call to its listeners before touching the address bar, the same hash or not. app.js: one listener applies `placeAfterNavigation(place, route.view)` (view-sidebar.js, pure; now also `dm`) and paints the rail + list when the place moved. Nothing moves on a render or on a route's completion: followPlace / navigationKey / the baseline in setSidebarPlace and settleRoutePlace are deleted. goPlace("wiki") from Activity therefore stands. | RED `node --test test/ui-t38-wiki-place.test.ts` exit 1: 8 pass / 5 fail - "T38-r3 F1" {view chat, place home}, "F2" place home after the second openWikiPage, "F3" "the late completion changes nothing" (place wiki after release), the pure-function `dm` case, and the design check (no onNavigate). GREEN `landfall heavy -- npm run test` exit 0, 1077/1077 (main merged). | b57e564 (RED), e7bc363 (GREEN) |
| F2 reopening the current page by a non-route entry kept the tree hidden | Every openWikiPage calls syncRoute at its start (view-wiki.js:128) even for the page on screen; the listener treats a `wiki` route as a navigation every time. | same | same |
| F3 a delayed route completion overrode a newer place | The place moves when the navigation STARTS (syncRoute precedes every await in openWikiPage and openConversation); completion does nothing, so #/dms chosen while GET /api/wiki/slow is pending wins; the symmetric case (a conversation's load finishing after a rail Wiki click) is covered by the same test. A conversation's own later address rewrites (view-chat.js:90,108 drop a dead `/m/<id>`) report the same conversation: the listener keys conversation navigations on `c:<slug>` / `dm:<handles>` and acts only on a change (reset by a wiki navigation, so returning to the same conversation from a page counts). | same | same |
Merge: `git merge origin/main` was "Already up to date" - origin/main sits at 082a954 while local `main` holds T-MG-36's 547db89 and T-MG-41; merged local `main` (the base branch the brief names) as 8d5b20e, clean, no conflicts.
Gate: typecheck exit 0; tests `landfall heavy -- npm run test` exit 0, 1077 pass / 0 fail (B-MG-32 is load-independent after T-MG-36); `landfall secrets` exit 1 with 12 findings: the 10 D-MG-8 baseline plus 2 new in test/cli/naming.test.ts:35-36, which came with the merge of main (T-MG-41), outside this task's files - reported, not fixed. Tree clean, no push.
Files: src/http/ui/js/router.js (onNavigate, syncRoute reports first), src/http/ui/js/app.js (listener next to paintRail; followPlace/settleRoutePlace and their call sites removed; views.sidebar back to renderSidebarList), src/http/ui/js/view-sidebar.js (placeAfterNavigation with `dm`; followPlace block removed; setSidebarPlace plain), test/ui-t38-wiki-place.test.ts (bootApp: held GETs, goNoWait, views; T38-r3 tests; the round-1 follow-on-render tests removed with the design they pinned - the behaviours they covered, page -> Wiki and conversation-from-Wiki -> Home and "a redraw keeps the choice", are asserted again in T38-r2/T38-r3), test/ui-r5-sec.test.ts (round-2 stub dep removed, harness back to its original body).
COD-3 note: three round-1 tests of this task (T38-r1) were removed, not weakened: they asserted the transition-keyed follow-on-render mechanism Codex rejected; their observable behaviours are re-asserted by T38-r2 and T38-r3 against the real route handler.
Status: DONE_WITH_CONCERNS

## Fix round 4 (review-r2.json, Codex: F4-F8 blocking; orchestrator's rule replaces navigation tracking)
Merge: `git merge main` first, as 6cbf966 (clean, landfall state files only). Commits: 0d03519 (RED), 7bcf336 (GREEN). No push.

### The rule as implemented (view-sidebar.js, one block next to the place)
1. Rail click / place route (rule 1): `setSidebarPlace(place)` sets the place AND records `renderedView = state.view`, so the next render derives nothing. `goPlace` now switches the view to chat BEFORE calling it (Activity -> Wiki keeps Wiki, r1 F1).
2. View transition (rule 2): `settlePlace()` is called at the top of `renderShell` (before the rail markup) and of `renderSidebarList`. If `state.view !== renderedView` it records the view and applies `placeAfterNavigation(place, view)`: wiki -> "wiki"; chat while "wiki" -> "home"; anything else keeps the place. One variable (`renderedView`), no route listening.
3. Explicit opening (rule 3): `placeOnOpen(view)` applies the same function even when the view does not change. Called by `openWikiPage` (unless `{ refresh: true }`), the new-page modal, the red [[link]] editor, and `openConversation`. Background: the SSE `wiki` callback calls `views.openWiki(slug, { refresh: true })` (F7); the SSE "conversation archived" move calls `openConversationInBackground(id)`, which skips the step.
4. Rail repaint (rule 4): `views.sidebar` is `() => { renderSidebarList(); paintRail(); }`, so every sidebar refresh repaints `on`/aria-current from (place, view); `renderShell` draws the rail from (place, view) after `settlePlace()` (F5).
5. Async completions (rule 5): `keepPlace()` records the view change of an async completion as seen without deriving: the failed page load in `openWikiPage` (falls back to chat) and the DELETE completion of a wiki page. A later, unrelated render therefore cannot move the place either.
Removed: `onNavigate` and the listener loop in router.js (syncRoute is byte-identical to main again), the `onNavigate` listener and `lastConversation` in app.js, the `placeAfterNavigation` import there.

### Every place where the place can change
| Where | Trigger | Sync? |
|---|---|---|
| view-sidebar.js `setSidebarPlace` | app.js `goPlace` (rail Home/DMs/Wiki click, `#/dms`, `#/wiki`, the "dms" keyboard shortcut), app.js `openPeopleDirectory` (`#/people`, before its first await) | yes, in the user's handler |
| view-sidebar.js `settlePlace` | `renderShell`, `renderSidebarList` (incl. `views.sidebar`) when the view changed since the last render | yes, in the render |
| view-sidebar.js `placeOnOpen` | `openWikiPage` (not refresh), new-page modal, red [[link]], `openConversation` (not background) | yes, in the synchronous start of the opener, next to `state.view =` |
| `keepPlace` | never changes the place; only marks a view change as seen | - |

### Why no async path can set the place
- No code awaits and then writes `sidebarPlace` directly; the four functions above are the only writers and none is called from a `.then` / after an `await` of a request in this task's code, except as listed next.
- `settlePlace` changes the place only on a VIEW TRANSITION. Every async completion that changes the view without an opening (failed page load, page delete) calls `keepPlace()` first, so its render sees no transition. Completions that only redraw (openWikiPage's page/history landing, openConversation's messages landing, SSE refreshes, presence ticks) leave `state.view === renderedView` and move nothing: F3, F6, F7 and "the conversation on screen archived" are tests of exactly that.
- `placeOnOpen` runs in the synchronous start of `openWikiPage` (when not editing there is no await before it; with an editor open it runs after the reader confirms "leave the editor", i.e. the reader's own action) and of `openConversation` (no await before it). One case is not purely a user event: callers that `await` a request and THEN call `openConversation` (applyRoute `chat` after `conversationBySlug`, `startDirect` after its POST, creating a channel). There the late completion puts a new conversation on screen; the place step is in the same synchronous run as that view change, so place and view never disagree. The route case is already guarded against newer navigation (`current()` and the hash check in applyRoute); the POST cases are pre-existing "late open" behaviour that this task does not change. Flagged below.

### Findings
| Finding | Fix | Test (RED on 0d03519, GREEN on 7bcf336) |
|---|---|---|
| F4 same conversation reopened from the Wiki place kept a sidebar without channels | `placeOnOpen("chat")` in `openConversation`: an explicit open from the Wiki place returns to Home even when the view and the conversation stay the same | "T38-r4 F4" ('wiki' !== 'home') |
| F5 Search -> the page on screen left rail-wiki unlit | `views.sidebar` repaints the rail on every refresh | "T38-r4 F5" (on false; the stub now also drops aria-current when the app root is rewritten, as a browser would) |
| F6 late `/m/<id>` cleanup of a conversation hid a newer page's tree | No route listening; the cleanup's `syncRoute` is address maintenance only | "T38-r4 F6" ('home' !== 'wiki') |
| F7 SSE refresh of the page on screen switched Home -> Wiki | `openWikiPage(slug, { refresh: true })` from sse-events.js skips `placeOnOpen`; the view is unchanged so `settlePlace` does nothing | "T38-r4 F7" ('wiki' !== 'home'; also asserts the refresh GET did happen) |
| F8 three T38-r1 tests removed in e7bc363 | Restored in their original position (see below) | 2 of 3 RED on the old code |
| r1 F1-F3 | Existing "T38-r3 F1/F2/F3" tests, unchanged, green | - |
Extra tests (written in the GREEN commit, discriminating by mutation): "T38-r4: opening another conversation (Cmd+K, a link) from the Wiki place ... returns to Home; a redraw does not"; "T38-r4: a page that fails to load falls back to the chat without a late jump of the place"; "T38-r4: the conversation on screen archived by somebody else ... without moving the reader's place".

### F8 / COD-3: restored and adapted tests
- "T38-r1: placeAfterNavigation - ..." restored verbatim.
- "T38-r1: a sidebar render after a wiki page opened ..." restored verbatim except its LAST step: a render with `state.activeId = 3` (another conversation, same chat view) used to expect "home"; it now expects "wiki". Why: under the orchestrator's rule a render is not a navigation and chat -> chat is no view transition; the move to Home on another conversation belongs to the explicit opening (`openConversation`), asserted by the new "T38-r4: opening another conversation" test against the real function. The behavioural intent (another conversation from the Wiki place lands in Home) is kept, on the path that really carries it.
- "T38-r1: app.js decides the place before drawing the rail and repaints the rail after every sidebar refresh": `followPlace()` became `settlePlace()` in the position check; the `views.sidebar` regex is the original, byte for byte; one assertion added (renderSidebarList settles first).
- "T38-r3: the rule has ONE home ..." (round 3, this task): its `onNavigate` expectations are inverted (router.js has none, app.js has no `onNavigate`/`lastConversation`), the followPlace/settleRoutePlace checks kept, two added (`settlePlace`, `placeOnOpen` exported by view-sidebar.js); title changed to say so. The round-4 rule removes `onNavigate` by design.
- Harness only: bootApp resets `state.view` to "chat" before the first `import("app.js")` (its boot render drew a half-seeded wiki view left by an earlier test and threw); fetch answers `/api/wiki`, `/api/conversations` and a failing `/api/wiki/broken`; EventSource listeners are captured.

### Mutation checks (COD-2), each reverted with `git checkout -- <file>`
- `if (!refresh) placeOnOpen("wiki")` -> unconditional: F7 fails.
- no `placeOnOpen("chat")` in openConversation: F4 and the Cmd+K test fail.
- background open does `placeOnOpen` too: the archived-conversation test fails.
- `views.sidebar: renderSidebarList` (no paintRail): F5, T38-r2, T38-r1 structure fail.
- no `keepPlace()` in the failed page load: the fallback test fails.
- `setSidebarPlace` / `keepPlace` not recording the view: 4 tests fail (T38 place rendering, collapsed storage, T38-r1 render, Cmd+K).
- goPlace sets the place before switching to chat: T38-r3 F1 fails.

### Gate
| Command | Result | Exit |
|---|---|---|
| `git merge main` | 6cbf966, clean | 0 |
| `npm run typecheck` | ok | 0 |
| `landfall heavy -- npm run test` | 1087 tests, 1087 pass, 0 fail | 0 |
First full run of the GREEN code: 2 fails in test/ui-c1-shell.test.ts (W4-S6-C, W2-S2-B) - they locate `export async function openConversation(id, focusMessageId)` by its exact header, and a third parameter had changed it. Fixed in code, not in that test: the signature is unchanged and the background open is a separate export, `openConversationInBackground`, registered in the views registry for sse-events.js. Rerun green.

### Files (this round)
- src/http/ui/js/view-sidebar.js: `renderedView`, `setSidebarPlace` (records the view), `settlePlace`, `placeOnOpen`, `keepPlace`; `settlePlace()` at the top of `renderSidebarList`; doc of `placeAfterNavigation`.
- src/http/ui/js/app.js: onNavigate listener and `lastConversation` removed; `settlePlace()` in renderShell before the rail; goPlace sets the place after the view switch; `views.sidebar` repaints the rail; `openConversationInBackground` registered.
- src/http/ui/js/router.js: `onNavigate` removed, `syncRoute` back to main's body.
- src/http/ui/js/view-wiki.js: `openWikiPage(slug, { refresh })` + `placeOnOpen`; `keepPlace()` on the failed load and after DELETE; `placeOnOpen` in the new-page modal.
- src/http/ui/js/view-chat.js: `placeOnOpen("chat")` / `keepPlace()` in openConversation's synchronous start; `openConversationInBackground`; `placeOnOpen("wiki")` for the red [[link]] editor.
- src/http/ui/js/sse-events.js: wiki refresh passes `{ refresh: true }`; the archived-conversation move uses `openConversationInBackground`.
- test/ui-t38-wiki-place.test.ts: as above.

### Concerns for the orchestrator
- Scope: view-wiki.js and sse-events.js are touched as the fix brief's rule 3 implies; view-chat.js (openConversation, red [[link]]) is touched too, outside both briefs' file lists - without it F4 cannot pass (the same conversation reopened from Wiki is not a view transition) and Cmd+K/links to another conversation would keep a sidebar without channels. This extends rule 3 to conversations ("an explicit conversation opening from the Wiki place returns to Home"); please confirm or decide.
- `openConversation` reached after an awaited request (startDirect, channel creation) applies the place step in that late continuation, together with the view change it makes; described above, not changed.
- UX consequence of `keepPlace` on a failed page load: a [[link]] to a page that fails to load leaves the Wiki place selected over the conversation the view falls back to (the rail shows Wiki, consistent with (place, view)); one rail click returns to Home.
- Pre-existing, not changed: openConversation's late `/m/<id>` cleanup (view-chat.js) rewrites the address to the conversation even when a wiki page is on screen by then (the F6 sequence ends with `#/c/general` in the address bar while the page is shown).
- The browser check is still the orchestrator's: rail order and states were verified only in the node harness.
Status: DONE_WITH_CONCERNS
