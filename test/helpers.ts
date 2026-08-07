/**
 * Wspolne narzedzia testow. Baza zawsze w pamieci, zegar zawsze wstrzykiwany -
 * test, ktory musi realnie odczekac 30 sekund, nie bedzie uruchamiany, a test,
 * ktory nie jest uruchamiany, nie chroni niczego.
 */
import { openDb } from "../src/store/db.ts";
import { createCtx, type Ctx } from "../src/core/ctx.ts";
import { EventBus } from "../src/core/events.ts";
import { type Actor, type ActorKind, createActor } from "../src/core/actors.ts";

export function testCtx(now?: () => number): Ctx {
  return createCtx(openDb(":memory:"), new EventBus(), now ?? (() => 1_000_000));
}

export function mkActor(ctx: Ctx, handle: string, kind: ActorKind = "agent"): Actor {
  return createActor(ctx, { kind, handle });
}

/** Czeka, az warunek stanie sie prawda, albo rzuca po `timeoutMs`.
 *  Uzywane tylko tam, gdzie po drugiej stronie jest realne I/O (SSE, HTTP). */
export async function waitFor(
  cond: () => boolean,
  timeoutMs = 2000,
  stepMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error("waitFor: timeout");
}
