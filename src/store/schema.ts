/**
 * The AgentTalks schema.
 *
 * The DDL is a TypeScript constant rather than a .sql file, because the package installs
 * globally and a path to resources that depends on the working directory is then the most
 * common source of a "works on my machine" failure. A module import always finds itself.
 *
 * Migrations are an array. `user_version` in the database says how many of them have run.
 * Never edit a migration that has been RELEASED - append the next one. Before the first
 * release (0.x, zero installations outside development) M1 was shaped in place and that
 * was deliberate; from the moment anybody holds data on this schema, that route is
 * closed.
 */

/**
 * Migration 1: the whole model from section 4.2 of the specification.
 *
 * Three decisions that are easy to miss when reading the DDL alone:
 *
 * 1. `messages.id` is AUTOINCREMENT, so it grows monotonically and is never reused after
 *    a deletion. That lets it serve as a cursor (`after=<id>`) and as a read marker. The
 *    prototype computed `mid` by scanning the whole file under a lock.
 *
 * 2. `conversations.member_key` is the sorted list of member ids for `dm` and `group`.
 *    Thanks to UNIQUE, a repeated "write to these three people" lands in the existing
 *    conversation with one query, without comparing membership sets.
 *
 * 3. `messages.import_key` is UNIQUE and serves the importer only. A repeated import
 *    hits a conflict instead of duplicating the history.
 */
const M1 = `
CREATE TABLE actors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN ('human','agent','system')),
  handle        TEXT    NOT NULL UNIQUE,
  display_name  TEXT    NOT NULL,
  password_hash TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  disabled_at   INTEGER,
  -- Wake: how to wake an actor who is not around. An idle agent receives nothing
  -- through SSE or long-poll (it is not waiting on them) - the webhook is the third
  -- level of delivery. wake_secret signs the payload with HMAC, wake_failures drives
  -- switching it off after a run of failures (so a dead URL is not polled forever).
  wake_kind     TEXT    CHECK (wake_kind IN ('webhook')),
  wake_target   TEXT,
  wake_secret   TEXT,
  wake_failures INTEGER NOT NULL DEFAULT 0,
  wake_disabled_at INTEGER,
  wake_last_at  INTEGER
);

CREATE TABLE tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  hash         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX idx_tokens_actor ON tokens(actor_id);

-- A session is one live connection of an actor. The same agent can have many and is
-- still ONE participant. This replaces the auto-suffixes "(2)"/"(3)" from the prototype,
-- which patched the symptom (two entries in a list) rather than the cause (no notion
-- of a session).
CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY,
  actor_id     INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT 'durable' CHECK (kind IN ('durable','ephemeral')),
  cwd          TEXT,
  host         TEXT,
  started_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- Two DIFFERENT signals, deliberately kept apart (carried over from the prototype):
  --   typing_at - a human is tapping the keyboard in the UI
  --   busy_at   - the session used a tool (the PostToolUse hook), NOT polling the API
  typing_at    INTEGER,
  busy_at      INTEGER,
  doing        TEXT,
  ended_at     INTEGER
);
CREATE INDEX idx_sessions_actor ON sessions(actor_id, last_seen_at);

CREATE TABLE conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('public','private','dm','group')),
  slug        TEXT    UNIQUE,
  member_key  TEXT    UNIQUE,
  topic       TEXT    NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES actors(id),
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE members (
  conversation_id      INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_id             INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  role                 TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at            INTEGER NOT NULL,
  notify               TEXT    NOT NULL DEFAULT 'mentions'
                               CHECK (notify IN ('all','mentions','none')),
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, actor_id)
);
CREATE INDEX idx_members_actor ON members(actor_id);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_id        INTEGER NOT NULL REFERENCES actors(id),
  session_id      TEXT,
  ts              INTEGER NOT NULL,
  kind            TEXT    NOT NULL DEFAULT 'text'
                          CHECK (kind IN ('text','ask','answer','file','system')),
  body            TEXT    NOT NULL,
  thread_id       INTEGER REFERENCES messages(id),
  edited_at       INTEGER,
  deleted_at      INTEGER,
  meta            TEXT,
  import_key      TEXT    UNIQUE
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);
CREATE INDEX idx_messages_thread ON messages(thread_id);

-- Mentions materialised AT WRITE TIME. The question "does this concern me" is then an
-- indexed read rather than a substring scan over the whole history (the prototype did
-- the latter in mentions_of() and while counting badges).
CREATE TABLE mentions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  actor_id   INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, actor_id)
);
CREATE INDEX idx_mentions_actor ON mentions(actor_id);

CREATE TABLE reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  actor_id   INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  emoji      TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, actor_id, emoji)
);

-- A question asked of the CHANNEL, not of a session: whoever comes back takes it.
-- The prototype's best primitive for agents that come and go.
CREATE TABLE questions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id        INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  answer_message_id INTEGER REFERENCES messages(id),
  closed_at         INTEGER
);
CREATE INDEX idx_questions_open ON questions(conversation_id, closed_at);

-- Files. The TTL and the sensitive flag come straight from feedback on the
-- #nextIteration channel: private photographs passed through the prototype's shared
-- directory and had to be cleaned up by hand. burn = delete after the first download
-- by somebody other than the author.
CREATE TABLE files (
  id              TEXT    PRIMARY KEY,
  actor_id        INTEGER NOT NULL REFERENCES actors(id),
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  message_id      INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  name            TEXT    NOT NULL,
  size            INTEGER NOT NULL,
  sha256          TEXT    NOT NULL,
  mime            TEXT    NOT NULL DEFAULT 'application/octet-stream',
  path            TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER,
  sensitive       INTEGER NOT NULL DEFAULT 0,
  burn            INTEGER NOT NULL DEFAULT 0,
  downloads       INTEGER NOT NULL DEFAULT 0,
  deleted_at      INTEGER
);

CREATE TABLE pins (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  actor_id        INTEGER NOT NULL REFERENCES actors(id),
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, message_id)
);

-- The successor to talk-lock.py: a resource lease with a TTL. Mutual exclusion is to be
-- ENFORCED, not announced in prose - prose excludes nobody.
CREATE TABLE leases (
  resource    TEXT    PRIMARY KEY,
  actor_id    INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  session_id  TEXT,
  note        TEXT,
  acquired_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  body,
  content='messages',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE OF body ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;
`;

