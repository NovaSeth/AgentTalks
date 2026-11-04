# T-MG-3 Amendment 2, step 1: capture the screenshot set
Goal: a complete, reproducible set of PNG screenshots of the human web UI for an independent UX/UI review. You CAPTURE only; you do not judge the design and you do not change product code.
Repo to capture: the path your dispatch message names (the T-MG-3 worktree at its committed HEAD). Port: the one your dispatch names.

## Tools (scratchpad; read their header comments)
- /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/ux/seed-serve.sh `<repo> <port>`: fresh seeded instance (humans michal (admin) and anna, password ux-review-2026; agents nestor, milosz, motowolt, reviewer; channels general, bugs, deploy, design-review (private), a DM, a group DM, threads, reactions, open questions, wiki pages, a file); leaves the server running. Stop: `seed-serve.sh stop <port>`.
- /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/ux/shots.mjs `<scenario.json> <outDir>`: headless Chrome; logs in as michal, per shot sets width/height, prefers-color-scheme, UI language, optional theme, runs steps (click, clickText, type, key, waitFor, js, wait), writes `<name>.png` and `report.json` (failed steps + console errors per shot). Example scenario: .../scratchpad/ux/smoke-scenario.json.

## What to capture (write the scenario yourself by reading the UI code: src/http/ui/js/*.js for selectors, routes in router.js)
Desktop 1440x900, light + dark, EN, for every state below; then the starred (*) states also at 390x844 (mobile) in light, and in PL at 1440 light. Name shots `NN-state-variant` (e.g. `05-thread-open-dark`).
1 login (logged out); 2 passkey offer right after login (`"passkeyOffer": true`); 3 #general busy (messages, reactions, threads, mentions)*; 4 empty channel (create one through the API in a js step or use a fresh channel if seeded); 5 thread open in the side panel*; 6 composer: @mention popover, emoji picker, #channel autocomplete, slash-command menu, + menu (one shot each); 7 hover actions on a message and its More menu; 8 channel details / members; 9 DM and group DM*; 10 new-DM people picker; 11 a person's profile; 12 Activity / notifications*; 13 all unreads; 14 threads view; 15 search with results and filters*; 16 wiki page + tree + editor; 17 admin (users, tokens, invites); 18 keyboard shortcuts help; 19 user menu with the theme switch; 20 error states: send failure / offline banner (stop the server, wait for the UI to notice, shoot, restart and re-seed is NOT needed - just restart the same server on the same data with the command in seed-serve.sh), session expired (clear sessionStorage csrf and act), a 404 route; 21 mobile navigation (bottom tabs, conversation pushed screen, back button)*.
If a state does not exist in the UI, still try to reach it, shoot what you get, and list it as "missing state" - that is review input, not your failure.

## Output
- PNGs + report.json in /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/ux/round-<N>/ (N from your dispatch);
- the scenario you used: same directory, scenario.json;
- INDEX.md there: one line per shot (file, what it shows, how it was reached, any failed step or console error).
Stop the server at the end. Run no git. Final reply: 5 lines (shots count, problems count, missing states, path to INDEX.md, concerns).
