/**
 * Importing history from the prototype (`~/.talk`).
 * 
 * The mapping:
 *   a label from channel.jsonl / presence  -> an actor (michal as human, the rest as agents)
 *   chan "#general"                        -> the public channel "general"
 *   a record with a `to` field              -> a DM between sender and addressee
 *   kind "react"                            -> a row in reactions, NOT a message
 *   kind "ask" / "answer"                   -> questions, linked by id/ref
 *   read/<who>/<view>                       -> last_read_message_id
 * 
 * The rule that governs this whole file: **nothing disappears silently**. The prototype
 * skipped corrupted JSON lines without a trace, so a message could vanish and nobody would
 * ever find out. Here every skipped record is counted and described in the report.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tx } from "../store/db.ts";
import type { Ctx } from "../core/ctx.ts";
import { createActor, getActorByHandle } from "../core/actors.ts";
import { normalizeHandle, normalizeSlug } from "../core/ids.ts";
import { createChannel, ensureDirect, getBySlug, join as joinConv } from "../core/conversations.ts";
import { resolveMentions } from "../core/mentions.ts";

export type ImportReport = {
  actors: number;
  conversations: number;
  messages: number;
  reactions: number;
  questions: number;
  reads: number;
  skipped: number;
  problems: string[];
};

type TalkRecord = {
  ts?: number;
  sid?: string;
  label?: string;
  kind?: string;
  to?: string | null;
  chan?: string;
  text?: string;
  mid?: string;
  id?: string;
  ref?: string;
  emoji?: string;
};

export function importTalkHome(ctx: Ctx, talkHome: string): ImportReport {
  const report: ImportReport = {
    actors: 0, conversations: 0, messages: 0, reactions: 0,
    questions: 0, reads: 0, skipped: 0, problems: [],
  };

  // A stable sort by time. channel.jsonl is appended to, so it usually IS chronological - but
  // "usually" is not enough, because the recalculation of read markers depends on the id order
  // agreeing with the time order (the marker is a time, and is meant to become a message id).
  // One record out of place would mark part of the history as read that nobody had seen.
  const records = readChannel(join(talkHome, "channel.jsonl"), report)
    .map((rec, index) => ({ rec, index }))
    .sort((a, b) => (a.rec.ts ?? 0) - (b.rec.ts ?? 0) || a.index - b.index)
    .map((x) => x.rec);
  const labelToActor = new Map<string, number>();
  // The prototype addressed DMs by label OR by an eight-character sid digest ("4a925a82"), so
  // without this second map some private conversations cannot be reconstructed.
  const sidToActor = new Map<string, number>();

  const actorFor = (label: string | undefined, sid: string | undefined): number | null => {
    // Merging "(N)" suffixes: in the prototype the same agent appeared as "Nestor/myday",
    // "Nestor/myday (2)", "(3)"... - those were artefacts of ONE session's identity, not separate
    // participants (Nestor's measurement m436, claude-general's remark m476). Without merging we
    // would carry the mess into a system built precisely so that identity is unambiguous. We
    // strip the suffix BEFORE everything, so "(2)" and the base land on the same key, handle and
    // displayName.
    const raw = (label ?? sid ?? "").trim().replace(/\s*\(\d+\)$/, "");
    if (!raw) return null;
    const key = raw.toLowerCase();
    const cached = labelToActor.get(key);
    if (cached !== undefined) {
      if (sid) sidToActor.set(sid.toLowerCase(), cached);
      return cached;
    }
    let handle: string;
    try {
      handle = normalizeHandle(raw);
    } catch {
      report.problems.push(`nie da sie zrobic handle z etykiety "${raw}"`);
      return null;
    }
    // A collision after transliteration ("Michal" with and without diacritics is the same handle,
    // but "mac/general" and "mac general" are DIFFERENT labels): silently fusing two participants
    // into one would falsify the history. We settle it by displayName - the same label is the
    // same actor, a different one gets a suffix.
    let existing = getActorByHandle(ctx, handle);
    if (existing && existing.displayName !== raw) {
      let n = 2;
      while (getActorByHandle(ctx, `${handle}-${n}`)?.displayName !== undefined
             && getActorByHandle(ctx, `${handle}-${n}`)!.displayName !== raw) n++;
      report.problems.push(
        `kolizja handle "${handle}": etykieta "${raw}" dostaje "${handle}-${n}"`,
      );
      handle = `${handle}-${n}`;
      existing = getActorByHandle(ctx, handle);
    }
    const actor = existing ?? createActor(ctx, {
      // "michal" is the only human in the prototype's history; the rest are agent sessions.
      kind: handle === "michal" ? "human" : "agent",
      handle,
      displayName: raw,
    });
    if (!existing) report.actors++;
    labelToActor.set(key, actor.id);
    if (sid) sidToActor.set(sid.toLowerCase(), actor.id);
    return actor.id;
  };

  const midToMessage = new Map<string, number>();
  const qidToQuestion = new Map<string, number>();
  const channelCache = new Map<string, number>();

  const channelFor = (chan: string | undefined, creator: number): number => {
    const slug = normalizeSlug(chan || "#general");
    const cached = channelCache.get(slug);
    if (cached !== undefined) return cached;
    const conv = getBySlug(ctx, slug)
      ?? createChannel(ctx, { slug, kind: "public", createdBy: creator });
    channelCache.set(slug, conv.id);
    return conv.id;
  };

  const importRecord = (rec: TalkRecord, kind: string): void => {
      // join/leave were pure noise already in the prototype (every bridge invocation is an entry
      // and an exit); presence state is kept separately anyway.
      if (kind === "join" || kind === "leave") {
        report.skipped++;
        return;
      }
      const author = actorFor(rec.label, rec.sid);
      if (author === null) {
        report.skipped++;
        return;
      }

      if (kind === "react") {
        // First the map from this run, then the database (import_key) - a second, incremental import
        // also has to be able to pin a reaction to a message imported the previous time.
        const target = (rec.ref ? midToMessage.get(rec.ref) : undefined)
          ?? messageByImportKey(ctx, rec.ref);
        if (!target) {
          report.skipped++;
          report.problems.push(`reakcja do nieznanej wiadomosci ${rec.ref ?? "?"}`);
          return;
        }
        const done = ctx.db
          .prepare(
            "INSERT OR IGNORE INTO reactions(message_id, actor_id, emoji, created_at) VALUES(?,?,?,?)",
          )
          .run(target, author, String(rec.emoji ?? "?").slice(0, 16), Math.floor(rec.ts ?? 0));
        if (done.changes > 0) report.reactions++;
        else report.skipped++;
        return;
      }

      // A DM's addressee was, in the prototype, a label or an eight-character sid digest.
      let conversationId: number;
      if (rec.to) {
        const target = resolveRecipient(ctx, rec.to, labelToActor, sidToActor);
        if (target === null) {
          report.skipped++;
          report.problems.push(`nie rozwiazano adresata "${rec.to}"`);
          return;
        }
        if (target === author) {
          report.skipped++;
          report.problems.push(`wiadomosc do samego siebie od "${rec.label ?? rec.sid}"`);
          return;
        }
        conversationId = ensureDirect(ctx, [author, target]).id;
      } else {
        conversationId = channelFor(rec.chan, author);
        joinConv(ctx, conversationId, author);
      }

      const importKey = rec.mid ? `talk:${rec.mid}` : null;
      if (importKey && ctx.db.prepare("SELECT 1 FROM messages WHERE import_key = ?").get(importKey)) {
        report.skipped++;
        return;
      }

      const body = String(rec.text ?? "").trim();
      if (!body) {
        report.skipped++;
        return;
      }

      const threadId = kind === "answer" && rec.ref
        ? questionMessage(ctx, qidToQuestion.get(rec.ref) ?? questionByAskMid(ctx, rec.ref))
        : null;

      ctx.db
        .prepare(
          `INSERT INTO messages(conversation_id, actor_id, ts, kind, body, thread_id, import_key)
           VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          conversationId,
          author,
          Math.floor(rec.ts ?? 0),
          kind === "ask" ? "ask" : kind === "answer" ? "answer" : kind === "file" ? "file" : "text",
          body,
          threadId,
          importKey,
        );
      const row = ctx.db.prepare("SELECT id FROM messages WHERE id = last_insert_rowid()").get() as {
        id: number;
      };
      report.messages++;
      if (rec.mid) midToMessage.set(rec.mid, row.id);

      insertMentions(ctx, row.id, body);

      if (kind === "ask") {
        ctx.db
          .prepare("INSERT INTO questions(message_id, conversation_id) VALUES(?,?)")
          .run(row.id, conversationId);
        const q = ctx.db.prepare("SELECT id FROM questions WHERE message_id = ?").get(row.id) as {
          id: number;
        };
        if (rec.id) qidToQuestion.set(rec.id, q.id);
        report.questions++;
      }
      if (kind === "answer" && rec.ref) {
        const qid = qidToQuestion.get(rec.ref) ?? questionByAskMid(ctx, rec.ref);
        if (qid) {
          ctx.db
            .prepare("UPDATE questions SET answer_message_id = ?, closed_at = ? WHERE id = ?")
            .run(row.id, Math.floor(rec.ts ?? 0), qid);
        } else {
          report.problems.push(`odpowiedz na nieznane pytanie ${rec.ref}`);
        }
      }
  };

  const importer = () => {
    // Actors from the presence directory go first (a DM addressee who never wrote anything also
    // has to be resolvable) - and ALREADY INSIDE the transaction, so that an interrupted import
    // does not leave actors with no history.
    seedFromPresence(ctx, talkHome, actorFor, report);
    for (const rec of records) {
      // A bad channel or another defect in ONE record must not bring down the whole import with a
      // rollback after two hundred messages - such a record is skipped and described in the report.
      try {
        importRecord(rec, rec.kind ?? "say");
      } catch (err) {
        report.skipped++;
        report.problems.push(
          `rekord ${rec.mid ?? "?"}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    importReadMarks(ctx, talkHome, labelToActor, sidToActor, report);
  };

  const convsBefore = (ctx.db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as
    { n: number }).n;
  tx(ctx.db, importer);
  // The report counts ALL created conversations (channels + DMs + groups) from the database,
  // not from a manual counter, which only covered channels.
  report.conversations = (ctx.db.prepare("SELECT COUNT(*) AS n FROM conversations").get() as
    { n: number }).n - convsBefore;
  return report;
}

// ---- the component parts --------------------------------------------------

function readChannel(path: string, report: ImportReport): TalkRecord[] {
  if (!existsSync(path)) return [];
  const out: TalkRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as TalkRecord);
    } catch {
      // Counted and described, not skipped in silence - that was a concrete bug of the prototype.
      report.skipped++;
      report.problems.push(`uszkodzona linia JSON: ${trimmed.slice(0, 60)}`);
    }
  }
  return out;
}

function seedFromPresence(
  ctx: Ctx,
  talkHome: string,
  actorFor: (label: string | undefined, sid: string | undefined) => number | null,
  report: ImportReport,
): void {
  const dir = join(talkHome, "presence");
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".tmp")) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, name), "utf8")) as { label?: string };
      actorFor(data.label, name);
    } catch {
      report.problems.push(`nieczytelny wpis obecnosci: ${name}`);
    }
  }
}

/** The addressee by label, then by the eight-character sid digest - exactly the order
/**  `read_new()` used in the prototype. */
function resolveRecipient(
  ctx: Ctx,
  to: string,
  labelToActor: Map<string, number>,
  sidToActor: Map<string, number>,
): number | null {
  const needle = to.trim().toLowerCase();
  const direct = labelToActor.get(needle);
  if (direct !== undefined) return direct;
  try {
    const byHandle = getActorByHandle(ctx, normalizeHandle(to));
    if (byHandle) return byHandle.id;
  } catch { /* etykieta nie daje sie sprowadzic do handle */ }
  // "4a925a82" is a digest of a sid, not of a label - hence a separate map.
  const bySid = sidToActor.get(needle);
  if (bySid !== undefined) return bySid;
  for (const [sid, id] of sidToActor) {
    if (sid.startsWith(needle)) return id;
  }
  for (const [label, id] of labelToActor) {
    if (label.startsWith(needle)) return id;
  }
  return null;
}

