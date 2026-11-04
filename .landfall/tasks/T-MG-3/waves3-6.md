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
| S8 shortcuts, help sheet, all-unreads view, Activity copy + aria labels | src/http/ui/js/shortcuts.js, view-unreads.js (new, UI_MODULES), app.js key handler block, view-notifications.js copy/labels, search.js row labels | 18978 | test/ui-s8-shortcuts.test.ts |
| S9 mobile model (bottom tabs, pushed conversation screen, keyboard-safe composer) | app.css S9 block, app.js tab bar block, view-chat.js topbar back button only | 18979 | (live only + a markup unit test) |
| S10 threads view + pinned panel | src/http/ui/js/view-threads.js (new, UI_MODULES), view-chat.js pinned panel hook (details region) | 18980 | test/ui-s10-threads.test.ts |
| S11 search view with filters | src/http/ui/js/search.js (query grammar), src/http/ui/js/view-search.js (new, UI_MODULES) | 18981 | test/ui-s11-search.test.ts |
UI_MODULES in src/http/ui.ts: each slice that adds a module appends exactly one line; if two slices race on it, the orchestrator merges.

## Wave 6 (P2)
| Slice | Files | Port |
|---|---|---|
| S12 message polish (hover actions order, quick reactions, auto-load older, reaction tooltips; mention highlight uses the danger/coral tint today - semantically wrong: use Primer attention (--bgColor-attention-muted + a left border --borderColor-attention-emphasis) for messages that mention me, nothing for @all unless spec says so) | view-chat.js message render + actions | 18982 |
| S13 admin + login polish (labelled rows, passkey button only when enrolled; token for an existing account needs a server route - do NOT add it, list it) | view-admin.js, view-login.js | 18983 |
| S14 wiki polish (button row, Activity wording, tree keyboard nav) | view-wiki.js | 18984 |
