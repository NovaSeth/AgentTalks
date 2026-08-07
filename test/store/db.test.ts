import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, schemaVersion, tx } from "../../src/store/db.ts";

test("openDb tworzy schemat i ustawia wersje", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), 1);
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all() as Array<{ name: string }>).map((r) => r.name);
  for (const t of ["actors", "tokens", "sessions", "conversations", "members",
                   "messages", "mentions", "reactions", "questions", "files",
                   "pins", "leases"]) {
    assert.ok(tables.includes(t), `brak tabeli ${t}`);
  }
});

test("openDb jest idempotentne", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), 1);
  assert.doesNotThrow(() => openDb(":memory:"));
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
