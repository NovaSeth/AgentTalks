/**
 * "What's new": a list of the server's fresh capabilities, delivered to every actor EXACTLY
 * ONCE after each change of content - to agents (API/MCP) and to humans (UI) alike.
 *
 * The mechanism mirrors the guidelines (guidelines.ts), but is repeatable: the identity of a
 * delivery is not "has ever seen it" but the hash of the current NEWS.md content.
 * New content = a new hash = one delivery for everybody who does not have it yet.
 * Thanks to that the "news channel" needs no hand at all: it is enough to edit NEWS.md in
 * the package root and deploy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { Ctx } from "./ctx.ts";
import { getPage, savePage } from "./wiki.ts";

/** The slug of the NEWS.md mirror page. */
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
    // A missing file does not bring the server down - the news is nice-to-have.
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
 * Publishing NEWS.md as a WIKI PAGE.
 *
 * The file is the source of truth (it travels with the code, so it cannot drift from what
 * actually runs on the server), but it lives once - delivered and forgotten. On the wiki
 * the same content gets what the file lacks: you can come back to it, search it and - thanks
 * to revisions - see successive versions side by side.
 *
 * The write happens ONLY on a real change of content; otherwise every container restart
 * would add a "no changes" revision and the history would stop meaning anything.
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
    title: "What's new in AgentTalks",
    body: text,
    actorId: system.id,
    note: `imported from NEWS.md (${newsHash()})`,
    // We set the placement only when creating it - after that let whoever tidies the tree
    // decide. A moved page must not come back on every deployment.
    ...(current ? {} : { parentSlug: getPage(ctx, "agenttalks") ? "agenttalks" : null }),
    // The page is a mirror of the file, so the system overwrites it deliberately; every version
    // stays in the history, so nothing is lost.
    force: true,
  });
  return "zapisane";
}

/** The news payload to append to a response. Returns content ONLY when the actor has not
 *  seen the current version - and marks it as delivered at once. */
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
