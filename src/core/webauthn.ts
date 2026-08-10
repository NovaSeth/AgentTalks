/**
 * Passkeys (WebAuthn) with no dependencies: Touch ID / Face ID sign-in.
 *
 * The trust model: we BIND a credential to an actor during a SIGNED-IN session (by
 * password), so device attestation would add nothing - we accept attestation "none" and
 * ignore attStmt. The proof at login is a signature over the challenge by the key whose
 * public half we stored at registration; the private half never leaves the device's Secure
 * Enclave.
 *
 * Supported algorithms: ES256 (-7, Apple and most others) and RS256 (-257, Windows Hello).
 * Verification purely on node:crypto - we parse CBOR and COSE ourselves, because the
 * subset needed is a few dozen lines.
 */
import { createHash, createVerify, randomBytes } from "node:crypto";
import type { Ctx } from "./ctx.ts";
import { badRequest, notFound, unauthorized } from "./errors.ts";

export const b64u = {
  enc: (b: Buffer): string => b.toString("base64url"),
  dec: (s: string): Buffer => Buffer.from(String(s ?? ""), "base64url"),
};

// ---------------------------------------------------------------- CBOR (reading)

type CborValue = number | bigint | string | Buffer | boolean | null | CborValue[]
  | Map<number | string, CborValue>;

/** A CBOR decoder limited to what occurs in attestationObject and COSE: numbers, bytes,
 *  text, arrays, maps, simple values. No streams. */
function cborDecode(buf: Buffer): { value: CborValue; rest: Buffer } {
  if (buf.length === 0) throw badRequest("cbor", "puste dane CBOR");
  const ib = buf[0];
  const major = ib >> 5;
  const info = ib & 0x1f;
  let off = 1;
  let len = BigInt(info);
  if (info === 24) { len = BigInt(buf[off]); off += 1; }
  else if (info === 25) { len = BigInt(buf.readUInt16BE(off)); off += 2; }
  else if (info === 26) { len = BigInt(buf.readUInt32BE(off)); off += 4; }
  else if (info === 27) { len = buf.readBigUInt64BE(off); off += 8; }
  else if (info >= 28) throw badRequest("cbor", "nieobslugiwana dlugosc CBOR");

  const n = Number(len);
  switch (major) {
    case 0: return { value: n, rest: buf.subarray(off) };
    case 1: return { value: -1 - n, rest: buf.subarray(off) };
    case 2: return { value: buf.subarray(off, off + n), rest: buf.subarray(off + n) };
    case 3: return { value: buf.subarray(off, off + n).toString("utf8"), rest: buf.subarray(off + n) };
    case 4: {
      const arr: CborValue[] = [];
      let rest = buf.subarray(off);
      for (let i = 0; i < n; i++) {
        const r = cborDecode(rest);
        arr.push(r.value); rest = r.rest;
      }
      return { value: arr, rest };
    }
    case 5: {
      const map = new Map<number | string, CborValue>();
      let rest = buf.subarray(off);
      for (let i = 0; i < n; i++) {
        const k = cborDecode(rest);
        const v = cborDecode(k.rest);
        if (typeof k.value !== "number" && typeof k.value !== "string") {
          throw badRequest("cbor", "klucz mapy CBOR musi byc liczba albo tekstem");
        }
        map.set(k.value, v.value); rest = v.rest;
      }
      return { value: map, rest };
    }
    case 6: return cborDecode(buf.subarray(off)); // a tag - transparent here
    case 7: {
      if (info === 20) return { value: false, rest: buf.subarray(off) };
      if (info === 21) return { value: true, rest: buf.subarray(off) };
      if (info === 22) return { value: null, rest: buf.subarray(off) };
      throw badRequest("cbor", "nieobslugiwana prosta wartosc CBOR");
    }
    default: throw badRequest("cbor", "nieznany typ CBOR");
  }
}

// ------------------------------------------------------------ COSE -> node key

type StoredKey = { kty: "EC" | "RSA"; jwk: Record<string, string>; alg: number };

/** A COSE_Key (a map with integer keys) into a JWK that node:crypto understands. */
function coseToJwk(cose: Map<number | string, CborValue>): StoredKey {
  const kty = cose.get(1);
  const alg = Number(cose.get(3) ?? 0);
  if (kty === 2) { // EC2 (P-256)
    const crv = cose.get(-1);
    const x = cose.get(-2), y = cose.get(-3);
    if (crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
      throw badRequest("webauthn", "obslugujemy tylko krzywa P-256");
    }
    return {
      kty: "EC", alg: alg || -7,
      jwk: { kty: "EC", crv: "P-256", x: b64u.enc(x), y: b64u.enc(y) },
    };
  }
  if (kty === 3) { // RSA
    const n = cose.get(-1), e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw badRequest("webauthn", "zly klucz RSA");
    return { kty: "RSA", alg: alg || -257, jwk: { kty: "RSA", n: b64u.enc(n), e: b64u.enc(e) } };
  }
  throw badRequest("webauthn", `nieobslugiwany typ klucza COSE (kty=${String(kty)})`);
}

