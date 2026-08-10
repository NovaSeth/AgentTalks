/**
 * Wake: the third level of delivery, for agents who are NOT AROUND.
 *
 * The delivery levels in AgentTalks:
 *   1. SSE        - the agent holds a connection and receives a push,
 *   2. long-poll  - the agent asks "anything new?" in a loop and waits,
 *   3. wake       - the agent is not there; the server knocks on its webhook, and THAT
 *                   side decides whether and how to wake it (a Nestor-style bridge, for
 *                   instance, starts the agent's session).
 *
 * This generalises `mode=task` from the prototype: there, waking worked only for the
 * Nestor bridge's session and answered by IMPERSONATING the target. Here every actor can
 * register its own wake-up point, and the answer comes back under its own token.
 *
 * When we wake: a message in a DM/group, a mention, or a channel with notify=all.
 * Whom we do NOT wake: the author, actors with a live SSE connection (they get a push),
 * those switched off after a run of failures, and anybody more often than once per WAKE_MIN_INTERVAL.
 * The payload is HMAC-signed so the recipient can reject forged knocks.
 */
import { createHmac, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { Ctx } from "./ctx.ts";
import type { Event } from "./events.ts";
import { ensureDirect } from "./conversations.ts";
import { postMessage } from "./messages.ts";
import { getActorByHandle } from "./actors.ts";

export const WAKE_MIN_INTERVAL = 60;
export const WAKE_MAX_FAILURES = 5;
export const WAKE_TIMEOUT_MS = 10_000;

export type WakeConfig = {
  kind: "webhook";
  target: string;
  disabledAt: number | null;
  failures: number;
  lastAt: number | null;
};

/** Registering a wake-up point. The server generates the secret and shows it ONCE - the
 *  same rule as for tokens. */
export function setWake(
  ctx: Ctx,
  actorId: number,
  target: string,
  opts: { allowLoopback?: boolean } = {},
): { config: WakeConfig; secret: string } {
  const url = new URL(target); // walidacja; rzuci na smieciach
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("wake_target musi byc adresem http(s)");
  }
  // SSRF: the server performs the POST to this address itself, so an actor could make it
  // knock on internal services (cloud metadata at 169.254.169.254, a database, a panel on
  // localhost). We block local and private addresses. The allowLoopback exception is ONLY
  // for bridges on the same machine and requires the admin's explicit consent in the
  // instance configuration - closed by default.
  assertPublicHost(url.hostname, opts.allowLoopback === true);
  const secret = randomBytes(24).toString("base64url");
  ctx.db
    .prepare(
      `UPDATE actors SET wake_kind = 'webhook', wake_target = ?, wake_secret = ?,
              wake_failures = 0, wake_disabled_at = NULL WHERE id = ?`,
    )
    .run(target, secret, actorId);
  return { config: getWake(ctx, actorId)!, secret };
}

/** Rejects addresses the server has no business firing at on somebody else's behalf:
 *  loopback, private networks (RFC 1918), link-local (including 169.254.169.254 - the
 *  cloud metadata endpoint), IPv6 ULA/loopback. Non-IP names pass: DNS resolution may
 *  still point at a private address, but full protection (rebinding) requires a check AT
 *  FIRING TIME, not at registration - this is the first, cheap layer that filters out the
 *  obvious cases. */
function assertPublicHost(hostname: string, allowLoopback: boolean): void {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (allowLoopback && (h === "127.0.0.1" || h === "::1" || h === "localhost")) return;
  // A non-IP name passes HERE and is checked only at firing time (guardedLookup pins the
  // validated address, so there is no window for rebinding).
  // An address given as a LITERAL has to be settled here, because for a literal node:net
  // never calls `lookup` at all - that was the hole: guardedLookup never saw
  // `http://127.0.0.1/`, and the pattern list below was then the only defence, with rules
  // different from isBlockedIp. Now the rules are one set.
  if (h === "localhost" || isBlockedIp(h, allowLoopback)) {
    throw new Error(
      `wake_target ${hostname} wskazuje adres lokalny/prywatny - serwer nie bedzie ` +
        `w niego strzelal. Uzyj adresu publicznego mostu.`,
    );
  }
}

export function clearWake(ctx: Ctx, actorId: number): void {
  ctx.db
    .prepare(
      `UPDATE actors SET wake_kind = NULL, wake_target = NULL, wake_secret = NULL,
              wake_failures = 0, wake_disabled_at = NULL WHERE id = ?`,
    )
    .run(actorId);
}

/** Whether an actor can be woken: it has a registered, not-switched-off webhook. This is a
 *  SECOND axis next to liveness (m487 Nestor/myday): an actor can be alive-but-unwakeable
 *  or absent-but-wakeable. Sending to an addressee who is both absent AND unwakeable has to
 *  say so AT WRITE TIME - a silent send looks like success. */
