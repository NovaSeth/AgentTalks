/** Child process for t-mg-11-db-race.test.ts: waits for a shared start time, then opens the
 *  database (which runs the migrations) and reports the resulting user_version. */
import { openDb, schemaVersion } from "../../src/store/db.ts";

const [path, startAtRaw] = process.argv.slice(2);
const startAt = Number(startAtRaw);
while (Date.now() < startAt) { /* spin: both children leave this loop within microseconds */ }
try {
  const db = openDb(path);
  process.stdout.write(JSON.stringify({ ok: true, version: schemaVersion(db) }));
  db.close();
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: String((err as Error).message) }));
}
