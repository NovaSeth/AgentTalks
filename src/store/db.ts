/**
 * Opening the database and transactions. The only module that knows about `node:sqlite`.
 */
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.ts";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  // WAL: readers do not block the writer. In the prototype readers took no lock at
  // all, so they could read a truncated JSON line, which was then silently skipped -
  // that is, a message disappeared without a trace. Here either the transaction went
  // through or it does not exist at all, and the error returns to the caller.
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function schemaVersion(db: Db): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

/**
 * Runs the migrations that are missing.
 *
 * BEGIN IMMEDIATE and a RE-READ of the version inside the transaction: two processes
 * (the server and the CLI) can start on the same database at the same time. Without
 * this, the loser of the race would run the migration a second time and die on "table
 * already exists" - with IMMEDIATE it waits on busy_timeout and then sees the version
 * already raised and does nothing.
 */
function migrate(db: Db): void {
  if (schemaVersion(db) >= SCHEMA_VERSION) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const from = schemaVersion(db);
    for (let i = from; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]);
      // user_version does not accept a bound parameter, only a literal.
      db.exec(`PRAGMA user_version = ${i + 1}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    safeRollback(db);
    throw err;
  }
}

// ---- transactions with nesting --------------------------------------------
//
// The original tx() forbade nesting, and that turned out to be a bad idea: domain
// operations are composed of other domain operations (ask = a message + a question
// row), so the ban forced atomicity to be torn apart. An adversarial review showed
// three real consequences: an orphaned question after a crash between commits, a
// double answer to a question, and a permanently broken DM with no member.
//
// Now: the outer transaction is BEGIN IMMEDIATE (a write lock straight away, so
// busy_timeout applies on entry rather than exploding as SQLITE_BUSY halfway through
// an upgrade from read to write lock), and tx() inside tx() is a SAVEPOINT.
//
// Events must NOT leave for the bus before the real COMMIT - a subscriber would ask
// for data that is not there yet (or that is about to disappear on a rollback). Hence
// onCommitted(): inside a transaction it defers the call until the OUTERMOST one
// commits; outside a transaction it runs immediately.

const txDepth = new WeakMap<Db, number>();
const afterCommit = new WeakMap<Db, Array<() => void>>();

export function tx<T>(db: Db, fn: () => T): T {
  const depth = txDepth.get(db) ?? 0;
  if (depth === 0) {
    db.exec("BEGIN IMMEDIATE");
    afterCommit.set(db, []);
  } else {
    db.exec(`SAVEPOINT sp_${depth}`);
  }
  txDepth.set(db, depth + 1);
  try {
    const out = fn();
    txDepth.set(db, depth);
    if (depth === 0) {
      db.exec("COMMIT");
      const callbacks = afterCommit.get(db) ?? [];
      afterCommit.delete(db);
      for (const cb of callbacks) {
        try {
          cb();
        } catch (err) {
          // Committed data is already the truth; a subscriber that threw cannot
          // pretend the transaction failed.
          console.error("[db] callback po commicie rzucil wyjatek:", err);
        }
      }
    } else {
      db.exec(`RELEASE sp_${depth}`);
    }
    return out;
  } catch (err) {
    txDepth.set(db, depth);
    if (depth === 0) {
      afterCommit.delete(db);
      safeRollback(db);
    } else {
      try {
        db.exec(`ROLLBACK TO sp_${depth}`);
        db.exec(`RELEASE sp_${depth}`);
      } catch {
        // the savepoint may have vanished in an auto-rollback of the whole transaction
      }
    }
    throw err;
  }
}

/** Run after the current transaction commits; outside a transaction - immediately.
 *  Used for publishing events: a push must not get ahead of the data. */
export function onCommitted(db: Db, cb: () => void): void {
  const callbacks = afterCommit.get(db);
  if (callbacks) callbacks.push(cb);
  else cb();
}

/** A ROLLBACK that will not mask the original error: when SQLite has already done an
 *  auto-rollback, an explicit ROLLBACK throws "no transaction is active" - and that
 *  secondary exception must not cover up the cause. */
function safeRollback(db: Db): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // no active transaction = goal achieved
  }
}
