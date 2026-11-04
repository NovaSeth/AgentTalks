---
red: {"command": "node --test test/ui-t44-unread-highlight.test.ts", "exit": 1, "excerpt": "tests 11, pass 0, fail 11. TypeError: counters.highlightUnreadIds is not a function (test/ui-t44-unread-highlight.test.ts:158); TypeError: chat.resetUnreadHighlights is not a function (x9); CSS: .msg.unread-hl exists -> actual '' expected true"}
green: {"command": "landfall heavy -- node --test --test-reporter=tap --test-timeout=20000 test/**/*.test.ts", "exit": 0, "excerpt": "# tests 1075\n# pass 1075\n# fail 0 (ui-t44-unread-highlight: 11 pass, 0 fail)"}
---
# Report: Web UI unread highlights like Slack (only after absence, fade after read) (T-MG-44)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-44, task/T-MG-44-unread-highlight from main 550d269. Commits: 172c475 (RED), df16371 (GREEN), 5dd4612 (brand-guard wording + a tab-return guard). Push: no. Scope touched: view-chat.js, counters.js, app.css, app.js (visibility listener region + one import line), test/ui-t44-unread-highlight.test.ts. data.js untouched.
Status: DONE_WITH_CONCERNS

## Decisions
1. Open after absence: `openConversation` calls `noteConversationEntered(id)` when the conversation changes; the next `renderMessages` (the first with data) takes `highlightUnreadIds(list, dividerMark, me)` from counters.js, so the tinted rows are exactly the others' messages above the "New messages" divider (same mark, including the mark-0 estimate). Class `unread-hl` on the `.msg` row.
2. Present = not tinted: `upsertMessageNode` with `document.visibilityState === "visible"` only moves a per-conversation "seen" watermark. Hidden tab: the arriving message (others' only) is added to the tinted set and drawn with the class; a full re-render behind a hidden tab (replay) tints ids above the watermark. `noteTabVisible()` (called from the app.js visibility listener) tints what is above the watermark in case the list was redrawn meanwhile.
3. Fade: `fadeUnreadHighlights(convId, upToId)` is called next to every `markReadDebounced` in view-chat.js (open, scroll to bottom, jump pill) and in the app.js visibility hook; after the same 500 ms debounce the tint class is swapped for `unread-hl-fade` (CSS `transition: background 2.5s ease-out` to transparent), removed after 3 s. The global reduced-motion rule (`transition-duration:.001ms!important`) covers it.
4. Never again: read ids leave the tinted set; renders only tint ids in the set (or the fading set mid-fade). T-MG-29 re-renders keep it. Per conversation (a Map keyed by convId).
5. Own messages: excluded in the helper and in the hidden-tab live path (`actorId !== state.actor.id`); deleted ones too.
6. CSS tokens: `var(--accent-soft)` (= Primer `--bgColor-accent-muted`); a mention of me keeps the attention tint (explicit rule).

## Files
- src/http/ui/js/counters.js: `highlightUnreadIds(list, mark, me)` pure helper.
- src/http/ui/js/view-chat.js: highlight state + `noteConversationEntered`, `noteTabVisible`, `fadeUnreadHighlights`, `resetUnreadHighlights`; class assignment in `renderMessages` / `upsertMessageNode` / `messageHtml` (opts.unreadHl); fade calls beside markReadDebounced.
- src/http/ui/app.css: `.msg.unread-hl`, `:hover`, `.msg.unread-hl-fade`, mention precedence (after the S12 mention rules).
- src/http/ui/js/app.js: import line; visibility listener calls `noteTabVisible()` and `fadeUnreadHighlights(...)`.
- test/ui-t44-unread-highlight.test.ts: 11 tests (helper, open-after-absence x3, live-present, live-hidden x2, fade x3, CSS).

## RED / GREEN
- RED: 11/11 failed, the helper and the view-chat exports did not exist; the CSS rules were absent.
- GREEN: 11/11 in the new file; full suite 1075 pass / 0 fail.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck (`npm run typecheck`) | clean | 0 |
| tests (`landfall heavy -- node --test --test-reporter=tap ...`, the NODE_OPTIONS form was refused by the shell guard) | 1075 pass, 0 fail | 0 |
| secrets scan (`landfall secrets`) | 12 findings, all the D-MG-8 baseline (decision file, env example, docs, cli/api/english tests); none in this task's files | 1 |
First full run (df16371) had 1 failure: S0b-6 brand guard rejected the word "Slack" in three comments; reworded in 5dd4612, rerun green.

## E2E assertions reviewed
None run (brief: the orchestrator checks the real UI). To check in the browser: open a channel with unread messages (tint + divider), hide the tab while another actor writes (tint on return), scroll to the bottom (fade ~2.5 s), re-open the panel (no tint comes back), dark theme readability, reduced motion.

## Shared gaps (for the orchestrator)
- none

## Context
Brief; view-chat.js 20-160, 325-345, 740-930, 1085-1130, 1191-1200, 1380-1400; counters.js 40-75; data.js 250-300; app.js 25-35, 430-470; sse-events.js 290-330 (read only); state.js views/visibleMessages/lastMessageId; app.css 240-262, 500-515, 970-1000, 1446-1456; test/ui-t29-scroll.test.ts, test/ui-s7-counters.test.ts. Rules by ID from the brief (not re-read in full).

## Open issues / deviations from the brief
- Concern: the fade starts when the read is requested (open at bottom, scroll to bottom, tab return at bottom, jump pill) plus the 500 ms debounce, not on the server's confirmation: data.js is out of scope, so there is no hook on the POST's success. On a failed POST the tint still fades.
- Concern (pre-existing, not changed): `state.memberships[id].lastReadMessageId` is not updated by the client after a read, so on re-entering a conversation the divider (and hence the tint) can follow a stale mark until the conversations list is refetched. The tint follows the divider by design; fixing the divider is a separate task.
- `sse-events.js` calls `markReadDebounced` on a live message while viewing at the bottom without a fade call (file out of scope); in that case nothing is tinted anyway (present), so no visible gap.
- Follow-up: messages missed while hidden with a dropped SSE and refetched after the return are drawn while visible, so they get no tint (only the divider). Covering it needs a "return since" marker that survives the refetch render.

## Fix round 1

# Report: Web UI unread highlights like Slack (only after absence, fade after read) (T-MG-44)

Worktree / branch: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-44, task/T-MG-44-unread-highlight from main 550d269. Commits: 172c475 (RED), df16371 (GREEN), 5dd4612 (brand-guard wording + a tab-return guard). Push: no. Scope touched: view-chat.js, counters.js, app.css, app.js (visibility listener region + one import line), test/ui-t44-unread-highlight.test.ts. data.js untouched.
Status: DONE_WITH_CONCERNS

## Decisions
1. Open after absence: `openConversation` calls `noteConversationEntered(id)` when the conversation changes; the next `renderMessages` (the first with data) takes `highlightUnreadIds(list, dividerMark, me)` from counters.js, so the tinted rows are exactly the others' messages above the "New messages" divider (same mark, including the mark-0 estimate). Class `unread-hl` on the `.msg` row.
2. Present = not tinted: `upsertMessageNode` with `document.visibilityState === "visible"` only moves a per-conversation "seen" watermark. Hidden tab: the arriving message (others' only) is added to the tinted set and drawn with the class; a full re-render behind a hidden tab (replay) tints ids above the watermark. `noteTabVisible()` (called from the app.js visibility listener) tints what is above the watermark in case the list was redrawn meanwhile.
3. Fade: `fadeUnreadHighlights(convId, upToId)` is called next to every `markReadDebounced` in view-chat.js (open, scroll to bottom, jump pill) and in the app.js visibility hook; after the same 500 ms debounce the tint class is swapped for `unread-hl-fade` (CSS `transition: background 2.5s ease-out` to transparent), removed after 3 s. The global reduced-motion rule (`transition-duration:.001ms!important`) covers it.
4. Never again: read ids leave the tinted set; renders only tint ids in the set (or the fading set mid-fade). T-MG-29 re-renders keep it. Per conversation (a Map keyed by convId).
5. Own messages: excluded in the helper and in the hidden-tab live path (`actorId !== state.actor.id`); deleted ones too.
6. CSS tokens: `var(--accent-soft)` (= Primer `--bgColor-accent-muted`); a mention of me keeps the attention tint (explicit rule).

## Files
- src/http/ui/js/counters.js: `highlightUnreadIds(list, mark, me)` pure helper.
- src/http/ui/js/view-chat.js: highlight state + `noteConversationEntered`, `noteTabVisible`, `fadeUnreadHighlights`, `resetUnreadHighlights`; class assignment in `renderMessages` / `upsertMessageNode` / `messageHtml` (opts.unreadHl); fade calls beside markReadDebounced.
- src/http/ui/app.css: `.msg.unread-hl`, `:hover`, `.msg.unread-hl-fade`, mention precedence (after the S12 mention rules).
- src/http/ui/js/app.js: import line; visibility listener calls `noteTabVisible()` and `fadeUnreadHighlights(...)`.
- test/ui-t44-unread-highlight.test.ts: 11 tests (helper, open-after-absence x3, live-present, live-hidden x2, fade x3, CSS).

## RED / GREEN
- RED: 11/11 failed, the helper and the view-chat exports did not exist; the CSS rules were absent.
- GREEN: 11/11 in the new file; full suite 1075 pass / 0 fail.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck (`npm run typecheck`) | clean | 0 |
| tests (`landfall heavy -- node --test --test-reporter=tap ...`, the NODE_OPTIONS form was refused by the shell guard) | 1075 pass, 0 fail | 0 |
| secrets scan (`landfall secrets`) | 12 findings, all the D-MG-8 baseline (decision file, env example, docs, cli/api/english tests); none in this task's files | 1 |
First full run (df16371) had 1 failure: S0b-6 brand guard rejected the word "Slack" in three comments; reworded in 5dd4612, rerun green.

## E2E assertions reviewed
None run (brief: the orchestrator checks the real UI). To check in the browser: open a channel with unread messages (tint + divider), hide the tab while another actor writes (tint on return), scroll to the bottom (fade ~2.5 s), re-open the panel (no tint comes back), dark theme readability, reduced motion.

## Shared gaps (for the orchestrator)
- none

## Context
Brief; view-chat.js 20-160, 325-345, 740-930, 1085-1130, 1191-1200, 1380-1400; counters.js 40-75; data.js 250-300; app.js 25-35, 430-470; sse-events.js 290-330 (read only); state.js views/visibleMessages/lastMessageId; app.css 240-262, 500-515, 970-1000, 1446-1456; test/ui-t29-scroll.test.ts, test/ui-s7-counters.test.ts. Rules by ID from the brief (not re-read in full).

## Open issues / deviations from the brief
- Concern: the fade starts when the read is requested (open at bottom, scroll to bottom, tab return at bottom, jump pill) plus the 500 ms debounce, not on the server's confirmation: data.js is out of scope, so there is no hook on the POST's success. On a failed POST the tint still fades.
- Concern (pre-existing, not changed): `state.memberships[id].lastReadMessageId` is not updated by the client after a read, so on re-entering a conversation the divider (and hence the tint) can follow a stale mark until the conversations list is refetched. The tint follows the divider by design; fixing the divider is a separate task.
- `sse-events.js` calls `markReadDebounced` on a live message while viewing at the bottom without a fade call (file out of scope); in that case nothing is tinted anyway (present), so no visible gap.
- Follow-up: messages missed while hidden with a dropped SSE and refetched after the return are drawn while visible, so they get no tint (only the divider). Covering it needs a "return since" marker that survives the refetch render.

## Fix round 1 (orchestrator browser check)
Merge: `git merge main` first (c07189f, clean, outside this task's files). Commits: b6c6bfb (RED), a3b0bb5 (GREEN). Push: no.
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| Return to #/c/general from #/wiki/... after 3 live messages: divider shown, no .unread-hl. Cause: `openConversation` with the same id skipped `noteConversationEntered` (only a conversation change counted), and sse-events draws nothing while another view covers the chat, so the hidden-tab live path never ran. | "Present" = chat view of this conversation on screen AND tab visible. `openConversation` records `previousView`; the same id after a non-chat view is a resume: `noteConversationEntered(id, { resumed: true })` keeps the state and the next drawn list tints the others' messages newer than the "seen" watermark (a first visit without a watermark falls back to the divider's mark). | RED: test "T-MG-44 r1: messages that arrive while another view (wiki) covers the active conversation are tinted on return" drives `openConversation(5)` twice through the real renderMain over the stubbed `#main`; before the fix `[]` instead of `[511, 513]` (exit 1). GREEN: 12/12 in the file. | b6c6bfb / a3b0bb5 |
Gate: typecheck exit 0; `landfall heavy -- node --test --test-reporter=tap ...` 1076 pass / 0 fail, exit 0; `landfall secrets` exit 1, the same 12 D-MG-8 baseline findings, none in this task's files. Tree clean.
Files: src/http/ui/js/view-chat.js (noteConversationEntered option, highlightResumePending, noteListDrawn, openConversation), test/ui-t44-unread-highlight.test.ts (hostify stub + the r1 test).
Status: DONE_WITH_CONCERNS
