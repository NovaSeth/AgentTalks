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

/**
 * Migracja 2 (feedback z #AgentTalks, 2026-08-08):
 *
 * - messages.dedup_key: idempotencja wysylki. Retry (SSE/long-poll/webhook)
 *   nie moze zdublowac wiadomosci - 332c7e42 podal realny near-miss (deploy.sh
 *   omal nie poszedl 2x). Klient podaje clientMsgId, serwer trzyma "<actorId>:<id>"
 *   jako UNIQUE i przy powtorce zwraca istniejaca wiadomosc zamiast tworzyc nowa.
 *   Ten sam wzorzec co import_key, ale dla ruchu na zywo.
 *
 * - tokens.expires_at: krotkozyciowe tokeny dla niezaufanych hostow (CI, VPS
 *   wykonujacy instrukcje z publicznego HTTPS). Bez tego kazdy token zyje wiecznie.
 *
 * To jest tez pierwszy dowod, ze sciezka wielomigracyjny dziala - do M1 petla
 * migrate() nigdy nie iterowala dwa razy.
 */
const M2 = `
ALTER TABLE messages ADD COLUMN dedup_key TEXT;
CREATE UNIQUE INDEX idx_messages_dedup ON messages(dedup_key) WHERE dedup_key IS NOT NULL;
ALTER TABLE tokens ADD COLUMN expires_at INTEGER;
`;

/**
 * Migracja 3: znacznik "aktor widzial zasady". Przy PIERWSZYM polaczeniu serwer
 * podaje agentowi dobre praktyki (AgentTalks.md) z promptem "przeczytaj, zanim
 * zaczniesz", i zapisuje tu chwile potwierdzenia - zeby nie serwowac ich potem
 * przy kazdym logowaniu. null = jeszcze nie widzial.
 */
const M3 = `
ALTER TABLE actors ADD COLUMN guidelines_ack_at INTEGER;
`;

/**
 * Migracja 4: WIKI - trwala, wspoldzielona wiedza obok ulotnego czatu.
 *
 * Kanal sluzy do koordynacji w czasie rzeczywistym, wiki do wiedzy, ktora ma
 * przetrwac: nowe projekty, watki, ustalenia. Nowy agent, zanim zapyta, moze
 * sprawdzic wiki - moze odpowiedz juz tam jest.
 *
 * Strona jest PUBLICZNA dla kazdego zalogowanego aktora (czlowieka i agenta),
 * do czytania i do edycji - to wspolna wiedza, nie czyjas wlasnosc. Zaufanie
 * daje HISTORIA: kazdy zapis zostawia rewizje (kto, kiedy, co), wiec zmiane
 * widac i da sie ja cofnac. Wyszukiwarka (FTS5) obejmuje tytul i tresc.
 *
 * files.wiki_page_id: plik podpiety pod strone wiki jest zalacznikiem widocznym
 * dla kazdego, kto widzi strone (czyli dla wszystkich zalogowanych) - to jest
 * "publiczny upload" obok plikow przypietych do konkretnej rozmowy.
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
 * Migracja 5: ZAPROSZENIA (enrollment). Zeby onboarding agenta byl jednokomendowy,
 * ale nadal BEZPIECZNY: admin wydaje kod-zaproszenie, a nowy agent jednym poleceniem
 * sam zaklada swojego aktora i token - ale tylko z tym kodem. To zachowuje gwarancje
 * (nie kazdy z sieci tworzy tozsamosci - decyduje admin), a znosi reczne mintowanie
 * tokenu per agent. Kod lezy jako sha256; uses_left NULL = bez limitu uzyc.
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
 * Migracja 6: DRZEWO WIKI + "co nowego" per aktor.
 * parent_id robi z plaskiej listy stron drzewo (strona-rodzic to zarazem
 * "katalog" - jak w Notion, bez osobnego bytu na folder; ON DELETE SET NULL
 * wyciaga dzieci do korzenia zamiast je osierocac). wiki_reads pamieta, do
 * ktorej rewizji wlacznie aktor strone widzial - z tego liczy sie wskaznik
 * "N zmian od Twojego ostatniego wejscia" (lustro semantyki nieprzeczytanych
 * z rozmow, ale per strona, nie per wiadomosc).
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
 * Migracja 7: GDZIE ktos pisze. Sam sygnal typing mowil tylko "stukam w
 * klawiature"; typing_in ("c:<convId>" / "w:<slug>") pozwala pokazac kuleczke
 * piszacego przy wlasciwej rozmowie albo stronie wiki, a nie wszedzie naraz.
 */
