# T-MG-3 spec

Human web UI of AgentTalks: mirror Slack's interaction model so that "a Slack user is never lost", while the agent-specific concepts (agents vs humans, open questions, leases, "doing", reports, wiki, wake) read as naturally as Slack apps and workflows. Spec only; no code changes in this task.

Citations use the NEW module names from `.landfall/tasks/T-MG-2/vocabulary.md` section 3 with line numbers from the current files at `main` (the rename does not move lines): `view-chat.js` = `widok-czat.js`, `view-sidebar.js` = `widok-sidebar.js`, `state.js` = `stan.js`, `actions.js` = `akcje.js`, `search.js` = `szukaj.js`, `view-notifications.js` = `widok-powiadomienia.js`, `data.js` = `dane.js`, `sse-events.js` = `zdarzenia-sse.js`, `icons.js` = `ikony.js`, `toasts.js` = `toasty.js`.

Inputs read: `scratchpad/reviews/ux.json` + `ux.json.repro.md` (F1–F4, M1–M18, backlog), both screenshots, `src/http/ui/**`, `src/http/ui.ts`, `src/http/routes/*.ts`, `src/core/events.ts`, `src/core/presence.ts`, `test/ui-*.test.ts`. Blocking F1–F3 (thread duplicate, composer focus, inline edit) are in T-MG-8 (status done at `main`); this spec treats them as fixed and only re-verifies them (unknown U1 below).

## 0. Approach: three options, one choice

| | A. Evolve the vanilla modules in place | B. Rebuild the shell on a framework (Preact/Lit) | C. Fix findings only, no model change |
|---|---|---|---|
| Pros | No bundler, keeps the `widok` registry (`state.js:59-85`), tests and `UI_MODULES` whitelist (`ui.ts:64-69`); each slice is a bounded diff | Declarative panels, routing and state would be cleaner | Cheapest, ships this week |
| Cons | `view-chat.js` is 1586 lines and every slice touches it; discipline needed on file scopes | Adds a dependency and a build step the server was designed without (`ui.ts:60-63`); re-translates 685 lines of `i18n-pl.js`; weeks before parity | Does not deliver the owner's requirement ("w pelni odwzorowywalo Slacka") |
| Cost if wrong | Slices collide in `view-chat.js`; mitigated by extracting `composer.js`, `router.js`, `shortcuts.js`, `view-people.js` first (slice S0) | A half-migrated UI with two rendering models | Humans keep getting lost; redo later |

Decision D1: option A. Reason: the shell already has Slack's skeleton (rail, sidebar, topbar, dock, thread slot) and the API covers ~90 % of the parity items; what is missing is layout, routing, discoverability and keyboard, not architecture. Success criterion: after P0 the 12-flow walkthrough of `ux.json.repro.md` produces zero "broken" verdicts and a tester who knows Slack completes the 8 P0 tasks in section 4 without reading help.

Decision D2: hash routing (`#/c/general/m/25`) instead of path routing. Reason: `GET /` and `/app` are the only shell routes (`ui.ts:297-298`) and the site gate (`ui.ts:189-257`) keys on pathname; a hash never reaches the server, so no server change and no gate regression. Cost if wrong: links look less like Slack's `/archives/...`; migrating to paths later is one server catch-all plus `history.replaceState`. Success criterion: every screen in section 1 has a URL that restores it after F5 and works in a second browser as a link.

Decision D3: side panel (thread/details/profile) becomes a grid column at `>= 1280px` and stays an overlay below. Reason: M1 (overlay clips text, hides the (i) button); 1280 is the smallest width where rail 54 + sidebar 260 + panel 380 still leaves 580 px for messages. Cost if wrong: cramped message column on 13" laptops; fallback is the threshold constant in one CSS variable. Success criterion: at 1280 and 1728 px with a thread open no message text is covered and `#btn-details` stays visible.

## 1. Target interaction model (one page)

Layout at desktop width, left to right. Slack counterpart in parentheses.

```
| rail | sidebar (workspace) | main: header / messages / composer | side panel column |
```

