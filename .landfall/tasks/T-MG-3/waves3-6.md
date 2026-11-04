# T-MG-3 waves 3-6 (parallel agents, disjoint files, one worktree, no git)
Read first: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-3/slice-common.md, then YOUR slice in docs/superpowers/specs/2026-11-04-ui-slack-parity.md section 4 (in the worktree /Users/michal/Documents/Code/AgentTalks-wt/T-MG-3). Earlier waves are committed (S0 scaffolding, S0b Primer, S1, S2, S7, ...): build on them, use Primer tokens/classes and Octicons only. Edit ONLY your files, your app.css block /* === Sn === */ and your i18n-pl.js block. Need another file -> NEEDS_CONTEXT. Run no git.

## Notes for every wave (orchestrator)
- The server caches CSS (readOnce): restart your server after a CSS edit before checking live.
- Live-check tools (read their headers): /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/ux/seed-serve.sh `<repo> <port>` (seeded instance; login michal / ux-review-2026; stop: `seed-serve.sh stop <port>`) and .../scratchpad/ux/shots.mjs `<scenario.json> <outDir>` (headless Chrome PNGs + console errors; example scenario .../scratchpad/ux/w1-scenario.json). Put your shots under .../scratchpad/ux/<slice>-shots/.
- Error codes are English (src/core/error-codes.ts); test fixtures use English codes; no Polish words in code, comments or tests (test/language.test.ts), Polish only as values in i18n-pl.js.
- Spacing and type in rules you touch: Primer tokens, not literal rem.
- Follow-ups assigned to your slice: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-3/followups.md lines naming your slice (S8: W2-S1-A, W2-S1-C, W2-S2-A; S9: W2-S1-B; S12: W1-C). Do them within your files.

## Wave 3
| Slice | Files | Port | Test |
|---|---|---|---|
| S3 routing, permalinks, thread deep links, Copy link / Mark unread | src/http/ui/js/router.js, app.js boot/hashchange block, view-chat.js openConversation + thread flash (spec 20-84) and More menu (spec 875-891), view-notifications.js navigation call, search.js navigation call, view-wiki.js route push | 18974 | test/ui-s3-router.test.ts |
| S4 composer parity (formatting bar, emoji picker, #channel autocomplete + links, thread composer reuse, also-send-to-channel, draft safety, mention popover race) | src/http/ui/js/composer.js, src/http/ui/js/emoji.js (new, add to UI_MODULES in ui.ts - the ONLY ui.ts edit allowed), view-chat.js composer region (spec 1113-1320) and thread box (1421-1466), markdown.js channel links, actions.js sendMessage only | 18975 | test/ui-s4-composer.test.ts |

## Wave 4
| Slice | Files | Port | Test |
|---|---|---|---|
| S5 slash commands, + menu, one-click reports, ask restored | src/http/ui/js/commands.js (new, add to UI_MODULES), composer.js command hook only (call into commands.js), view-chat.js message actions + header pill (spec 685-787), state.js isReport, view-sidebar.js HOW_WE_TALK text, actions.js ask | 18976 | test/ui-s5-commands.test.ts |
| S6 people: profiles, header faces, DM people picker, @system hidden | src/http/ui/js/view-people.js, view-chat.js header + details (spec 140-148, 215-370) and new-DM modal (1506-1586), view-sidebar.js people rows (160-200) - coordinate: S5 edits view-sidebar HOW_WE_TALK only | 18977 | test/ui-s6-people.test.ts |

## Wave 5 (P1)
| Slice | Files | Port | Test |
|---|---|---|---|
| S8 shortcuts, help sheet, all-unreads view, Activity copy + aria labels; follow-ups W2-S1-A, W2-S1-C, W2-S2-A | src/http/ui/js/shortcuts.js, view-unreads.js (new, UI_MODULES), app.js key handler block + the DMs rail badge line (railBadges), view-notifications.js copy/labels, data.js the #rail-notif aria-label line only, view-chat.js closeThread only | 18978 | test/ui-s8-shortcuts.test.ts |
| S9 mobile model (bottom tabs, pushed conversation screen, keyboard-safe composer); follow-up W2-S1-B | app.css S9 block AND the shell grid rule's rail column width (one value), app.js tab bar block, view-chat.js topbar back button only | 18979 | test/ui-s9-mobile.test.ts (markup unit test) + live at 390x844 |
| S10 threads view + pinned panel | src/http/ui/js/view-threads.js (new, UI_MODULES), view-chat.js pinned panel hook (details region) | 18980 | test/ui-s10-threads.test.ts |
| S11 search view with filters (also: search.js row labels/aria from S8's list, and follow-up W3-S3-A: #/search?q= applies q) | src/http/ui/js/search.js (query grammar + row labels), src/http/ui/js/view-search.js (new, UI_MODULES), app.js applyRoute search branch only | 18981 | test/ui-s11-search.test.ts |
UI_MODULES in src/http/ui.ts: each slice that adds a module appends exactly one line; if two slices race on it, the orchestrator merges.

## Wave 6 (P2 + clean-up): five agents in parallel
Follow-up IDs refer to /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-3/followups.md (read the lines you own; each is a concrete defect with its fix). Every follow-up you own gets a test (unit or source assertion) or a live shot as evidence in your report. Test file: test/ui-<slice>.test.ts (e.g. test/ui-c1-shell.test.ts).
| Slice | Owns follow-ups | Files | Port |
|---|---|---|---|
| C1 navigation and shell clean-up | W5-S11-A, W5-S11-B, W5-S11-C, W5-S8-A, W5-S8-C, W5-S10-A, W5-S10-B, W5-S10-C, W5-S10-D, W4-S6-C, W2-S2-B | app.js, router.js, view-threads.js, view-unreads.js, view-search.js, shortcuts.js, data.js, view-chat.js ONLY renderMain/openConversation/sidePanel-listener regions (S12 owns message render + actions), view-sidebar.js ONLY a "Threads" row under the header, app.css C1 rules appended at the end of the S8 block | 18985 |
| C2 state, components and CSS clean-up | W2-S7-A, W2-S7-B, W2-S7-C, W1-A, W1-B, W3-S4-A, W3-S4-C, W4-S6-B, W4-S6-D, W4-S5-A, W5-S8-B, W5-S9-A | state.js, counters.js, api.js, toasts.js, dom.js, emoji.js + new emoji-names-pl.js (UI_MODULES line), composer.js, commands.js, view-sidebar.js ONLY the badge number and the claim modal export, app.css base rules (outside the per-slice blocks) and the dead S1 caption rule, test/language-allowlist.txt | 18986 |
W1-A scope guard for C2: tokenise spacing/font sizes in base rules mechanically (no visual change beyond rounding to the nearest Primer step); W1-B: apply Primer Counter/Label/tooltip look where the markup is produced in your files (dom.js helpers), elsewhere list what remains.

| Slice | Files | Port |
|---|---|---|
| S12 message polish, also owns W1-C and W4-S6-A (author name and avatar become buttons that open the profile) (hover actions order, quick reactions, auto-load older, reaction tooltips; mention highlight uses the danger/coral tint today - semantically wrong: use Primer attention (--bgColor-attention-muted + a left border --borderColor-attention-emphasis) for messages that mention me, nothing for @all unless spec says so) | view-chat.js message render + actions | 18982 |
| S13 admin + login polish (labelled rows, passkey button only when enrolled; token for an existing account needs a server route - do NOT add it, list it) | view-admin.js, view-login.js | 18983 |
| S14 wiki polish (button row, Activity wording, tree keyboard nav) | view-wiki.js | 18984 |
