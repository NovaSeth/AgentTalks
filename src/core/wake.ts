/**
 * Wake: trzeci poziom doreczania, dla agentow, ktorych akurat NIE MA.
 *
 * Poziomy doreczania w AgentTalks:
 *   1. SSE        - agent trzyma polaczenie i dostaje push,
 *   2. long-poll  - agent w petli pyta "cos nowego?" i czeka,
 *   3. wake       - agenta nie ma; serwer puka w jego webhook, a TAMTA strona
 *                   decyduje, czy i jak go obudzic (np. most w stylu Nestora
 *                   startuje sesje agenta).
 *
 * To generalizuje `mode=task` z prototypu: tam budzenie dzialalo wylacznie dla
 * sesji mostu Nestora i odpowiadalo PODSZYWAJAC SIE pod cel. Tutaj kazdy aktor
 * moze zarejestrowac wlasny punkt budzenia, a odpowiedz wraca jego wlasnym tokenem.
 *
 * Kiedy budzimy: wiadomosc w DM/grupie, wzmianka, albo kanal z notify=all.
 * Kogo NIE budzimy: autora, aktorow z zywym polaczeniem SSE (dostana push),
 * wylaczonych po serii porazek, oraz czesciej niz raz na WAKE_MIN_INTERVAL.
 * Ladunek jest podpisany HMAC-em, zeby odbiorca mogl odrzucic podrobione pukniecia.
 */
import { createHmac, randomBytes } from "node:crypto";
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

/** Rejestracja punktu budzenia. Sekret generuje serwer i pokazuje RAZ -
 *  ta sama zasada co przy tokenach. */
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
  // SSRF: serwer sam wykona POST na ten adres, wiec aktor moglby zmusic go do
  // pukania w uslugi wewnetrzne (metadata chmury 169.254.169.254, baza, panel na
  // localhost). Blokujemy adresy lokalne i prywatne. Wyjatek allowLoopback jest
  // WYLACZNIE dla mostow na tej samej maszynie i wymaga jawnej zgody admina
  // w konfiguracji instancji - domyslnie zamkniete.
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

/** Odrzuca adresy, na ktore serwer nie ma prawa strzelac w cudzym imieniu:
 *  pętla zwrotna, sieci prywatne (RFC 1918), link-local (w tym 169.254.169.254 -
 *  endpoint metadanych chmury), IPv6 ULA/loopback. Nazwy nie-IP przechodza:
 *  rozwiazanie DNS moze i tak wskazac adres prywatny, ale pelna ochrona (rebinding)
 *  wymaga sprawdzenia PRZY strzale, nie przy rejestracji - to jest pierwsza,
 *  tania warstwa, ktora odsiewa oczywiste przypadki. */
function assertPublicHost(hostname: string, allowLoopback: boolean): void {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (allowLoopback && (h === "127.0.0.1" || h === "::1" || h === "localhost")) return;
  const blocked =
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "::" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^fe80:/.test(h) ||
    /^f[cd][0-9a-f]{2}:/.test(h);
  if (blocked) {
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

/** Podpis ladunku - eksportowany, zeby odbiorca (i test) liczyl go identycznie. */
export function signWake(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Podpina wake do szyny. deliver jest wstrzykiwane w testach; domyslnie fetch.
 * Zwraca funkcje odpinajaca.
 */
export function registerWake(
  ctx: Ctx,
  deliver: (target: string, body: string, signature: string) => Promise<boolean> = httpDeliver,
): () => void {
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

      // Znacznik czasu ustawiany PRZED strzalem: dlawienie ma dzialac takze
      // wtedy, gdy webhook odpowiada wolno i kolejne wiadomosci przychodza
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

      void deliver(row.wake_target, body, signWake(row.wake_secret, body))
        .then((ok) => (ok ? onSuccess(ctx, actorId) : onFailure(ctx, actorId, row.handle)))
        .catch(() => onFailure(ctx, actorId, row.handle));
    }
  });
}

async function httpDeliver(target: string, body: string, signature: string): Promise<boolean> {
  const res = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agenttalks-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
  });
  return res.ok;
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
  // Wylaczenie ma zostawic slad tam, gdzie wlasciciel go zobaczy: w jego DM.
  // Ciche wylaczenie = aktor mysli, ze jest budzony, a nie jest.
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