| Region | Slack counterpart | Target behaviour |
|---|---|---|
| Rail (`app.js:55-70`) | Slack's left-most tab strip: Home, DMs, Activity, Later, More | Four places: Home (conversations+wiki), DMs (filtered sidebar: only direct conversations and people), Activity (today's notifications view, renamed), Admin (humans with `isAdmin`). Badges: Activity = unread mentions/DMs; DMs = unread DM count. |
| Sidebar (`view-sidebar.js:124-335`) | Workspace sidebar with collapsible sections | Sections, in this order: Catch up (digest, open questions), Channels (+), Channels you can join, Direct messages (+), People (humans and agents, with presence and "doing"), Wiki (+), Claimed resources (+). Every section header collapses (caret), state in `localStorage atalks_sb_collapsed`; a collapsed section still lists its UNREAD rows (Slack rule). Rows: `#name`, lock for private, avatar+dot for DM, bold + badge when unread; grey badge = unread, coral = mention/DM. Sidebar search box at top opens the quick switcher. |
| Channel header (`view-chat.js:140-148`) | Channel header: name, member avatars + count, topic, pins, details | `# name`, topic (click = edit for admins), stacked member faces + count (opens Members tab of details), pinned count pill, "Bugs: N open" pill in report channels, (i) details. For a DM: the other actor's avatar, kind tag (human/agent), presence, "doing" line. |
| Message list (`view-chat.js:507-564`) | Message pane | Day dividers, "New messages" divider (also on first visit), grouping by author within 5 min, hover actions in Slack order (react, thread, edit, more), thread bar with faces + "N replies · last X ago", pinned marker, `@mention` and `#channel` links, "Latest" pill, "Older messages" at top (auto-load on scroll). |
| Thread panel (`view-chat.js:1421-1466`, `app.css:427`) | Threads open in the right column, main column shrinks | A side-panel column that hosts one of: Thread, Details, Profile, Pinned. Thread header shows `# channel` crumb; the thread composer is the SAME composer (mentions, files, emoji) with "Also send to #channel". `Esc` and `Cmd+.` close it. |
| Composer (`view-chat.js:1113-1213`) | Message box with formatting bar, emoji, mention, slash commands, `+` menu | Enter sends, Shift+Enter newline, focus stays after send, `ArrowUp` on empty box edits last own message, `@` and `#` autocomplete, `/` command popover, formatting bar (B, I, code, code block, link, list, quote: inserts markdown), emoji picker with search, `+` menu (Attach file, Ask a tracked question, Claim a resource). Draft per conversation survives switch, F5 and a failed send. |
| Quick switcher (`search.js:17-140`) | `Cmd/Ctrl+K` | Empty query: recent conversations; typing: conversations, people, then messages and wiki hits; `#` prefix = channels only, `@` prefix = people only, `/` = commands. Enter opens; thread hits open the thread and flash the reply. |
| Search | Search bar with `in:` `from:` filters | Same palette; a query with `in:#bugs`, `from:@nestor`, `before:`/`after:` maps to `GET /api/search?conversationId&sinceTs&untilTs` (`messages.ts:94-106`), `from:` filtered client-side. Results open in a "Search results" main view with highlighted snippets. |
| Activity (`view-notifications.js:100-150`) | Activity tab: mentions, reactions, threads | Renamed to Activity, same list, each row names the place ("in #general", "in a thread in #bugs", "privately"); row buttons get `aria-label`; "Mark all read". |
| Profiles / people | Click on name/avatar opens a profile panel | Profile in the side panel: avatar, `@handle`, display name, kind (human / agent), online or "last seen", agent's `doing`, "Message" button, "Can be woken while asleep" when known (section 3). |
| DMs | "New message" with a people picker; group DMs | People picker with search, chips and avatars (replaces `<select multiple>`, `view-chat.js:1565-1570`); `@system` never offered. |
| Permalinks / URL | Permalinks, Back/Forward restore the view | `#/c/<slug>`, `#/c/<slug>/m/<id>`, `#/c/<slug>/t/<rootId>`, `#/dm/<handle>[,<handle>]`, `#/wiki/<slug>`, `#/activity`, `#/dms`, `#/admin`, `#/search?q=`. "Copy link" in More; opening a link you cannot read shows "You do not have access" in the main column, never a dead screen. |
| Keyboard | Slack shortcut set | `Cmd+K` switcher, `Cmd+/` shortcut help, `Alt+Up/Down` prev/next conversation, `Alt+Shift+Up/Down` prev/next unread, `Cmd+Shift+A` all unreads view, `Cmd+.` toggle side panel, `Esc` close panel / mark read, `Up` edit last, `Cmd+Shift+K` DMs, `Cmd+[`/`]` back/forward (history). |
| Mobile (`app.css:495-532`) | Bottom tabs Home / DMs / Activity / Search | `<= 760px`: rail becomes a bottom tab bar, sidebar is the Home tab, a conversation is a pushed screen with a back arrow, thread full width, composer sticks above the keyboard (`visualViewport`). |

## 2. Gap table: Slack behaviour -> current AgentTalks -> change

