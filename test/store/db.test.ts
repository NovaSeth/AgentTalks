// Polish fixture handles and message bodies exercise persistence, migration and full-text search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onCommitted, openDb, schemaVersion, tx } from "../../src/store/db.ts";
import { MIGRATIONS, SCHEMA_VERSION } from "../../src/store/schema.ts";
import { DatabaseSync } from "node:sqlite";

test("openDb creates the schema and sets the version", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), SCHEMA_VERSION);
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all() as Array<{ name: string }>).map((r) => r.name);
  for (const t of ["actors", "tokens", "sessions", "conversations", "members",
                   "messages", "mentions", "reactions", "questions", "files",
                   "pins", "leases", "wiki_pages", "wiki_revisions", "invites",
                   "wiki_reads"]) {
    assert.ok(tables.includes(t), `table ${t} missing`);
  }
});

test("openDb is idempotent on THE SAME file", () => {
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
  assert.equal(n.n, 1, "reopening must not change the data");
});

test("nested tx: an inner rollback does not kill the outer transaction", () => {
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

test("onCommitted inside a transaction defers the call until commit; an error prevents the call", () => {
  const db = openDb(":memory:");
  const calls: string[] = [];
  tx(db, () => {
    onCommitted(db, () => calls.push("a"));
    assert.deepEqual(calls, [], "the callback must not precede commit");
  });
  assert.deepEqual(calls, ["a"]);
  assert.throws(() => tx(db, () => {
    onCommitted(db, () => calls.push("b"));
    throw new Error("bum");
  }), /bum/);
  assert.deepEqual(calls, ["a"], "the callback must not fire after rollback");
  onCommitted(db, () => calls.push("c"));
  assert.deepEqual(calls, ["a", "c"], "outside a transaction, fire immediately");
});

test("FTS5 is available and synchronized by a trigger", () => {
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

test("foreign keys are enforced", () => {
  const db = openDb(":memory:");
  assert.throws(
    () => db.prepare("INSERT INTO messages(conversation_id,actor_id,ts,body) VALUES(9,9,1,'x')").run(),
    /FOREIGN KEY/i,
  );
});

test("tx rolls everything back when an error occurs inside", () => {
  const db = openDb(":memory:");
  assert.throws(() => tx(db, () => {
    db.prepare("INSERT INTO actors(kind,handle,display_name,created_at) VALUES(?,?,?,?)")
      .run("agent", "a", "a", 1);
    throw new Error("bum");
  }), /bum/);
  const n = db.prepare("SELECT count(*) AS n FROM actors").get() as { n: number };
  assert.equal(n.n, 0);
});

test("multistep migration: an old database reaches the current version with its data", () => {
  // The previous version of this test only OPENED a fresh database and checked that it has the
  // columns - that is, it tested a from-scratch installation under the name "migration", and
  // could not fail on a broken migration. Here we really start from a schema from years back:
  // the first migration, data inside it, and then a full run up to the current version. The data
  // MUST survive - that is the only thing a migration promises.
  const path = join(mkdtempSync(join(tmpdir(), "at-mig-")), "test.sqlite");

  // 1. The database in the state after M1 and only M1.
  const oldDb = new DatabaseSync(path);
  oldDb.exec("PRAGMA foreign_keys = ON");
  oldDb.exec(MIGRATIONS[0]);
  oldDb.exec("PRAGMA user_version = 1");
  oldDb.prepare("INSERT INTO actors(kind, handle, display_name, created_at) VALUES(?,?,?,?)")
    .run("agent", "stary-agent", "stary-agent", 1000);
  oldDb.close();

  // 2. Opening through openDb has to pull in ALL the remaining migrations.
  const db = openDb(path);
  assert.equal(schemaVersion(db), SCHEMA_VERSION, "migration did not reach the current version");

  // 3. Pre-migration data survives.
  const actorRow = db.prepare("SELECT handle FROM actors WHERE handle = ?").get("stary-agent") as
    | { handle: string }
    | undefined;
  assert.equal(actorRow?.handle, "stary-agent", "migration lost preexisting data");

  // 4. Columns and tables from later migrations really are there.
  const columns = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
  assert.ok(columns("messages").includes("dedup_key"), "dedup_key missing (M2)");
  assert.ok(columns("tokens").includes("expires_at"), "tokens.expires_at missing (M2)");
  assert.ok(columns("messages").includes("fixed_at"), "messages.fixed_at missing (M12)");
  assert.ok(columns("actors").includes("session_epoch"), "actors.session_epoch missing (M13)");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as
    Array<{ name: string }>).map((t) => t.name);
  assert.ok(tables.includes("notifications"), "notifications table missing (M11)");
  assert.ok(tables.includes("wiki_pages"), "wiki_pages table missing (M4)");
});

test("migration is idempotent: a second open does nothing and preserves data", () => {
  const path = join(mkdtempSync(join(tmpdir(), "at-mig2-")), "test.sqlite");
  const a = openDb(path);
  a.prepare("INSERT INTO actors(kind, handle, display_name, created_at) VALUES(?,?,?,?)")
    .run("agent", "ktos", "ktos", 1000);
  a.close();
  const b = openDb(path);
  assert.equal(schemaVersion(b), SCHEMA_VERSION);
  const n = b.prepare("SELECT COUNT(*) AS n FROM actors").get() as { n: number };
  assert.equal(n.n, 1, "reopening changed the data");
});