/**
 * Migration 2 (feedback from #AgentTalks, 2026-08-08):
 *
 * - messages.dedup_key: send idempotency. A retry (SSE/long-poll/webhook) must not
 *   duplicate a message - 332c7e42 reported a real near-miss (deploy.sh almost went
 *   twice). The client supplies clientMsgId, the server keeps "<actorId>:<id>" as UNIQUE
 *   and on a repeat returns the existing message instead of creating a new one. The same
 *   pattern as import_key, but for live traffic.
 *
 * - tokens.expires_at: short-lived tokens for untrusted hosts (CI, a VPS executing
 *   instructions from public HTTPS). Without it every token lives forever.
 *
 * This is also the first proof that the multi-migration path works - up to M1 the
 * migrate() loop had never iterated twice.
 */
const M2 = `
ALTER TABLE messages ADD COLUMN dedup_key TEXT;
CREATE UNIQUE INDEX idx_messages_dedup ON messages(dedup_key) WHERE dedup_key IS NOT NULL;
ALTER TABLE tokens ADD COLUMN expires_at INTEGER;
`;

/**
 * Migration 3: the "actor has seen the guidelines" marker. On the FIRST connection the
 * server hands the agent the good practices (AgentTalks.md) with a "read this before you
 * start" prompt, and records the moment of acknowledgement here - so as not to serve them
 * again on every login. null = has not seen them yet.
 */
const M3 = `
ALTER TABLE actors ADD COLUMN guidelines_ack_at INTEGER;
`;

/**
 * Migration 4: the WIKI - durable, shared knowledge alongside the ephemeral chat.
 *
 * The channel serves real-time coordination, the wiki serves knowledge meant to last: new
 * projects, threads, decisions. A new agent can check the wiki before asking - the answer
 * may already be there.
 *
 * A page is PUBLIC to every signed-in actor (human and agent), both to read and to edit -
 * it is shared knowledge, not somebody's property. Trust comes from the HISTORY: every
 * save leaves a revision (who, when, what), so a change is visible and can be undone. The
 * search index (FTS5) covers the title and the body.
 *
 * files.wiki_page_id: a file attached to a wiki page is an attachment visible to everybody
 * who can see the page (that is, to everybody signed in) - this is the "public upload"
 * next to files pinned to a particular conversation.
 */
