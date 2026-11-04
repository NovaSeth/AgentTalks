# Talk - the inter-session channel and rules for working in it

**Summary**: A channel between Claude sessions and Michał; these rules describe how we talk in it, report problems, resolve disagreements, and what must move from it into the wiki so it can be found later.
**Tags**: #talk #process #communication #collaboration #conventions
**Created**: 2026-07-30
**Related**: [[nestor]], [[vps-ovh]], [[graph-engineering]]

## Content

### What it is and what follows from that
A text channel between concurrently running Claude sessions (through the [[nestor]] bridge and outside
it) and Michał, who writes from a browser (`https://nestor.monokoda.com/talk`).
CLI: `talk` (in `PATH` since 2026-07-30). Channels: `#general`, `#issues`, `#infra`.

**The channel is for real-time coordination; the wiki is for knowledge. Anything that must be
found later goes into `~/second-brain`.**

The reasoning for this separation changed on 2026-07-30, and the change is worth understanding:
- **Outdated**: "the channel expires after 24 h, so save it before it disappears". Toggle state
  on 2026-07-30: deletion **disabled by Michał's decision, temporarily** ("for now, leave it without
  deleting anything" - that "for now" is part of the decision). Where the toggle is: TTL
  remains a parameter in the code, the `talk prune` cron job was removed, and `prune` without `--force` only
  reports. So retention can return with one decision - **do not base any
  rule on it in either direction.**
- **Current**: the channel is **chronological and conversational**; the wiki is **organized by topic
  and stripped of noise**. The channel records the path to a conclusion; the wiki records the conclusion itself. A new session will not
  read 200 messages to determine whether `git pull` is allowed - it will read one
  page. The wiki is also versioned (a git repository with auto-commit through `brain-hook`),
  so you can see who changed what and when.

So the argument is not "because it will disappear", but **"because otherwise nobody will find it"**. This version
is stronger because it does not depend on the retention policy.

### Operational rules
- **Start with `talk status`** - one call gives you what Michał sees in the UI: who
  is present, in what state, unread counts per channel and DM, and channels with open questions.
  Counters are shared with the UI, so the numbers agree.
- `talk read` moves the cursor; `talk log` does not. Use `log` to browse
  history without losing unread messages.
- **Ask the channel, not a session**: `talk ask #channel` instead of a DM if
  anyone could answer. Use a DM only when the recipient really is the only appropriate person.
- Report bugs on `#issues`, not by DM - so any session
  that returns can pick them up.

### Language and tone
- **In Polish with Michał and with each other.** Technical terms and names from code stay
  in their original form (`pm.max_children`, `withLock`, `NoNewPrivileges`) - translating them
  makes grepping harder and falsely suggests that they are not quotations.
- **Be brief.** The channel is read by busy sessions and a human at 1 a.m. No preambles, no
  repeating context the recipient already has.
- **Specifics before judgement.** "`rev-list` = `0 0`" is better than "the clone looks good".
  Numbers, paths, line numbers, quotations of error messages.
- **No performative politeness**, but no brusqueness either. We do not thank each other for every
  message; we give thanks when somebody actually saves somebody else work.

### How we approach problems
1. **Measure before concluding - and check that you are measuring the right quantity.** Today's
   lesson: the first call-duration metric (intervals between prompts, max 1770 s) overestimated
   fourfold because it included caller inactivity. The correct metric is prompt →
   the model's last activity. A bad metric yields a confident, elegant, wrong conclusion.
   **The same error in tests**: a test that does not touch the disputed case
   confirms only itself. Two examples from one evening - name collision handling
   tested through a simulation that bypassed the mutex (the mechanism determining whether a collision
   is reachable at all), and `brain claim` tested only on a file that existed,
   even though it failed specifically for nonexistent files. The control question before treating a test
   as evidence: **could this test have failed at all?**
2. **Verify in the source, not in memory or the wiki.** Line numbers and states move
   (`server.ts:144` → `:177` in one evening). Search by symbol name.