function safeHandleLookup(ctx: Ctx, raw: string): number | undefined {
  try {
    return getActorByHandle(ctx, normalizeHandle(raw))?.id;
  } catch {
    return undefined;
  }
}

/** A message by its import key (talk:<mid>) - for incremental runs. */
function messageByImportKey(ctx: Ctx, mid: string | undefined): number | undefined {
  if (!mid) return undefined;
  const row = ctx.db.prepare("SELECT id FROM messages WHERE import_key = ?")
    .get(`talk:${mid}`) as { id: number } | undefined;
  return row?.id;
}

/** A question by the mid of an ask message from a PREVIOUS import run.
/**  Note: the prototype's qid ("q7") is a different naming from mid ("m123") - answer refs
/**  point at a qid, and we map qid->question in memory; the fallback works through the ask
/**  message, which has an import_key, when the ref is a mid. */
function questionByAskMid(ctx: Ctx, ref: string | undefined): number | undefined {
  if (!ref) return undefined;
  const row = ctx.db.prepare(
    `SELECT q.id FROM questions q JOIN messages m ON m.id = q.message_id
      WHERE m.import_key = ?`,
  ).get(`talk:${ref}`) as { id: number } | undefined;
  return row?.id;
}

function questionMessage(ctx: Ctx, questionId: number | undefined): number | null {
  if (!questionId) return null;
  const row = ctx.db.prepare("SELECT message_id FROM questions WHERE id = ?").get(questionId) as
    | { message_id: number }
    | undefined;
  return row?.message_id ?? null;
}

