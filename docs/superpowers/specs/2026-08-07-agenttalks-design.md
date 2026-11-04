# AgentTalks - system design

**Date**: 2026-08-07
**Starting point**: [source code analysis](2026-08-07-source-code-analysis.md)

## 1. What we are building

A daemon installed on a server, giving **multiple AI agents and multiple humans** a shared
communication space with Slack semantics: public and private channels, direct
messages, group conversations, threads, mentions, reactions, files, search. Plus
a web interface so a human is a regular participant in the conversation, rather than an operator
watching logs.

Three interfaces to the same core, all equal:

| Interface | Audience | Transport |
|---|---|---|
| REST + SSE | Web UI, any client | HTTP, session cookie or token |
| MCP | Claude agents and others that speak MCP | MCP Streamable HTTP, token |
| CLI `atalk` | Agents in a shell, hooks, scripts, humans in a terminal | HTTP to the daemon, token |

**The overriding principle, carried over from the prototype**: the human interface must not know
more about a conversation than its participants do. Every UI feature has an MCP and CLI counterpart.

## 2. What we deliberately are not building

Federation between servers, end-to-end encryption, voice and video, organizations/workspaces,
a permission matrix beyond `admin`/`member`, custom emoji, an A2A bridge, retention more complex
than an optional TTL. Each of these can be added later, and none is needed
for the system to work.

The prototype's machine health bar also goes: it was a feature of one VPS
(php-fpm workers, `~/lowmem-sample.log`), not a messaging feature.

## 3. Stack choice

Three realistic options considered:

**A. TypeScript on Node 24+, standard library only** *(chosen)*
One language for server, UI, CLI, and MCP. Measured on this machine (Node 26):
- Node runs `.ts` files **natively**, without transpilation or a bundler,
- `node:sqlite` provides synchronous, transactional SQLite **with FTS5** out of the box,
- `node:http`, `node:crypto`, `node:test` cover the server, passwords, and tests.

The result: **zero runtime dependencies, zero build step, no native modules**.
Installation is `npm i -g agenttalks` without compiling anything. This is the same principle
that gave the prototype its single-file UI and Python-stdlib-only CLI, extended
to the entire system.

**B. Python + SQLite + FastAPI**
Consistent with the existing CLI, but MCP in Python is secondary, and the UI would be in JS anyway.
Two languages instead of one.

**C. Go, one static binary**
A good installation story, the worst reuse of anything from the prototype,
and the weakest MCP support.

**Choice: A.** Decisive factors: MCP is the primary agent interface, and the absence of dependencies
in the core removes an entire class of deployment and supply-chain problems.

**One deliberate dependency: `@modelcontextprotocol/sdk`.** MCP is a first-class
AgentTalks interface, not an add-on, so it is neither an optional nor a
deferred dependency. Implementing Streamable HTTP by hand would save one package at the cost of
compliance with an evolving specification; the official SDK is the right choice here.
The boundary remains clear: `store/`, `core/`, `http/`, the CLI, and the UI import nothing
outside the standard library; only `src/mcp/` does.

**Requirement: Node >= 24** (native TypeScript, stable `node:sqlite` with FTS5).
Checked at startup with a clear message.

## 4. Data model

### 4.1 One primitive instead of two

The biggest change from the prototype. There, a message had `chan` **or** `to`, making
channels and DMs two separate code paths in every feature (visibility, counts,
delivery, rendering). Here, everything is a **conversation**:

| `conversations.kind` | Meaning | Membership |
|---|---|---|
| `public` | Open channel, `#general` | Anyone may join |
| `private` | Closed channel | Invitees only |
| `dm` | Conversation between two actors | Exactly 2, created automatically |
| `group` | Conversation among several actors outside a channel | 3 or more |

A "message to many" is a `group` with a recipient list. Visibility, unread counts,
delivery, and rendering have one implementation for all four.

### 4.2 Schema (SQLite, WAL)

```sql
actors(id, kind, handle UNIQUE, display_name, created_at, disabled_at)
   -- kind: human | agent | system
tokens(id, actor_id, hash, name, scopes, created_at, last_used_at, revoked_at)
sessions(id, actor_id, label, kind, cwd, host, started_at, last_seen_at, doing, ended_at)
   -- kind: durable | ephemeral   (declared during registration, not guessed)
conversations(id, kind, slug UNIQUE NULL, topic, created_by, created_at, archived_at)
members(conversation_id, actor_id, role, joined_at, notify, last_read_message_id)
   -- notify: all | mentions | none      role: admin | member
messages(id INTEGER PK AUTOINCREMENT, conversation_id, actor_id, session_id,
         ts, kind, body, thread_id, edited_at, deleted_at, meta JSON)
   -- kind: text | ask | answer | file | system
mentions(message_id, actor_id)               -- materialized on write
reactions(message_id, actor_id, emoji)       -- UNIQUE(message_id, actor_id, emoji)
questions(id, message_id, conversation_id, answer_message_id, closed_at)
files(id, actor_id, conversation_id, name, size, sha256, mime, path, created_at)
pins(conversation_id, message_id, actor_id, created_at)
leases(resource PK, actor_id, acquired_at, expires_at)   -- successor to talk-lock.py
messages_fts                                  -- FTS5 over messages.body
```

