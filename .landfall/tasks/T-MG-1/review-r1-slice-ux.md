# T-MG-1 r1 - slice UX: live UX/UI validation of the human web UI against Slack's interaction model (landfall:reviewer, model fable)
Common part first: /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-1/review-r1-common.md (its reproduction and output rules apply; a reproduction here = the exact steps + what you saw, with a screenshot reference).
Owner's words (2026-11-04): "there is an entire web UI so a human can also give instructions and talk - please validate it very thoroughly for UX and UI" and "a UI for humans that must be extremely intuitive, so ideally it should fully mirror Slack". So: validate VERY thoroughly; the yardstick is Slack's interaction model (not its brand). A human must be able to command and talk to agents without reading any docs.

Live instance (already running, seeded with realistic data - do not restart it): http://127.0.0.1:18790/
- human admin: handle `michal`, password `ux-review-2026`; human non-admin: `anna` / `ux-review-2026`.
- agents nestor, milosz, motowolt, reviewer (tokens in /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/ux/tokens.json) - use them with curl against http://127.0.0.1:18790/api to make agents reply LIVE while you watch the UI (POST /api/conversations/<id>/messages {"body": "...", "threadId": <id or omitted>}, header `authorization: Bearer <token>`). Conversation ids: general 1, bugs 2, deploy 3, design-review 4 (private), DM nestor-michal 5, group 6.
- Seed script (what exists): /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/ux/seed.mjs

Browser: use the Claude in Chrome tools (load them in ONE ToolSearch call: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__resize_window,mcp__claude-in-chrome__tabs_close_mcp). Call tabs_context_mcp first, open your OWN new tab, never touch the user's other tabs, never trigger alert/confirm dialogs (do not click "delete" buttons that confirm; inspect them in code instead), close your tab at the end. Only 127.0.0.1:18790. If the browser tools fail 2-3 times, fall back to reading the UI code (src/http/ui/**) plus curl of the served HTML, and say so in your concerns line.
Code for reference (read-only): /Users/michal/Documents/Code/AgentTalks-wt/T-MG-1/src/http/ui/** and src/http/ui.ts. Prior UX audit: docs/audyt-ux-2026-08-09.md (check whether its items still hold).

Walk these flows as the human `michal`, then as `anna`, at desktop width (1440x900) and mobile width (390x844), in English and in Polish (language switch):
1. First contact: login (password; the passkey button behavior), what you see first, can you tell where to start?
2. Sidebar like Slack: channels / DMs / groups sections, unread bold + mention badges, presence dots, "who is online", browse/join channels, create channel, start a DM, ordering, collapsing.
3. Channel view: header (name, topic, members, pins, details), message grouping by author/time, day dividers, "N new messages" marker, scrolling up through history, jump to latest, timestamps, edited/deleted states, markdown (code, tables, links), files, reactions (add, toggle, who reacted), hover actions on a message.
4. Threads: open in a side panel, reply, "also send to channel" (if any), thread reply counts and avatars, unread in threads.
5. Composer: Enter vs Shift+Enter, @mention autocomplete (people AND agents, @all), #channel references, emoji, formatting, attachments (drag and drop, paste), draft kept per conversation, edit last message with Up arrow, typing indicators of agents.
6. Commanding agents: ask a question (open question flow), see an agent answer live (make one answer via curl), resolve a #bugs report (green check), see leases ("who holds deploy:prod"), see what each agent is "doing".
7. Notifications: bell/activity, mentions, DMs, reactions; marking read; deep link to the message.
8. Search: messages, filters, jump to result in context.
9. Wiki: tree, page, edit, conflict message, history, links between pages.
10. Admin panel (michal only): users and access, tokens, invites, disabling an account - is it clear and safe?
11. Keyboard and accessibility: Cmd/Ctrl+K quick switcher, Esc closes panels, Tab order, focus visible, ARIA labels on icon buttons, contrast, screen-reader names (read_page gives the accessibility tree).
12. Empty, loading and error states: offline server (do NOT stop the shared server; inspect how the UI handles a failed fetch from code and from the console), 403 on a private channel for anna, long names, many channels.
For each step, compare with what a Slack user expects; any place a Slack user would be lost, surprised or would misclick is a finding.

Severity: blocking = a flow that does not work, an unusable screen, data shown to the wrong person, or a place where a human cannot command/talk to agents without docs. Minor = friction, inconsistency, polish, missing Slack convention that has a workaround. Be concrete: screen, steps, observed vs expected (Slack), suggested fix. Aim for completeness: list everything you find, ranked.
Output: /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/reviews/ux.json (reviewer id claude:reviewer), plus a readable report with the full walkthrough, per-flow verdicts and a prioritized "make it Slack-like" backlog in ux.json.repro.md next to it.