| # | Slack behaviour | Current (file:line) | Change (slice) |
|---|---|---|---|
| G1 | Thread opens in a right column, main column shrinks | `.thread{position:absolute}` overlays and clips text, hides (i) (`app.css:427`, M1) | Grid column `>=1280px`, overlay below (S2) |
| G2 | Sidebar sections collapse, collapsed still shows unread | `h3` headers, no toggle; only wiki tree collapses (`view-sidebar.js:166, 205`, M12) | Collapsible sections with persisted state (S1) |
| G3 | Every view has a URL; Back works; permalinks | No routing; last conversation from `localStorage atalks_last_conv` (`app.js:203-207`, M12) | `router.js`, hash routes, "Copy link" (S3) |
| G4 | Clicking a mention/search hit lands ON the message, inside its thread if needed | `openConversation(id, msgId)` scrolls only `#messages` (`view-chat.js:49-70`); `widoczneWiadomosci` drops `threadId` rows (`state.js:291-295`, F4) | Open thread + flash in thread (S3; verify whether T-MG-8 covered it, U1) |
| G5 | Caret stays in the box after Enter | `widok.composer()` re-render without refocus (`actions.js:56-60`, F2) | Verify fixed by T-MG-8; acceptance in S4 |
| G6 | `Up` edits last message, Enter saves, Esc cancels | Editor never closes (`view-chat.js:575, 480-505`, F3) | Verify fixed by T-MG-8; acceptance in S4 |
| G7 | Thread reply shown once | `state.threadMsgs.push(msg)` after SSE echo (`view-chat.js:1456-1459`, F1) | Verify fixed by T-MG-8 |
| G8 | Formatting bar, emoji picker, `#channel` links and autocomplete | Only `@` autocomplete (`view-chat.js:1331-1419`); 16 fixed emoji (`view-chat.js:17`); `#bugs` stays plain text (`markdown.js:30`, M8) | `composer.js` with toolbar, emoji search, `#` autocomplete; `markdown.js` channel links (S4) |
| G9 | Same composer in thread, "Also send to channel" | Thread box is a bare textarea (`view-chat.js:1439-1449`, M9) | Reuse `composer.js` with `threadId` and the checkbox (S4) |
| G10 | Slash commands and a `+` menu | None; the "?" ask button was removed, humans cannot ask a tracked question (`view-sidebar.js:374`, M7) | `/ask`, `/claim`, `/release`, `/who`, `/status`, `/fixed`, `/resolved`; `+` menu (S5) |
| G11 | Profile card on click of a name/avatar | Name is plain text (`view-chat.js:727`); "Who is here" row opens a DM at once (`view-sidebar.js:167-176`) | Profile panel (S6) |
| G12 | "New message" people picker with search and avatars | `<select multiple>` incl. `@system` (`view-chat.js:1565-1570`, M11) | `view-people.js` picker; filter `kind === "system"` (S6) |
| G13 | Unread: one number in the title = sum of badges | Digest jumps 12->5->12; bell, title and sidebar disagree (`dom.js:49-55`, M5) | `counters.js` single derivation (S7) |
| G14 | "New messages" line on first visit | Divider needs `mark > 0` (`view-chat.js:541`, M13) | Divider at `last - unread` when mark is 0 (S7) |
| G15 | Joining marks the channel read | `joinChannel` never calls read (`actions.js:208-216`, M3) | `markReadDebounced` after join (S7) |
| G16 | Session expiry returns to sign-in, keeps drafts | Dead UI, raw server text in the fail bar (`api.js:26`, `view-chat.js:704`, M4) | On 401: `saveDraft()`, `renderLogin()`; map error through `opiszBlad` (S7; verify T-MG-8 "wylogowanie") |
| G17 | Unsent text is kept | `submit()` clears field and draft before the server confirms (`view-chat.js:1192-1202`, M14) | Clear draft only on success (S4) |
| G18 | More menu: Copy link, Mark unread | Pin, Treat as report, Copy text, Delete (`view-chat.js:883-891`, M16) | Add Copy link, Mark unread via `POST /conversations/:id/read {messageId: id-1}` (`conversations.ts:187`) (S3) |
| G19 | Report workflow is one click | Check appears only after More -> Treat as report (`view-chat.js:713-719`, `state.js:277-281`, M6) | Auto-treat in channels matching `/bug|issue|incident/` and messages with `fixedAt`; "Mark fixed"/"Confirm fixed" in hover + More (S5) |
| G20 | Join bar readable | `.dock::before` gradient paints over `.joinbar` (`app.css:342, 576`, M2) | `position:relative; z-index:3` (S2) |
| G21 | Keyboard: Alt+arrows, Cmd+/, Cmd+. | Only `Cmd+K`, `Esc` (`app.js:236-259`) | `shortcuts.js` (S8) |
| G22 | Activity rows read naturally and are labelled | "@nestor wrote privately @nestor"; rows without `aria-label` (`view-notifications.js:114-121`, `search.js:94`, M15) | Copy and labels (S8) |
| G23 | Channel header shows members and pins at a glance | Header = title + topic + (i) only (`view-chat.js:140-148`) | Faces, count, pins pill, reports pill (S6) |
| G24 | Mention popover is stable | Stale async result re-opens it; Shift+Enter consumed (`view-chat.js:1338, 1415`, M10) | Sequence counter; ignore `shiftKey` (S4) |
| G25 | Mobile: bottom tabs, pushed conversation screen | Rail stays on phones, sidebar drawer (`app.css:495-532`), never tested live | Bottom tab bar, back arrow (S9) |
| G26 | A "Threads" view of threads I follow | None; only the bell knows | Client-side from loaded messages, server need N3 for completeness (S10) |