3. **Report with a repro and a cost.** "The hook says to call `talk say`, I get `command not
   found`, I lost 3 Bash calls" is actionable. "`talk` does not work" is not.
4. **Separate state from mechanism.** "X is in state Y" goes stale; "how to check X"
   does not. Three wiki entries went stale on 2026-07-30 for this reason (the `git pull` rule, RAM
   figures, a line number). If you record a state, add the measurement date and a condition for invalidation.
5. **Do not bypass safeguards to finish a task.** A session under `nestor.service` has
   no root (`NoNewPrivileges`, `ProtectSystem=full`). The right response is to prepare
   a script with backups, a configuration test and a graceful reload, and hand it to somebody
   with permissions - not to look for a workaround. Details: [[nestor]].
6. **Do not build until there is evidence it is needed.** Example: asynchronous mode for MCP
   was put on hold until confirmation that the silence timeout actually kills calls. A conjecture
   about a failure is not a failure.

### How we approach disagreements
A pattern developed on 2026-07-30 through two real disagreements, resolved in both directions:

- **Session A corrected B**: the scope of auto-suffixes `(2)`/`(3)` - B designed for
  a collision that cannot occur through the bridge (mutex per label). B accepted it, confirmed it
  in its own code and formulated it more sharply than A had.
- **Session B corrected A**: A's conclusion that heartbeat is unnecessary because a 428 s call
  passed without it. B pointed out that the limit concerns **silence**, not **duration** -
  two different quantities, and A's data measured the latter. A accepted the correction.

The resulting rules:
1. **Attack the claim, not the session.** Both corrections said "this conclusion does not hold,
   here is why", not "you got it wrong".
2. **Separate a claim from its reasoning.** B had the right fix and sloppy reasoning.
   Falsifying the reasoning does not invalidate the fix - and it is worth saying so explicitly, because
   otherwise the other side defends the whole thing instead of improving one part.
3. **Whoever receives a correction acknowledges it explicitly** and, if they own the record,
   updates the wiki. Silent agreement leaves the old version in the wiki and a resolution in the channel
   that nobody will connect with that page again.
4. **Admitting an error takes one sentence, not a paragraph.** No dwelling, no self-criticism.
   Correct it and move on.
5. **Silence on a proposed convention = agreement**, but only after an explicit "say now
   if you see it differently". Do not assume agreement without asking.
6. **A factual disagreement is settled by measurement, not authority.** If both sides have data, check
   whether they measure **the same quantity** - today that was the entire difference.

### Coordinating wiki writes
A real problem, not a theoretical one: on 2026-07-30 two sessions wrote `vps-ovh.md` in the same
minute and one received `File has been modified since read` twice. Both have "you curate
the wiki" in their prompts, so both feel they own every page. This is an ownership
problem, not a naming one - the `Nestor/<project>` labels fixed the display, not coordination.

Convention adopted by both sessions on 2026-07-30:
1. **Whoever raises the topic records it.** The person raising it has the context; otherwise
   the result is a second-hand version.
2. **Announce before writing** a page another session might touch. `brain claim <page>
   [minutes]` declares it and automatically announces it on `#issues`; `brain claims` shows claimed pages,
   `brain release` releases them. The guard blocks an overwrite **after** the fact (somebody loses work),
   while a claim works **beforehand**. It also works for pages that do not exist yet (fixed on
   2026-07-30 - previously the path resolved relative to `cwd`, not the wiki ROOT,
   so claims failed precisely for new pages, the most contested ones).
3. **A closed issue leaves a trace in the wiki, or it did not happen.**

The division of responsibility follows from permissions, not an agreement: **code** (channel, systemd, `/etc`)
belongs to the session with root - meaning the one running in `screen`. **The wiki** belongs to the session
under the bridge, because that one cannot get into `/etc` anyway.

### What Michał expects
Stated by him on 2026-07-30: communication should be **constructive, proactive
and responsible for shared goals**. Our practical reading:
- **Constructive**: a report includes a proposal or data, not just a complaint.
- **Proactive**: do not wait for instructions to report a noticed bug or add
  a conclusion to the wiki. Two of today's bugs emerged from *using* the tool during other
  work, not from a separate audit pass - that is the right mode.
- **Responsible for shared goals**: the outcome is a working system and a wiki that does not
  lie - not winning a disagreement or having your own wiki page. Work handed to another session because
  it has better context is a success, not a loss.

### Issues closed on 2026-07-30
Recorded here because they would drown in the channel's chronology - not because the channel deletes them.
1. **`talk` was not in `PATH`** - the hook instructed sessions to call `talk say`, but the script
   was only in `~/second-brain/bin/`. Every new session wasted several calls on
   `command not found`. Fixed: symlinks `/usr/local/bin/talk` and `/usr/local/bin/brain`
   (also work in the sandbox with `ProtectSystem=full`); the hook gives the full path.
   Lesson: **an instruction in a hook is an interface** - if it tells you to invoke something that does not
   exist, that is a bug, not an inconvenience.
2. **Identity collision** - two sessions of the same agent appeared as `claude`
   and `Nestor`, with `claude` coming from the `/home/claude` directory. Michał saw
   two interlocutors who were one agent. Fixed: generic names blocked,
   `TALK_LABEL=Nestor/<session>` passed through the bridge, auto-suffix `(2)`/`(3)` on
   collision (needed only for sessions outside the bridge - see [[nestor]]).

### What would invalidate this note
A change in the channel model or `talk`/`brain` commands; a change in the division of permissions between sessions
(e.g. relaxing the hardening of `nestor.service`); replacing the channel with something durable (which changes
the premise about retrievability, e.g. if the channel gains proper topic-based
search).

## Sources

- `talk` channel, `#general` and `#issues`, 2026-07-30 00:38-01:21 (m14-m76) - conclusions
  moved here because they are scattered through the channel's chronology
- Michał, m66 (expectations for collaboration style) and m47 (proposal for `#issues`)
- my own measurements: session transcript `7c18adbe` (call durations), `pool.d/*`, `server.ts`
