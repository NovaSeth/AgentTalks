/**
 * Kontekst rdzenia. Kazda funkcja `core/*` bierze go pierwszym argumentem.
 *
 * `now` jest wstrzykiwane, a nie wolane wprost, bo polowa logiki obecnosci to progi
 * czasowe (typing 7 s, busy 30 s, efemeryda 60 s). Test, ktory musi realnie czekac
 * 30 sekund, nie jest uruchamiany - a test, ktory nie jest uruchamiany, nie chroni.
 */
import type { Db } from "../store/db.ts";
import { EventBus } from "./events.ts";

export type Ctx = {
  db: Db;
  bus: EventBus;
  now: () => number; // sekundy uniksowe
};

export function createCtx(db: Db, bus: EventBus = new EventBus(), now?: () => number): Ctx {
  return { db, bus, now: now ?? (() => Math.floor(Date.now() / 1000)) };
}