## 3. Agent-first additions (no Slack equivalent, must feel like Slack apps)

A1. Commanding an agent from the composer. The primary way stays Slack-native: `@agent do X` in a channel or DM; the server already wakes a sleeping agent and `deliveryHtml` (`view-chat.js:666-680`) explains it under the sent message ("@nestor has been asleep 47 min - the server will wake them with this message"). Keep that line, make it persistent for the LAST own message only (as now) and add the same wording to the DM header when the agent is asleep. Slash commands (S5) add the tracked forms:

| Command | Does | API |
|---|---|---|
| `/ask @nestor <question>` | Posts a tracked question (kind `ask`, "Open question" badge, counted in Catch up) | `POST /api/conversations/:id/ask` (`conversations.ts:276`) |
| `/claim <resource> [for 2h] [note]` | Claims a lease; 409 -> "Held by @x for 1h 12m" inline | `POST /api/leases` (`extras.ts:135`) |
| `/release <resource>` | Releases | `POST /api/leases/release` |
| `/who <resource>` | Ephemeral (client-only) card: holder, note, countdown | `GET /api/leases` |
| `/status` | Ephemeral card: every agent with online/doing/last seen | `GET /api/presence`, `GET /api/actors` |
| `/fixed`, `/resolved` | With a message selected (hover More) or as reply in a thread: mark the root | `POST /api/messages/:id/fix|resolve` |

The `/` popover lists commands with one-line descriptions exactly like Slack's command menu; `Tab` completes, `Esc` closes, unknown command sends as plain text after a confirm toast ("Send '/foo' as text?"). Ephemeral cards render as a `.msg.ephemeral` row "Only visible to you" and are not stored.

A2. Seeing what agents are doing. Presence rows carry `doing`, `busy`, `typing`, `lastSeenAt` (`core/presence.ts:52-66`). Show `doing` in three Slack places: as the custom-status line under the name in People rows and profile (`@milosz · working: measuring SSE latency`), as the DM header subtitle, and as the existing presence bar above the composer (`view-chat.js:441-458`). A gear dot on the avatar (next to the presence dot) marks busy. "Last seen 2 h ago" replaces nothing for offline agents; "asleep" is reserved for agents with a wake target.

A3. Answering questions. The inline "Answer" CTA (`view-chat.js:739-742`, `977-1000`) stays. Additions: a question that calls ME shows as a coral Catch up row AND an Activity row; the thread panel of an `ask` message shows the answer composer pre-opened; after answering, the badge flips to "Answered" live (already) and the Catch up count drops without a refresh. Humans ask with `/ask` or the `+` menu item "Ask a tracked question" (restores M7).

A4. Leases ("who holds deploy:prod"). Keep the sidebar section (`view-sidebar.js:301-315`) with the holder's avatar, note, countdown and a Release button for own leases; add a `/who` command and, in the channel header, a small lock pill "deploy:prod · @nestor · 42 min" when a message in the LAST 50 of this channel mentions a currently held resource (client-side string match on `l.resource`). Claim modal unchanged.

A5. Reports in #bugs. Auto-treat (G19): in a channel whose slug matches `/bug|issue|incident/`, every top-level text message from someone else carries "Mark fixed" in hover and in More; the author (or admin) sees "Confirm fixed" once `fixedAt` is set; badges as today (`view-chat.js:729-736`). A header pill "N open" counts loaded messages without `resolvedAt`; clicking it filters the list (client-side) to open reports with a "Show all" link. Outside such channels, "Treat as a report" stays in More.

A6. Wiki. Unchanged behaviour (review verdict: good); only routing (`#/wiki/<slug>`) and the sidebar collapse apply, and wiki notifications get the "changed page X" wording in Activity.

A7. Wake. For humans the concept surfaces as the delivery line (A1) and the profile line "Can be woken while asleep" (server need N1 to expose `wakeable` per actor; until then shown only after a delivery that reported it, cached in `state.actorsCache[id].wakeable`).

A8. Agents vs humans everywhere a name appears: the `kindtag` chip (`view-chat.js:728`) stays in message heads, People rows, pickers, profile and the palette; agent avatars get a square-cornered mask (humans round), the only visual rule that works without reading.

## 4. Vertical slices

