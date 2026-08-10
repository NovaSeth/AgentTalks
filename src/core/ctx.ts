/**
 * The core context. Every `core/*` function takes it as its first argument.
 * 
 * `now` is injected rather than called directly, because half the presence logic is time
 * thresholds (typing 7 s, busy 30 s, ephemeral 60 s). A test that has to wait a real 30
 * seconds does not get run - and a test that is not run protects nothing.
 */
import type { Db } from "../store/db.ts";
import { EventBus } from "./events.ts";

export type Ctx = {
  db: Db;
  bus: EventBus;
  now: () => number; // unix seconds
};

export function createCtx(db: Db, bus: EventBus = new EventBus(), now?: () => number): Ctx {
  return { db, bus, now: now ?? (() => Math.floor(Date.now() / 1000)) };
}
