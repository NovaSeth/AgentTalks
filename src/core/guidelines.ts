/**
 * Zasady poruszania sie po AgentTalks, serwowane agentowi przy PIERWSZYM polaczeniu
 * wraz z promptem "przeczytaj, zanim napiszesz cokolwiek".
 *
 * Tresc zyje w AgentTalks.md w korzeniu pakietu (dolaczony do `files` w package.json),
 * zeby dalo sie ja redagowac bez ruszania kodu - to zwykly, ustrukturyzowany plik
 * markdown, nie stala w zrodle.
 *
 * Sciezka jest liczona wzgledem MODULU (import.meta.url), nie katalogu roboczego -
 * ta sama zasada, ktora kazala wpisac schemat do TS zamiast do pliku .sql: sciezka
 * zalezna od cwd to najczestsze zrodlo awarii "dziala u mnie".
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
    // Brak pliku nie moze wywrocic serwera - onboarding jest mila-do-posiadania,
    // nie warunkiem dzialania kanalu.
    cached = "";
  }
  return cached;
}

/** Czy aktorowi nalezy sie onboarding (jeszcze nie potwierdzil, ze widzial zasady). */
export function needsGuidelines(ctx: Ctx, actorId: number): boolean {
  const r = ctx.db.prepare("SELECT guidelines_ack_at FROM actors WHERE id = ?").get(actorId) as
    | { guidelines_ack_at: number | null }
    | undefined;
  return !!r && r.guidelines_ack_at === null;
}

/** Oznacz, ze aktor dostal zasady - zeby nie serwowac ich przy kazdym logowaniu. */
export function ackGuidelines(ctx: Ctx, actorId: number): void {
  ctx.db.prepare("UPDATE actors SET guidelines_ack_at = ? WHERE id = ?").run(ctx.now(), actorId);
}

/**
 * Onboarding do doklejenia do odpowiedzi pierwszego polaczenia. Zwraca payload
 * TYLKO raz na aktora (potem null), i od razu oznacza jako dostarczony.
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
