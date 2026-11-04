# T-MG-3 wave 2: S1 (collapsible sidebar + rail places) | S2 (side panel as a column + join bar) | S7 (counters and unread truth)
Three agents work in the worktree /Users/michal/Documents/Code/AgentTalks-wt/T-MG-3 AT THE SAME TIME on disjoint files. Read first: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-3/slice-common.md, then YOUR slice in the spec docs/superpowers/specs/2026-11-04-ui-slack-parity.md section 4 (behavior, acceptance, files, tests, live checklist). Wave 1 (S0 scaffolding + S0b Primer) is committed: use Primer tokens/classes and Octicons for everything you add (no raw colors).

| Slice | Your files (only these) | CSS block | Port | Test file |
|---|---|---|---|---|
| S1 | src/http/ui/js/view-sidebar.js, the rail block in src/http/ui/js/app.js (rail markup/handlers only), i18n-pl.js S1 block | /* === S1 === */ | 18971 | test/ui-s1-sidebar.test.ts |
| S2 | src/http/ui/js/view-chat.js lines of the main/side-panel slot markup (spec: view-chat.js:140-165 region) and src/http/ui/js/app.js shell class line only, i18n-pl.js S2 block | /* === S2 === */ | 18972 | test/ui-s2-panel.test.ts |
| S7 | src/http/ui/js/counters.js, src/http/ui/js/dom.js (badge/title code), src/http/ui/js/data.js (unread/digest derivation), src/http/ui/js/api.js (401 handling), src/http/ui/js/actions.js joinChannel only, src/http/ui/js/sse-events.js (401 path only), the divider in view-chat.js (spec: ~541, one function), i18n-pl.js S7 block | /* === S7 === */ | 18973 | test/ui-s7-counters.test.ts |
Shared vocabulary: state.sidePanel = { kind: "thread" | "details" | "profile" | "pinned", id } (S2 owns its rendering; S1 and S7 do not touch it); state.sbCollapsed = { [sectionId]: boolean } (S1); counters.js exports titleCount(state), dividerAfter(list, mark, unread, me), railBadges(state) (S7). i18n-pl.js: edit ONLY inside your slice block markers; app.css: ONLY inside your block marker.
Do not edit any other file; if you need one, stop and report NEEDS_CONTEXT naming it. Run no git.

## Known from the wave-1 screenshots (orchestrator, 2026-11-04)
- S1: the sidebar header row is crowded (avatar, search, help, sign-out icon, EN/PL in one row; the handle truncates; sign-out duplicates the account menu's "Sign out"). Give the workspace header room (workspace name + account avatar), move search to the place the spec gives it, drop the duplicate sign-out icon (it stays in the account menu), keep EN/PL reachable (account menu or settings).
- All: spacing/font sizes in rules you touch: use Primer tokens (--base-size-*, --text-*), not literal rem.
- The server caches CSS (readOnce): restart your server after a CSS edit before checking live.
- Screenshot tool you may use for your live check (writes PNGs; read its header): /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/ux/shots.mjs with a scenario like .../scratchpad/ux/w1-scenario.json (change base port and names), and .../scratchpad/ux/seed-serve.sh `<repo> <port>` (seeded instance, login michal / ux-review-2026; stop: `seed-serve.sh stop <port>`).
