// @ts-check
/**
 * The presence heartbeat. The SessionStart hook registers presence once; the server counts a
 * session online for 15 minutes after its last contact (src/core/presence.ts ONLINE_WINDOW),
 * so a long listening session went offline while its monitor or channel was still delivering.
 *
 * The delivering process (the monitor in run mode; the channel when it delivers) re-posts the
 * same registration body every HEARTBEAT_MS, only while the Claude Code process it belongs to
 * is alive: the upsert clears `ended_at`, so a beat after SessionEnd would revive a finished
 * session. A failed beat never throws and never stops delivery; it logs once per failure kind.
 */
import { hostname } from "node:os";
import { basename } from "node:path";

/** Well below the 15 minute window, so one lost beat does not show the agent offline. */
export const HEARTBEAT_MS = 240_000;

/** AGENTTALKS_HEARTBEAT_MS is a test-only knob. @param {Record<string, string | undefined>} [env] */
export function heartbeatMs(env = process.env) {
  const n = Number(env.AGENTTALKS_HEARTBEAT_MS);
  return Number.isFinite(n) && n > 0 ? n : HEARTBEAT_MS;
}

/** The POST /api/sessions body: the hook, the monitor and the channel all send this one.
 *  @param {{ sessionId: string, cwd: string, env?: Record<string, string | undefined> }} p */
export function presenceBody({ sessionId, cwd, env = process.env }) {
  return {
    sessionId,
    label: env.AGENTTALKS_LABEL || basename(cwd),
    kind: "durable",
    cwd,
    host: hostname(),
  };
}

/** Whether a process lives (signal 0 checks, sends nothing). @param {number} pid */
export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return /** @type {any} */ (err)?.code === "EPERM"; }
}

/**
 * @param {{ api: { post(path: string, body?: unknown): Promise<any> }, sessionId: string, body: object,
 *   intervalMs: number, alive: () => boolean, log?: (line: string) => void }} opts
 * @returns {{ stop(): void }}
 */
export function startHeartbeat({ api, sessionId, body, intervalMs, alive, log = () => {} }) {
  /** @type {Set<string>} */
  const reported = new Set();
  let busy = false;
  const timer = setInterval(async () => {
    // A slow server must not stack requests; a gone ancestor must not be revived.
    if (busy || !alive()) return;
    busy = true;
    try {
      await api.post("/api/sessions", body);
      if (reported.size) { reported.clear(); log("presence heartbeat recovered"); }
    } catch (err) {
      const status = Number(/** @type {any} */ (err)?.status);
      const kind = status ? `HTTP ${status}` : "network error";
      if (!reported.has(kind)) {
        reported.add(kind);
        log(`presence heartbeat failed (${kind}) for session ${sessionId}; delivery continues`);
      }
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
