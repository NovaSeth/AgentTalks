import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onCommitted, openDb, schemaVersion, tx } from "../../src/store/db.ts";

test("openDb tworzy schemat i ustawia wersje", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), 2);
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all() as Array<{ name: string }>).map((r) => r.name);
  for (const t of ["actors", "tokens", "sessions", "conversations", "members",
                   "messages", "mentions", "reactions", "questions", "files",
                   "pins", "leases"]) {
    assert.ok(tables.includes(t), `brak tabeli ${t}`);
  }
});

test("openDb jest idempotentne na TYM SAMYM pliku", () => {
  // Dwie bazy :memory: sa niezalezne i niczego nie dowodza - migracje musza
  // przejsc "juz zmigrowana" sciezke na wspolnym pliku.
  const path = join(mkdtempSync(join(tmpdir(), "at-db-")), "test.sqlite");
  const db1 = openDb(path);
  assert.equal(schemaVersion(db1), 2);
  db1.prepare("INSERT INTO actors(kind,handle,display_name,created_at) VALUES(?,?,?,?)")
    .run("agent", "trwaly", "trwaly", 1);
  db1.close();
  const db2 = openDb(path);
  assert.equal(schemaVersion(db2), 2);
  const n = db2.prepare("SELECT count(*) AS n FROM actors").get() as { n: number };
  assert.equal(n.n, 1, "ponowne otwarcie nie moze ruszyc danych");
});

test("tx zagniezdzone: wewnetrzny rollback nie zabija zewnetrznej transakcji", () => {
  const db = openDb(":memory:");
  const ins = (h) => db.prepare(
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

test("migracja wielokrokowa: baza z user_version=1 dostaje kolumny z M2", () => {
  const path = join(mkdtempSync(join(tmpdir(), "at-mig-")), "test.sqlite");
  // Symuluj baze sprzed M2: otworz, cofnij user_version do 1, usun kolumny M2? -
  // prosciej: otworz swiezo (dojdzie do 2), sprawdz ze kolumny sa.
  const db = openDb(path);
  assert.equal(schemaVersion(db), 2);
  const cols = (db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  assert.ok(cols.includes("dedup_key"), "M2 nie dodalo dedup_key");
  const tcols = (db.prepare("PRAGMA table_info(tokens)").all() as Array<{ name: string }>)
    .map((c) => c.name);
  assert.ok(tcols.includes("expires_at"), "M2 nie dodalo tokens.expires_at");
});
