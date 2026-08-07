/**
 * Import historii z prototypu (`~/.talk`).
 *
 * Odwzorowanie:
 *   label z channel.jsonl / presence  -> aktor (michal jako human, reszta jako agent)
 *   chan "#general"                   -> kanal publiczny "general"
 *   rekord z polem `to`               -> DM miedzy nadawca a adresatem
 *   kind "react"                      -> wiersz w reactions, NIE wiadomosc
 *   kind "ask" / "answer"             -> questions, powiazane po id/ref
 *   read/<who>/<view>                 -> last_read_message_id
 *
 * Zasada, ktora rzadzi calym tym plikiem: **nic nie ginie po cichu**. Prototyp
 * pomijal uszkodzone linie JSON bez sladu, wiec wiadomosc mogla zniknac i nikt
 * nigdy sie o tym nie dowiedzial. Tutaj kazdy pominiety rekord jest policzony
 * i opisany w raporcie.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tx } from "../store/db.ts";
import type { Ctx } from "../core/ctx.ts";
import { createActor, getActorByHandle } from "../core/actors.ts";
import { normalizeHandle, normalizeSlug } from "../core/ids.ts";
import { createChannel, ensureDirect, getBySlug, join as joinConv } from "../core/conversations.ts";

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

  // Sortowanie po czasie, stabilne. channel.jsonl jest dopisywany, wiec zwykle JEST
  // chronologiczny - ale "zwykle" nie wystarcza, bo od zgodnosci porzadku id z
  // porzadkiem czasu zalezy przeliczenie znacznikow odczytu (znacznik jest czasem,
  // a docelowo ma byc identyfikatorem wiadomosci). Jeden rekord nie na swoim miejscu
  // oznaczylby czesc historii jako przeczytana, choc nikt jej nie widzial.
  const records = readChannel(join(talkHome, "channel.jsonl"), report)
    .map((rec, index) => ({ rec, index }))
    .sort((a, b) => (a.rec.ts ?? 0) - (b.rec.ts ?? 0) || a.index - b.index)
    .map((x) => x.rec);
  const labelToActor = new Map<string, number>();
  // Prototyp adresowal DM-y etykieta ALBO osmioznakowym skrotem sid ("4a925a82"),
  // wiec bez tej drugiej mapy czesc rozmow prywatnych nie da sie odtworzyc.
  const sidToActor = new Map<string, number>();

  const actorFor = (label: string | undefined, sid: string | undefined): number | null => {
    const raw = (label ?? sid ?? "").trim();
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
    const existing = getActorByHandle(ctx, handle);
    const actor = existing ?? createActor(ctx, {
      // "michal" to jedyny czlowiek w historii prototypu; reszta to sesje agentow.
      kind: handle === "michal" ? "human" : "agent",
      handle,
      displayName: raw,
    });
    if (!existing) report.actors++;
    labelToActor.set(key, actor.id);
    if (sid) sidToActor.set(sid.toLowerCase(), actor.id);
    return actor.id;
  };

  // Aktorzy z katalogu obecnosci ida pierwsi: dzieki temu adresat DM-a, ktory nigdy
  // nic nie napisal, i tak da sie rozwiazac.
  seedFromPresence(ctx, talkHome, actorFor, report);

  const importer = () => {
    const midToMessage = new Map<string, number>();
    const qidToQuestion = new Map<string, number>();
    const channelCache = new Map<string, number>();

    const channelFor = (chan: string | undefined, creator: number): number => {
      const slug = normalizeSlug(chan || "#general");
      const cached = channelCache.get(slug);
      if (cached !== undefined) return cached;
      const conv = getBySlug(ctx, slug)
        ?? (report.conversations++,
            createChannel(ctx, { slug, kind: "public", createdBy: creator }));
      channelCache.set(slug, conv.id);
      return conv.id;
    };

    for (const rec of records) {
      const kind = rec.kind ?? "say";
      // join/leave byly czystym szumem juz w prototypie (kazde wywolanie mostu
      // to wejscie i wyjscie); stan obecnosci i tak trzymamy osobno.
      if (kind === "join" || kind === "leave") {
        report.skipped++;
        continue;
      }
      const author = actorFor(rec.label, rec.sid);
      if (author === null) {
        report.skipped++;
        continue;
      }

      if (kind === "react") {
        const target = rec.ref ? midToMessage.get(rec.ref) : undefined;
        if (!target) {
          report.skipped++;
          report.problems.push(`reakcja do nieznanej wiadomosci ${rec.ref ?? "?"}`);
          continue;
        }
        const done = ctx.db
          .prepare(
            "INSERT OR IGNORE INTO reactions(message_id, actor_id, emoji, created_at) VALUES(?,?,?,?)",
          )
          .run(target, author, String(rec.emoji ?? "?").slice(0, 16), Math.floor(rec.ts ?? 0));
        if (done.changes > 0) report.reactions++;
        else report.skipped++;
        continue;
      }

      // Adresat DM-a byl w prototypie etykieta albo osmioznakowym skrotem sid.
      let conversationId: number;
      if (rec.to) {
        const target = resolveRecipient(ctx, rec.to, labelToActor, sidToActor);
        if (target === null) {
          report.skipped++;
          report.problems.push(`nie rozwiazano adresata "${rec.to}"`);
          continue;
        }
        if (target === author) {
          report.skipped++;
          report.problems.push(`wiadomosc do samego siebie od "${rec.label ?? rec.sid}"`);
          continue;
        }
        conversationId = ensureDirect(ctx, [author, target]).id;
      } else {
        conversationId = channelFor(rec.chan, author);
        joinConv(ctx, conversationId, author);
      }

      const importKey = rec.mid ? `talk:${rec.mid}` : null;
      if (importKey && ctx.db.prepare("SELECT 1 FROM messages WHERE import_key = ?").get(importKey)) {
        report.skipped++;
        continue;
      }

      const body = String(rec.text ?? "").trim();
      if (!body) {
        report.skipped++;
        continue;
      }

      const threadId = kind === "answer" && rec.ref
        ? questionMessage(ctx, qidToQuestion.get(rec.ref))
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
        const qid = qidToQuestion.get(rec.ref);
        if (qid) {
          ctx.db
            .prepare("UPDATE questions SET answer_message_id = ?, closed_at = ? WHERE id = ?")
            .run(row.id, Math.floor(rec.ts ?? 0), qid);
        } else {
          report.problems.push(`odpowiedz na nieznane pytanie ${rec.ref}`);
        }
      }
    }

    importReadMarks(ctx, talkHome, labelToActor, sidToActor, report);
  };

  tx(ctx.db, importer);
  return report;
}

// ---- czesci skladowe ------------------------------------------------------

function readChannel(path: string, report: ImportReport): TalkRecord[] {
  if (!existsSync(path)) return [];
  const out: TalkRecord[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as TalkRecord);
    } catch {
      // Policzone i opisane, a nie pominiete w ciszy - to byl konkretny blad prototypu.
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

/** Adresat po etykiecie, potem po osmioznakowym skrocie sid - dokladnie taka
 *  kolejnosc, jaka stosowal `read_new()` w prototypie. */
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
  // "4a925a82" to skrot sid, a nie skrot etykiety - stad osobna mapa.
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