// --------------------------------------------------------------- challenges

/** A challenge lives briefly and once, in the process's memory - a server restart simply
 *  invalidates open login attempts, which is the right behaviour. */
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const challenges = new Map<string, { purpose: "register" | "login"; actorId: number | null; expires: number }>();

export function issueChallenge(purpose: "register" | "login", actorId: number | null): string {
  for (const [k, v] of challenges) if (v.expires < Date.now()) challenges.delete(k);
  const c = b64u.enc(randomBytes(32));
  challenges.set(c, { purpose, actorId, expires: Date.now() + CHALLENGE_TTL_MS });
  return c;
}

function consumeChallenge(c: string, purpose: "register" | "login"):
  { actorId: number | null } {
  const row = challenges.get(String(c ?? ""));
  challenges.delete(String(c ?? ""));
  if (!row || row.purpose !== purpose || row.expires < Date.now()) {
    throw unauthorized("webauthn_challenge", "wyzwanie wygaslo albo nie istnieje - sprobuj jeszcze raz");
  }
  return { actorId: row.actorId };
}

// ------------------------------------------------------------------ verification

type ClientData = { type: string; challenge: string; origin: string };

function parseClientData(raw: Buffer): ClientData {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch {
    throw badRequest("webauthn", "clientDataJSON nie jest JSON-em");
  }
  const o = parsed as Record<string, unknown>;
  return { type: String(o.type ?? ""), challenge: String(o.challenge ?? ""), origin: String(o.origin ?? "") };
}

function assertOrigin(origin: string, expectedOrigins: readonly string[]): void {
  if (!expectedOrigins.includes(origin)) {
    throw unauthorized("webauthn_origin", `origin ${origin} nie pasuje do tej instancji`);
  }
}

function rpIdHashOk(authData: Buffer, rpId: string): boolean {
  const expect = createHash("sha256").update(rpId).digest();
  return authData.length >= 37 && expect.equals(authData.subarray(0, 32));
}

const FLAG_UP = 0x01, FLAG_UV = 0x04, FLAG_AT = 0x40;

export type RegistrationInput = {
  rpId: string;
  expectedOrigins: readonly string[];
  actorId: number;
  // The `challengeFromClient` field was REMOVED. It was dead: nobody read it, and its comment
  // suggested a check that did not exist. The trustworthy challenge comes ONLY from
  // clientDataJSON (signed by the authenticator) and is consumed there - a copy handed over
  // alongside it by the client would prove nothing, because the client could hand over
  // anything. Better an empty space than an apparent check.
  clientDataJSON: string;           // base64url
  attestationObject: string;        // base64url
  label?: string | null;
};

/** Registering a credential: checks challenge/origin/rpId/flags, extracts the credentialId
 *  and the public key, and stores them. Returns the credential's id. */
/** A call that MAY receive junk from a client, wrapped so that junk ends in a 400 ("you sent
 *  something wrong") rather than a 500 ("the server fell over"). Buffer reads (readUInt16BE,
 *  subarray, CBOR) throw a RangeError on truncated data - and an unhandled RangeError is our
 *  failure in response to somebody else's error, that is, a message that lies about who was
 *  at fault. */
function zeSmieciemJako400<T>(co: () => T): T {
  try {
    return co();
  } catch (err) {
    if (err instanceof RangeError || err instanceof TypeError) {
      throw badRequest("webauthn", "dane rejestracji klucza sa niekompletne albo uszkodzone");
    }
    throw err;
  }
}

export function registerCredential(ctx: Ctx, input: RegistrationInput): string {
  return zeSmieciemJako400(() => registerCredentialWewn(ctx, input));
}

