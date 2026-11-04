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

## Fix round 2

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

## Fix round 2 (review-r1.json, Codex F1-F5; brief .landfall/tasks/T-MG-44/brief.md, acceptance 1-7)
Merge: `git merge main` first (clean, c07189f already held it; nothing new outside this task). Commits: 56974ce (RED: the five reproductions), 369d346 (GREEN). Push: no. data.js touched only for the read-confirmed hook (allowed by the brief).
Model after the round: per conversation `floor` (newest id on screen at entry), `live` (ids seen arriving: tab visible, this chat on screen), `read` (highest CONFIRMED read id), `ids` (tinted), `fading`. The entry render tints the others' messages above max(divider mark, read); every later render of the same conversation, whatever restored it, tints the others' messages above max(floor, read) that are neither live nor fading. No entry/resume flags, no duplicated debounce.
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| F1 read rows regain the tint after 5 -> 6 -> 5 | the confirmed read watermark (`read`) lives per conversation and survives navigation; the entry render excludes ids <= read even when the membership mark is stale | RED: `[506,508,510]` vs `[]`; GREEN: `[]`, the divider unchanged | 56974ce / 369d346 |
| F2 the fade timer did not follow the read (reschedule -> posts 0 yet fading; 503 -> fading) | the fade starts ONLY from `views.readConfirmed(convId, messageId)`, called in markReadDebounced's success path after the counters clear (data.js); `fadeUnreadHighlights` is that hook (registered in app.js); the three request-side fade calls in view-chat.js and the one in the app.js visibility hook are gone | RED: tint gone with posts=0; 503 posted but rows faded; GREEN: rescheduled read -> still tinted, posts 0; confirmed -> fade; 503 -> tinted, unread stays 3 | 56974ce / 369d346 |
| F3 Activity -> Home (goPlace: view='chat', renderShell) gave no tint | classification is in the render itself (noteListDrawn): a render of the conversation drawn last tints what is above the floor and not live, so every restoring path qualifies (openConversation, goPlace, routes, view-unreads/notifications/wiki "back to chat") | RED: `[]` vs `[511,513]` via `state.view='chat'; renderMain()`; GREEN | 56974ce / 369d346 |
| F4 reconnect catch-up after a return classified as seen live | the floor does not advance on a visible render; only `upsertMessageNode` with the tab visible marks an id live, so messages recovered by the catch-up (loadMessages/loadGapAfter -> views.messages) are above the floor and not live -> tinted; a live one afterwards stays untinted across re-renders. sse-events.js untouched | RED: `[]` vs `[511,512]`; GREEN: `[511,512]`, 513 (live) untinted | 56974ce / 369d346 |
| F5 state and timers outlive an account change | the map is bound to the session generation (`hlMap()` drops it on the first touch after `newSessionGeneration()`, which both teardown paths call: view-login.js sign-out and sse-events.js session loss); the fade-end timer captures the generation and does nothing under another one; `resetUnreadHighlights` stays for tests | RED: A's timer stripped B's tint; GREEN: B's `[506,508,510]` untouched after A's timer | 56974ce / 369d346 |
Test harness changes (COD-3: nothing removed or weakened; every earlier assertion kept, now driven through the real `openConversation`/`renderMain` over the hostified `#main`): a working localStorage stub (trimConversationCache dropped conversation 6 under the no-op one), `fetch` answers the read POST as the test decides (ok / 503 / never) and records posts, `data.cancelMarkRead()` before each `mock.timers.reset()` (a mocked read timer outliving its mock broke the next test's mock queue).
Gate: typecheck exit 0; `landfall heavy -- node --test --test-reporter=tap ...` 1081 pass / 0 fail, exit 0 (ui-t44: 17/17); `landfall secrets` exit 1, the same 12 D-MG-8 baseline findings, none in this task's files. Tree clean.
Files: src/http/ui/js/view-chat.js (highlight block rewritten; openConversation and the three read sites no longer call a fade), src/http/ui/js/app.js (readConfirmed registration; the visibility hook keeps noteTabVisible only), src/http/ui/js/data.js (one line: `views.readConfirmed?.(convId, messageId)` after the confirmed read), test/ui-t44-unread-highlight.test.ts.
Remaining concern (unchanged, pre-existing): the stale `memberships.lastReadMessageId` still places the DIVIDER at an old mark on a fresh re-entry until the conversations list is refetched; the tint no longer follows it for confirmed-read ids (F1), but ids read in an earlier page session (before this tab's confirmations) are above that stale mark and would be tinted together with the divider — a divider fix is a separate task.
Status: DONE_WITH_CONCERNS

## Fix round 3

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

## Fix round 2 (review-r1.json, Codex F1-F5; brief .landfall/tasks/T-MG-44/brief.md, acceptance 1-7)
Merge: `git merge main` first (clean, c07189f already held it; nothing new outside this task). Commits: 56974ce (RED: the five reproductions), 369d346 (GREEN). Push: no. data.js touched only for the read-confirmed hook (allowed by the brief).
Model after the round: per conversation `floor` (newest id on screen at entry), `live` (ids seen arriving: tab visible, this chat on screen), `read` (highest CONFIRMED read id), `ids` (tinted), `fading`. The entry render tints the others' messages above max(divider mark, read); every later render of the same conversation, whatever restored it, tints the others' messages above max(floor, read) that are neither live nor fading. No entry/resume flags, no duplicated debounce.
| Finding | Fix | RED / GREEN | Commit |
|---|---|---|---|
| F1 read rows regain the tint after 5 -> 6 -> 5 | the confirmed read watermark (`read`) lives per conversation and survives navigation; the entry render excludes ids <= read even when the membership mark is stale | RED: `[506,508,510]` vs `[]`; GREEN: `[]`, the divider unchanged | 56974ce / 369d346 |
| F2 the fade timer did not follow the read (reschedule -> posts 0 yet fading; 503 -> fading) | the fade starts ONLY from `views.readConfirmed(convId, messageId)`, called in markReadDebounced's success path after the counters clear (data.js); `fadeUnreadHighlights` is that hook (registered in app.js); the three request-side fade calls in view-chat.js and the one in the app.js visibility hook are gone | RED: tint gone with posts=0; 503 posted but rows faded; GREEN: rescheduled read -> still tinted, posts 0; confirmed -> fade; 503 -> tinted, unread stays 3 | 56974ce / 369d346 |
| F3 Activity -> Home (goPlace: view='chat', renderShell) gave no tint | classification is in the render itself (noteListDrawn): a render of the conversation drawn last tints what is above the floor and not live, so every restoring path qualifies (openConversation, goPlace, routes, view-unreads/notifications/wiki "back to chat") | RED: `[]` vs `[511,513]` via `state.view='chat'; renderMain()`; GREEN | 56974ce / 369d346 |
| F4 reconnect catch-up after a return classified as seen live | the floor does not advance on a visible render; only `upsertMessageNode` with the tab visible marks an id live, so messages recovered by the catch-up (loadMessages/loadGapAfter -> views.messages) are above the floor and not live -> tinted; a live one afterwards stays untinted across re-renders. sse-events.js untouched | RED: `[]` vs `[511,512]`; GREEN: `[511,512]`, 513 (live) untinted | 56974ce / 369d346 |
| F5 state and timers outlive an account change | the map is bound to the session generation (`hlMap()` drops it on the first touch after `newSessionGeneration()`, which both teardown paths call: view-login.js sign-out and sse-events.js session loss); the fade-end timer captures the generation and does nothing under another one; `resetUnreadHighlights` stays for tests | RED: A's timer stripped B's tint; GREEN: B's `[506,508,510]` untouched after A's timer | 56974ce / 369d346 |
Test harness changes (COD-3: nothing removed or weakened; every earlier assertion kept, now driven through the real `openConversation`/`renderMain` over the hostified `#main`): a working localStorage stub (trimConversationCache dropped conversation 6 under the no-op one), `fetch` answers the read POST as the test decides (ok / 503 / never) and records posts, `data.cancelMarkRead()` before each `mock.timers.reset()` (a mocked read timer outliving its mock broke the next test's mock queue).
Gate: typecheck exit 0; `landfall heavy -- node --test --test-reporter=tap ...` 1081 pass / 0 fail, exit 0 (ui-t44: 17/17); `landfall secrets` exit 1, the same 12 D-MG-8 baseline findings, none in this task's files. Tree clean.
Files: src/http/ui/js/view-chat.js (highlight block rewritten; openConversation and the three read sites no longer call a fade), src/http/ui/js/app.js (readConfirmed registration; the visibility hook keeps noteTabVisible only), src/http/ui/js/data.js (one line: `views.readConfirmed?.(convId, messageId)` after the confirmed read), test/ui-t44-unread-highlight.test.ts.
Remaining concern (unchanged, pre-existing): the stale `memberships.lastReadMessageId` still places the DIVIDER at an old mark on a fresh re-entry until the conversations list is refetched; the tint no longer follows it for confirmed-read ids (F1), but ids read in an earlier page session (before this tab's confirmations) are above that stale mark and would be tinted together with the divider — a divider fix is a separate task.
Status: DONE_WITH_CONCERNS


## Fix round 3
Commits: e6a9fd6 (merge main; app.js import and registerViews conflicts resolved keeping openConversationInBackground, paintRail and the T-MG-44 hooks), 244e1fb (RED tests), e1dc1a6 (fix).
- F7: view-chat.js gets serverRead(convId) = state.memberships[conv].lastReadMessageId (the server's watermark, moved by every confirmed read); tintMissed and the entry render use max(floor, read, serverRead). Test: setup(520), 512/514 appended behind the cache render untinted; 522 is tinted.
- F8: the account-change test no longer calls resetUnreadHighlights (setup gets reset:false), signs out through newSessionGeneration, ticks 3500 ms past A's 3000 ms timer. Local mutation `if (hlGeneration === -1)` made it fail (16 pass, 2 fail), reverted.
- Concern: Mark as unread lowers the membership mark, so serverRead drops with it; h.read (session-confirmed) still keeps previously read rows from re-tinting.
