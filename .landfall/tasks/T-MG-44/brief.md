# Web UI unread highlights like Slack (only after absence, fade after read) (T-MG-44, recreated from T-MG-39)
<!-- Task brief (ORC-4), hand-written by the orchestrator. Every path is absolute (ORC-15). This file replaces the unfilled template; the executor worked from an identical copy at scratchpad/T-MG-44-brief.md. -->

Executor: landfall:implementer (class: standard, escalated to critical by verify; kind: task). Deliverable kind: a working feature in the shipped web UI.
Review: cross-provider (Codex), then a scoped re-review.
Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-44 (branch task/T-MG-44-unread-highlight from main at 550d269269d0). Never rebase.
Rules: ORC-2 ORC-17 ORC-18 ORC-12 ORC-13 COD-1 COD-2 COD-3 COD-14 REV-10 REV-9 REV-18 ORC-7 PRI-2 PRI-15 SPC-13 SPC-14. Decisions in force: D-MG-6 (English in code), D-MG-18 (Primer visual layer, Slack interaction model).

## Source (the owner's request, task title verbatim)
"Web UI unread highlights like Slack (only after absence, fade after read)".

## Today
- `renderMessages()` in src/http/ui/js/view-chat.js draws the list with a "New messages" divider (`.newline`, positioned by `dividerAfter()` in src/http/ui/js/counters.js:53 from `state.readMark[convId]`); live events update single bubbles via `upsertMessageNode()`.
- `markReadDebounced(convId, messageId)` in src/http/ui/js/data.js:262 posts the read mark (500 ms debounce) and clears `state.unread[convId]` after the server confirms.
- app.js has a `visibilitychange` listener; app.css has the reduced-motion block.

## Scope
Modify: src/http/ui/js/view-chat.js, src/http/ui/app.css, src/http/ui/js/counters.js, src/http/ui/js/app.js (visibility, view switching), and src/http/ui/js/data.js only for a read-confirmed hook. Create: test/ui-t44-unread-highlight.test.ts. Not: sse-events.js (T-MG-43), the plugin (T-MG-40), view-sidebar.js / router.js (T-MG-38).

## Contracts
Consumes: state.readMark / state.unread / state.msgs / state.activeId / state.view (state.js), markReadDebounced (data.js), document visibility. Produces: CSS classes `.unread-hl` and `.unread-hl-fade` on message rows; no new public API.

## Acceptance
1. Returning to a conversation that has messages from others newer than the user's read mark — by opening it from anywhere (route, sidebar, rail place switch such as Activity → Home, search) or by coming back to a hidden tab — highlights exactly those unread messages (soft accent tint, Primer tokens, both themes), in addition to the divider.
2. A message that arrives while the chat view of THIS conversation is on screen and the tab is visible is not highlighted; one that arrives while the tab is hidden, another view is shown, or another conversation is open is highlighted on return — including messages recovered by an SSE reconnect catch-up after the return.
3. The highlight fades out over ~2-3 s only after the read mark is CONFIRMED by the server for those messages; a failed or rescheduled read leaves them highlighted. With prefers-reduced-motion it disappears without animation.
4. A message once read never regains the highlight (navigation away and back, re-render, panel open/close); the confirmed read watermark survives navigation.
5. Own messages are never highlighted.
6. Highlight state and timers are cleared on sign-out / account change / session generation change; nothing from one account leaks into another.
7. Tests in the stubbed-DOM / pure-function style for 1-6; CSS uses theme tokens; no test removed, skipped or weakened (COD-3).

## Gate
`landfall heavy -- npm run test`, `npm run typecheck`, `landfall secrets` (baseline D-MG-8 tolerated). One commit per step; no push.

## Report
scratchpad/T-MG-44-report.md (frontmatter red/green, Status line, decisions per point, files, gate). Final reply: 5 lines.
