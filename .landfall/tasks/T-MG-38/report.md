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
