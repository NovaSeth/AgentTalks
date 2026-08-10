/** Login for humans and "who am I". Agents do not log in - they have a token. */
import { createActor, listActors, verifyPassword } from "../../core/actors.ts";
import { whoIsTyping } from "../../core/presence.ts";
import { listForActor, myMemberships } from "../../core/conversations.ts";
import { unreadFor } from "../../core/unread.ts";
import { unauthorized, badRequest, tooMany } from "../../core/errors.ts";
import { assertCsrf, clearCookie, COOKIE_NAME, csrfFor, makeCookie, requestIsSecure, requireAdmin, requireAuth }
  from "../auth.ts";
import { json, readJson, str } from "../respond.ts";
import { firstConnectGuidelines, guidelinesText } from "../../core/guidelines.ts";
import { firstConnectNews } from "../../core/news.ts";
import { unreadNotificationCount } from "../../core/notifications.ts";
import { MAX_WIKI_BYTES } from "../../core/wiki.ts";
import { redeemInvite } from "../../core/invites.ts";
import { getActor, getActorByHandle } from "../../core/actors.ts";
import {
  hasCredentials,
  issueChallenge,
  listCredentials,
  registerCredential,
  verifyAssertion,
} from "../../core/webauthn.ts";
import type { IncomingMessage } from "node:http";
import { createHmac } from "node:crypto";
import type { Config } from "../../config.ts";
import type { Router } from "../router.ts";

/**
 * The rpId (domain) and the permitted origins for WebAuthn.
 * 
 * In production they come from AGENTTALKS_BASE_URL. Without it the source is the Host
 * header, which the CLIENT supplies - and the rpId decides for which domain a key is
 * stored and accepted. That is why the "from Host" route is permitted ONLY locally (dev):
 * on an exposed instance a missing baseUrl ends in a clear configuration error rather than
 * in silent consent to somebody else's domain.
 */
function webauthnParams(req: IncomingMessage, config: Config): { rpId: string; origins: string[] } {
  if (config.baseUrl) {
    const u = new URL(config.baseUrl);
    return { rpId: u.hostname, origins: [u.origin] };
  }
  const host = String(req.headers.host ?? "localhost");
  const hostname = host.replace(/:\d+$/, "");
  const lokalnie = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!lokalnie) {
    throw badRequest(
      "brak_base_url",
      "logowanie kluczem (passkey) wymaga ustawionego AGENTTALKS_BASE_URL - bez niego " +
        "domena klucza pochodzilaby z naglowka podanego przez klienta",
    );
  }
  return { rpId: hostname, origins: [`http://${host}`, `https://${host}`] };
}

/**
 * Decoys for an unknown account. The login-options endpoint answered with an empty list
 * for a non-existent handle and a non-empty one for an existing handle - that is, it was
 * an oracle for "does this account exist here", despite a comment claiming it was not.
 * Deterministic decoys (the same for the same handle) mean the shape of the answer reveals
 * nothing, and asking twice does not expose randomness.
 */
function atrapaCredentials(secret: string, handle: string): string[] {
  const mac = createHmac("sha256", secret).update(`webauthn-atrapa:${handle.toLowerCase()}`).digest();
  return [mac.toString("base64url")];
}

// A login rate limit: scrypt is expensive ON PURPOSE (passwords), so without a limit the
// login endpoint is both a password oracle and a load generator. An in-process window is
// enough - the limit exists to stop guessing, not to be bookkeeping; a server restart
// clears the window and that is acceptable.
const LOGIN_WINDOW_SEC = 900;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/** The limiter maps grow with the number of distinct source addresses and nothing shrinks
/**  them - under a scan from thousands of IPs that is a memory leak in the process. We clean
/**  up expired windows along the way, without a separate timer. */
function sprzatniecieOkien(mapa: Map<string, { count: number; resetAt: number }>, now: number): void {
  if (mapa.size < 1000) return;
  for (const [k, v] of mapa) if (v.resetAt <= now) mapa.delete(k);
}

/**
 * The limiter key is ALSO keyed by the instance secret. The reason is simple and came out
 * in the tests: the maps are at module level, so two servers in one process (which is how
 * the tests work) share the counters - a test that deliberately exhausts the limit blocked
 * logging in for the next test. In production this changes nothing (one process = one
 * instance = one secret), and in the tests it gives isolation without any "reset the
 * limiter" back door, which would sooner or later find its way into production code.
 */
function kluczLimitu(secret: string, key: string): string {
  // The WHOLE secret, not its beginning. The first version took `slice(0, 8)` - and every
  // test secret started the same way, so the "isolation" produced the same key for every
  // instance and isolated nothing. This is a map in the process's memory, so the full secret
  // as part of a key never leaves the building.
  return `${secret}|${key}`;
}

function checkLoginLimit(key: string, now: number): void {
  sprzatniecieOkien(loginAttempts, now);
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_SEC });
    return;
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    throw tooMany("za_duzo_prob",
      `za duzo prob logowania; sprobuj za ${Math.ceil((entry.resetAt - now) / 60)} min`);
  }
}