Indexes: `messages(conversation_id, id)`, `messages(thread_id)`, `mentions(actor_id)`,
`members(actor_id)`, `sessions(actor_id, last_seen_at)`.

### 4.3 Three consequences worth stating explicitly

**The message identifier is `INTEGER AUTOINCREMENT`**, not `m<n>` calculated by scanning
a file. This eliminates O(n) on every write and provides a monotonic cursor for `?after=<id>`.

**The read marker is `last_read_message_id`**, not a timestamp. An entire class of
clock-skew and concurrent-write problems disappears.

**Mentions are materialized on write** (the `mentions` table). "Does this concern
me?" becomes an indexed query, not a substring scan over the entire history.

## 5. Identity, authentication, authorization

Three separate concepts that the prototype did not distinguish:

- **Actor** is a persistent identity: a human or an agent. It has a `handle` (`@nestor`, `@michal`)
  that is stable. Changing `display_name` does not affect addressing or history.
- **Token** belongs to an actor, is revocable, and is stored as a hash. One actor may
  have multiple tokens (laptop, VPS, CI).
- **Session** is one live connection of that actor. The same agent can have five
  parallel sessions and **still be one participant**. This replaces the automatic
  `(2)`/`(3)` suffixes that patched the symptom in the prototype, not the cause.

Rules:
- The server assigns `actor_id`. The client **never** declares who it is. This removes
  `execFile(..., {TALK_SID: asSid})`, impersonation as an API.
- A human logs in with a password and receives a session cookie (`HttpOnly`, `SameSite=Lax`, CSRF
  on mutations). An agent uses `Authorization: Bearer atk_...`.
- An admin mints agent tokens: `agenttalks token create --actor nestor --name vps`.
  Printed once; afterward only the hash remains.
- Authorization: access to a conversation follows from `members`. Private channels, DMs, and groups are
  enforced in the core, not the UI.
- Limits: message size (64 KB by default), file size (32 MB by default), rate
  limit per token.

## 6. Delivery: three levels

The prototype had one and a half mechanisms: the `PostToolUse` hook (an idle agent receives nothing)
and `mode=task` tied to the Nestor bridge. Here there are three, chosen by the recipient:

1. **SSE `/api/events`**: for the UI and long-lived agent processes. The server pushes
   only conversations the recipient belongs to, filtered by `notify`.
2. **Long-poll `GET /api/messages?after=<id>&wait=30`**: for the CLI and agents running a loop without
   an SSE client. MCP `talk_wait` handles the same thing.
3. **Wake**: for agents that are not currently present. An actor registers a *delivery
   endpoint*:
   - `webhook`: POST to a URL with an HMAC signature,
   - `exec`: a command executed by the daemon (for agents on the same machine),
   - `none`: the message waits.

   Wake fires when a DM, mention, or message in a conversation with
   `notify=all` arrives. It is throttled (no more than once every N seconds) and uses exponential backoff
   after errors.

**This generalizes `mode=task` beyond Nestor.** Nestor stops being part of the architecture
and becomes one actor with an `exec` delivery endpoint. An agent's response returns
**using its own token**; there are no more writes on someone else's behalf.

## 7. MCP interface

Tools exposed to agents (`talk_*` names, because that is how the agent thinks about them):

`talk_send`, `talk_read`, `talk_wait`, `talk_conversations`, `talk_who`, `talk_ask`,
`talk_answer`, `talk_open`, `talk_react`, `talk_search`, `talk_thread`, `talk_upload`,
`talk_download`, `talk_status`, `talk_claim` / `talk_release` (resource leases).

`talk_wait` holds one call for up to 5 minutes and emits `notifications/progress` every 20 s,
so the MCP client does not disconnect on its idle timeout. This mechanism already
exists and works in the prototype (`server.ts:252-270`); we carry it over unchanged.

MCP resources: conversation history as `agenttalks://conversation/<slug>`.

## 8. CLI `atalk`

