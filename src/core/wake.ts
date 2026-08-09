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
  // Nazwa nie-IP przechodzi TUTAJ i jest sprawdzana dopiero przy strzale
  // (guardedLookup pina zwalidowany adres, wiec nie ma okna na rebinding).
  // Adres podany LITERALEM musi zostac rozstrzygniety tu, bo dla literalu
  // node:net w ogole nie wola `lookup` - to byla ta dziura: guardedLookup nigdy
  // nie widzial `http://127.0.0.1/`, a lista wzorcow ponizej byla wtedy jedyna
  // obrona i miala inne reguly niz isBlockedIp. Teraz reguly sa jedne.
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

/** Czy aktor da sie obudzic: ma zarejestrowany, niewylaczony webhook. To DRUGA os
 *  obok zywotnosci (m487 Nestor/myday): aktor moze byc zywy-ale-nieobudzalny albo
 *  nieobecny-ale-obudzalny. Wysylka do nieobecnego I nieobudzalnego adresata musi
 *  to powiedziec PRZY ZAPISIE - cicha wysylka wyglada jak sukces. */
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

/** Podpis ladunku - eksportowany, zeby odbiorca (i test) liczyl go identycznie. */
export function signWake(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Podpina wake do szyny. deliver jest wstrzykiwane w testach; domyslnie httpDeliver
 * z autorytatywna kontrola SSRF przy strzale. allowLoopback (z konfiguracji) luzuje
 * ja tylko dla mostow na tej samej maszynie. Zwraca funkcje odpinajaca.
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

      void send(row.wake_target, body, signWake(row.wake_secret, body))
        .then((ok) => (ok ? onSuccess(ctx, actorId) : onFailure(ctx, actorId, row.handle)))
        .catch(() => onFailure(ctx, actorId, row.handle));
    }
  });
}

/**
 * Czy IP nalezy do sieci, w ktora serwer nie ma prawa strzelac. To jest
 * AUTORYTATYWNA kontrola SSRF: dziala na rozwiazanym adresie, nie na nazwie,
 * wiec broni takze przed DNS rebinding (nazwa publiczna przy rejestracji,
 * prywatna przy strzale). Eksportowane do testu.
 */
/**
 * Normalizacja adresu przed decyzja. Parser URL zwraca adresy IPv4-mapped IPv6
 * w postaci SZESNASTKOWEJ (`new URL("http://[::ffff:169.254.169.254]/")` daje
 * hostname `[::ffff:a9fe:a9fe]`), wiec wzorzec dopasowujacy tylko zapis kropkowy
 * przepuszczal endpoint metadanych chmury. Sprowadzamy oba zapisy do IPv4 -
 * inaczej "ten sam adres" ma dwie reprezentacje i tylko jedna jest sprawdzana.
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

/** Czy adres jest prywatny/lokalny. JEDNO miejsce z regulami - i przy rejestracji
 *  webhooka, i przy strzale. Dwie listy regul w dwoch miejscach juz raz sie
 *  rozjechaly (100.64/10 i 0.0.0.0/8 byly tylko w jednej z nich). */
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

/** lookup dla node:http, ktory ODMAWIA polaczenia na adres prywatny i PINUJE
 *  socket do zwalidowanego IP - ten sam adres jest sprawdzony i uzyty, wiec
 *  nie ma okna TOCTOU na rebinding. */
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
 * Dostarczenie webhooka przez node:http/https zamiast fetch, bo daje dwie rzeczy,
 * ktorych fetch nie da bez zaleznosci: (a) wlasny lookup pinujacy do zwalidowanego
 * IP (obrona przed rebinding), (b) BRAK automatycznego podazania za 3xx - webhook
 * nie moze przekierowac serwera na adres wewnetrzny, bo przekierowanie jest po
 * prostu traktowane jak porazka.
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
        // node:http NIE podaza za redirectami; 3xx to dla nas porazka, nie okazja
        // do skierowania serwera gdzie indziej. Sukces = tylko 2xx.
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
