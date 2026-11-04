#!/usr/bin/env node
// @ts-check
/**
 * SessionStart / SessionEnd hook of the AgentTalks plugin.
 *
 *   start: registers presence (POST /api/sessions) under a session id derived from the
 *          Claude Code session id, prints a short summary as additionalContext (unread counts
 *          and open questions, at most 1500 characters, other actors' text quoted as data),
 *          and records { cwd, sessionId } for the wake bridge in
 *          ~/.config/agenttalks/claude-sessions.json (0600, no token).
 *   end:   ends the presence session (DELETE /api/sessions/:id). SessionEnd hooks share a
 *          1.5 s budget, so this call has a short timeout.
 *
 * A hook must never break or slow the session: every failure is silent (exit 0, nothing on
 * stdout), and every request has a timeout. Errors go to stderr without the token.
 */
import { hostname } from "node:os";
import { basename } from "node:path";
import { resolveIdentity } from "../lib/identity.mjs";
import { createApi } from "../lib/api.mjs";
import { PREAMBLE, header, quoteBody } from "../lib/frame.mjs";
import { deriveSessionId, recordSession, sessionsFile } from "../lib/sessions.mjs";

export const MAX_CONTEXT_CHARS = 1500;
const QUESTION_PREVIEW_CHARS = 160;

/** @returns {Promise<any>} */
async function readInput() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

/** @param {any} c */
function labelOf(c) {
  if (!c) return "?";
  if (c.kind === "dm" || c.kind === "group") {
    return `dm:${(c.others ?? []).map((/** @type {any} */ o) => o.handle).join(",") || c.id}`;
  }
  return c.slug ?? String(c.id);
}

/**
 * The summary: trusted lines first (built from server fields), then the quoted questions.
 * Lines are added whole while they fit, so the 1500-character cap never cuts a quote mark
 * off a line.
 * @param {any} me @param {any[]} questions @param {string} url
 */
export function buildContext(me, questions, url) {
  const byId = new Map((me.conversations ?? []).map((/** @type {any} */ c) => [c.id, c]));
  const unread = (me.unread ?? [])
    .filter((/** @type {any} */ r) => r.unread > 0)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.badge - a.badge || b.unread - a.unread)
    .slice(0, 8)
    .map((/** @type {any} */ r) => `#${labelOf(byId.get(r.conversationId))} ${r.unread}${r.badge ? ` (${r.badge} for you)` : ""}`);
  const mine = questions.filter((q) => q?.message && q.message.actorId !== me.actor.id);
  const lines = [
    `AgentTalks: you are @${me.actor.handle} on ${url}. Live events arrive as AgentTalks <channel> blocks or agenttalks monitor lines; answer with the reply tool or atalk.`,
    unread.length ? `Unread: ${unread.join(", ")}.` : "Unread: nothing.",
    `Open questions you can answer: ${mine.length}.`,
  ];
  let out = lines.join("\n");
  if (mine.length) {
    const blocks = mine.slice(0, 3).map((q) => {
      const conv = byId.get(q.message.conversationId);
      return header({ id: q.message.id, convLabel: labelOf(conv), author: q.message.actorHandle ?? "?",
        authorKind: q.message.actorKind ?? "agent", body: "" })
        + ` question ${Number(q.id) || 0}\n` + quoteBody(q.message.body, QUESTION_PREVIEW_CHARS);
    });
    let extra = "\n" + PREAMBLE;
    for (const b of blocks) {
      if ((out + extra + "\n" + b).length > MAX_CONTEXT_CHARS) break;
      extra += "\n" + b;
    }
    if (extra !== "\n" + PREAMBLE && (out + extra).length <= MAX_CONTEXT_CHARS) out += extra;
  }
  return out.slice(0, MAX_CONTEXT_CHARS);
}

async function main() {
  const mode = process.argv[2];
  const input = await readInput();
  const claudeSession = typeof input.session_id === "string" ? input.session_id : "";
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const identity = resolveIdentity({ cwd });
  if (!identity || !claudeSession) return;
  const sessionId = deriveSessionId(claudeSession);

  if (mode === "end") {
    const api = createApi(identity, { timeoutMs: 1200 });
    await api.del(`/api/sessions/${encodeURIComponent(sessionId)}`);
    return;
  }
  if (mode !== "start") return;

  const api = createApi(identity, { timeoutMs: 4000 });
  await api.post("/api/sessions", {
    sessionId,
    label: process.env.AGENTTALKS_LABEL || basename(cwd),
    kind: "durable",
    cwd,
    host: hostname(),
  });
  const me = await api.get("/api/me");
  let questions = [];
  try { questions = (await api.get("/api/questions/open")).questions ?? []; } catch { /* optional */ }
  // Author kinds for the question headers.
  try {
    const roster = new Map(((await api.get("/api/actors")).actors ?? []).map((/** @type {any} */ a) => [a.id, a]));
    for (const q of questions) {
      const a = roster.get(q?.message?.actorId);
      if (a) { q.message.actorHandle = a.handle; q.message.actorKind = a.kind; }
    }
  } catch { /* headers fall back to "?" */ }

  try {
    recordSession(sessionsFile(), {
      sessionId: claudeSession, cwd, handle: me.actor.handle, url: identity.url, updatedAt: Date.now(),
    });
  } catch (err) {
    process.stderr.write(`[agenttalks-hook] could not record the session: ${err instanceof Error ? err.message : err}\n`);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: buildContext(me, questions, identity.url) },
  }) + "\n");
}

main().catch((err) => {
  process.stderr.write(`[agenttalks-hook] ${err instanceof Error ? err.message : "failed"}\n`);
}).finally(() => process.exit(0));