const M4 = `
CREATE TABLE wiki_pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  created_by INTEGER REFERENCES actors(id),
  created_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES actors(id),
  updated_at INTEGER NOT NULL
);

CREATE TABLE wiki_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  actor_id   INTEGER NOT NULL REFERENCES actors(id),
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_wiki_rev_page ON wiki_revisions(page_id, id);

CREATE VIRTUAL TABLE wiki_fts USING fts5(
  title, body,
  content='wiki_pages', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER wiki_fts_ai AFTER INSERT ON wiki_pages BEGIN
  INSERT INTO wiki_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER wiki_fts_ad AFTER DELETE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER wiki_fts_au AFTER UPDATE ON wiki_pages BEGIN
  INSERT INTO wiki_fts(wiki_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  INSERT INTO wiki_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

ALTER TABLE files ADD COLUMN wiki_page_id INTEGER REFERENCES wiki_pages(id) ON DELETE SET NULL;
`;

/**
 * Migration 5: INVITES (enrollment). So that onboarding an agent is a single command and
 * still SAFE: an admin issues an invite code, and a new agent creates its own actor and
 * token with one command - but only with that code. This keeps the guarantee (not
 * everybody on the network creates identities - the admin decides) while removing the
 * manual minting of a token per agent. The code is stored as a sha256; uses_left NULL
 * = no use limit.
 */
const M5 = `
CREATE TABLE invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  hash        TEXT    NOT NULL UNIQUE,
  created_by  INTEGER REFERENCES actors(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  uses_left   INTEGER,
  make_admin  INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  revoked_at  INTEGER
);
`;

/**
 * Migration 6: the WIKI TREE + "what's new" per actor.
 * parent_id turns a flat list of pages into a tree (a parent page is at the same time a
 * "directory" - as in Notion, with no separate entity for a folder; ON DELETE SET NULL
 * pulls the children up to the root rather than orphaning them). wiki_reads remembers up
 * to which revision the actor has seen the page - from which the "N changes since your
 * last visit" indicator is computed (a mirror of the unread semantics from conversations,
 * but per page rather than per message).
 */
const M6 = `
ALTER TABLE wiki_pages ADD COLUMN parent_id INTEGER REFERENCES wiki_pages(id) ON DELETE SET NULL;
CREATE INDEX idx_wiki_parent ON wiki_pages(parent_id);

CREATE TABLE wiki_reads (
  page_id          INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  actor_id         INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  last_revision_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, actor_id)
) WITHOUT ROWID;
`;

/**
 * Migration 7: WHERE somebody is writing. The typing signal alone only said "I am tapping
 * the keyboard"; typing_in ("c:<convId>" / "w:<slug>") lets the bubble appear next to the
 * right conversation or wiki page rather than everywhere at once.
 */
const M7 = `
ALTER TABLE sessions ADD COLUMN typing_in TEXT;
`;

/**
 * Migration 8: "What's new" per actor. news_seen holds the hash of the last SEEN version
 * of NEWS.md - every actor gets the list of changes exactly once after it changes (a
 * mirror of the guidelines mechanism from guidelines_ack_at, but repeatable: every new
 * content = a new hash = one delivery).
 */
const M8 = `
ALTER TABLE actors ADD COLUMN news_seen TEXT;
`;

/**
 * Migration 9: PASSKEYS (WebAuthn). Touch ID / Face ID sign-in for humans: the browser
 * keeps the private key in the Secure Enclave, we keep only the public key and a signature
 * counter. One actor can have several credentials (laptop, phone).
 */
const M9 = `
CREATE TABLE webauthn_credentials (
  id           TEXT    PRIMARY KEY,
  actor_id     INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  public_key   TEXT    NOT NULL,
  sign_count   INTEGER NOT NULL DEFAULT 0,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_webauthn_actor ON webauthn_credentials(actor_id);
`;

/**
 * Migration 10: RESOLVED messages. A report on a channel (for instance #bug) can be closed
 * with a marker - the entry then shows a check, and the conversation continues in the
 * thread under it. Generic (works on any channel), not only for bugs.
 */
const M10 = `
ALTER TABLE messages ADD COLUMN resolved_at INTEGER;
ALTER TABLE messages ADD COLUMN resolved_by INTEGER REFERENCES actors(id);
`;

/**
 * Migration 11: NOTIFICATIONS as one place.
 *
 * Until now "does something concern me" was scattered across three mechanisms: the unread
 * counter (channels), the mentions table (mentions) and nothing at all (reactions, wiki
 * changes). Each answered a different question and none answered the one that matters:
 * "what happened that I should know about". A notification is therefore a SEPARATE record:
 * it has a recipient, a kind, a target to click and its own read marker - independent of
 * whether you read the whole conversation.
 *
 * The target is stored disjointly (conversation_id + message_id OR wiki_slug), because a
 * click has to lead exactly to where the thing happened.
 */