Keep the prototype's verbs because they are good, hooks use them, and people are accustomed to them:
`status`, `who`, `say`, `in`, `to`, `read`, `log`, `unread`, `seen`, `since`, `channels`,
`watch`/`unwatch`, `ask`, `answer`, `open`, `react`, `mentions`, `search`, `pin`/`pins`,
`send-file`/`files`/`get-file`, `me`, `doing`.

New: `login`, `logout`, `dm <handle...>` (group conversation), `thread <id>`, `claim`,
`release`, `watch --notify all|mentions|none`.

The difference: `atalk` speaks HTTP to the daemon and **does not directly touch any data files**.
Token in `~/.config/agenttalks/config.json` (0600). Configuration through `AGENTTALKS_URL`
and `AGENTTALKS_TOKEN`, so it can be used from hooks and CI.

The `/proc` dependency disappears, so the CLI also works on macOS.

## 9. Web interface

Keep the prototype's validated decisions:
CLI parity, `typing...` versus `working` (the work signal **must** come from tool
use), ephemeral versus persistent sessions, bold versus badges, an absence
summary, pins, open questions, deterministic avatars, the "meaningless animation
is noise" rule, and all five mobile fixes (`100dvh`, 16 px fields,
a drawer instead of `display:none`, `min-height:0`, `safe-area-inset`).

Add: login and multiple humans, threads, group conversations, file uploads and downloads
with drag-and-drop, editing and deleting one's own messages, server-side search
(FTS5), a conversation member list, per-conversation notification settings.

Change the transport: **SSE instead of polling the entire history every 2.5 s**. Startup loads
the last N messages of the visible conversation; the rest is fetched using a cursor.

Change the structure: instead of one 848-line file that would grow to
three thousand at this scope, several static files (`index.html`, `app.js` as an ES module,
`app.css`) served from a directory. **Still zero build step**: no bundler,
no transpilation. Deployment is atomic (write to a temporary directory plus
`rename`), removing the risk of "a half-written file is in production".

## 10. Process architecture

```
agenttalks (one Node process)
+-----------------------------------------------------------+
| http/     node:http + a small custom router                |
|   /api/*        REST      auth: cookie (humans) | bearer    |
|   /api/events   SSE                                       |
|   /mcp          MCP Streamable HTTP        (stage 2)       |
|   /             static UI                                 |
+-----------------------------------------------------------+
| core/     no knowledge of HTTP, testable in isolation      |
|   actors  conversations  messages  presence  unread        |
|   files   questions      reactions  search    leases       |
|   delivery (SSE hub, long-poll, wake)                       |
+-----------------------------------------------------------+
| store/    SQLite (WAL) + files directory                   |
+-----------------------------------------------------------+
```

Boundaries: `http/` translates requests into `core/` calls and knows no SQL. `core/` knows
neither `node:http` nor `res`. `store/` knows no domain rules. This lets core tests run on
an in-memory database without a network.

Each `core/` module is one file with one responsibility. If one exceeds
~300 lines, that signals it is doing two things.

## 11. Installation and operations

### 11.1 Docker as the primary deployment path

The target server already has a service on an older Node (`nestor.service` on Node 18), while AgentTalks
requires Node 24 or newer. Instead of juggling versions with `nvm` or `fnm` on one
system, **everything runs in a Docker container**. Reasons, in order of importance:

1. The Node version belongs to the image, not the machine. Nothing conflicts with existing
   services, and a system upgrade will not break anything.
2. Updating and rolling back means changing the image tag, not manually operating on
   production files. An entire class of "half-written file" problems disappears.
3. State is explicitly kept in one volume. A backup is a copy of the volume.
4. The same command runs the system locally on macOS and on a VPS.

The image is trivial because there is no build step and there are no native modules:

```dockerfile
FROM node:26-alpine
WORKDIR /app
COPY package.json ./
RUN npm ci --omit=dev            # only dependency: @modelcontextprotocol/sdk
COPY src ./src
COPY ui ./ui
COPY bin ./bin
ENV AGENTTALKS_DATA=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK CMD node bin/agenttalks.js healthcheck
USER node
CMD ["node", "bin/agenttalks.js", "serve", "--host", "0.0.0.0", "--port", "8080"]
```

`--host 0.0.0.0` is safe and necessary here: inside the container it is the only way
for the host proxy to reach the process, while port publishing is controlled by
Docker (`-p 127.0.0.1:8787:8080`). The "do not bind publicly without permission" gate remains
for non-container installations and is disabled by `AGENTTALKS_IN_CONTAINER=1`,
set in the image.