function registerCredentialWewn(ctx: Ctx, input: RegistrationInput): string {
  const client = parseClientData(b64u.dec(input.clientDataJSON));
  if (client.type !== "webauthn.create") throw badRequest("webauthn", "zly typ clientData");
  const ch = consumeChallenge(client.challenge, "register");
  if (ch.actorId !== input.actorId) {
    throw unauthorized("webauthn_challenge", "wyzwanie nie nalezy do tego aktora");
  }
  assertOrigin(client.origin, input.expectedOrigins);

  const att = cborDecode(b64u.dec(input.attestationObject)).value;
  if (!(att instanceof Map)) throw badRequest("webauthn", "zly attestationObject");
  const authData = att.get("authData");
  if (!Buffer.isBuffer(authData)) throw badRequest("webauthn", "brak authData");
  if (!rpIdHashOk(authData, input.rpId)) throw unauthorized("webauthn_rpid", "rpIdHash nie pasuje");
  const flags = authData[32];
  if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) {
    throw unauthorized("webauthn_uv", "wymagana weryfikacja uzytkownika (odcisk/twarz)");
  }
  if (!(flags & FLAG_AT)) throw badRequest("webauthn", "brak attested credential data");

  // authData: rpIdHash(32) flags(1) signCount(4) aaguid(16) credIdLen(2) credId cose
  const credIdLen = authData.readUInt16BE(53);
  const credId = authData.subarray(55, 55 + credIdLen);
  const coseRaw = authData.subarray(55 + credIdLen);
  const cose = cborDecode(coseRaw).value;
  if (!(cose instanceof Map)) throw badRequest("webauthn", "zly klucz COSE");
  const key = coseToJwk(cose);
  if (key.alg !== -7 && key.alg !== -257) {
    throw badRequest("webauthn", `nieobslugiwany algorytm ${key.alg}`);
  }
  const signCount = authData.readUInt32BE(33);
  const id = b64u.enc(credId);
  ctx.db.prepare(
    `INSERT INTO webauthn_credentials(id, actor_id, public_key, sign_count, label, created_at)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, input.actorId, JSON.stringify(key), signCount, input.label ?? null, ctx.now());
  return id;
}

export type AuthenticationInput = {
  rpId: string;
  expectedOrigins: readonly string[];
  credentialId: string;             // base64url
  clientDataJSON: string;           // base64url
  authenticatorData: string;        // base64url
  signature: string;                // base64url
};

/** Passkey login: returns the actorId after the signature verifies. */
export function verifyAssertion(ctx: Ctx, input: AuthenticationInput): number {
  const row = ctx.db.prepare(
    "SELECT actor_id, public_key, sign_count FROM webauthn_credentials WHERE id = ?",
  ).get(String(input.credentialId ?? "")) as
    | { actor_id: number; public_key: string; sign_count: number }
    | undefined;
  if (!row) throw notFound("poswiadczenie", "nieznane poswiadczenie - zaloguj sie haslem i dodaj je ponownie");

  const client = parseClientData(b64u.dec(input.clientDataJSON));
  if (client.type !== "webauthn.get") throw badRequest("webauthn", "zly typ clientData");
  consumeChallenge(client.challenge, "login");
  assertOrigin(client.origin, input.expectedOrigins);

  const authData = b64u.dec(input.authenticatorData);
  if (!rpIdHashOk(authData, input.rpId)) throw unauthorized("webauthn_rpid", "rpIdHash nie pasuje");
  const flags = authData[32];
  if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) {
    throw unauthorized("webauthn_uv", "wymagana weryfikacja uzytkownika (odcisk/twarz)");
  }

  const key = JSON.parse(row.public_key) as StoredKey;
  const signedData = Buffer.concat([
    authData,
    createHash("sha256").update(b64u.dec(input.clientDataJSON)).digest(),
  ]);
  const verifier = createVerify("sha256");
  verifier.update(signedData);
  let ok = false;
  try {
    ok = verifier.verify(
      { key: key.jwk as unknown as string, format: "jwk" } as unknown as string,
      b64u.dec(input.signature),
    );
  } catch {
    ok = false;
  }
  if (!ok) throw unauthorized("webauthn_podpis", "podpis sie nie zgadza");

  const count = authData.readUInt32BE(33);
  // The signature counter grows on devices that support it; a regression MAY mean a cloned
  // key. Apple keeps zero - then we do not compare.
  if (count !== 0 && row.sign_count !== 0 && count <= row.sign_count) {
    throw unauthorized("webauthn_licznik", "licznik podpisow sie cofnal - poswiadczenie odrzucone");
  }
  ctx.db.prepare(
    "UPDATE webauthn_credentials SET sign_count = ?, last_used_at = ? WHERE id = ?",
  ).run(count, ctx.now(), String(input.credentialId));
  return row.actor_id;
}

/** An actor's list of credentials (for allowCredentials and for the settings UI). */
export function listCredentials(ctx: Ctx, actorId: number): Array<{ id: string; label: string | null; createdAt: number; lastUsedAt: number | null }> {
  const rows = ctx.db.prepare(
    "SELECT id, label, created_at, last_used_at FROM webauthn_credentials WHERE actor_id = ? ORDER BY created_at",
  ).all(actorId) as Array<{ id: string; label: string | null; created_at: number; last_used_at: number | null }>;
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

export function hasCredentials(ctx: Ctx, actorId: number): boolean {
  return !!ctx.db.prepare("SELECT 1 FROM webauthn_credentials WHERE actor_id = ? LIMIT 1").get(actorId);
}