function questionMessage(ctx: Ctx, questionId: number | undefined): number | null {
  if (!questionId) return null;
  const row = ctx.db.prepare("SELECT message_id FROM questions WHERE id = ?").get(questionId) as
    | { message_id: number }
    | undefined;
  return row?.message_id ?? null;
}

function insertMentions(ctx: Ctx, messageId: number, body: string): void {
  const handles = [...body.matchAll(/(^|[^\p{L}\p{N}_@.-])@([\p{L}\p{N}][\p{L}\p{N}._-]{1,31})/gu)]
    .map((m) => m[2].toLowerCase().replace(/[._-]+$/, ""));
  if (handles.length === 0) return;
  const stmt = ctx.db.prepare(
    "INSERT OR IGNORE INTO mentions(message_id, actor_id) SELECT ?, id FROM actors WHERE handle = ?",
  );
  for (const h of new Set(handles)) stmt.run(messageId, h);
}

/** Znacznik czasu w milisekundach zamieniamy na id ostatniej wiadomosci, ktora
 *  wtedy istniala. Dzieki temu liczniki po imporcie zgadzaja sie z tym, co
 *  czlowiek widzial przed migracja. */
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
    // Katalog nazywa sie sid-em uczestnika, ale dla czlowieka bywal etykieta.
    const actorId = sidToActor.get(who.toLowerCase())
      ?? labelToActor.get(who.toLowerCase())
      ?? safeHandleLookup(ctx, who);
    if (!actorId) continue;
    for (const view of readdirSync(join(root, who))) {
      if (view.startsWith("dm_")) continue; // DM-y maja nowe identyfikatory konwersacji
      const conv = getBySlug(ctx, view.replace(/^#/, ""));
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
