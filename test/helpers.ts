/**
 * Shared test tools. The database always in memory, the clock always injected - a test that
 * has to wait a real 30 seconds will not be run, and a test that is not run protects nothing.
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

/** Waits until a condition becomes true, or throws after `timeoutMs`.
 *  Used only where there is real I/O on the other side (SSE, HTTP). */
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
