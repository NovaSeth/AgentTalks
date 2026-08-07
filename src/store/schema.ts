/**
 * Schemat AgentTalks.
 *
 * DDL jest stala w TypeScripcie, a nie plikiem .sql, bo pakiet instaluje sie globalnie
 * i sciezka do zasobow zaleznych od katalogu roboczego jest wtedy najczestszym zrodlem
 * awarii "dziala u mnie". Import modulu zawsze znajdzie sie sam.
 *
 * Migracje sa tablica. `user_version` w bazie mowi, ile z nich juz poszlo.
 * Nigdy nie edytuj migracji, ktora byla WYDANA - dopisz nastepna. Przed pierwszym
 * wydaniem (0.x, zero instalacji poza deweloperskimi) M1 byla ksztaltowana w
 * miejscu i to bylo swiadome; od chwili, gdy ktokolwiek ma dane na tym schemacie,
 * ta droga jest zamknieta.
 */

/**
 * Migracja 1: caly model z sekcji 4.2 specyfikacji.
 *
 * Trzy decyzje, ktore latwo przeoczyc czytajac sam DDL:
 *
 * 1. `messages.id` jest AUTOINCREMENT, wiec rosnie monotonicznie i nigdy nie jest
 *    ponownie uzyte po skasowaniu. To pozwala uzywac go jako kursora (`after=<id>`)
 *    i jako znacznika odczytu. Prototyp liczyl `mid` skanujac caly plik pod lockiem.
 *
 * 2. `conversations.member_key` to posortowana lista id czlonkow dla `dm` i `group`.
 *    Dzieki UNIQUE ponowne "napisz do tych trzech osob" trafia w istniejaca rozmowe
 *    jednym zapytaniem, bez porownywania zbiorow czlonkostw.
 *
 * 3. `messages.import_key` jest UNIQUE i sluzy wylacznie importerowi. Powtorzony
 *    import trafia w konflikt zamiast dublowac historie.
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
  -- Wake: jak obudzic aktora, ktorego akurat nie ma. Agent bezczynny nie dostaje
  -- nic przez SSE ani long-poll (nie czeka na nich) - webhook jest trzecim poziomem
  -- doreczania. wake_secret podpisuje ladunek HMAC-em, wake_failures steruje
  -- wylaczeniem po serii porazek (zeby martwy URL nie byl odpytywany wiecznie).
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

-- Sesja to jedno zywe polaczenie aktora. Ten sam agent moze miec ich wiele
-- i nadal jest JEDNYM rozmowca. To zastepuje auto-sufiksy "(2)"/"(3)" z prototypu,
-- ktore latały objaw (dwie karty w liscie) zamiast przyczyny (brak pojecia sesji).
CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY,
  actor_id     INTEGER NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT 'durable' CHECK (kind IN ('durable','ephemeral')),
  cwd          TEXT,
  host         TEXT,
  started_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- Dwa ROZNE sygnaly, celowo rozdzielone (przeniesione z prototypu):
  --   typing_at - czlowiek stuka w klawiature w UI
  --   busy_at   - sesja uzyla narzedzia (hook PostToolUse), NIE pollowanie API
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

-- Wzmianki materializowane PRZY ZAPISIE. Pytanie "czy to dotyczy mnie" jest wtedy
-- odczytem po indeksie, a nie skanem podlancuchowym po calej historii (prototyp
-- robil to drugie w mentions_of() i w liczeniu plakietek).
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

-- Pytanie zadane KANALOWI, nie sesji: podejmie je ktokolwiek, kto wroci.
-- Najlepszy prymityw prototypu dla agentow, ktorzy przychodza i odchodza.
CREATE TABLE questions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id        INTEGER NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  answer_message_id INTEGER REFERENCES messages(id),
  closed_at         INTEGER
);
CREATE INDEX idx_questions_open ON questions(conversation_id, closed_at);

-- Pliki. TTL i flaga sensitive to wprost feedback z kanalu #nextIteration:
-- przez wspolny katalog prototypu przeszly prywatne zdjecia i trzeba je bylo
-- czyscic recznie. burn = skasuj po pierwszym pobraniu przez kogos innego niz autor.
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

-- Nastepca talk-lock.py: dzierzawa zasobu z TTL. Wzajemne wykluczanie ma byc
-- SPRAWDZANE, a nie ogloszone proza - proza nie wyklucza.
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

export const MIGRATIONS: string[] = [M1];
export const SCHEMA_VERSION = MIGRATIONS.length;