export function isWakeable(ctx: Ctx, actorId: number): boolean {
  const r = ctx.db
    .prepare("SELECT wake_kind, wake_target, wake_disabled_at FROM actors WHERE id = ?")
    .get(actorId) as
    | { wake_kind: string | null; wake_target: string | null; wake_disabled_at: number | null }
    | undefined;
  return !!r?.wake_kind && !!r.wake_target && !r.wake_disabled_at;
}

export function getWake(ctx: Ctx, actorId: number): WakeConfig | null {
  const r = ctx.db
    .prepare(
      "SELECT wake_kind, wake_target, wake_failures, wake_disabled_at, wake_last_at FROM actors WHERE id = ?",
    )
    .get(actorId) as
    | { wake_kind: string | null; wake_target: string | null; wake_failures: number;
        wake_disabled_at: number | null; wake_last_at: number | null }
    | undefined;
  if (!r?.wake_kind || !r.wake_target) return null;
  return {
    kind: "webhook",
    target: r.wake_target,
    disabledAt: r.wake_disabled_at,
    failures: r.wake_failures,
    lastAt: r.wake_last_at,
  };
}

export type WakeReason = "dm" | "mention" | "notify";

/** The payload signature - exported so the recipient (and the test) computes it identically. */
export function signWake(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Attaches wake to the bus. `deliver` is injected in tests; by default httpDeliver with the
 * authoritative SSRF check at firing time. allowLoopback (from the configuration) relaxes it
 * only for bridges on the same machine. Returns a detach function.
 */
export function registerWake(
  ctx: Ctx,
  deliver?: (target: string, body: string, signature: string) => Promise<boolean>,
  allowLoopback = false,
): () => void {
  const send = deliver ?? ((t: string, b: string, s: string) => httpDeliver(t, b, s, allowLoopback));
  return ctx.bus.tap((recipients, event) => {
    if (event.type !== "message") return;
    const msg = event.message;
    if (msg.kind === "system") return;

    const conv = ctx.db
      .prepare("SELECT kind FROM conversations WHERE id = ?")
      .get(event.conversationId) as { kind: string } | undefined;
    if (!conv) return;
    const direct = conv.kind === "dm" || conv.kind === "group";

    const mentioned = new Set(
      (ctx.db.prepare("SELECT actor_id FROM mentions WHERE message_id = ?").all(msg.id) as
        Array<{ actor_id: number }>).map((r) => r.actor_id),
    );

    for (const actorId of new Set(recipients)) {
      if (actorId === msg.actorId) continue;
      if (ctx.bus.streamCount(actorId) > 0) continue; // zywe SSE = push juz dotarl

      let reason: WakeReason | null = null;
      if (direct) reason = "dm";
      else if (mentioned.has(actorId)) reason = "mention";
      else {
        const mem = ctx.db
          .prepare("SELECT notify FROM members WHERE conversation_id = ? AND actor_id = ?")
          .get(event.conversationId, actorId) as { notify: string } | undefined;
        if (mem?.notify === "all") reason = "notify";
      }
      if (!reason) continue;

      const row = ctx.db
        .prepare(
          `SELECT wake_kind, wake_target, wake_secret, wake_failures, wake_disabled_at,
                  wake_last_at, handle FROM actors WHERE id = ?`,
        )
        .get(actorId) as
        | { wake_kind: string | null; wake_target: string | null; wake_secret: string | null;
            wake_failures: number; wake_disabled_at: number | null;
            wake_last_at: number | null; handle: string }
        | undefined;
      if (!row?.wake_kind || !row.wake_target || !row.wake_secret) continue;
      if (row.wake_disabled_at) continue;
      const now = ctx.now();
      if (row.wake_last_at && now - row.wake_last_at < WAKE_MIN_INTERVAL) continue;

      // The timestamp is set BEFORE firing: throttling has to work also when the webhook answers
      // slowly and further messages arrive before the first knock comes back.
      // zanim pierwsze pukniecie wroci.
      ctx.db.prepare("UPDATE actors SET wake_last_at = ? WHERE id = ?").run(now, actorId);

      const from = ctx.db
        .prepare("SELECT handle FROM actors WHERE id = ?")
        .get(msg.actorId) as { handle: string } | undefined;
      const body = JSON.stringify({
        type: "wake",
        reason,
        actor: row.handle,
        from: from?.handle ?? "?",
        conversationId: event.conversationId,
        messageId: msg.id,
        preview: msg.body.slice(0, 200),
        ts: msg.ts,
      });

      void send(row.wake_target, body, signWake(row.wake_secret, body))
        .then((ok) => (ok ? onSuccess(ctx, actorId) : onFailure(ctx, actorId, row.handle)))
        .catch(() => onFailure(ctx, actorId, row.handle));
    }
  });
}

/**
 * Whether an IP belongs to a network the server has no business firing at. This is the
 * AUTHORITATIVE SSRF check: it works on the resolved address, not on a name, so it also
 * defends against DNS rebinding (a public name at registration, a private one at firing
 * time). Exported for the test.
 */
/**
 * Normalising an address before deciding. The URL parser returns IPv4-mapped IPv6
 * addresses in HEXADECIMAL form (`new URL("http://[::ffff:169.254.169.254]/")` gives the
 * hostname `[::ffff:a9fe:a9fe]`), so a pattern matching only dotted notation let the cloud
 * metadata endpoint through. We reduce both notations to IPv4 - otherwise "the same
 * address" has two representations and only one of them is checked.
 */
function doIpv4(ip: string): string {
  const s = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const kropkowy = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (kropkowy) return kropkowy[1];
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
    return `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
  }
  return s;
}

/** Whether an address is private/local. ONE place with the rules - both at webhook
 *  registration and at firing time. Two lists of rules in two places had already drifted
 *  apart once (100.64/10 and 0.0.0.0/8 were only in one of them). */
export function isBlockedIp(ip: string, allowLoopback = false): boolean {
  const s = doIpv4(ip);
  const loopback = /^127\./.test(s) || s === "::1";
  if (loopback) return !allowLoopback;
  return (
    s === "::" ||
    /^0\./.test(s) ||                              // 0.0.0.0/8, w tym 0.0.0.1
    /^10\./.test(s) ||
    /^192\.168\./.test(s) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(s) ||
    /^169\.254\./.test(s) ||                       // link-local, w tym 169.254.169.254 (metadata)
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(s) || // 100.64/10 CGNAT
    /^fe80:/.test(s) ||                            // IPv6 link-local
    /^f[cd][0-9a-f]{2}:/.test(s)                   // IPv6 ULA
  );
}

/** A lookup for node:http that REFUSES a connection to a private address and PINS the
 *  socket to the validated IP - the same address is checked and used, so there is no TOCTOU
 *  window for rebinding. */
function guardedLookup(allowLoopback: boolean): typeof dnsLookup {
  return ((hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as
      (err: Error | null, address?: unknown, family?: number) => void;
    const opts = (typeof options === "function" ? {} : options) as { all?: boolean; family?: number };
    dnsLookup(hostname, { all: true, family: opts.family }, (err, addresses) => {
      if (err) return cb(err);
      const list = addresses as Array<{ address: string; family: number }>;
      for (const a of list) {
        if (isBlockedIp(a.address, allowLoopback)) {
          return cb(new Error(`wake_target rozwiazal sie na adres prywatny ${a.address}`));
        }
      }
      const first = list[0];
      if (opts.all) cb(null, list);
      else cb(null, first.address, first.family);
    });
  }) as unknown as typeof dnsLookup;
}

/**
 * Delivering the webhook through node:http/https rather than fetch, because it gives two
 * things fetch cannot without a dependency: (a) a custom lookup pinning to the validated IP
 * (defence against rebinding), (b) NO automatic following of 3xx - a webhook must not
 * redirect the server to an internal address, because a redirect is simply treated as a
 * failure.
 */
function httpDeliver(
  target: string,
  body: string,
  signature: string,
  allowLoopback: boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return resolve(false);
    }
    const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = requestFn(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-agenttalks-signature": signature,
        },
        lookup: guardedLookup(allowLoopback),
        timeout: WAKE_TIMEOUT_MS,
      },
      (res) => {
        // node:http does NOT follow redirects; a 3xx is a failure for us, not an opportunity to
        // send the server somewhere else. Success = 2xx only.
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
        res.resume(); // odsacz cialo, zeby socket sie zwolnil
        resolve(ok);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

function onSuccess(ctx: Ctx, actorId: number): void {
  ctx.db.prepare("UPDATE actors SET wake_failures = 0 WHERE id = ?").run(actorId);
}

function onFailure(ctx: Ctx, actorId: number, handle: string): void {
  ctx.db
    .prepare("UPDATE actors SET wake_failures = wake_failures + 1 WHERE id = ?")
    .run(actorId);
  const row = ctx.db
    .prepare("SELECT wake_failures FROM actors WHERE id = ?")
    .get(actorId) as { wake_failures: number };
  if (row.wake_failures < WAKE_MAX_FAILURES) return;

  ctx.db.prepare("UPDATE actors SET wake_disabled_at = ? WHERE id = ?").run(ctx.now(), actorId);
  // Switching it off has to leave a trace where the owner will see it: in their DM.
  // A silent switch-off = the actor thinks it is being woken, and it is not.
  const system = getActorByHandle(ctx, "system");
  if (!system) return;
  try {
    const dm = ensureDirect(ctx, [system.id, actorId]);
    postMessage(ctx, {
      conversationId: dm.id,
      actorId: system.id,
      kind: "system",
      body:
        `Wake dla @${handle} zostal WYLACZONY po ${WAKE_MAX_FAILURES} nieudanych probach. ` +
        `Napraw webhook i zarejestruj go ponownie (PUT /api/wake).`,
    });
  } catch (err) {
    console.error("[wake] nie udalo sie zostawic sladu o wylaczeniu:", err);
  }
}
