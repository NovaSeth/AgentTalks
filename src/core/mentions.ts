/**
 * Mentions. Parsed once, at write time, and stored in the `mentions` table.
 *
 * In the prototype every "does this concern me" question was a substring scan over the whole
 * history, with a list of name variants built on the fly (`@label`, `@first-part`,
 * `@eight-characters-of-sid`). That was slow and unreliable: changing a label changed the result
 * retroactively, and "@nestor" inside somebody else's message counted the same as a mention.
 */
import type { Ctx } from "./ctx.ts";
import { transliterate } from "./ids.ts";
import { messageFromRow, type Message, type MsgRow } from "./messages.ts";

// A mention has to be preceded by the start of the text or by a character that is not part
// of a word. Without that, "michal@example.com" would be a mention of the user "example".
const MENTION_RE = /(^|[^\p{L}\p{N}_@.-])@([\p{L}\p{N}][\p{L}\p{N}._-]{1,31})/gu;

/** Returns handles in order of occurrence, without duplicates, lower-cased. */
export function parseMentions(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(body ?? "").matchAll(MENTION_RE)) {
    // A dot and a hyphen can be part of a handle, but not at the end - there they are usually
    // sentence punctuation ("ask @nestor."). Transliteration is THE SAME as when a handle is
    // issued - otherwise "@Michal" written with Polish diacritics would never hit the account
    // "michal", because a handle is stored transliterated.
    const h = transliterate(m[2]).replace(/[._-]+$/, "");
    if (h.length < 2 || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/** Collective mentions: each of these aliases calls EVERY member of the channel. */
const ALL_ALIASES = new Set(["all", "channel", "here", "wszyscy", "kanal"]);

/** Handles that really exist, mapped to actor ids. Non-existent ones are simply text.
 *  When a conversationId is given, `@all` (and its aliases) expands to every member of the
 *  channel - so that an announcement to the whole channel reaches, by push/wake, everybody
 *  watching it. */
export function resolveMentions(ctx: Ctx, body: string, conversationId?: number): number[] {
  const handles = parseMentions(body);
  if (handles.length === 0) return [];
  const ids = new Set<number>();
  const named = handles.filter((h) => !ALL_ALIASES.has(h));
  const wantsAll = conversationId !== undefined && handles.some((h) => ALL_ALIASES.has(h));
  if (named.length) {
    const marks = named.map(() => "?").join(",");
    const rows = ctx.db.prepare(`SELECT id FROM actors WHERE handle IN (${marks})`)
      .all(...named) as Array<{ id: number }>;
    for (const r of rows) ids.add(r.id);
  }
  if (wantsAll) {
    const rows = ctx.db.prepare("SELECT actor_id FROM members WHERE conversation_id = ?")
      .all(conversationId) as Array<{ actor_id: number }>;
    for (const r of rows) ids.add(r.actor_id);
  }
  return [...ids];
}

/**
 * Messages mentioning an actor - the equivalent of `talk mentions`.
 * Limited to conversations the actor is allowed to read (public or its own): a mention in
 * somebody else's private channel must NOT become a channel for leaking content.
 */
export function mentionsOf(
  ctx: Ctx,
  actorId: number,
  opts: { afterId?: number; limit?: number } = {},
): Message[] {
  const rows = ctx.db
    .prepare(
      `SELECT m.* FROM mentions mn
         JOIN messages m ON m.id = mn.message_id
         JOIN conversations c ON c.id = m.conversation_id
        WHERE mn.actor_id = :me
          AND m.id > :after
          AND m.actor_id <> :me
          AND m.deleted_at IS NULL
          AND (c.kind = 'public'
               OR EXISTS (SELECT 1 FROM members mem
                           WHERE mem.conversation_id = c.id AND mem.actor_id = :me))
        ORDER BY m.id DESC LIMIT :lim`,
    )
    .all({ me: actorId, after: opts.afterId ?? 0, lim: Math.min(opts.limit ?? 50, 200) }) as
    MsgRow[];
  return rows.reverse().map(messageFromRow);
}