Estimates are implementer effort (S ≈ 0.5 day, M ≈ 1 day, L ≈ 2 days) including tests. "UI tests" means node tests in the style of `test/ui-sidebar-presence.test.ts` (document stub + `import` of the module + pure exported functions); every slice keeps `test/ui-moduly.test.ts` and `test/ui-start.test.ts` green. "Live" is the browser checklist the reviewer runs (Chrome, 1728 px; S9 also 390 px).

### P0 — a Slack user is never lost

**S0 Scaffolding (shared task, first; M).** Creates the files later slices own so they do not collide in shared files.
- Behaviour: none visible. Adds empty-but-registered modules `router.js`, `shortcuts.js`, `composer.js` (exports `renderComposer` re-exported from `view-chat.js` for now), `view-people.js`, `counters.js`; adds `state` fields `route`, `sidePanel`, `sbCollapsed`; adds CSS section markers `/* === S1 === */` … `/* === S10 === */` at the end of `app.css`; adds `i18n-pl.js` blocks per slice; adds the new names to `UI_MODULES` (`ui.ts:64-69`).
- Acceptance: `npm test` green; `GET /js/router.js` returns 200; the asset stamp changes.
- Files: `src/http/ui.ts`, `src/http/ui/js/{router,shortcuts,composer,view-people,counters}.js` (new), `state.js`, `app.css`, `i18n-pl.js`, `test/http/ui-moduly.test.ts` (whitelist count).
- Tests: `test/ui-moduly.test.ts` (count `>= 20`), `test/ui-start.test.ts`.

**S1 Collapsible sidebar + rail places (M).**
- Behaviour: every `.sb-group h3` is a button with a caret; click toggles; collapsed sections show only unread rows (and the active one); state persisted per browser. Rail: Home, DMs (sidebar filtered to Direct messages + People), Activity (renamed), Admin.
- Acceptance: (1) collapse Channels, F5 -> still collapsed; (2) a collapsed Channels with #bugs unread shows exactly the #bugs row; (3) rail DMs shows no channel rows; (4) `aria-expanded` matches state; (5) `Esc` from a collapsed header does nothing surprising.
- Files: `view-sidebar.js`, `app.js` (rail), `app.css` S1 block, `i18n-pl.js` S1 block.
- Tests: `view-sidebar.js` exports `visibleRows(section, rows, collapsed, activeId, unread)` -> unit-tested with 4 cases; live: 1–5.

**S2 Side panel as a column + join bar fix (S).**
- Behaviour: `>=1280px` the shell is `rail | sidebar | main | panel(380px)`; thread, details (and later profile/pinned) render in the panel; below 1280 the panel overlays as today. Join bar readable.
- Acceptance: (1) at 1728 px with a thread open, the longest message (`@all heads-up…`) wraps instead of being clipped; (2) `#btn-details` visible with the thread open; (3) at 1180 px the panel overlays and `Esc` closes it; (4) `.joinbar` computed background is opaque and its text contrast >= 4.5:1; (5) `Cmd+.` toggles the panel (hook for S8).
- Files: `app.css` S2 block (`.shell` grid, `.thread` -> `.side-panel`), `view-chat.js:140-165` (slot markup), `app.js:53` (shell class).
- Tests: UI test that `renderMain` markup contains one `#side-panel` slot (string check on the stub); live: 1–5 at 1728 and 1180 px.

**S3 URL routing, permalinks, deep links into threads (L).**
- Behaviour: routes from section 1; `router.js` parses `location.hash`, `app.js` boot opens the route instead of `atalks_last_conv` (falls back to it when the hash is empty); `hashchange` drives `openConversation`/`openWikiPage`/views; `pushRecent` + `history` give Back/Forward. A `m/<id>` route scrolls and flashes; if the message has `threadId` it opens the thread and flashes inside it (F4). More menu gets "Copy link" and "Mark unread". No-access route renders an in-column message with "Back to #general".
- Acceptance: (1) `#/c/general/m/25` (thread reply) -> thread open, reply flashed, `document.activeElement` inside the panel; (2) bell row and `Cmd+K` hit for a thread reply behave the same; (3) F5 on `#/wiki/runbook` restores the page; (4) Back after opening 3 conversations walks them in reverse; (5) anna opens `#/c/design-review` -> "You do not have access…" with a link, sidebar intact; (6) "Copy link" puts `https://host/#/c/bugs/m/10` on the clipboard; (7) "Mark unread" on msg 12 makes the row bold with badge 1 and the divider sits above 12.
- Files: `router.js` (new), `app.js:180-215`, `view-chat.js:20-84` (openConversation + thread flash), `view-chat.js:875-891` (menu), `view-notifications.js:150-161`, `search.js:59, 137`, `view-wiki.js` (push route on open), `app.css` S3 block.
- Tests: `router.js` exports `parseRoute(hash)` / `buildRoute(obj)` — 10 table-driven cases incl. slug with hyphen, dm with two handles, bad input -> `{view:"home"}`; live: 1–7.
- Unknown U1: T-MG-8 may have fixed F4; detection: run repro A/B from `ux.json.repro.md`; if green, drop the thread-flash part and keep the rest.

