import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onCommitted, openDb, schemaVersion, tx } from "../../src/store/db.ts";
import { MIGRATIONS, SCHEMA_VERSION } from "../../src/store/schema.ts";
import { DatabaseSync } from "node:sqlite";

test("openDb tworzy schemat i ustawia wersje", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all() as Array<{ name: string }>).map((r) => r.name);
  for (const t of ["actors", "tokens", "sessions", "conversations", "members",
                   "messages", "mentions", "reactions", "questions", "files",
                   "pins", "leases", "wiki_pages", "wiki_revisions", "invites",
                   "wiki_reads"]) {
    assert.ok(tables.includes(t), `brak tabeli ${t}`);
  }
});

test("openDb jest idempotentne na TYM SAMYM pliku", () => {
  // Two :memory: databases are independent and prove nothing - migrations have to go through the
  // "already migrated" path on a shared file.
  const path = join(mkdtempSync(join(tmpdir(), "at-db-")), "test.sqlite");
  const db1 = openDb(path);
  assert.equal(schemaVersion(db1), SCHEMA_VERSION);
  db1.prepare("INSERT INTO actors(kind,handle,display_name,created_at) VALUES(?,?,?,?)")
    .run("agent", "trwaly", "trwaly", 1);
  db1.close();
  const db2 = openDb(path);
  assert.equal(schemaVersion(db2), SCHEMA_VERSION);
  const n = db2.prepare("SELECT count(*) AS n FROM actors").get() as { n: number };
  assert.equal(n.n, 1, "ponowne otwarcie nie moze ruszyc danych");
});

test("tx zagniezdzone: wewnetrzny rollback nie zabija zewnetrznej transakcji", () => {
  const db = openDb(":memory:");
  const ins = (h: string) => db.prepare(
    "INSERT INTO actors(kind,handle,display_name,created_at) VALUES('agent',?,?,1)").run(h, h);
  tx(db, () => {
    ins("zewnetrzny");
    assert.throws(() => tx(db, () => { ins("wewnetrzny"); throw new Error("bum"); }), /bum/);
    ins("po-wewnetrznym");
  });
  const handles = (db.prepare("SELECT handle FROM actors ORDER BY handle").all() as
    Array<{ handle: string }>).map((r) => r.handle);
  assert.deepEqual(handles, ["po-wewnetrznym", "zewnetrzny"]);
});

test("onCommitted w transakcji odklada wywolanie do commita; blad = brak wywolania", () => {
  const db = openDb(":memory:");
  const calls: string[] = [];
  tx(db, () => {
    onCommitted(db, () => calls.push("a"));
    assert.deepEqual(calls, [], "callback nie moze wyprzedzic commita");
  });
  assert.deepEqual(calls, ["a"]);
  assert.throws(() => tx(db, () => {
    onCommitted(db, () => calls.push("b"));
    throw new Error("bum");
  }), /bum/);
  assert.deepEqual(calls, ["a"], "po rollbacku callback nie ma prawa wyjsc");
  onCommitted(db, () => calls.push("c"));
  assert.deepEqual(calls, ["a", "c"], "poza transakcja - od razu");
});

test("FTS5 jest dostepny i synchronizuje sie triggerem", () => {
  const db = openDb(":memory:");
  const now = 1;
  db.prepare("INSERT INTO actors(kind,handle,display_name,created_at) VALUES(?,?,?,?)")
    .run("agent", "a", "a", now);
  db.prepare("INSERT INTO conversations(kind,slug,topic,created_at) VALUES(?,?,?,?)")
    .run("public", "general", "", now);
  db.prepare("INSERT INTO messages(conversation_id,actor_id,ts,body) VALUES(1,1,?,?)")
    .run(now, "szukana fraza w tresci");
  const hits = db.prepare(
    "SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").all("szukana");
  assert.equal(hits.length, 1);
});

test("klucze obce sa egzekwowane", () => {
  const db = openDb(":memory:");
  assert.throws(
    () => db.prepare("INSERT INTO messages(conversation_id,actor_id,ts,body) VALUES(9,9,1,'x')").run(),
    /FOREIGN KEY/i,
  );
});

test("tx wycofuje wszystko przy bledzie w srodku", () => {
  const db = openDb(":memory:");
  assert.throws(() => tx(db, () => {
    db.prepare("INSERT INTO actors(kind,handle,display_name,created_at) VALUES(?,?,?,?)")
      .run("agent", "a", "a", 1);
    throw new Error("bum");
  }), /bum/);
  const n = db.prepare("SELECT count(*) AS n FROM actors").get() as { n: number };
  assert.equal(n.n, 0);
});

test("migracja wielokrokowa: stara baza dochodzi do biezacej wersji, z danymi", () => {
  // The previous version of this test only OPENED a fresh database and checked that it has the
  // columns - that is, it tested a from-scratch installation under the name "migration", and
  // could not fail on a broken migration. Here we really start from a schema from years back:
  // the first migration, data inside it, and then a full run up to the current version. The data
  // MUST survive - that is the only thing a migration promises.
  const path = join(mkdtempSync(join(tmpdir(), "at-mig-")), "test.sqlite");

  // 1. The database in the state after M1 and only M1.
  const stara = new DatabaseSync(path);
  stara.exec("PRAGMA foreign_keys = ON");
  stara.exec(MIGRATIONS[0]);
  stara.exec("PRAGMA user_version = 1");
  stara.prepare("INSERT INTO actors(kind, handle, display_name, created_at) VALUES(?,?,?,?)")
    .run("agent", "stary-agent", "stary-agent", 1000);
  stara.close();

  // 2. Opening through openDb has to pull in ALL the remaining migrations.
  const db = openDb(path);
  assert.equal(schemaVersion(db), SCHEMA_VERSION, "migracja nie doszla do biezacej wersji");

  // 3. Dane sprzed migracji zyja.
  const kto = db.prepare("SELECT handle FROM actors WHERE handle = ?").get("stary-agent") as
    | { handle: string }
    | undefined;
  assert.equal(kto?.handle, "stary-agent", "migracja zgubila dane sprzed niej");

  // 4. Columns and tables from later migrations really are there.
  const kolumny = (tabela: string) =>
    (db.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(kolumny("messages").includes("dedup_key"), "brak dedup_key (M2)");
  assert.ok(kolumny("tokens").includes("expires_at"), "brak tokens.expires_at (M2)");
  assert.ok(kolumny("messages").includes("fixed_at"), "brak messages.fixed_at (M12)");
  assert.ok(kolumny("actors").includes("session_epoch"), "brak actors.session_epoch (M13)");
  const tabele = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
    Array<{ name: string }>).map((t) => t.name);
  assert.ok(tabele.includes("notifications"), "brak tabeli notifications (M11)");
  assert.ok(tabele.includes("wiki_pages"), "brak tabeli wiki_pages (M4)");
});

test("migracja jest idempotentna: drugie otwarcie nie robi nic i nie psuje danych", () => {
  const path = join(mkdtempSync(join(tmpdir(), "at-mig2-")), "test.sqlite");
  const a = openDb(path);
  a.prepare("INSERT INTO actors(kind, handle, display_name, created_at) VALUES(?,?,?,?)")
    .run("agent", "ktos", "ktos", 1000);
  a.close();
  const b = openDb(path);
  assert.equal(schemaVersion(b), SCHEMA_VERSION);
  const n = b.prepare("SELECT COUNT(*) AS n FROM actors").get() as { n: number };
  assert.equal(n.n, 1, "ponowne otwarcie zmienilo dane");
});
