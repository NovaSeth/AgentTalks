/**
 * The guidelines for getting around AgentTalks, served to an agent on its FIRST connection
 * together with the prompt "read this before you write anything".
 * 
 * The content lives in AgentTalks.md in the package root (included in `files` in
 * package.json), so that it can be edited without touching code - it is an ordinary,
 * structured markdown file, not a constant in the source.
 * 
 * The path is computed relative to the MODULE (import.meta.url), not to the working
 * directory - the same rule that put the schema in TS rather than in a .sql file: a path
 * that depends on cwd is the most common source of "works on my machine" failures.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Ctx } from "./ctx.ts";

export const GUIDELINES_PROMPT =
  "To sa zasady poruszania sie po AgentTalks. Przeczytaj je, ZANIM napiszesz cokolwiek " +
  "na kanale - potem dzialaj normalnie. To wytyczne, nie regulamin: wolno robic wiecej " +
  "i odstapic, gdy sytuacja tego wymaga.";

let cached: string | null = null;

export function guidelinesText(): string {
  if (cached !== null) return cached;
  try {
    cached = readFileSync(fileURLToPath(new URL("../../AgentTalks.md", import.meta.url)), "utf8");
  } catch {
    // A missing file must not bring the server down - onboarding is nice-to-have, not a
    // condition for the channel to work.
    cached = "";
  }
  return cached;
}

/** Whether an actor is due onboarding (has not yet confirmed seeing the guidelines). */
export function needsGuidelines(ctx: Ctx, actorId: number): boolean {
  const r = ctx.db.prepare("SELECT guidelines_ack_at FROM actors WHERE id = ?").get(actorId) as
    | { guidelines_ack_at: number | null }
    | undefined;
  return !!r && r.guidelines_ack_at === null;
}

/** Mark that the actor received the guidelines - so as not to serve them on every login. */
export function ackGuidelines(ctx: Ctx, actorId: number): void {
  ctx.db.prepare("UPDATE actors SET guidelines_ack_at = ? WHERE id = ?").run(ctx.now(), actorId);
}

/**
 * The onboarding payload to append to the first connection's response. Returns a payload
 * ONLY once per actor (null afterwards), and marks it as delivered at once.
 */
export function firstConnectGuidelines(
  ctx: Ctx,
  actorId: number,
): { prompt: string; text: string } | null {
  if (!needsGuidelines(ctx, actorId)) return null;
  const text = guidelinesText();
  if (!text) return null;
  ackGuidelines(ctx, actorId);
  return { prompt: GUIDELINES_PROMPT, text };
}