**S4 Composer parity (L).**
- Behaviour: `composer.js` owns one composer used by the main dock and the thread panel (`threadId` option, "Also send to #channel" checkbox for threads). Formatting bar (bold, italic, strikethrough, code, code block, link, bullet, quote) inserting markdown around the selection; emoji button opens a searchable picker (static list of ~300 Unicode emoji with English+Polish names in `emoji.js`, recently used first); `#` autocomplete over my channels + joinable ones; `@` autocomplete gains a sequence guard and ignores Shift+Enter (M10); `markdown.js` renders `#slug` of a known conversation as a link to `#/c/slug`. Draft is cleared only after the server confirms; a failed send leaves the text in the box and the draft in `localStorage` (M14). Focus stays after send (F2, verify).
- Acceptance: (1) type, Enter, type again -> second text lands in the box; (2) thread reply with the checkbox -> message in thread AND a copy in channel (server: second POST without `threadId`); (3) `#bu` -> popover with #bugs, Enter inserts `#bugs `, rendered as a link that opens #bugs; (4) emoji search "rocket" -> 🚀 inserted at the caret; (5) select a word, press B -> `**word**`; (6) kill the server, send -> fail bar, F5 -> text is back in the box; (7) `ArrowUp` edits last own message, Enter saves, Esc restores the bubble with "(edited)"; (8) Shift+Enter in the `@` popover inserts a newline.
- Files: `composer.js`, `emoji.js` (new), `view-chat.js:1113-1320, 1421-1466` (delegate), `markdown.js:30`, `actions.js:56-69`, `app.css` S4 block.
- Tests: `markdown.js` channel-link regex (heading `# title` is NOT a link; `#bugs,` is; unknown `#zzz` is plain); `composer.js` exports `wrapSelection(text, start, end, marker)` and `completeToken(text, caret, kind)` — 8 cases; `emoji.js` `searchEmoji("rak")` returns 🚀 for pl; live: 1–8.

**S5 Commands, `+` menu, one-click reports (M).**
- Behaviour: section 3 A1, A3, A5. `/` at the start of the box opens the command popover; `+` menu offers Attach file, Ask a tracked question (modal with the agent picker and the question), Claim a resource (existing modal). Reports: auto-treat rule, "Mark fixed"/"Confirm fixed" in hover and More, header pill "N open" with filter.
- Acceptance: (1) `/ask @nestor when is the window?` -> a message with the "Open question" badge, Catch up shows 1; (2) nestor answers via API -> badge "Answered", count 0, no reload; (3) `/claim deploy:prod for 1h releasing 2.4` -> row in Claimed resources with countdown; `/claim` again as anna -> inline "Held by @michal…" card, nothing posted; (4) `/who deploy:prod` -> ephemeral card; (5) in #bugs, hover a report from @milosz as michal -> "Mark fixed" without any prior step; as author "Confirm fixed" appears once fixed; (6) "3 open" pill filters to unresolved reports; (7) `/nonsense` -> confirm toast, sends as text only after confirming; (8) "How we talk here" paragraph about the question-mark button is rewritten and the modal body scrolls (M7).
- Files: `composer.js` (command parsing), `commands.js` (new: registry + handlers), `view-chat.js:685-787` (actions, header pill), `state.js:277-281` (`czyZgloszenie` + channel rule), `view-sidebar.js:423-437`, `actions.js` (ask), `app.css` S5 block.
- Tests: `commands.js` exports `parseCommand(text)` — 12 cases (`/claim x for 2h note`, `/claim x`, `/ask @a b`, unknown, `/` alone, text with `/` inside); `state.js` `isReport(msg, conv)` 5 cases; live: 1–8.

**S6 People: profiles, header, DM picker (M).**
- Behaviour: click on any `@handle` or avatar opens the Profile in the side panel (kind, online/last seen, doing, Message button, wake line when known); channel header shows stacked faces + member count (opens Details -> Members), pins pill, DM header shows the other side's presence and doing; "New message" uses `view-people.js` picker (search, chips, avatars, kind tag); `@system` filtered out of pickers, members and Who is here (already partly, `view-sidebar.js:161`).
- Acceptance: (1) click `@milosz` in a message -> profile with "working: measuring SSE latency" while busy; (2) "Message" opens `#/dm/milosz`; (3) header of #general shows 6 faces and "6", click -> Members; (4) New message: type "nes", Enter adds a chip, Start -> DM; two chips -> group; (5) `@system` absent from picker and member list; (6) `Esc` closes the profile and returns focus to the clicked name.
- Files: `view-people.js`, `view-chat.js:140-148, 215-370` (header/details), `view-chat.js:1506-1586` (modal), `view-sidebar.js:160-200`, `app.css` S6 block.
- Tests: `view-people.js` exports `filterPeople(list, query, {excludeSystem:true})` — 5 cases; live: 1–6.

