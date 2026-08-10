/**
 * Presence.
 *
 * Two signals, deliberately kept apart - one of the prototype's better decisions:
 *
 *   typing - a human really is tapping the keyboard in the UI (clears after 7 s)
 *   busy   - the session used a tool (clears after 30 s)
 *
 * The "working" signal MUST come from tool use, never from polling the API. Otherwise an
 * open browser tab pretends to be work, and then the indicator carries no information at
 * all.
 *
 * The kind of session is DECLARED at registration, not guessed from the shape of a name.
 * The prototype guessed from a prefix ("bs/") and a suffix ("/oneshot"), which made
 * subagent incarnations glow as active ten minutes after they died.
 */
import type { Ctx } from "./ctx.ts";
import { notFound } from "./errors.ts";

/**
 * How many seconds the "typing" signal lives without a refresh.
 *
 * Seven seconds is right for a HUMAN: every keystroke refreshes the signal, so the bubble
 * goes out shortly after somebody stops writing. For an AGENT it is useless - an agent
 * "writes" in one move that lasts tens of seconds or a minute, with nothing to refresh
 * along the way. Measured on this instance: 8 of 26 sessions set the signal EVER, and most
 * of those were my own attempts. The feature existed and was unusable for half of this
 * channel's participants.
 *
 * That is why the signal can carry its OWN lifetime (up to TYPING_MAX). This does not risk
 * stuck bubbles, because sending a message clears the signal immediately - and stop is one
 * call.
 */
export const TYPING_TTL = 7;
export const TYPING_MAX = 300;
export const BUSY_TTL = 30;
export const ONLINE_WINDOW = 900;
export const STALE_DURABLE = 600;
export const STALE_EPHEMERAL = 60;
// A durable session without a heartbeat for longer than this disappears from presence.
// Feedback from #nextIteration: the prototype's participant list grew monotonically and a
// new session read 14 dead participants next to 3 live ones. The key to this operation
// being safe: the PRESENCE ROW disappears, not the identity - the actor stays in the roster
// (the actors table) and its label has no way to "move out", which was the prototype's bug
// when it deleted on idleness.
export const PRESENCE_RETENTION = 7 * 24 * 3600;

export type SessionKind = "durable" | "ephemeral";

export type PresenceRow = {
  sessionId: string;
  actorId: number;
  handle: string;
  displayName: string;
  label: string;
  kind: SessionKind;
  doing: string | null;
  cwd: string | null;
  lastSeenAt: number;
  online: boolean;
  stale: boolean;
  typing: boolean;
  /** Where it is writing: "c:<convId>" / "w:<wiki slug>" / null (a signal with no place). */
  typingIn: string | null;
  busy: boolean;
};

export function registerSession(
  ctx: Ctx,
  input: {
    sessionId: string;
    actorId: number;
    label?: string;
    kind?: SessionKind;
    cwd?: string | null;
    host?: string | null;
  },
): void {
  const exists = ctx.db.prepare("SELECT id FROM actors WHERE id = ?").get(input.actorId);
  if (!exists) throw notFound("aktor", `nie ma aktora ${input.actorId}`);
  const now = ctx.now();
  // The state BEFORE the write - to decide whether anybody will see a difference.
  const przed = ctx.db
    .prepare("SELECT label, kind, ended_at FROM sessions WHERE id = ?")
    .get(input.sessionId) as { label: string; kind: string; ended_at: number | null } | undefined;
  // COALESCE(excluded, sessions): fields that are GIVEN overwrite, fields OMITTED stay.
  // `atalk ping`/`busy`/`typing` call the same POST /api/sessions with only a sessionId -
  // without this the heartbeat erased the label set by `atalk me` (label fell back to
  // sessionId.slice(0,8), kind/cwd/host to their defaults), so a participant kept changing
  // name in presence.
  ctx.db
    .prepare(
      `INSERT INTO sessions(id, actor_id, label, kind, cwd, host, started_at, last_seen_at)
       VALUES(:id, :actor, :label, :kind, :cwd, :host, :now, :now)
       ON CONFLICT(id) DO UPDATE SET
         label = COALESCE(:labelOrNull, sessions.label),
         kind = COALESCE(:kindOrNull, sessions.kind),
         cwd = COALESCE(:cwd, sessions.cwd),
         host = COALESCE(:host, sessions.host),
         last_seen_at = :now,
         ended_at = NULL`,
    )
    .run({
      id: input.sessionId,
      actor: input.actorId,
      label: input.label ?? input.sessionId.slice(0, 8),
      kind: input.kind ?? "durable",
      cwd: input.cwd ?? null,
      host: input.host ?? null,
      now,
      // on UPDATE: null = "leave this field alone"
      labelOrNull: input.label ?? null,
      kindOrNull: input.kind ?? null,
    });
  sprzatnijMartweSesje(ctx);

  // Broadcast ONLY on a real change. The interface beats a heartbeat every 30 s with this
  // same call, so unconditional publication meant that with N open sessions each of them woke
  // all the others every 30 s: traffic grows with the square of the number of participants,
  // and the event's content is the same every time ("something in presence"). Refreshing a
  // timestamp alone changes nothing anybody can see - for the first 60 s after the last
  // contact the session is "online" regardless.
  // kontaktu sesja i tak jest "online".
  const nowaSesja = przed === undefined;
  const wrocila = przed?.ended_at != null;
  const zmienionaEtykieta = input.label !== undefined && input.label !== przed?.label;
  const zmienionyRodzaj = input.kind !== undefined && input.kind !== przed?.kind;
  if (nowaSesja || wrocila || zmienionaEtykieta || zmienionyRodzaj) {
    ctx.bus.publish(allActorIds(ctx), { type: "presence" });
  }
}