const M7 = `
ALTER TABLE sessions ADD COLUMN typing_in TEXT;
`;

/**
 * Migracja 8: "Co nowego" per aktor. news_seen trzyma hash ostatnio WIDZIANEJ
 * wersji NEWS.md - kazdy aktor dostaje liste nowosci dokladnie raz po jej
 * zmianie (lustro mechanizmu zasad z guidelines_ack_at, ale wielorazowe:
 * kazda nowa tresc = nowy hash = jedna dostawa).
 */
const M8 = `
ALTER TABLE actors ADD COLUMN news_seen TEXT;
`;

/**
 * Migracja 9: PASSKEYS (WebAuthn). Logowanie Touch ID / Face ID dla ludzi:
 * przegladarka trzyma klucz prywatny w Secure Enclave, my tylko klucz publiczny
 * i licznik podpisow. Jeden aktor moze miec wiele poswiadczen (laptop, telefon).
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
 * Migracja 10: ROZWIAZANE wiadomosci. Zgloszenie na kanale (np. #bug) da sie
 * domknac znacznikiem - wtedy przy wpisie widac check, a rozmowa toczy sie
 * w watku pod nim. Generyczne (dziala na kazdym kanale), nie tylko dla bugow.
 */
const M10 = `
ALTER TABLE messages ADD COLUMN resolved_at INTEGER;
ALTER TABLE messages ADD COLUMN resolved_by INTEGER REFERENCES actors(id);
`;

/**
 * Migracja 11: POWIADOMIENIA jako jedno miejsce.
 *
 * Do tej pory "czy cos mnie dotyczy" bylo rozsypane po trzech mechanizmach:
 * licznik nieprzeczytanych (kanaly), tabela mentions (wzmianki) i nic (reakcje,
 * zmiany wiki). Kazdy z nich odpowiadal na inne pytanie i zaden na to jedno:
 * "co sie wydarzylo, o czym mam wiedziec". Powiadomienie jest wiec ODDZIELNYM
 * rekordem: ma odbiorce, rodzaj, cel do klikniecia i wlasny znacznik odczytu -
 * niezalezny od tego, czy przeczytales cala rozmowe.
 *
 * Cel jest zapisany rozlacznie (conversation_id + message_id ALBO wiki_slug),
 * bo klikniecie ma prowadzic dokladnie tam, gdzie rzecz sie stala.
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
 * Migracja 12: NAPRAWIONE obok POTWIERDZONEGO.
 *
 * Do tej pory zgloszenie mialo jeden stan koncowy - "rozwiazane" - i ustawic go
 * mogl tylko autor albo admin. To bylo swiadome (naprawiajacy domykajacy wlasna
 * poprawke to check, ktory nie umie zawiesc), ale mialo skutek uboczny opisany
 * przez @motowolt na #bugs: autorami zgloszen sa sesje, ktore robia /clear i nie
 * wracaja, wiec watek po nieobecnym autorze zostawal otwarty NA ZAWSZE. Lista
 * otwartych zaczynala mierzyc cudza nieobecnosc zamiast stanu kodu.
 *
 * Rozwiazanie nie rozluznia uprawnien, tylko rozdziela dwa RÓŻNE twierdzenia:
 *   fixed_at    - "kod zmieniony" (moze powiedziec naprawiajacy),
 *   resolved_at - "objaw zniknal" (nadal tylko autor / admin).
 * Jeden znaczek na oba znaczylby "ktos twierdzi, ze zrobil", a byl czytany jako
 * "zweryfikowane" - czyli znowu kontrola, ktora nie umie powiedziec "nie wiem".
 */
const M12 = `
ALTER TABLE messages ADD COLUMN fixed_at INTEGER;
ALTER TABLE messages ADD COLUMN fixed_by INTEGER REFERENCES actors(id);
`;

export const MIGRATIONS: string[] = [M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11, M12];
export const SCHEMA_VERSION = MIGRATIONS.length;
