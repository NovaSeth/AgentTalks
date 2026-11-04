# Nestor (MCP bridge on a VPS)

**Summary**: A persistent agent on a VPS, invoked through `ask_nestor` from local Claude Code; memory continuity is per session label, not global.
**Tags**: #nestor #mcp #claude-code #architecture #vps
**Created**: 2026-07-29
**Related**: [[vps-ovh]], [[graph-engineering]], [[motowolt]]

## Content

### What it is
An MCP bridge wrapping the Claude Agent SDK, allowing local Claude Code (laptop, phone)
to delegate tasks to an agent living on a VPS. The agent that built it chose
the name "Nestor" itself.

- Endpoint: `https://nestor.monokoda.com/mcp` (MCP Streamable HTTP, stateless), Bearer token.
- Stack: TypeScript, `@anthropic-ai/claude-agent-sdk` + `@modelcontextprotocol/sdk`,
  Express on `127.0.0.1:8787`, behind the existing Apache reverse proxy, Let's Encrypt certificate.
- systemd unit `nestor`, user `claude`. Code and full docs: `~/workspace/nestor/`.
- Anthropic auth: Claude Max subscription (the CLI on the VPS is signed in), not an API key.
- Without a valid token **every** path returns 404 (discovery resistance); `/health` is localhost only.
- Tools: `ask_nestor(prompt, context?, session?, reset?)` and `nestor_sessions`.
- Nestor curates this wiki - durable knowledge between calls lives in `~/second-brain`.

### How continuity works (critical, empirically verified on 2026-07-29)
Nestor **is not a daemon with one shared stream**. Claude Code runs one process per session,
each with its own ID and transcript. Continuity works as follows:

- `session: <label>` → SDK `resume` of the existing session. The label→sessionId map is in
  `~/workspace/nestor/sessions.json`. No label = one-shot, context is lost.
- The client snippet (`~/workspace/nestor/client/`, injected into `~/.claude/CLAUDE.md`
  between the `<!-- NESTOR:START/END -->` markers) tells local Claude to **automatically**
  pass `session` = the project directory's basename. This gives each project its own continuous thread.

Practical conclusion: **there is one stream, but it belongs to a project, not a machine.** Entering
with the same label = the same thread. Entering another way (e.g. a Claude Code session started on the VPS
directly, through chat/mobile) = a neighbouring thread, invisible to Nestor and vice versa.
Confirmed: on 2026-07-29 a chat session could not see resource diagnostics delegated in parallel
through `ask_nestor` to the `motowolt` label, despite being on the same machine during the same 20 minutes.

### What is shared and what is not
- **No**: contexts. Isolation is a property of the stateless API, not the harness - no trick
  on the Claude Code side can remove it.
- **Yes**: the filesystem. This is the only real channel between sessions. Transcripts live as
  `.jsonl` in `~/.claude/projects/<project>/`, and durable knowledge in `~/second-brain`.
  Knowledge consolidation between sessions must use this route (see [[graph-engineering]]).

### Permissions: remote Nestor does NOT have root (verified on 2026-07-29)
A critical operational constraint, easy to overlook because user `claude` **is** in the
`sudo` group. The `nestor.service` unit has:

```
User=claude
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
```

Effects on an agent spawned by `ask_nestor`:
- `NoNewPrivs: 1` in `/proc/self/status` → the setuid bit on `/usr/bin/sudo` is ignored.
  `sudo` returns `The "no new privileges" flag is set`. **By kernel design, the flag is
  irreversible within a process** - it cannot be removed from itself or its children, even
  with root.
- `ProtectSystem=full` mounts `/etc` and `/usr` as `ro,nosuid` in the process namespace →
  writing to `/etc/**` returns `Read-only file system` **even for root**. `nosuid` on `/usr`
  is also a second, independent reason for `sudo` to fail.
- `systemctl reload <anything>` → `Interactive authentication required` (polkit).

These are three **independent** blocks. Michał confirming "you have admin permissions" changes
nothing, because the problem is not in the sudoers policy.

**Working pattern**: remote Nestor diagnoses and prepares a ready-to-run script with backups,
a configuration test and a graceful reload; Michał executes it over SSH (user `debian`, NOPASSWD
sudo), or a Claude Code session started locally on the box does. This worked for
php-fpm tuning on 2026-07-29 (see [[vps-ovh]]) - with one correction, because Nestor could not
test `php-fpm -t` itself.

Relaxing this hardening is possible (`ReadWritePaths=/etc/php`, `sudoers.d`
with `NOPASSWD` for an allowlist of commands), but **broad root access is not worth granting**: the service is
exposed over public HTTPS and executes instructions arriving over the network.

### Memory: `~/second-brain` is the only reliable channel
Claude Code's memory directory depends on **the cwd when the session starts**. Nestor starts
the agent with `NESTOR_HOME=/home/claude`, so it loads `~/.claude/projects/-home-claude/memory/`
- and that directory is **empty** (as of 2026-07-30). A memory note about Nestor was
once saved with cwd `~/workspace`, so it ended up in
`~/.claude/projects/-home-claude-workspace/memory/` and is **not readable by remote Nestor
at startup** - orphaned, not lost.