/** Cleaning up dead sessions. The `sessions` table grew without bound (every CLI run left a
 *  row), and `presence()` reads it IN FULL on every read - so the cost of the presence list
 *  grew with the history of runs rather than with the number of people present. Instead of
 *  a separate job: we clean up lazily, on write. */
const MARTWA_SESJA_SEK = 7 * 24 * 3600;
function sprzatnijMartweSesje(ctx: Ctx): void {
  ctx.db.prepare("DELETE FROM sessions WHERE COALESCE(ended_at, last_seen_at) < ?")
    .run(ctx.now() - MARTWA_SESJA_SEK);
}

export function heartbeat(ctx: Ctx, sessionId: string): void {
  ctx.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(ctx.now(), sessionId);
}

export function setDoing(ctx: Ctx, sessionId: string, doing: string | null): void {
  ctx.db
    .prepare("UPDATE sessions SET doing = ?, last_seen_at = ? WHERE id = ?")
    .run(doing, ctx.now(), sessionId);
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

/** The typing/busy signal. For typing you can give a PLACE ("c:<convId>" / "w:<slug>") and
 *  stop=true, when the author changed their mind and the bubble should disappear at once
 *  (rather than wait for the TTL). */
export function signal(
  ctx: Ctx,
  sessionId: string,
  kind: "typing" | "busy",
  opts?: { typingIn?: string | null; stop?: boolean; sec?: number | null },
): void {
  const now = ctx.now();
  if (kind === "typing") {
    if (opts?.stop) {
      ctx.db
        .prepare("UPDATE sessions SET typing_at = NULL, typing_in = NULL, typing_sec = NULL, last_seen_at = ? WHERE id = ?")
        .run(now, sessionId);
    } else {
      // We store a custom lifetime NEXT TO the timestamp rather than by pushing the timestamp
      // into the future: otherwise "when they started writing" and "how long this is valid"
      // would be the same number and a fresh signal could not be told from a long one.
      // sygnalu od dlugiego.
      const sec = opts?.sec == null ? null
        : Math.min(Math.max(Math.trunc(Number(opts.sec) || 0), 1), TYPING_MAX);
      ctx.db
        .prepare("UPDATE sessions SET typing_at = ?, typing_in = ?, typing_sec = ?, last_seen_at = ? WHERE id = ?")
        .run(now, opts?.typingIn ? String(opts.typingIn).slice(0, 100) : null, sec, now, sessionId);
    }
  } else {
    ctx.db
      .prepare("UPDATE sessions SET busy_at = ?, last_seen_at = ? WHERE id = ?")
      .run(now, now, sessionId);
  }
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

/** Sending a message ends typing - the bubble disappears without waiting for the TTL. */
export function clearTyping(ctx: Ctx, sessionId: string): void {
  ctx.db
    .prepare("UPDATE sessions SET typing_at = NULL, typing_in = NULL WHERE id = ?")
    .run(sessionId);
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

export function endSession(ctx: Ctx, sessionId: string): void {
  ctx.db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(ctx.now(), sessionId);
  ctx.bus.publish(allActorIds(ctx), { type: "presence" });
}

type SessionRow = {
  id: string;
  actor_id: number;
  handle: string;
  display_name: string;
  label: string;
  kind: SessionKind;
  cwd: string | null;
  last_seen_at: number;
  typing_at: number | null;
  typing_sec: number | null;
  typing_in: string | null;
  busy_at: number | null;
  doing: string | null;
  ended_at: number | null;
};

export function presence(ctx: Ctx): PresenceRow[] {
  const now = ctx.now();
  const rows = ctx.db
    .prepare(
      `SELECT s.id, s.actor_id, a.handle, a.display_name, s.label, s.kind, s.cwd,
              s.last_seen_at, s.typing_at, s.typing_in, s.typing_sec, s.busy_at, s.doing, s.ended_at
         FROM sessions s JOIN actors a ON a.id = s.actor_id
        ORDER BY a.handle, s.label, s.id`,
    )
    .all() as SessionRow[];

  const out: PresenceRow[] = [];
  for (const r of rows) {
    const age = now - r.last_seen_at;
    const staleAfter = r.kind === "ephemeral" ? STALE_EPHEMERAL : STALE_DURABLE;
    const stale = age > staleAfter;
    // A session that ENDED (an end signal, for instance the SessionEnd hook) disappears from
    // presence regardless of its kind - presence shows who you can talk to NOW, and identity
    // is held by the actor roster. A dead ephemeral session also disappears after silence, a
    // durable one only after PRESENCE_RETENTION - because idleness does not mean the end, and
    // for a session without a loop it is the normal state.
    if (r.ended_at) continue;
    if (r.kind === "ephemeral" && stale) continue;
    if (r.kind === "durable" && age > PRESENCE_RETENTION) continue;
    out.push({
      sessionId: r.id,
      actorId: r.actor_id,
      handle: r.handle,
      displayName: r.display_name,
      label: r.label,
      kind: r.kind,
      doing: r.doing,
      cwd: r.cwd,
      lastSeenAt: r.last_seen_at,
      online: !r.ended_at && age < ONLINE_WINDOW,
      stale,
      typing: r.typing_at !== null && now - r.typing_at < (r.typing_sec ?? TYPING_TTL),
      typingIn: r.typing_in,
      busy: r.busy_at !== null && now - r.busy_at < BUSY_TTL,
    });
  }
  return out;
}

/**
 * An ACTOR's liveness (the freshest of its unfinished sessions). Feedback from
 * #nextIteration: `talk to <anybody>` always said "sent" and the sender learned about a
 * dead addressee from the absence of an answer, an hour later. This function feeds the one
 * confirmation line at write time: alive / silent for N min / absent.
 */
export function actorLiveness(
  ctx: Ctx,
  actorId: number,
): { online: boolean; lastSeenAt: number | null } {
  const row = ctx.db
    .prepare(
      "SELECT MAX(last_seen_at) AS seen FROM sessions WHERE actor_id = ? AND ended_at IS NULL",
    )
    .get(actorId) as { seen: number | null };
  if (row.seen === null) return { online: false, lastSeenAt: null };
  return { online: ctx.now() - row.seen < ONLINE_WINDOW, lastSeenAt: row.seen };
}

/** Presence is public information within an instance, so the event goes to everybody. The
 *  list is short (actors, not sessions) and read from an index.
 *  Exported: the wiki (also public) uses the same recipient list. */
export function allActorIds(ctx: Ctx): number[] {
  const rows = ctx.db.prepare("SELECT id FROM actors WHERE disabled_at IS NULL").all() as Array<{
    id: number;
  }>;
  return rows.map((r) => r.id);
}

/**
 * Who is writing RIGHT NOW - in a form ready to be placed where an agent makes its decision.
 *
 * @michal's request (#general [226]): "make it so that the api shows who is writing, maybe
 * that will unblock the conversations". The signal existed, but only in the PRESENCE LIST -
 * that is, you had to ask for it separately and know that it was worth asking. An agent
 * that is reading new messages and about to answer did not ask for the roster and had no
 * way to learn that somebody else is already answering.
 *
 * Hence the same question asked at the point of decision rather than in a separate call.
 * We skip our own sessions: "typing" about yourself is not information.
 */
export function whoIsTyping(
  ctx: Ctx,
  exceptActorId: number,
): Array<{ handle: string; in: string | null }> {
  const widziani = new Set<string>();
  const out: Array<{ handle: string; in: string | null }> = [];
  for (const p of presence(ctx)) {
    if (!p.typing || p.actorId === exceptActorId || widziani.has(p.handle)) continue;
    widziani.add(p.handle);
    out.push({ handle: p.handle, in: p.typingIn });
  }
  return out;
}
