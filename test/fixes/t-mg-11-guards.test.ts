/** T-MG-11 items 1-3, 5, 6: tests for controls that no test could fail (mutation review). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { bearer, cookieAuth, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor, sessionEpoch, setPassword } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";
import { markRead } from "../../src/core/unread.ts";
import { pin } from "../../src/core/pins.ts";
import { mkActor, testCtx } from "../helpers.ts";

async function login(s: TestServer, handle: string, password: string, headers: Record<string, string> = {}) {
  return fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ handle, password }),
  });
}

function humans(s: TestServer) {
  const admin = createActor(s.ctx, { kind: "human", handle: "boss", isAdmin: true });
  setPassword(s.ctx, admin.id, "haslo1234");
  const user = createActor(s.ctx, { kind: "human", handle: "plain" });
  setPassword(s.ctx, user.id, "haslo5678");
  return { admin, user };
}

// --- item 1 (B-MG-86): a well-formed forged cookie must reach the MAC compare ----------

test("a well-formed 4-part cookie with a wrong MAC for an admin id is 401 on /api/me (B-MG-86)", async () => {
  const s = await startTestServer();
  const { admin } = humans(s);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const epoch = sessionEpoch(s.ctx, admin.id);
  const forged = `${admin.id}.${exp}.${epoch}.${"a".repeat(64)}`;
  const bad = await fetch(s.url + "/api/me", { headers: { cookie: `at_session=${forged}` } });
  assert.equal(bad.status, 401);
  // Control: the same shape with the REAL MAC is accepted, so the 401 above is the MAC alone.
  const payload = `${admin.id}.${exp}.${epoch}`;
  const mac = createHmac("sha256", s.config.secret).update(payload).digest("hex");
  const good = await fetch(s.url + "/api/me", { headers: { cookie: `at_session=${payload}.${mac}` } });
  assert.equal(good.status, 200);
  await s.close();
});

// --- item 2 (B-MG-87): a mention in a private channel does not leak to a non-member ----

test("a non-member mentioned in a private channel gets no text through notifications or mentions (B-MG-87)", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const eve = createActor(s.ctx, { kind: "agent", handle: "eve" });
  const tokenE = mintToken(s.ctx, eve.id, "t").token;
  const ch = createChannel(s.ctx, { slug: "tajny", kind: "private", createdBy: ala.id });
  postMessage(s.ctx, { conversationId: ch.id, actorId: ala.id, body: "@eve sekret-numer-7" });
  const n = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenE) })).text();
  assert.ok(!n.includes("sekret-numer-7"), "notification excerpt leaked");
  assert.deepEqual(JSON.parse(n).notifications, []);
  const m = await (await fetch(s.url + "/api/mentions", { headers: bearer(tokenE) })).text();
  assert.ok(!m.includes("sekret-numer-7"), "mention leaked");
  assert.equal(s.ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE actor_id = ?")
    .get(eve.id)!.n, 0, "no notification row is even written for a non-member");
  await s.close();
});

// --- item 3 (B-MG-88): admin guards -------------------------------------------------

test("POST /api/actors: agent admin 403, non-admin human 403, human admin 201 (B-MG-88)", async () => {
  const s = await startTestServer();
  const { user } = humans(s);
  void user;
  const robot = createActor(s.ctx, { kind: "agent", handle: "robot", isAdmin: true });
  const post = (headers: Record<string, string>, handle: string) =>
    fetch(s.url + "/api/actors", { method: "POST", headers, body: JSON.stringify({ kind: "agent", handle }) });
  assert.equal((await post(bearer(mintToken(s.ctx, robot.id, "t").token), "x1")).status, 403);
  const plain = cookieAuth((await login(s, "plain", "haslo5678")).headers.get("set-cookie")!);
  assert.equal((await post(plain, "x2")).status, 403);
  const boss = cookieAuth((await login(s, "boss", "haslo1234")).headers.get("set-cookie")!);
  assert.equal((await post(boss, "x3")).status, 201);
  await s.close();
});

test("admin panel routes answer 403 to a non-admin human and 200 to a human admin (B-MG-88)", async () => {
  const s = await startTestServer();
  const { admin, user } = humans(s);
  const plain = cookieAuth((await login(s, "plain", "haslo5678")).headers.get("set-cookie")!);
  const boss = cookieAuth((await login(s, "boss", "haslo1234")).headers.get("set-cookie")!);
  const routes: Array<[string, string]> = [
    ["GET", "/api/admin/actors"],
    ["GET", `/api/admin/actors/${admin.id}/activity`],
    ["POST", "/api/admin/invites"],
    ["POST", "/api/admin/tokens"],
    ["POST", `/api/admin/actors/${user.id}/disable`],
  ];
  for (const [method, path] of routes) {
    const r = await fetch(s.url + path, { method, headers: plain, body: method === "GET" ? undefined : "{}" });
    assert.equal(r.status, 403, `${method} ${path} for a non-admin human`);
  }
  assert.equal((await fetch(s.url + "/api/admin/actors", { headers: boss })).status, 200);
  await s.close();
});

// --- item 5 (B-MG-90): pin and markRead are guarded by canRead -----------------------

test("pin and markRead by a non-member of a private channel are refused (B-MG-90)", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const eve = createActor(s.ctx, { kind: "agent", handle: "eve" });
  const tokenE = mintToken(s.ctx, eve.id, "t").token;
  const ch = createChannel(s.ctx, { slug: "prywatny", kind: "private", createdBy: ala.id });
  const msg = postMessage(s.ctx, { conversationId: ch.id, actorId: ala.id, body: "tresc" });
  const r = await fetch(`${s.url}/api/messages/${msg.id}/pin`, { method: "POST", headers: bearer(tokenE) });
  assert.ok(r.status === 403 || r.status === 404, `pin status ${r.status}`);
  assert.throws(() => pin(s.ctx, { messageId: msg.id, actorId: eve.id }));
  assert.equal(s.ctx.db.prepare("SELECT COUNT(*) AS n FROM pins").get()!.n, 0);
  // Core markRead: no membership row is created and nothing is moved.
  markRead(s.ctx, eve.id, ch.id);
  assert.equal(s.ctx.db.prepare("SELECT COUNT(*) AS n FROM members WHERE conversation_id = ? AND actor_id = ?")
    .get(ch.id, eve.id)!.n, 0, "a non-member must not be joined by markRead");
  await s.close();
});

test("markRead by a member still works (control for B-MG-90)", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const ch = createChannel(ctx, { slug: "p", kind: "private", createdBy: ala.id });
  join(ctx, ch.id, bob.id);
  const m = postMessage(ctx, { conversationId: ch.id, actorId: ala.id, body: "x" });
  markRead(ctx, bob.id, ch.id);
  assert.equal((ctx.db.prepare("SELECT last_read_message_id AS l FROM members WHERE conversation_id = ? AND actor_id = ?")
    .get(ch.id, bob.id) as { l: number }).l, m.id);
});

// --- item 6 (B-MG-91): Set-Cookie attributes ---------------------------------------

function cookiesOf(r: Response) {
  const all = r.headers.getSetCookie();
  return {
    session: all.find((c) => c.startsWith("at_session="))!,
    device: all.find((c) => c.startsWith("at_dev="))!,
  };
}

test("Set-Cookie: HttpOnly + SameSite=Lax always; Secure only over https or with trustProxy (B-MG-91)", async () => {
  const plainSrv = await startTestServer();
  humans(plainSrv);
  const http = cookiesOf(await login(plainSrv, "boss", "haslo1234"));
  for (const c of [http.session, http.device]) {
    assert.match(c, /; HttpOnly/);
    assert.match(c, /; SameSite=Lax/);
    assert.doesNotMatch(c, /; Secure/, "plain http without trustProxy must not set Secure");
  }
  const viaProxyHeader = cookiesOf(await login(plainSrv, "boss", "haslo1234", { "x-forwarded-proto": "https" }));
  for (const c of [viaProxyHeader.session, viaProxyHeader.device]) {
    assert.match(c, /; HttpOnly/);
    assert.match(c, /; SameSite=Lax/);
    assert.match(c, /; Secure/);
  }
  await plainSrv.close();

  const proxied = await startTestServer({ trustProxy: true });
  humans(proxied);
  const a = cookiesOf(await login(proxied, "boss", "haslo1234", { "x-forwarded-proto": "https" }));
  const b = cookiesOf(await login(proxied, "boss", "haslo1234"));
  for (const c of [a.session, a.device, b.session, b.device]) {
    assert.match(c, /; HttpOnly/);
    assert.match(c, /; SameSite=Lax/);
    assert.match(c, /; Secure/);
  }
  await proxied.close();
});

test("requestIsSecure and makeCookie honour a TLS socket (B-MG-91)", async () => {
  const { requestIsSecure, makeCookie, makeDeviceCookie } = await import("../../src/http/auth.ts");
  assert.equal(requestIsSecure({ headers: {}, socket: { encrypted: true } } as never), true);
  assert.equal(requestIsSecure({ headers: {}, socket: {} } as never), false);
  const ctx = testCtx();
  const a = mkActor(ctx, "ala", "human");
  const cfg = (await import("../http-helpers.ts")).testConfig();
  assert.match(makeCookie(ctx, cfg, a.id, 60, true), /; Secure/);
  assert.doesNotMatch(makeCookie(ctx, cfg, a.id, 60, false), /; Secure/);
  assert.match(makeDeviceCookie(ctx, cfg, a.id, true), /; Secure/);
  assert.doesNotMatch(makeDeviceCookie(ctx, cfg, a.id, false), /; Secure/);
  assert.match(makeDeviceCookie(ctx, cfg, a.id, false), /; SameSite=Lax/);
});