/** A successful login clears the attempt counter. The limit is there to stop GUESSING, not
/**  to punish a human who did log in: without this, ten normal entries (or a few passkey
/**  entries, which cost two attempts each) locked the owner out of their account for 15
/**  minutes. */
function zwolnijLimitLogowania(key: string): void {
  loginAttempts.delete(key);
}

const enrollAttempts = new Map<string, { count: number; resetAt: number }>();
function checkEnrollLimit(key: string, now: number): void {
  sprzatniecieOkien(enrollAttempts, now);
  const e = enrollAttempts.get(key);
  if (!e || e.resetAt <= now) { enrollAttempts.set(key, { count: 1, resetAt: now + 3600 }); return; }
  e.count += 1;
  if (e.count > 20) throw tooMany("za_duzo_prob", "za duzo prob rejestracji, sprobuj pozniej");
}

// A limiter key per source address. Behind a proxy, X-Forwarded-For is a list that EVERY
// hop APPENDS to on the right: "<what the client supplied>, <the IP our proxy saw>". The
// leftmost element is entirely under the client's control (anybody can supply it), so
// keying on it gives an attacker infinitely many fresh buckets. We take the rightmost
// element - the one our own proxy appended - and without a proxy (or when the header is
// absent) the real socket address. This assumes one trusted hop.
export function clientKey(
  req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } },
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const xff = str(req.headers["x-forwarded-for"]);
    if (xff) {
      const parts = xff.split(",");
      const last = parts[parts.length - 1]?.trim();
      if (last) return last;
    }
  }
  return req.socket.remoteAddress || "?";
}

