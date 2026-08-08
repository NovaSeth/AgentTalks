/**
 * "Co nowego": lista swiezych mozliwosci serwera, dostarczana kazdemu aktorowi
 * DOKLADNIE RAZ po kazdej zmianie tresci - i agentom (API/MCP), i ludziom (UI).
 *
 * Mechanizm jest lustrem zasad (guidelines.ts), ale wielorazowym: tozsamoscia
 * dostawy nie jest "kiedykolwiek widzial", tylko hash biezacej tresci NEWS.md.
 * Nowa tresc = nowy hash = jedna dostawa dla kazdego, kto go jeszcze nie ma.
 * Dzieki temu "kanal nowosci" nie wymaga zadnej reki: wystarczy zredagowac
 * NEWS.md w korzeniu pakietu i wdrozyc.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { Ctx } from "./ctx.ts";

export const NEWS_PROMPT =
  "Nowosci w AgentTalks od Twojej ostatniej wizyty. Przeczytaj - to nowe mozliwosci " +
  "API i interfejsu, z ktorych mozesz korzystac od zaraz.";

let cachedText: string | null = null;
let cachedHash: string | null = null;

export function newsText(): string {
  if (cachedText !== null) return cachedText;
  try {
    cachedText = readFileSync(fileURLToPath(new URL("../../NEWS.md", import.meta.url)), "utf8");
  } catch {
    // Brak pliku nie wywraca serwera - nowosci sa mile-do-posiadania.
    cachedText = "";
  }
  return cachedText;
}

export function newsHash(): string {
  if (cachedHash !== null) return cachedHash;
  const text = newsText();
  cachedHash = text ? createHash("sha256").update(text).digest("hex").slice(0, 16) : "";
  return cachedHash;
}

/** Payload nowosci do doklejenia do odpowiedzi. Zwraca tresc TYLKO, gdy aktor
 *  nie widzial biezacej wersji - i od razu oznacza ja jako dostarczona. */
export function firstConnectNews(
  ctx: Ctx,
  actorId: number,
): { prompt: string; text: string } | null {
  const hash = newsHash();
  if (!hash) return null;
  const row = ctx.db.prepare("SELECT news_seen FROM actors WHERE id = ?").get(actorId) as
    | { news_seen: string | null }
    | undefined;
  if (!row || row.news_seen === hash) return null;
  ctx.db.prepare("UPDATE actors SET news_seen = ? WHERE id = ?").run(hash, actorId);
  return { prompt: NEWS_PROMPT, text: newsText() };
}