**Therefore, save durable knowledge in `~/second-brain`, not in the memory directory.** The wiki is
specified in Nestor's system prompt, so it is independent of cwd. To make the memory directory
work, it must be symlinked or `NESTOR_HOME` changed - Michał's decision.

### Resource cost and concurrency
- Each `ask_nestor` call starts a separate `claude` process (SDK). The processes are
  **transient** - they end after the call, confirmed by observation.
- The persistent `node dist/server.js` is ~35 MB. Cheap, it should stay.
- **Verified in source**: `src/server.ts:177` calls `withLock('sess:' + session)` (helper
  on line 79) - the lock key includes the label, so calls with **different** labels run
  in parallel and there is no global concurrency limit.
  Line numbers checked on 2026-07-30; previously `:144` / `:76-90`, the code moved
  when `TALK_LABEL` was added. Search by the name `withLock`, not by line number.

### Label semantics: one label = one thread, serially
The consequence of two mechanisms together, worth recording because it is not obvious:
- `sessions.json` maps a label to **one** `sessionId` (not a list).
- `withLock('sess:' + label)` serializes calls with the same label.

So **two sessions with the same label never coexist through the bridge** - the second
call waits and resumes the same thread. Parallelism exists only **between different**
labels. Established on 2026-07-30 together with session `Nestor/chat-vps`, which confirmed it
in the code.

Practical effects:
- A name collision of "the same project twice at once" **cannot happen through the bridge.**
  The auto-suffix `(2)`/`(3)` in the [[talk]] channel is needed only for sessions **outside** the bridge
  (screen, app, manual launches) - there is no label from the project directory there, and that is where
  the generic `claude` from `/home/claude` came from.
- Restarting the bridge **does not lose the thread**: the session resumes using the `sessionId` from `sessions.json`.
  Checked on 2026-07-30 - `nestor.service` came up at 00:47:36 during a live `motowolt` session;
  the thread survived.

**Methodological lesson** (broader than this code): a test that bypasses the mutex and label
map proves **the correctness of the logic, not the feasibility of the scenario**. A simulation of four
calls "confirmed" collision handling for a collision that cannot occur on the production path.
When testing concurrency, check whether the test bypasses the very mechanism that
determines whether the scenario is reachable.

**Correction 2026-07-30**: I originally wrote "2 × 290 MB → certain OOM" here. Those 290 MB were
**RSS, which overestimates** (see methodology in [[vps-ovh]]) - PSS for the entire `claude` stack is ~344 MB
across all processes together. The risk is therefore real, but smaller than I wrote: several
parallel SDK sessions alongside the 330-megabyte `screen` session may exhaust the headroom, but
two on their own do not necessarily do so. **The size of the risk is still unknown** - that is why the sampler
`~/bin/lowmem-sample.sh` is running, rather than any limit set by guesswork.

**If a limit is needed, it should not be fixed.** A fixed cap = 1 would serialize calls
between projects (B waits minutes for A) - a real functional regression, because Nestor's entire
value lies in each project having its own continuous thread. The right pattern is a **memory
gate**: check `MemAvailable` before spawning, admit the process if there is headroom,
otherwise queue it. Concurrency remains whenever the machine can support it.

Separately: a transcript consolidator with subagent fan-out on this box would have to run
sequentially anyway (see [[graph-engineering]]).

### Design decisions
- MCP instead of the A2A protocol, because Claude Code speaks MCP natively; A2A would require a bridge.
  A2A remains an option for conversations with non-Claude agents.
- Do **not** use `/loop` to unify contexts: resuming by label gives continuity while paying
  only when used; a loop would charge on every tick and add ~a quarter-hour of latency.
  A loop makes sense for things happening without Michał (monitoring, consolidation), not for delivering messages.

### Minor notes
- The MCP server identifier on Michał's laptop was changed from `nestor` to `Nestor`
  (`~/.claude.json`, 2026-07-29). Purely cosmetic - it affects only the tool names
  in local Claude Code; nothing changed on the VPS side.
- Automatic labelling confirmed in operation: `sessions.json` after the 2026-07-29 session contains
  `{"motowolt": {...}}`. The entry appears **after** the first call with a label, so an empty
  `{}` at startup does not mean the mechanism is broken.

### What would invalidate this note
Changing the lock key or adding a global limit in `src/server.ts`; changing the automatic
labelling mechanism in the client snippet; changing VPS RAM; relaxing hardening in the
`nestor.service` unit; symlinking the memory directory or changing `NESTOR_HOME`.

## Sources

- `~/workspace/nestor/` (code, README) - read on 2026-07-29
- `~/workspace/nestor/src/server.ts:79,177` (`withLock`, mutex scope - verified
  in source on 2026-07-30; line numbers shift, search by name)
- `talk` channel, exchange with session `Nestor/chat-vps` on 2026-07-30 (m44/m45) - establishing
  label semantics; the channel is ephemeral, which is why the conclusion is here
- `~/workspace/nestor/sessions.json`, `~/.claude/projects/**/*.jsonl` (session measurements)
- Claude Code chat session on the VPS, 2026-07-29