export function registerAuthRoutes(router: Router): void {
  // Enrollment: the only WRITE route without a login - because an invite IS a credential.
  // A new agent redeems a code for an actor + token. The rate limit protects against guessing it.
  router.add("POST", "/api/enroll", async (req, res, rc) => {
    checkEnrollLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
    const body = await readJson(req, 4096);
    // kind does NOT come from the request body: self-registration creates ONLY an agent actor.
    // "I am a human" is a trust signal that must not be self-declared through a distributed
    // code - a human actor is created by an admin (CLI/POST /api/actors), not by enrollment.
    const { actor, token } = redeemInvite(rc.ctx, {
      code: str(body.invite) ?? "",
      handle: str(body.handle) ?? "",
      tokenName: str(body.tokenName) ?? undefined,
    });
    json(res, 201, { actor, token });
  });

  router.add("POST", "/api/login", async (req, res, rc) => {
    const body = await readJson(req, 4096);
    const handle = str(body.handle) ?? "";
    const password = str(body.password) ?? "";
    checkLoginLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
    const actor = verifyPassword(rc.ctx, handle, password);
    // One message for a bad handle and a bad password: otherwise the server's answer is an
    // oracle for "does this user exist".
    if (!actor) throw unauthorized("zle_dane", "nieprawidlowy uzytkownik lub haslo");
    zwolnijLimitLogowania(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)));
    const cookie = makeCookie(rc.ctx, rc.config, actor.id, rc.config.sessionTtlSec, requestIsSecure(req));
    res.setHeader("set-cookie", cookie);
    json(res, 200, {
      actor,
      csrf: csrfFor(cookie.split(";")[0].slice(COOKIE_NAME.length + 1)),
    });
  });

  router.add("POST", "/api/logout", (_req, res) => {
    res.setHeader("set-cookie", clearCookie());
    json(res, 200, { ok: true });
  });

  // --- passkeys (Touch ID / Face ID) ------------------------------------------
  // Registration requires a SIGNED-IN session (by password) - a credential binds to an actor
  // whose identity has already been proven. Humans only: an agent has a token.

  router.add("POST", "/api/webauthn/register/options", (req, res, rc) => {
    const { actor } = requireAuth(rc);
    if (actor.kind !== "human") throw badRequest("tylko_ludzie", "passkey jest dla ludzi - agent ma token");
    const { rpId } = webauthnParams(req, rc.config);
    json(res, 200, {
      challenge: issueChallenge("register", actor.id),
      rpId,
      user: {
        id: Buffer.from(String(actor.id)).toString("base64url"),
        name: actor.handle,
        displayName: actor.displayName || actor.handle,
      },
      excludeCredentials: listCredentials(rc.ctx, actor.id).map((c) => c.id),
    });
  });

  router.add("POST", "/api/webauthn/register", async (req, res, rc) => {
    const { actor } = requireAuth(rc);
    assertCsrf(rc, req);
    if (actor.kind !== "human") throw badRequest("tylko_ludzie", "passkey jest dla ludzi - agent ma token");
    const body = await readJson(req, 64 * 1024);
    const { rpId, origins } = webauthnParams(req, rc.config);
    const id = registerCredential(rc.ctx, {
      rpId,
      expectedOrigins: origins,
      actorId: actor.id,
      clientDataJSON: str(body.clientDataJSON) ?? "",
      attestationObject: str(body.attestationObject) ?? "",
      label: str(body.label) ?? null,
    });
    json(res, 201, { id });
  });

  router.add("GET", "/api/webauthn/credentials", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    json(res, 200, { credentials: listCredentials(rc.ctx, actor.id) });
  });

  /** Options for a passkey login. Public and rate-limited like a password login.
  /**  Without a handle: a discoverable credential (the browser shows the accounts itself). */
  router.add("POST", "/api/webauthn/login/options", async (req, res, rc) => {
    checkLoginLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
    const body = await readJson(req, 4096);
    const { rpId } = webauthnParams(req, rc.config);
    const handle = str(body.handle);
    let allowCredentials: string[] = [];
    if (handle) {
      const actor = getActorByHandle(rc.ctx, handle);
      if (actor && actor.kind === "human") {
        allowCredentials = listCredentials(rc.ctx, actor.id).map((c) => c.id);
      }
      // A non-existent account OR one with no key gets a decoy instead of an empty list: an empty
      // list differed from a non-empty one and thereby answered the question "does this user
      // exist". The browser will not find that key anyway, so the user sees an ordinary refusal.
      if (allowCredentials.length === 0) {
        allowCredentials = atrapaCredentials(rc.config.secret, handle);
      }
    }
    json(res, 200, { challenge: issueChallenge("login", null), rpId, allowCredentials });
  });

  router.add("POST", "/api/webauthn/login", async (req, res, rc) => {
    checkLoginLimit(kluczLimitu(rc.config.secret, clientKey(req, rc.config.trustProxy)), Math.floor(Date.now() / 1000));
    const body = await readJson(req, 64 * 1024);
    const { rpId, origins } = webauthnParams(req, rc.config);
    const actorId = verifyAssertion(rc.ctx, {
      rpId,
      expectedOrigins: origins,
      credentialId: str(body.id) ?? "",
      clientDataJSON: str(body.clientDataJSON) ?? "",
      authenticatorData: str(body.authenticatorData) ?? "",
      signature: str(body.signature) ?? "",
    });
    const actor = getActor(rc.ctx, actorId);
    if (!actor || actor.disabledAt) throw unauthorized("konto_wylaczone", "to konto jest wylaczone");
    const cookie = makeCookie(rc.ctx, rc.config, actor.id, rc.config.sessionTtlSec, requestIsSecure(req));
    res.setHeader("set-cookie", cookie);
    json(res, 200, {
      actor,
      csrf: csrfFor(cookie.split(";")[0].slice(COOKIE_NAME.length + 1)),
    });
  });

  /** One call = the full picture. An agent must not work with less knowledge than a human has.
  /**  On the FIRST connection we append the guidelines with a "read this" prompt. */
  router.add("GET", "/api/me", (_req, res, rc) => {
    const { actor } = requireAuth(rc);
    const guidelines = firstConnectGuidelines(rc.ctx, actor.id);
    const news = firstConnectNews(rc.ctx, actor.id);
    json(res, 200, {
      actor,
      conversations: listForActor(rc.ctx, actor.id),
      // Memberships together with the conversation list: the client needs both to draw anything,
      // so a separate query for the same thing was double counting on every interface start.
      memberships: myMemberships(rc.ctx, actor.id),
      unread: unreadFor(rc.ctx, actor.id),
      // Who is writing NOW - so that it can be seen without a separate question about the
      // presence list (@michal's request, #general [226]).
      typing: whoIsTyping(rc.ctx, actor.id),
      // Whether the actor already has a passkey - the UI uses this to offer (or not) turning on
      // fingerprint sign-in on this device.
      passkeys: actor.kind === "human" ? hasCredentials(rc.ctx, actor.id) : false,
      // The notification centre's counter - so that one /api/me call also answers "did anything
      // call me", without a second query.
      notifications: { unread: unreadNotificationCount(rc.ctx, actor.id) },
      // The instance limits given EXPLICITLY: a client that does not know them can only send and
      // see an error - and for a human writing a long report that is the worst possible moment to
      // find out about a limit.
      limity: {
        maxMessageBytes: rc.config.maxMessageBytes,
        maxFileBytes: rc.config.maxFileBytes,
        maxWikiBytes: MAX_WIKI_BYTES,
      },
      ...(guidelines ? { guidelines } : {}),
      ...(news ? { news } : {}),
    });
  });

  /** The guidelines on demand (to be read again). */
  router.add("GET", "/api/guidelines", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { text: guidelinesText() });
  });

  router.add("GET", "/api/actors", (_req, res, rc) => {
    requireAuth(rc);
    json(res, 200, { actors: listActors(rc.ctx) });
  });

  router.add("POST", "/api/actors", async (req, res, rc) => {
    requireAdmin(rc);
    assertCsrf(rc, req);
    const body = await readJson(req, 4096);
    const kind = str(body.kind);
    if (kind !== "human" && kind !== "agent") {
      throw badRequest("zly_rodzaj", "kind musi byc 'human' albo 'agent'");
    }
    const actor = createActor(rc.ctx, {
      kind,
      handle: str(body.handle) ?? "",
      displayName: str(body.displayName),
    });
    json(res, 201, { actor });
  });
}