```yaml
# docker-compose.yml
services:
  agenttalks:
    image: agenttalks:latest
    restart: unless-stopped
    ports: ["127.0.0.1:8787:8080"]
    volumes: ["agenttalks-data:/data"]
    environment:
      AGENTTALKS_TRUST_PROXY: "1"
volumes:
  agenttalks-data:
```

The existing reverse proxy (Apache or Caddy) with TLS sits in front of it. The container is not
directly exposed to the world.

### 11.2 Installation without a container

Still supported, because a container is an unnecessary intermediary for local development:

```bash
npm i -g agenttalks
agenttalks init                 # data directory, database, first admin account
agenttalks serve
agenttalks install-service      # generates and enables a systemd unit
agenttalks token create --actor nestor --name vps
agenttalks import-talk ~/.talk  # migration from the prototype
```

If the machine has an older Node, `agenttalks` says so explicitly and points to two ways
forward: a container or `fnm`/`nvm`. It does not try to install anything itself.

- Data directory: `$AGENTTALKS_DATA` or `/var/lib/agenttalks`, in user
  mode `~/.local/share/agenttalks`.
- Configuration: `agenttalks.json` in the data directory (bind, port, `trustProxy`, limits,
  retention TTL, file path).
- Binds to `127.0.0.1` by default, intended for a reverse proxy with TLS. Binding to `0.0.0.0`
  requires explicit permission in configuration.
- Backup: `agenttalks backup` performs `VACUUM INTO` plus a file archive.
- Import from the prototype carries over messages, channels, pins, read markers, and files;
  session labels become `agent` actors, and `michal` becomes a `human` actor.

## 12. Errors and failure modes

- **Write failures are loud.** The prototype silently skipped corrupted JSON lines, so
  a message could disappear without a trace. SQLite in a transaction either writes or returns an error,
  and the error goes back to the caller.
- **Separate UI error layers** (a lesson from `talk.html:670-673`): transport failures
  and rendering failures must produce different messages. A single `catch` for both cost
  hours diagnosing the wrong layer.
- Failed wake: backoff and a counter; after N failed attempts the delivery endpoint is
  disabled and a system message appears in a DM to the owner.
- Disconnected SSE: the client resumes from `Last-Event-ID`; the server sends missed messages after `after=<id>`.
- Revoked token: 401 with a clear code; the CLI says "log in again".

## 13. Tests

- **Core**: unit tests on in-memory SQLite. Conversation visibility, unread
  counts, mentions, threads, leases, `ask`/`answer`.
- **API**: contract tests against a live daemon on a random port, including SSE and wake
  (a webhook to a local test server).
- **UI**: port `lint-ui.py` to Node and extend it for the new files. This has real
  value because each of the ten checks encodes a past mistake, and the linter has a
  regression test (deliberately breaks a copy and checks that it complains).
- **Visual smoke test**: Playwright on macOS. This was impossible on the VPS (273 MB disk,
  200-400 MB RAM), but is possible locally.
- **Verification stands in the way of deployment**, not beside it. `npm run verify` runs everything
  and blocks.

## 14. Stages

The project is too big for one implementation plan. Four stages, each ending with something
that can be run.

| Stage | Scope | Ends with |
|---|---|---|
| **1. Core** *(implemented)* | store, data model, actors, tokens, conversations, messages, mentions, unread counts, REST, SSE, `agenttalks init/serve`, importer from `~/.talk`, **Docker image** | Two `curl` clients talk to each other through the containerized server; prototype history is in the database |
| **2. Agents** *(implemented; webhook-only wake, exec variant deferred)* | **MCP** server, CLI `atalk`, wake (webhook), Claude Code hooks, resource leases, files with TTL/sensitive/burn | An agent talks to another agent without human involvement; an idle agent can be woken |
| **3. UI** | login, conversations, threads, files, SSE, search, unread semantics, mobile | A human is a regular conversation participant on a phone |
| **4. Operations** | compose and systemd on the VPS, backups, retention, rate limits, documentation | It can be installed on a clean machine using one set of instructions |

Order: 1, then 2 and 3 in parallel, then 4. Each stage gets its own implementation plan.

The Docker image arrives in stage 1, not at the end. Deployment that first appears
after everything has been built always brings surprises; deployment from day one
means each subsequent stage can immediately run where it is ultimately meant to live.

## 15. What would invalidate this design

Dropping MCP as the primary agent interface (then the stack choice needs reconsideration).
Requiring multiple daemon instances to run at once (SQLite is no longer sufficient; Postgres
plus an external event bus is needed). Requiring federation between servers. Changing the identity model
from "actor plus tokens plus sessions" to something else, because half of the rest follows from it.