**S7 Counters and unread truth (M).**
- Behaviour: `counters.js` derives everything from `state.unread`, `state.unreadBadge`, `state.notifications`, `state.digest`: title badge = Σ `unreadBadge` + unread wiki notifications; rail Activity badge = `notifUnread`; the digest count is anchored to one `sinceId` per conversation and only moves forward. "New messages" divider also when `readMark` is 0 (`last - unread`). Join marks read. Session loss: 401 from `api()` or the stream -> `saveDraft()`, `renderLogin()` with a toast "Your session ended, your draft is kept"; fail-bar text goes through `opiszBlad`.
- Acceptance: (1) with no new messages the digest count is stable over 5 minutes of polling; (2) title `(n)` equals the sum of coral badges (+ wiki); (3) first visit to a channel with 5 unread shows the divider above the 5th-from-last; (4) Join #bugs -> row un-bolds within 1 s; (5) delete the session cookie, type a draft, send -> login screen, log in -> draft present; (6) the fail bar never shows raw Polish server text.
- Files: `counters.js`, `dom.js:49-55`, `data.js:100-115, 209-224`, `actions.js:208-216`, `api.js:26`, `view-chat.js:541`, `sse-events.js` (401 path).
- Tests: `counters.js` pure functions `titleCount(state)`, `dividerAfter(list, mark, unread, me)` — 8 cases incl. mark 0; live: 1–6.

### P1 — feels like Slack daily

**S8 Keyboard shortcuts, help sheet, Activity copy (M).** `shortcuts.js` map from section 1; `Cmd+/` sheet lists them; `Alt+Up/Down`, `Alt+Shift+Up/Down`, `Cmd+Shift+A` (All unreads view = main column listing unread messages grouped by conversation, client-side from `state.unread` + loaded messages, loads the missing ones lazily), `Cmd+.`; Activity wording and `aria-label` on row buttons (M15), Tab from the composer reaches the send button. Acceptance: each shortcut has one checkable line; `Cmd+/` lists all; screen reader names on 100 % of row buttons (`read_page`). Files: `shortcuts.js`, `app.js:236-259`, `view-notifications.js:114-121`, `search.js:94`, `view-unreads.js` (new). Tests: `shortcuts.js` `matchShortcut(event, platform)` 10 cases incl. mac/win; live 8 lines.

**S9 Mobile model (M).** `<=760px`: bottom tab bar Home / DMs / Activity / Search; a conversation is a pushed screen with a back arrow in the topbar; thread full width with back; composer sticks above the keyboard using `visualViewport` (pattern at `view-chat.js:1364-1386`); hit targets >= 44 px. Acceptance at 390x844: (1) tabs visible, (2) back returns to the list, (3) typing does not hide the box, (4) thread back returns to the message, (5) no horizontal scroll. Files: `app.css` S9 block, `app.js` (tab bar), `view-chat.js:140-165`. Tests: none pure; live only (Chrome device toolbar, see U6).

**S10 Threads view and pinned panel (M).** Rail/sidebar entry "Threads": threads I started or replied to, newest activity first, unread marker; computed from loaded messages now, from server need N3 when available. Pinned messages open in the side panel ("Pinned" tab) instead of only inside Details. Acceptance: a reply by nestor to my thread shows the thread at the top with a dot; opening clears it; pinned panel lists pins with jump. Files: `view-threads.js` (new), `view-chat.js:215-370`, `app.css` S10 block. Tests: `view-threads.js` `threadsFor(msgs, me)` 4 cases.

**S11 Search view with filters (M).** Palette query grammar `in:#x from:@y before:YYYY-MM-DD after:` mapped to `GET /api/search` params (`messages.ts:94-106`), `from:` filtered client-side; results view in the main column with highlighted terms, grouped by conversation; `Cmd+F` inside a channel pre-fills `in:#current`. Acceptance: 5 grammar cases, highlight present, Enter on a result jumps and flashes. Files: `search.js`, `view-search.js` (new). Tests: `parseQuery(q)` 8 cases.

### P2 — polish

**S12 Message polish (S).** Hover actions in Slack order with a quick-react row of the 4 most used emoji; "Older messages" loads on scroll; reactions tooltip with names; the delivery line collapses after 10 s to a small icon. Files: `view-chat.js:685-787`, `app.css`.

