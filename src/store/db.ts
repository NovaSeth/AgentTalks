/**
 * Otwarcie bazy i migracje. To jedyny modul, ktory wie o `node:sqlite`.
 */
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.ts";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  // WAL: czytelnicy nie blokuja pisarza. W prototypie czytelnicy w ogole nie brali
  // locka i przez to mogli przeczytac urwana linie JSON, ktora byla po cichu pomijana -
  // czyli wiadomosc znikala bez sladu. Tutaj albo transakcja przeszla, albo nie ma jej
  // wcale, a blad wraca do wywolujacego.
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

/** Wykonuje brakujace migracje. Kazda w osobnej transakcji, zeby polowicznie
 *  zastosowana migracja nie zostawila bazy w stanie nie do opisania. */
function migrate(db: Db): void {
  const from = schemaVersion(db);
  if (from >= SCHEMA_VERSION) return;
  for (let i = from; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      // user_version nie przyjmuje parametru zwiazanego, tylko literal.
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/** Uruchamia `fn` w transakcji. Zagniezdzenie jest bledem programisty, nie sytuacja
 *  do obsluzenia: SQLite nie ma zagniezdzonych transakcji, a udawanie ich savepointami
 *  ukrywa fakt, ze wywolujacy nie wie, kto jest wlascicielem transakcji. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