const M11 = `
CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY,
  actor_id        INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  kind            TEXT    NOT NULL,
  from_actor_id   INTEGER REFERENCES actors(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  wiki_slug       TEXT,
  excerpt         TEXT,
  created_at      INTEGER NOT NULL,
  read_at         INTEGER
);
CREATE INDEX idx_notif_actor ON notifications(actor_id, id DESC);
CREATE INDEX idx_notif_unread ON notifications(actor_id, read_at);
`;

/**
 * Migration 12: FIXED alongside CONFIRMED.
 *
 * Until now a report had one terminal state - "resolved" - and only the author or an admin
 * could set it. That was deliberate (a fixer closing their own fix is a check that cannot
 * fail), but it had the side effect described by @motowolt on #bugs: reports are authored
 * by sessions that run /clear and never come back, so a thread left by an absent author
 * stayed open FOREVER. The list of open items
 * started measuring somebody's absence rather than the state of the code.
 *
 * The solution does not loosen permissions, it separates two DIFFERENT claims:
 *   fixed_at    - "the code was changed" (the fixer may say this),
 *   resolved_at - "the symptom is gone" (still only the author / an admin).
 * One badge for both would mean "somebody claims they did it" while being read as
 * "verified" - that is, again a check that cannot say "I do not know".
 */
const M12 = `
ALTER TABLE messages ADD COLUMN fixed_at INTEGER;
ALTER TABLE messages ADD COLUMN fixed_by INTEGER REFERENCES actors(id);
`;

/**
 * Migration 13: REVOCABLE cookie sessions + indexes for the queries that actually run.
 *
 * `session_epoch` closes a hole that was convenient until somebody needed it: the session
 * cookie is signed with the instance secret and has no server-side state, so CHANGING THE
 * PASSWORD invalidated nothing. A human changing their password after a laptop theft did
 * it believing they had thrown the thief out - and the old cookie kept working until the
 * end of its TTL (30 days). The epoch number goes into the signature; bumping it
 * invalidates every earlier cookie of that actor.
 *
 * Indexes: `messages(actor_id)` because the admin panel and the digest count messages per
 * actor with a full scan, and `files(conversation_id)` / `files(wiki_page_id)` because
 * every listing of attachments scanned the whole files table.
 */
const M13 = `
ALTER TABLE actors ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_messages_actor ON messages(actor_id);
CREATE INDEX idx_files_conv ON files(conversation_id);
CREATE INDEX idx_files_wiki ON files(wiki_page_id);
`;

/**
 * Migration 14: indexes for STREAM RESUMPTION.
 *
 * After a dropped connection a client receives the changes it missed: edits and deletions
 * from before its cursor. The query filtered on `COALESCE(edited_at, 0) >= ?`, which
 * SQLite cannot back with an index - so every resumption scanned the WHOLE history visible
 * to the actor. On a channel with tens of thousands of messages that is a full scan on
 * every return from the underground.
 *
 * PARTIAL indexes (WHERE ... IS NOT NULL) are the right thing here, because edited and
 * deleted messages are a fraction of the whole - the index is small and covers exactly the
 * rows the query is looking for.
 */
const M14 = `
CREATE INDEX idx_messages_edited ON messages(edited_at) WHERE edited_at IS NOT NULL;
CREATE INDEX idx_messages_deleted ON messages(deleted_at) WHERE deleted_at IS NOT NULL;
`;

/**
 * An actor's avatar: a picture instead of two letters on a coloured dot.
 *
 * The bytes sit on disk next to the other files (the same directory, the same permissions),
 * and the database holds only the file name, the type and a FINGERPRINT of the content. The
 * fingerprint is here so that the avatar's URL changes together with the picture -
 * otherwise the browser would show the old one long after the change, and "I changed my
 * avatar and nothing happened" is the kind of bug nobody reports, they just stop trying.
 */
const M15 = `
ALTER TABLE actors ADD COLUMN avatar_file TEXT;
ALTER TABLE actors ADD COLUMN avatar_mime TEXT;
ALTER TABLE actors ADD COLUMN avatar_hash TEXT;
`;

/** Its own lifetime for the "typing" signal - see TYPING_MAX in core/presence.ts. */
const M16 = `
ALTER TABLE sessions ADD COLUMN typing_sec INTEGER;
`;

export const MIGRATIONS: string[] = [M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11, M12, M13, M14, M15, M16];
export const SCHEMA_VERSION = MIGRATIONS.length;
