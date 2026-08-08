/** Passkeys: pelna petla rejestracja -> logowanie na SYNTETYCZNYM
 *  authenticatorze (node:crypto gra role Secure Enclave). Weryfikujemy
 *  wlasny parser CBOR/COSE i weryfikacje podpisu - bez przegladarki. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkActor, testCtx } from "../helpers.ts";
import {
  b64u,
  hasCredentials,
  issueChallenge,
  listCredentials,
  registerCredential,
  verifyAssertion,
} from "../../src/core/webauthn.ts";

// --- minimalny ENKODER CBOR (tylko na potrzeby testu) -----------------------

function cborInt(n: number, major: number): Buffer {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 256) return Buffer.from([m | 24, n]);
  const b = Buffer.alloc(3); b[0] = m | 25; b.writeUInt16BE(n, 1); return b;
}
function cbor(v: unknown): Buffer {
  if (typeof v === "number") {
    return v >= 0 ? cborInt(v, 0) : cborInt(-1 - v, 1);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([cborInt(v.length, 2), v]);
  if (typeof v === "string") {
    const b = Buffer.from(v, "utf8");
    return Buffer.concat([cborInt(b.length, 3), b]);
  }
  if (v instanceof Map) {
    const parts: Buffer[] = [cborInt(v.size, 5)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error("nieobslugiwany typ w testowym enkoderze CBOR");
}

// --- syntetyczny authenticator ---------------------------------------------

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8788";

function makeAuthenticator() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const credId = randomBytes(16);
  const cose = new Map<number, unknown>([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, "base64url")],
    [-3, Buffer.from(jwk.y, "base64url")],
  ]);
  return { privateKey, credId, coseKey: cbor(cose) };
}

function authData(flags: number, signCount: number, attested?: { credId: Buffer; coseKey: Buffer }): Buffer {
  const head = Buffer.alloc(37);
  createHash("sha256").update(RP_ID).digest().copy(head, 0);
  head[32] = flags;
  head.writeUInt32BE(signCount, 33);
  if (!attested) return head;
  const len = Buffer.alloc(2); len.writeUInt16BE(attested.credId.length, 0);
  return Buffer.concat([head, Buffer.alloc(16), len, attested.credId, attested.coseKey]);
}

function clientData(type: string, challenge: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN }), "utf8");
}

function register(ctx: ReturnType<typeof testCtx>, actorId: number, auth: ReturnType<typeof makeAuthenticator>) {
  const challenge = issueChallenge("register", actorId);
  const att = cbor(new Map<string, unknown>([
    ["fmt", "none"],
    ["attStmt", new Map()],
    ["authData", authData(0x45, 0, { credId: auth.credId, coseKey: auth.coseKey })],
  ]));
  return registerCredential(ctx, {
    rpId: RP_ID,
    expectedOrigins: [ORIGIN],
    actorId,
    challengeFromClient: challenge,
    clientDataJSON: b64u.enc(clientData("webauthn.create", challenge)),
    attestationObject: b64u.enc(att),
  });
}

function assertLogin(ctx: ReturnType<typeof testCtx>, auth: ReturnType<typeof makeAuthenticator>,
                     opts?: { origin?: string; challenge?: string; count?: number; tamper?: boolean }) {
  const challenge = opts?.challenge ?? issueChallenge("login", null);
  const ad = authData(0x05, opts?.count ?? 1);
  const cd = Buffer.from(JSON.stringify({
    type: "webauthn.get", challenge, origin: opts?.origin ?? ORIGIN,
  }), "utf8");
  const signer = createSign("sha256");
  signer.update(Buffer.concat([ad, createHash("sha256").update(cd).digest()]));
  let sig = signer.sign(auth.privateKey);
  if (opts?.tamper) sig = Buffer.concat([sig.subarray(0, sig.length - 1), Buffer.from([sig[sig.length - 1] ^ 0xff])]);
  return verifyAssertion(ctx, {
    rpId: RP_ID,
    expectedOrigins: [ORIGIN],
    credentialId: b64u.enc(auth.credId),
    clientDataJSON: b64u.enc(cd),
    authenticatorData: b64u.enc(ad),
    signature: b64u.enc(sig),
  });
}

// --- testy ------------------------------------------------------------------

test("passkey: rejestracja i logowanie przechodza pelna petle", () => {
  const ctx = testCtx();
  const michal = mkActor(ctx, "michal", "human");
  const auth = makeAuthenticator();
  assert.equal(hasCredentials(ctx, michal.id), false);
  const id = register(ctx, michal.id, auth);
  assert.equal(id, b64u.enc(auth.credId));
  assert.equal(hasCredentials(ctx, michal.id), true);
  assert.equal(listCredentials(ctx, michal.id).length, 1);
  assert.equal(assertLogin(ctx, auth), michal.id);
});

test("passkey: zly origin, powtorzony challenge i zepsuty podpis sa odrzucane", () => {
  const ctx = testCtx();
  const michal = mkActor(ctx, "michal", "human");
  const auth = makeAuthenticator();
  register(ctx, michal.id, auth);

  assert.throws(() => assertLogin(ctx, auth, { origin: "https://zly.example" }), /origin/);

  const ch = issueChallenge("login", null);
  assert.equal(assertLogin(ctx, auth, { challenge: ch, count: 1 }), michal.id);
  // ten sam challenge drugi raz = replay
  assert.throws(() => assertLogin(ctx, auth, { challenge: ch, count: 2 }), /wyzwanie/);

  assert.throws(() => assertLogin(ctx, auth, { count: 3, tamper: true }), /podpis/);
});

test("passkey: cofniety licznik podpisow jest odrzucany (klon klucza)", () => {
  const ctx = testCtx();
  const michal = mkActor(ctx, "michal", "human");
  const auth = makeAuthenticator();
  register(ctx, michal.id, auth);
  assert.equal(assertLogin(ctx, auth, { count: 5 }), michal.id);
  assert.throws(() => assertLogin(ctx, auth, { count: 4 }), /licznik/);
  // Apple (licznik zawsze 0) nie wpada w te pulapke
  const apple = makeAuthenticator();
  register(ctx, michal.id, apple);
  assert.equal(assertLogin(ctx, apple, { count: 0 }), michal.id);
  assert.equal(assertLogin(ctx, apple, { count: 0 }), michal.id);
});