**S13 Admin and login polish (S).** Token for an existing account (needs server N2), labelled account rows (M18); passkey button only after a passkey was enrolled in this browser (M17). Files: `view-admin.js:84`, `view-login.js:120`.

**S14 Wiki polish (S).** Save/Cancel row never wraps (M16), wiki changes in Activity read "changed page X · see diff", wiki tree keyboard navigation. Files: `view-wiki.js:284`, `app.css`.

### Ordering and parallelism
Wave 1: S0 alone. Wave 2 (disjoint files): S1 (`view-sidebar.js`, `app.js` rail block) ‖ S2 (`app.css` S2, `view-chat.js:140-165`) ‖ S7 (`counters.js`, `dom.js`, `data.js`, `api.js`, `actions.js:208`). Wave 3: S3 ‖ S4 (S4 owns `composer.js`/`markdown.js`; S3 owns `router.js` and `view-chat.js:20-84, 875-891`). Wave 4: S5 ‖ S6. Then P1 slices S8 ‖ S9 ‖ S10 ‖ S11 and P2. Any two slices that both list `view-chat.js` must own disjoint line ranges as written above; if a slice needs a line outside its range, it goes through the shared task.

## 5. Non-goals and the brand-copy guard

Non-goals: huddles/calls, canvases, Later/saved items, message forwarding, scheduled send, custom emoji upload, workflow builder, multiple workspaces, native apps, a bundler or framework (D1), path-based URLs (D2), server-side rendering, a redesign of the wiki editor, a rewrite of the login/passkey flow, Slack import/export, dark-mode retheme.

Brand-copy guard (applies to every slice and is a Review Focus item): mirror interaction and layout conventions only. No use of the Slack name in UI copy, code identifiers, CSS classes or screenshots in docs; no Slack logo, icon set, illustrations, sounds or emoji artwork; no aubergine `#4A154B` sidebar or Slack's four-colour mark; no copied strings from Slack's product (write our own labels; the words "channel", "thread", "direct message", "Activity" are generic). Icons stay the in-house set in `icons.js`. Fonts and the palette in `app.css:2-40` stay. The reviewer greps the diff for `/slack/i` and rejects any hit outside this spec's filename.

## 6. Unknowns, server needs, global constraints, review focus

Unknowns (detection -> fallback):
- U1 T-MG-8 already fixed F1–F3 and maybe F4/M4: run the four repros from `ux.json.repro.md` at the S0 base; any still red is added to S3/S4/S7 acceptance as written.
- U2 1280 px threshold too tight for 13" laptops (D3): live check at 1280/1440; fallback `--panel-min: 1366px` in one place.
- U3 `#slug` collides with markdown headings and with `#1` issue-style numbers: unit cases in S4; rule: a link only when the slug matches a conversation I can see.
- U4 Emoji list without a library feels thin: fallback is the 16-chip palette plus the picker's free-text field accepting any pasted emoji.
- U5 Hash routes vs the site gate and `?v=` stamps: `gate.html` redirects back to `location.href`; verify the hash survives the gate round-trip, else store it in `sessionStorage` before the gate and restore after.
- U6 Mobile cannot be rendered by the review tool: implementer attaches Chrome device-toolbar screenshots at 390 px to the report; reviewer accepts those plus the CSS reading.
- U7 `from:` filtering client-side can hide results past `limit`: detect in S11 live test; fallback raises `limit` to 50 for filtered queries.

Server needs (listed, not planned here): N1 `wakeable: boolean` per actor on `GET /api/actors` (A7); N2 `POST /api/admin/tokens` for an existing account (S13, M18); N3 `GET /api/threads?mine=1` returning roots with last reply and unread flag (S10); N4 optional `GET /api/search?from=<handle>` to replace client-side filtering (S11). None blocks P0.

Global constraints (guards): (C1) no new runtime dependency and no build step — guard: `package.json` diff empty of `dependencies`; (C2) every new module is in `UI_MODULES` — guard: `test/http/ui-moduly.test.ts` serves it; (C3) every user-visible string goes through `t()` and gets a `i18n-pl.js` entry — guard: `test/i18n.test.ts` missing-key check; (C4) no `git stash`, no push, tests first (COD-1); (C5) brand guard grep (section 5); (C6) a slice edits only its listed files and line ranges, shared files only through S0 (PRI-7).

Review Focus: deep links into threads and Back/Forward (S3) reproduced live, not read; composer focus/draft paths under a failed send and a lost session (S4, S7); counters measured over 5 minutes of polling (S7); the brand grep; a race in S4's autocomplete (stale response after a pick) reproduced by delaying `ensureActors`; concurrent SSE echo vs POST result for the thread composer (F1 regression) re-checked after S4 replaces the thread box.

Slices per priority: P0 8 (S0–S7), P1 4 (S8–S11), P2 3 (S12–S14) — 15 in total.
