/**
 * Otwarcie bazy i transakcje. To jedyny modul, ktory wie o `node:sqlite`.
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

/**
 * Wykonuje brakujace migracje.
 *
 * BEGIN IMMEDIATE i PONOWNY odczyt wersji w srodku transakcji: dwa procesy
 * (serwer i CLI) moga startowac rownoczesnie na tej samej bazie. Bez tego
 * przegrany wyscigu wykonywalby migracje drugi raz i padal na "table already
 * exists" - z IMMEDIATE czeka na busy_timeout, a potem widzi juz podniesiona
 * wersje i nie robi nic.
 */
function migrate(db: Db): void {
  if (schemaVersion(db) >= SCHEMA_VERSION) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    const from = schemaVersion(db);
    for (let i = from; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i]);
      // user_version nie przyjmuje parametru zwiazanego, tylko literal.
      db.exec(`PRAGMA user_version = ${i + 1}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    safeRollback(db);
    throw err;
  }
}

// ---- transakcje z zagniezdzaniem -----------------------------------------
//
// Pierwotna wersja tx() zabranila zagniezdzania i to okazalo sie zlym pomyslem:
// operacje domenowe skladaja sie z innych operacji domenowych (ask = wiadomosc
// + wpis pytania), wiec zakaz zmuszal do rozrywania atomowosci. Przeglad
// adwersaryjny pokazal trzy realne skutki: pytanie-sierota po padzie miedzy
// commitami, podwojna odpowiedz na pytanie i trwale zepsuty DM bez czlonka.
//
// Teraz: transakcja zewnetrzna to BEGIN IMMEDIATE (write-lock od razu, wiec
// busy_timeout dziala przy wejsciu, a nie wybucha SQLITE_BUSY w srodku przy
// podnoszeniu blokady odczyt->zapis), a tx() wewnatrz tx() to SAVEPOINT.
//
// Zdarzenia na szyne NIE moga wychodzic przed prawdziwym COMMIT - subskrybent
// zapytalby o dane, ktorych jeszcze nie ma (albo ktore zaraz znikna po
// rollbacku). Stad onCommitted(): w transakcji odklada wywolanie do chwili
// zatwierdzenia NAJBARDZIEJ zewnetrznej, poza transakcja wykonuje od razu.

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
          // Zatwierdzone dane sa juz prawda; padniety subskrybent nie moze
          // udawac, ze transakcja sie nie powiodla.
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
        // savepoint mogl zniknac przy auto-rollbacku calej transakcji
      }
    }
    throw err;
  }
}

/** Wykonaj po zatwierdzeniu biezacej transakcji; poza transakcja - od razu.
 *  Uzywane do publikacji zdarzen: push nie moze wyprzedzac danych. */
export function onCommitted(db: Db, cb: () => void): void {
  const callbacks = afterCommit.get(db);
  if (callbacks) callbacks.push(cb);
  else cb();
}

/** ROLLBACK, ktory nie zamaskuje pierwotnego bledu: gdy SQLite zdazyl zrobic
 *  auto-rollback, jawny ROLLBACK rzuca "no transaction is active" - i ten
 *  wtorny wyjatek nie moze przykryc przyczyny. */
function safeRollback(db: Db): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // brak aktywnej transakcji = cel osiagniety
  }
}
