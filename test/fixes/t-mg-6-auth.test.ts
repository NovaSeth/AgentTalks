// Polish synthetic passwords and private message bodies verify authentication and non-disclosure of exact input.
/** T-MG-6 (fix package A1): auth and sessions. One group of tests per finding. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { bearer, cookieAuth, startTestServer, type TestServer } from "../http-helpers.ts";
import { mkActor, testCtx, waitFor } from "../helpers.ts";
import { createActor, setDisabled, setPassword } from "../../src/core/actors.ts";
import { mintToken, listTokens, revokeToken } from "../../src/core/tokens.ts";
import { ensureDirect } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";
import { isBlockedIp, isWakeable, registerWake, setWake, signWake } from "../../src/core/wake.ts";
import { b64u, issueChallenge, registerCredential, verifyAssertion } from "../../src/core/webauthn.ts";

function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  const dm = ensureDirect(s.ctx, [ala.id, bob.id]);
  return {
    ala, bob, michal, dmId: dm.id,
    tokenA: mintToken(s.ctx, ala.id, "t").token,
    tokenB: mintToken(s.ctx, bob.id, "t").token,
  };
}

async function login(s: TestServer, handle: string, password: string): Promise<Response> {
  return fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle, password }),
  });
}

// --- B-MG-2 / B-MG-50: long-poll re-authenticates before delivery -------------

async function pollThenKill(kill: (s: TestServer, ctxs: ReturnType<typeof seed>) => void) {
  const s = await startTestServer();
  const sc = seed(s);
  const poll = fetch(`${s.url}/api/messages?wait=20`, { headers: bearer(sc.tokenB) });
  await waitFor(() => s.ctx.bus.streamCount(sc.bob.id) === 1, 2000);
  kill(s, sc);
  postMessage(s.ctx, { conversationId: sc.dmId, actorId: sc.ala.id, body: "tajna-tresc" });
  const r = await poll;
  const text = await r.text();
  await s.close();
  return { status: r.status, text };
}

test("long-poll answers 401 after the token was revoked mid-wait (B-MG-2)", async () => {
  const { status, text } = await pollThenKill((s, sc) => {
    revokeToken(s.ctx, listTokens(s.ctx, sc.bob.id)[0].id);
  });
  assert.equal(status, 401);
  assert.ok(!text.includes("tajna-tresc"));
});

test("long-poll answers 401 after the actor was disabled mid-wait (B-MG-2)", async () => {
  const { status, text } = await pollThenKill((s, sc) => { setDisabled(s.ctx, sc.bob.id, true); });
  assert.equal(status, 401);
  assert.ok(!text.includes("tajna-tresc"));
});

test("long-poll of a cookie session answers 401 after a password change (B-MG-50)", async () => {
  const s = await startTestServer();
  const sc = seed(s);
  const lg = await login(s, "michal", "haslo1234");
  const auth = cookieAuth(lg.headers.get("set-cookie")!);
  const dm = ensureDirect(s.ctx, [sc.ala.id, sc.michal.id]);
  const poll = fetch(`${s.url}/api/messages?wait=20`, { headers: { cookie: auth.cookie } });
  await waitFor(() => s.ctx.bus.streamCount(sc.michal.id) === 1, 2000);
  setPassword(s.ctx, sc.michal.id, "zupelnie-nowe-haslo");
  postMessage(s.ctx, { conversationId: dm.id, actorId: sc.ala.id, body: "tajna-tresc" });
  const r = await poll;
  const text = await r.text();
  assert.equal(r.status, 401);
  assert.ok(!text.includes("tajna-tresc"));
  await s.close();
});

// --- B-MG-3: wake is dead for a disabled actor ---------------------------------

test("a disabled actor is not woken and is not wakeable (B-MG-3)", async () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "system", handle: "system" });
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const dm = ensureDirect(ctx, [ala.id, bob.id]);
  const delivered: string[] = [];
  registerWake(ctx, async (_t, body) => { delivered.push(body); return true; });
  setWake(ctx, bob.id, "https://most.example/wake");
  assert.equal(isWakeable(ctx, bob.id), true);
  setDisabled(ctx, bob.id, true);
  assert.equal(isWakeable(ctx, bob.id), false);
  postMessage(ctx, { conversationId: dm.id, actorId: ala.id, body: "prywatne" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(delivered.length, 0);
});

// --- B-MG-19: signed exp + nonce, NAT64 / 6to4 blocked --------------------------

test("wake body carries a signed exp (now+300) and a random nonce (B-MG-19)", async () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "system", handle: "system" });
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const dm = ensureDirect(ctx, [ala.id, bob.id]);
  const got: Array<{ body: string; sig: string }> = [];
  registerWake(ctx, async (_t, body, sig) => { got.push({ body, sig }); return true; });
  const { secret } = setWake(ctx, bob.id, "https://most.example/wake");
  postMessage(ctx, { conversationId: dm.id, actorId: ala.id, body: "hej" });
  await waitFor(() => got.length === 1, 2000);
  const parsed = JSON.parse(got[0].body);
  assert.equal(parsed.exp, ctx.now() + 300);
  assert.match(parsed.nonce, /^[0-9a-f]{32}$/);
  assert.equal(got[0].sig, signWake(secret, got[0].body));
  const tampered = got[0].body.replace(`"exp":${parsed.exp}`, `"exp":${parsed.exp + 9999}`);
  assert.notEqual(signWake(secret, tampered), got[0].sig);
});

test("isBlockedIp blocks NAT64 and 6to4 ranges (B-MG-19)", () => {
  for (const ip of ["64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "[64:ff9b::1]",
                    "2002:7f00:1::1", "2002:a9fe:a9fe::", "[2002::1]"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  assert.equal(isBlockedIp("2606:4700::1111"), false);
  assert.equal(isBlockedIp("93.184.216.34"), false);
});

// --- B-MG-5 / B-MG-52: passkey counter ------------------------------------------

const RP_ID = "localhost";
const ORIGIN = "http://localhost:8788";

function cborBytes(n: number, major: number): Buffer {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 256) return Buffer.from([m | 24, n]);
  const b = Buffer.alloc(3); b[0] = m | 25; b.writeUInt16BE(n, 1); return b;
}
function cbor(v: unknown): Buffer {
  if (typeof v === "number") return v >= 0 ? cborBytes(v, 0) : cborBytes(-1 - v, 1);
  if (Buffer.isBuffer(v)) return Buffer.concat([cborBytes(v.length, 2), v]);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([cborBytes(b.length, 3), b]); }
  if (v instanceof Map) {
    const parts: Buffer[] = [cborBytes(v.size, 5)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error("cbor");
}
function authData(flags: number, count: number, att?: { credId: Buffer; cose: Buffer }): Buffer {
  const head = Buffer.alloc(37);
  createHash("sha256").update(RP_ID).digest().copy(head, 0);
  head[32] = flags; head.writeUInt32BE(count, 33);
  if (!att) return head;
  const len = Buffer.alloc(2); len.writeUInt16BE(att.credId.length, 0);
  return Buffer.concat([head, Buffer.alloc(16), len, att.credId, att.cose]);
}
function passkeySetup() {
  const ctx = testCtx();
  const actor = mkActor(ctx, "michal", "human");
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const credId = randomBytes(16);
  const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
  const challenge = issueChallenge("register", actor.id);
  const cd = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN }));
  const att = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()],
    ["authData", authData(0x45, 0, { credId, cose })]]));
  registerCredential(ctx, { rpId: RP_ID, expectedOrigins: [ORIGIN], actorId: actor.id,
    clientDataJSON: b64u.enc(cd), attestationObject: b64u.enc(att) });
  const login = (count: number) => {
    const ad = authData(0x05, count);
    const cdj = Buffer.from(JSON.stringify({
      type: "webauthn.get", challenge: issueChallenge("login", null), origin: ORIGIN }));
    const signer = createSign("sha256");
    signer.update(Buffer.concat([ad, createHash("sha256").update(cdj).digest()]));
    return verifyAssertion(ctx, { rpId: RP_ID, expectedOrigins: [ORIGIN],
      credentialId: b64u.enc(credId), clientDataJSON: b64u.enc(cdj),
      authenticatorData: b64u.enc(ad), signature: b64u.enc(signer.sign(privateKey)) });
  };
  const stored = () => (ctx.db.prepare("SELECT sign_count AS n FROM webauthn_credentials")
    .get() as { n: number }).n;
  return { login, stored, actor };
}

test("passkey counter: 5->0 and 5->5 rejected, 5->6 ok, never lowered (B-MG-5)", () => {
  const p = passkeySetup();
  assert.equal(p.login(5), p.actor.id);
  assert.throws(() => p.login(0), /counter/);
  assert.equal(p.stored(), 5);
  assert.throws(() => p.login(5), /counter/);
  assert.equal(p.login(6), p.actor.id);
  assert.equal(p.stored(), 6);
});

test("passkey counter: an always-zero authenticator stays allowed (B-MG-52)", () => {
  const p = passkeySetup();
  assert.equal(p.login(0), p.actor.id);
  assert.equal(p.login(0), p.actor.id);
  assert.equal(p.stored(), 0);
});

// --- B-MG-8: POST /api/actors needs a HUMAN admin --------------------------------

test("an agent admin cannot create actors, a human admin can (B-MG-8)", async () => {
  const s = await startTestServer();
  const sc = seed(s);
  const robot = createActor(s.ctx, { kind: "agent", handle: "robot", isAdmin: true });
  const tokenR = mintToken(s.ctx, robot.id, "t").token;
  const denied = await fetch(s.url + "/api/actors", {
    method: "POST", headers: bearer(tokenR),
    body: JSON.stringify({ kind: "human", handle: "intruz" }),
  });
  assert.equal(denied.status, 403);
  const lg = await login(s, "michal", "haslo1234");
  const ok = await fetch(s.url + "/api/actors", {
    method: "POST", headers: cookieAuth(lg.headers.get("set-cookie")!),
    body: JSON.stringify({ kind: "human", handle: "nowy" }),
  });
  assert.equal(ok.status, 201);
  void sc;
  await s.close();
});

// --- B-MG-44: login rate limit per IP+handle and per handle -----------------------

test("interleaved successful logins do not reset the guess counter on a victim (B-MG-44)", async () => {
  const s = await startTestServer();
  seed(s);
  const mallory = createActor(s.ctx, { kind: "human", handle: "mallory" });
  setPassword(s.ctx, mallory.id, "wlasne-haslo-1");
  for (let i = 0; i < 8; i++) {
    assert.equal((await login(s, "michal", "zle-haslo-" + i)).status, 401);
    assert.equal((await login(s, "mallory", "wlasne-haslo-1")).status, 200);
  }
  assert.equal((await login(s, "michal", "zle-haslo-9")).status, 429);
  await s.close();
});

// --- B-MG-45: logout is server-side and needs CSRF --------------------------------

test("logout invalidates the cookie server-side and requires CSRF (B-MG-45)", async () => {
  const s = await startTestServer();
  seed(s);
  const lg = await login(s, "michal", "haslo1234");
  const auth = cookieAuth(lg.headers.get("set-cookie")!);
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie: auth.cookie } })).status, 200);
  const noCsrf = await fetch(s.url + "/api/logout", { method: "POST", headers: { cookie: auth.cookie } });
  assert.equal(noCsrf.status, 403);
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie: auth.cookie } })).status, 200);
  const out = await fetch(s.url + "/api/logout", { method: "POST", headers: auth });
  assert.equal(out.status, 200);
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie: auth.cookie } })).status, 401);
  await s.close();
});

// --- B-MG-51: security logging ----------------------------------------------------

test("a failed login writes exactly one security: line without the password (B-MG-51)", async () => {
  const s = await startTestServer();
  seed(s);
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try {
    assert.equal((await login(s, "michal", "super-tajne-zle-haslo")).status, 401);
  } finally { console.warn = orig; }
  const sec = lines.filter((l) => l.startsWith("security:"));
  assert.equal(sec.length, 1);
  const evt = JSON.parse(sec[0].slice("security:".length));
  assert.equal(evt.event, "login_failed");
  assert.ok(!sec[0].includes("super-tajne-zle-haslo"));
  await s.close();
});

test("token mint and revoke and a denied admin action are logged without secrets (B-MG-51)", async () => {
  const s = await startTestServer();
  const sc = seed(s);
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  let minted = "";
  try {
    minted = mintToken(s.ctx, sc.ala.id, "ci").token;
    revokeToken(s.ctx, listTokens(s.ctx, sc.ala.id).at(-1)!.id);
    await fetch(s.url + "/api/actors", { method: "POST", headers: bearer(sc.tokenA),
      body: JSON.stringify({ kind: "agent", handle: "x" }) });
  } finally { console.warn = orig; }
  const events = lines.filter((l) => l.startsWith("security:"))
    .map((l) => JSON.parse(l.slice("security:".length)).event);
  assert.deepEqual(events, ["token_minted", "token_revoked", "admin_denied"]);
  assert.ok(!lines.join("\n").includes(minted));
  void createHmac;
  await s.close();
});
