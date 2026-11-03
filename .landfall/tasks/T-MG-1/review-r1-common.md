# T-MG-1 review round 1 - common part for every slice (read this first, then your slice file)

Read, in this order:
1. /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-1/review-r1-brief.md - pinned range 877e20e..945674f, rules, severity (REV-2), output shape (review.schema.json). The diff file it names is a map; review the CODE AT HEAD.
2. /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-1/brief.md - acceptance points 1-14 (cite them by number).
3. /Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-1/spec.md - Global Constraints GC1-GC8 and Review Focus RF1-RF5.

Code: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-1 - a clean checkout of 945674f with `npm ci` done. READ-ONLY: never modify, create or delete a file there and run no git that writes. Baseline: `npm test` 322 pass, `npm run typecheck` exit 0.

Reproductions (REV-3): write them ONLY under your own directory /private/tmp/claude-501/-Users-michal-Documents-Code-AgentTalks/9dfeb82b-2d22-46c9-bb1d-d218d405c517/scratchpad/reviews/<slice>/ (create it). A reproduction may import modules from the worktree by absolute path (Node >= 24 runs .ts directly; see test/helpers.ts and test/http-helpers.ts in the worktree for how tests open a temp DB and start a server) and run with `node --test <file>`; or start a server with a temp data dir: `node /Users/michal/Documents/Code/AgentTalks-wt/T-MG-1/bin/agenttalks.js init --data <your dir>/data` then `... serve --data <your dir>/data --port <your port>`. Use only the port your slice file gives you. Stop every process you start before you finish.

Prior work: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-1/docs/audyt-2026-08-09.md and docs/audyt-ux-2026-08-09.md list the 2026-08-09 audit (reported fixed). Report one of those only if it still reproduces at HEAD (say so: "regression of audit item ...").

Ask of every control you see (a check, a test, a guard): "can this control answer DIFFERENTLY?" - a guard that cannot fail is a finding.

Language (acceptance 12): do NOT list Polish identifiers, file names, test titles, API error codes, CLI help or docs - task T-MG-2 translates all of it. Report language only if it hides a defect.

Never contact anything outside 127.0.0.1. Never use the file /Users/michal/Documents/Code/AgentTalks/.agenttalks.json or ~/.config/agenttalks (production identity). If you run `atalk`, set HOME to your own scratch directory and pass --url/--token explicitly.

Output: one JSON file at the path your slice file names, shaped exactly by /Users/michal/.claude/plugins/cache/landfall-plugins/landfall/2.5.1/templates/review.schema.json (every key present; null when absent; text <= 500 chars, one line, including the reproduction in short: command -> observed result). Blocking first. Severity: blocking = data loss/corruption, security hole (Critical/High), outage, functional defect, a broken user/agent flow, a GC violation; minor = everything else. For each blocking finding, put the full reproduction (script path + output) in a sidecar file <json path>.repro.md as well.
Final reply: exactly 5 lines: status, verdict with counts per severity, reproductions run, concerns or "none", JSON path.