function insertMentions(ctx: Ctx, messageId: number, body: string): void {
  // THE SAME parsing implementation as on an ordinary write (core/mentions) - two copies of the
  // regex have already managed to drift apart once.
  const stmt = ctx.db.prepare(
    "INSERT OR IGNORE INTO mentions(message_id, actor_id) VALUES(?, ?)",
  );
  for (const actorId of resolveMentions(ctx, body)) stmt.run(messageId, actorId);
}

/** A millisecond timestamp is turned into the id of the last message that existed then. Thanks
/**  to that, the counters after an import agree with what the human saw before the migration. */
function importReadMarks(
  ctx: Ctx,
  talkHome: string,
  labelToActor: Map<string, number>,
  sidToActor: Map<string, number>,
  report: ImportReport,
): void {
  const root = join(talkHome, "read");
  if (!existsSync(root)) return;
  for (const who of readdirSync(root)) {
    // The directory is named after the participant's sid, but for a human it was sometimes a label.
    const actorId = sidToActor.get(who.toLowerCase())
      ?? labelToActor.get(who.toLowerCase())
      ?? safeHandleLookup(ctx, who);
    if (!actorId) continue;
    for (const view of readdirSync(join(root, who))) {
      let conv = null;
      if (view.startsWith("dm_")) {
        // A DM's read marker: dm_<sid|label> -> the conversation between the reader
        // and that actor. Dropping these markers made every DM "unread" right after
        // the migration.
        const other = sidToActor.get(view.slice(3).toLowerCase())
          ?? labelToActor.get(view.slice(3).toLowerCase());
        if (other && other !== actorId) conv = ensureDirect(ctx, [actorId, other]);
      } else {
        conv = getBySlug(ctx, view.replace(/^#/, ""));
      }
      if (!conv) continue;
      const raw = Number(readFileSync(join(root, who, view), "utf8").trim());
      if (!Number.isFinite(raw)) continue;
      const row = ctx.db
        .prepare(
          "SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE conversation_id = ? AND ts <= ?",
        )
        .get(conv.id, Math.floor(raw / 1000)) as { id: number };
      ctx.db
        .prepare(
          `INSERT INTO members(conversation_id, actor_id, joined_at, last_read_message_id)
           VALUES(?,?,?,?)
           ON CONFLICT(conversation_id, actor_id)
           DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)`,
        )
        .run(conv.id, actorId, 0, row.id);
      report.reads++;
    }
  }
}
