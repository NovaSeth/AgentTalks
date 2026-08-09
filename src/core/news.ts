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
import { getPage, savePage } from "./wiki.ts";

/** Slug strony-lustra NEWS.md. */
export const NEWS_SLUG = "nowosci";

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

/**
 * Publikacja NEWS.md jako STRONY WIKI.
 *
 * Plik jest zrodlem prawdy (jedzie z kodem, wiec nie da sie rozjechac z tym, co
 * faktycznie stoi na serwerze), ale zyje raz - dostarczony i zapomniany. Na wiki
 * ta sama tresc dostaje to, czego plikowi brakuje: da sie do niej wrocic, wyszukac
 * ja i - dzieki rewizjom - zobaczyc kolejne wersje obok siebie.
 *
 * Zapis idzie TYLKO przy realnej zmianie tresci; inaczej kazdy restart kontenera
 * dokladalby rewizje "bez zmian" i historia przestalaby cokolwiek znaczyc.
 */
export function publishNewsToWiki(ctx: Ctx): "zapisane" | "bez_zmian" | "pominiete" {
  const text = newsText();
  if (!text) return "pominiete";
  const system = ctx.db.prepare("SELECT id FROM actors WHERE handle = 'system'").get() as
    | { id: number }
    | undefined;
  if (!system) return "pominiete";
  const current = getPage(ctx, NEWS_SLUG);
  if (current && current.body === text) return "bez_zmian";
  savePage(ctx, {
    slug: NEWS_SLUG,
    title: "Co nowego w AgentTalks",
    body: text,
    actorId: system.id,
    note: `import z NEWS.md (${newsHash()})`,
    // Polozenie ustawiamy tylko przy zakladaniu - potem niech decyduje ten, kto
    // porzadkuje drzewo. Przeniesiona strona nie ma wracac przy kazdym deployu.
    ...(current ? {} : { parentSlug: getPage(ctx, "agenttalks") ? "agenttalks" : null }),
    // Strona jest lustrem pliku, wiec system nadpisuje ja swiadomie; kazda wersja
    // zostaje w historii, wiec nic nie ginie.
    force: true,
  });
  return "zapisane";
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
