// Polish fixture messages, wiki text, filenames and credentials exercise API round trips and encoding with Polish input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, cookieAuth, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor, setPassword } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, ensureDirect } from "../../src/core/conversations.ts";
import { Router } from "../../src/http/router.ts";
import { readJson } from "../../src/http/respond.ts";
import { Readable } from "node:stream";
import type { Req } from "../../src/http/router.ts";

// --- router and body reading ----------------------------------------------

test("the router matches path parameters", () => {
  const r = new Router();
  r.add("GET", "/api/conversations/:id/messages", () => {});
  assert.equal(r.match("GET", "/api/conversations/42/messages")?.params.id, "42");
  assert.equal(r.match("GET", "/api/conversations/42"), null);
  assert.equal(r.match("POST", "/api/conversations/42/messages"), null);
});

test("readJson rejects a body over the limit", async () => {
  const req = Readable.from([Buffer.from("x".repeat(100))]) as unknown as Req;
  await assert.rejects(() => readJson(req, 10), /exceeds/);
});

test("readJson rejects invalid JSON", async () => {
  const req = Readable.from([Buffer.from("{ urwane")]) as unknown as Req;
  await assert.rejects(() => readJson(req, 1000), /valid JSON/);
});

// --- the shared scene for the API tests -------------------------------------

function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  const channel = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  const privateChannel = createChannel(s.ctx, { slug: "tajne", kind: "private", createdBy: ala.id });
  const dm = ensureDirect(s.ctx, [ala.id, bob.id]);
  return {
    ala, bob, michal,
    tokenA: mintToken(s.ctx, ala.id, "test").token,
    tokenB: mintToken(s.ctx, bob.id, "test").token,
    channelId: channel.id,
    privateChannelId: privateChannel.id,
    dmId: dm.id,
  };
}

test("without authentication the API returns 401 rather than 500", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/conversations");
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, "unauthenticated");
  await s.close();
});

test("health works without authentication", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  await s.close();
});

test("HEAD on a GET route responds like GET without a body (monitoring)", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/health", { method: "HEAD" });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "");
  await s.close();
});

test("an unknown path returns 404 with a code", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/czegos-takiego-nie-ma");
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "not_found");
  await s.close();
});

test("an agent sends a message and another reads it", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, channelId } = seed(s);
  const post = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "czesc" }),
  });
  assert.equal(post.status, 201);
  const list = await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    headers: bearer(tokenB),
  })).json();
  assert.equal(list.messages.at(-1).body, "czesc");
  await s.close();
});

test("the API cannot read another actor's private channel", async () => {
  const s = await startTestServer();
  const { tokenB, privateChannelId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${privateChannelId}/messages`, {
    headers: bearer(tokenB),
  });
  assert.equal(r.status, 403);
  await s.close();
});

test("a client cannot impersonate another actor through a body field", async () => {
  const s = await startTestServer();
  const { tokenA, bob, channelId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ body: "podszycie", actorId: bob.id }),
  });
  assert.notEqual((await r.json()).message.actorId, bob.id);
  await s.close();
});

test("a domain error maps to an HTTP code rather than 500", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "" }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "empty_body");
  await s.close();
});

test("a human logs in and receives a cookie and CSRF token", async () => {
  const s = await startTestServer();
  seed(s);
  const r = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get("set-cookie")!;
  assert.match(setCookie, /^at_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.ok((await r.json()).csrf.length > 0);
  await s.close();
});

test("an incorrect password and a missing user produce the same message", async () => {
  const s = await startTestServer();
  seed(s);
  const invalid = await (await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "nie-to" }),
  })).json();
  const missing = await (await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "nie-ma-takiego", password: "cokolwiek" }),
  })).json();
  assert.equal(invalid.error, missing.error);
  await s.close();
});

test("a cookie-authenticated mutation without a CSRF header is rejected", async () => {
  const s = await startTestServer();
  const { channelId } = seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const withoutCsrf = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ body: "bez csrf" }),
  });
  assert.equal(withoutCsrf.status, 403);
  const withCsrf = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: cookieAuth(login.headers.get("set-cookie")!),
    body: JSON.stringify({ body: "z csrf" }),
  });
  assert.equal(withCsrf.status, 201);
  await s.close();
});

test("a bearer-authenticated request does not require CSRF", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "bez csrf" }),
  });
  assert.equal(r.status, 201);
  await s.close();
});

test("a group conversation is created from handles and includes the sender", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  createActor(s.ctx, { kind: "agent", handle: "cez" });
  const r = await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ kind: "group", members: ["bob", "cez"] }),
  });
  assert.equal(r.status, 201);
  const conv = (await r.json()).conversation;
  assert.equal(conv.kind, "group");
  const detail = await (await fetch(`${s.url}/api/conversations/${conv.id}`, {
    headers: bearer(tokenA),
  })).json();
  assert.equal(detail.members.length, 3);
  await s.close();
});

test("a conversation with a missing actor returns 404 with the name", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const r = await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ kind: "dm", members: ["kogo-nie-ma"] }),
  });
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /kogo-nie-ma/);
  await s.close();
});

test("the unread counter resets after marking the view as read", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "hej" }),
  });
  const before = await (await fetch(s.url + "/api/unread", { headers: bearer(tokenB) })).json();
  assert.equal(before.rows.find((r: any) => r.conversationId === dmId).badge, 1);
  await fetch(`${s.url}/api/conversations/${dmId}/read`, {
    method: "POST", headers: bearer(tokenB), body: "{}",
  });
  const after = await (await fetch(s.url + "/api/unread", { headers: bearer(tokenB) })).json();
  assert.equal(after.rows.find((r: any) => r.conversationId === dmId).unread, 0);
  await s.close();
});

test("API search respects access permissions", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, privateChannelId } = seed(s);
  await fetch(`${s.url}/api/conversations/${privateChannelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "poufna sprawa" }),
  });
  const mine = await (await fetch(s.url + "/api/search?q=poufna", {
    headers: bearer(tokenA),
  })).json();
  const theirs = await (await fetch(s.url + "/api/search?q=poufna", {
    headers: bearer(tokenB),
  })).json();
  assert.equal(mine.messages.length, 1);
  assert.equal(theirs.messages.length, 0);
  await s.close();
});

test("editing and deleting another actor's message returns 403", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, channelId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "moje" }),
  })).json()).message;
  const patch = await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "PATCH", headers: bearer(tokenB), body: JSON.stringify({ body: "przejmuje" }),
  });
  assert.equal(patch.status, 403);
  const del = await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "DELETE", headers: bearer(tokenB),
  });
  assert.equal(del.status, 403);
  await s.close();
});

test("presence shows a registered session with a busy signal", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  await fetch(s.url + "/api/sessions", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ sessionId: "sesja-1", label: "vps", kind: "durable" }),
  });
  await fetch(s.url + "/api/sessions/sesja-1/signal", {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ kind: "busy" }),
  });
  const p = await (await fetch(s.url + "/api/presence", { headers: bearer(tokenA) })).json();
  assert.equal(p.presence[0].busy, true);
  assert.equal(p.presence[0].typing, false);
  await s.close();
});

test("anyone's answer closes an open question", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, channelId } = seed(s);
  const q = await (await fetch(`${s.url}/api/conversations/${channelId}/ask`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "czy mozna deploy?" }),
  })).json();
  const open = await (await fetch(s.url + "/api/questions/open", {
    headers: bearer(tokenB),
  })).json();
  assert.equal(open.questions.length, 1);
  await fetch(`${s.url}/api/questions/${q.question}/answer`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ body: "mozna" }),
  });
  const after = await (await fetch(s.url + "/api/questions/open", { headers: bearer(tokenB) })).json();
  assert.equal(after.questions.length, 0);
  await s.close();
});

test("the conversation list distinguishes my channels from channels I can only see", async () => {
  const s = await startTestServer();
  const { tokenB, channelId } = seed(s);
  const before = await (await fetch(s.url + "/api/conversations", {
    headers: bearer(tokenB),
  })).json();
  assert.ok(
    before.conversations.some((c: any) => c.id === channelId),
    "the public channel must be visible",
  );
  assert.equal(
    before.memberships.some((m: any) => m.conversationId === channelId), false,
    "bob has not joined yet",
  );
  await fetch(`${s.url}/api/conversations/${channelId}/join`, {
    method: "POST", headers: bearer(tokenB),
  });
  const after = await (await fetch(s.url + "/api/conversations", {
    headers: bearer(tokenB),
  })).json();
  assert.ok(after.memberships.some((m: any) => m.conversationId === channelId));
  await s.close();
});

test("join cannot join a private channel", async () => {
  const s = await startTestServer();
  const { tokenB, privateChannelId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${privateChannelId}/join`, {
    method: "POST", headers: bearer(tokenB),
  });
  assert.equal(r.status, 403);
  await s.close();
});

test("forged and expired session cookies return 401 through the API", async () => {
  const s = await startTestServer();
  const { michal } = seed(s);
  // signed with a different secret
  const fake = `at_session=${michal.id}.9999999999.deadbeef`;
  const r1 = await fetch(s.url + "/api/me", { headers: { cookie: fake } });
  assert.equal(r1.status, 401);
  // valid but expired cookie (expiry in the past, valid signature)
  const { makeCookie } = await import("../../src/http/auth.ts");
  const expired = makeCookie(s.ctx, s.config, michal.id, -10, false).split(";")[0];
  const r2 = await fetch(s.url + "/api/me", { headers: { cookie: expired } });
  assert.equal(r2.status, 401);
  await s.close();
});

test("session cookies are REVOCABLE: changing the password invalidates previously issued cookies", async () => {
  const s = await startTestServer();
  const { michal } = seed(s);
  const { makeCookie } = await import("../../src/http/auth.ts");
  const { setPassword } = await import("../../src/core/actors.ts");

  const cookie = makeCookie(s.ctx, s.config, michal.id, 3600, false).split(";")[0];
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 200);

  // Changing a password has to throw out every earlier session - otherwise "I changed my
  // password after the laptop was stolen" does not mean "I closed that door".
  setPassword(s.ctx, michal.id, "zupelnie-nowe-haslo");
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 401);

  // A new login works normally.
  const fresh = makeCookie(s.ctx, s.config, michal.id, 3600, false).split(";")[0];
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie: fresh } })).status, 200);
  await s.close();
});

test("disabling an account invalidates an open cookie session, not just the next login", async () => {
  const s = await startTestServer();
  const { michal } = seed(s);
  const { makeCookie } = await import("../../src/http/auth.ts");
  const { setDisabled } = await import("../../src/core/actors.ts");
  const cookie = makeCookie(s.ctx, s.config, michal.id, 3600, false).split(";")[0];
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 200);
  setDisabled(s.ctx, michal.id, true);
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 401);
  await s.close();
});

test("invalid percent-encoding in a path returns 404 rather than 500", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const r = await fetch(s.url + "/api/files/%zz/info", { headers: bearer(tokenA) });
  assert.equal(r.status, 404);
  await s.close();
});

test("a missing thread and an inaccessible thread return the same response", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, privateChannelId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${privateChannelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "tajne" }),
  })).json()).message;
  const noAccess = await fetch(`${s.url}/api/messages/${m.id}/thread`, {
    headers: bearer(tokenB),
  });
  const missing = await fetch(`${s.url}/api/messages/999999/thread`, {
    headers: bearer(tokenB),
  });
  assert.equal(noAccess.status, 404);
  assert.equal(missing.status, 404);
  await s.close();
});

test("kind=ask smuggled through POST /messages does not create an orphan question", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  const r = await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ body: "podstepne pytanie?", kind: "ask" }),
  })).json();
  assert.equal(r.message.kind, "text", "kind ask must only go through /ask");
  const n = s.ctx.db.prepare("SELECT count(*) AS n FROM questions").get() as { n: number };
  assert.equal(n.n, 0);
  await s.close();
});

test("someone cannot be forcibly added to a public channel", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${channelId}/members`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ handle: "bob" }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "public_channel_open");
  await s.close();
});

test("editing a message updates the search index", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "pierwotna fraza" }),
  })).json()).message;
  await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "PATCH", headers: bearer(tokenA), body: JSON.stringify({ body: "zmieniona tresc" }),
  });
  const originalResults = await (await fetch(s.url + "/api/search?q=pierwotna", {
    headers: bearer(tokenA),
  })).json();
  const updatedResults = await (await fetch(s.url + "/api/search?q=zmieniona", {
    headers: bearer(tokenA),
  })).json();
  assert.equal(originalResults.messages.length, 0, "the old body must not be searchable");
  assert.equal(updatedResults.messages.length, 1);
  await s.close();
});

test("API lease: 200 on acquisition, 409 with the owner on refusal", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  const ok = await fetch(s.url + "/api/leases", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ resource: "deploy", ttlSec: 120, note: "wdrazam" }),
  });
  assert.equal(ok.status, 200);
  const denied = await fetch(s.url + "/api/leases", {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ resource: "deploy" }),
  });
  assert.equal(denied.status, 409);
  const body = await denied.json();
  assert.equal(body.heldBy.handle, "ala");
  await s.close();
});

test("API file upload, download by a member, refusal for an outsider", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const up = await fetch(`${s.url}/api/conversations/${dmId}/files`, {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization,
      "content-type": "text/plain", "x-file-name": "raport.txt" },
    body: "tresc raportu",
  });
  assert.equal(up.status, 201);
  const fileId = (await up.json()).file.id;
  const got = await fetch(`${s.url}/api/files/${fileId}`, { headers: bearer(tokenB) });
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "tresc raportu");
  const outsider = createActor(s.ctx, { kind: "agent", handle: "obcy" });
  const outsiderToken = mintToken(s.ctx, outsider.id, "t").token;
  const denied = await fetch(`${s.url}/api/files/${fileId}`, {
    headers: bearer(outsiderToken),
  });
  assert.equal(denied.status, 404);
  await s.close();
});

/**
 * The file name arrives in a header, so it MUST be %-encoded (HTTP headers do not carry
 * accented characters). Bad encoding is not an exotic case: every client that assembles the
 * header by hand rather than through encodeURIComponent does it - and "report 50%.txt" is
 * enough to make decodeURIComponent throw. Without this test a 400 with a readable message
 * could quietly become a 500.
 */
test("X-File-Name with invalid percent-encoding returns 400 with instructions rather than 500", async () => {
  const s = await startTestServer();
  try {
  const { tokenA, dmId } = seed(s);
  const send = (name: string) => fetch(`${s.url}/api/conversations/${dmId}/files`, {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization,
      "content-type": "text/plain", "x-file-name": name },
    body: "tresc",
  });

  const invalid = await send("raport 50%.txt");
  assert.equal(invalid.status, 400, "incomplete percent-encoding must return a request error rather than a server failure");
  const error = await invalid.json();
  assert.equal(error.code, "invalid_name");
  assert.match(error.error, /encodeURIComponent/, "the message must say WHAT to do");

  // The same name, correctly encoded, goes through and comes back in its original form - that
  // is, the rejection is about the encoding, not about the percent sign itself.
  const valid = await send(encodeURIComponent("raport 50%.txt"));
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).file.name, "raport 50%.txt");
  } finally { await s.close(); }
});

test("a file with an active MIME type (text/html) is served inertly to prevent stored XSS", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const up = await fetch(`${s.url}/api/conversations/${dmId}/files`, {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization,
      "content-type": "text/html", "x-file-name": "atak.html" },
    body: "<script>document.title='xss'</script>",
  });
  assert.equal(up.status, 201);
  const fileId = (await up.json()).file.id;
  const got = await fetch(`${s.url}/api/files/${fileId}`, { headers: bearer(tokenB) });
  assert.equal(got.status, 200);
  // neutralized type, forced download, no sniffing, sandbox
  assert.equal(got.headers.get("content-type"), "application/octet-stream");
  assert.match(got.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.match(got.headers.get("content-security-policy") ?? "", /sandbox/);
  await s.close();
});

test("wake: registration returns the secret once; GET shows configuration without the secret", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const put = await (await fetch(s.url + "/api/wake", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ target: "https://most.example/wake" }),
  })).json();
  assert.ok(put.secret.length > 20);
  const got = await (await fetch(s.url + "/api/wake", { headers: bearer(tokenA) })).json();
  assert.equal(got.wake.target, "https://most.example/wake");
  assert.equal(got.wake.secret, undefined, "the secret must not be readable afterward");
  await s.close();
});

test("the message response carries an actor map with kind to enforce human identity", async () => {
  const s = await startTestServer();
  const { tokenA, michal, channelId } = seed(s);
  await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "od agenta" }),
  });
  const r = await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    headers: bearer(tokenA),
  })).json();
  const authorId = r.messages.at(-1).actorId;
  assert.ok(r.actors[authorId], "actor map missing from the response");
  assert.equal(r.actors[authorId].kind, "agent");
  void michal;
  await s.close();
});

test("health performs a real database probe with counts, not just ok", async () => {
  const s = await startTestServer();
  seed(s);
  const h = await (await fetch(s.url + "/api/health")).json();
  assert.equal(h.ok, true);
  assert.equal(typeof h.actors, "number");
  assert.ok(h.actors >= 3, "health did not read the actual actor count");
  assert.equal(typeof h.lastMessageId, "number");
  await s.close();
});

test("clientMsgId through the API: a repeated POST returns the same id without a second message", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  const body = JSON.stringify({ body: "deploy prod", clientMsgId: "req-42" });
  const m1 = (await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body,
  })).json()).message;
  const m2 = (await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body,
  })).json()).message;
  assert.equal(m1.id, m2.id);
  const list = await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    headers: bearer(tokenA),
  })).json();
  assert.equal(list.messages.filter((m: any) => m.body === "deploy prod").length, 1);
  await s.close();
});

test("the first connection serves guidelines with a prompt; the second does not", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const me1 = await (await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).json();
  assert.ok(me1.guidelines, "the first /api/me did not return guidelines");
  assert.match(me1.guidelines.prompt, /read them before/i);
  assert.match(me1.guidelines.text, /AgentTalks/);
  const me2 = await (await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).json();
  assert.equal(me2.guidelines, undefined, "guidelines returned a second time");
  await s.close();
});

test("GET /api/guidelines returns the guidelines text on request", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const r = await (await fetch(s.url + "/api/guidelines", { headers: bearer(tokenA) })).json();
  assert.match(r.text, /how to find your way here|AgentTalks/);
  await s.close();
});

test("enroll: an invite creates an actor and the token works; an invalid code returns 403", async () => {
  const s = await startTestServer();
  const { createInvite } = await import("../../src/core/invites.ts");
  const { code } = createInvite(s.ctx, { createdBy: null, uses: 2 });
  const r = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    // kind:"human" in the body MUST be ignored - enroll creates an agent only.
    body: JSON.stringify({ invite: code, handle: "swiezak", kind: "human" }),
  });
  assert.equal(r.status, 201);
  const { token, actor } = await r.json();
  assert.equal(actor.handle, "swiezak");
  assert.equal(actor.kind, "agent");
  const me = await fetch(s.url + "/api/me", { headers: bearer(token) });
  assert.equal(me.status, 200);
  const bad = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite: "ati_zle", handle: "ktos" }),
  });
  assert.equal(bad.status, 403);
  await s.close();
});

test("wiki through the API: save, read, search, history, revert", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const put = await fetch(s.url + "/api/wiki/projekt", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Projekt", body: "wersja jeden z frazą kanarek" }),
  });
  // The wiki is saved with PUT; there is no POST on that address. There used to be an assertion
  // here admitting 404, 405 OR 200 - that is, a condition that could not be broken, with a
  // comment saying "fix this". A test that cannot fail protects nothing; this one checks a
  // specific response.
  assert.equal(put.status, 404);
  assert.equal((await put.json()).code, "not_found");
  const put2 = await fetch(s.url + "/api/wiki/projekt", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Projekt", body: "wersja jeden z frazą kanarek" }),
  });
  assert.equal(put2.status, 200);
  const read = await (await fetch(s.url + "/api/wiki/projekt", { headers: bearer(tokenA) })).json();
  assert.equal(read.page.title, "Projekt");
  const found = await (await fetch(s.url + "/api/wiki/search?q=kanarek", { headers: bearer(tokenA) })).json();
  assert.equal(found.hits.length, 1);
  assert.equal(found.hits[0].slug, "projekt");
  await fetch(s.url + "/api/wiki/projekt", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Projekt", body: "zepsute" }),
  });
  const hist = await (await fetch(s.url + "/api/wiki/projekt/history", { headers: bearer(tokenA) })).json();
  assert.equal(hist.revisions.length, 2);
  const firstRev = hist.revisions.at(-1).id;
  const rev = await fetch(s.url + "/api/wiki/projekt/revert", {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ revisionId: firstRev }),
  });
  assert.equal(rev.status, 200);
  const after = await (await fetch(s.url + "/api/wiki/projekt", { headers: bearer(tokenA) })).json();
  assert.match(after.page.body, /kanarek/);
  await s.close();
});

test("wiki: a page is shared; another actor can also edit it after reading", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/wspolna", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "W", body: "od ali" }),
  });
  // Bob reads first (a GET means "I have seen it"), then writes - and that goes through.
  await fetch(s.url + "/api/wiki/wspolna", { headers: bearer(tokenB) });
  const r = await fetch(s.url + "/api/wiki/wspolna", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "W", body: "od boba" }),
  });
  assert.equal(r.status, 200);
  const read = await (await fetch(s.url + "/api/wiki/wspolna", { headers: bearer(tokenB) })).json();
  assert.equal(read.page.body, "od boba");
  await s.close();
});

test("wiki: a blind write to another actor's page returns 409 with the revision number; after reading it returns 200", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/korzen", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Ala ma strone", body: "tresc ali" }),
  });
  // Bob has never seen this page - a PUT would silently overwrite somebody else's work.
  const blind = await fetch(s.url + "/api/wiki/korzen", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Bob ma strone", body: "tresc boba" }),
  });
  assert.equal(blind.status, 409);
  const err = await blind.json();
  assert.equal(err.code, "wiki_conflict");
  // The error has to lead to the content that would be lost: the revision id and the author.
  const page = await (await fetch(s.url + "/api/wiki/korzen", { headers: bearer(tokenB) })).json();
  assert.ok(page.page.lastRevisionId > 0);
  assert.match(err.error, new RegExp(String(page.page.lastRevisionId)));
  assert.match(err.error, /ala/);
  // Ala's content stands untouched.
  assert.equal(page.page.body, "tresc ali");
  // After reading it (the GET above) the same write goes through.
  const after = await fetch(s.url + "/api/wiki/korzen", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Bob ma strone", body: "tresc boba" }),
  });
  assert.equal(after.status, 200);
  await s.close();
});

test("wiki: baseRevision - matching passes, mismatched returns 409, 0 means create only", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Plan", body: "v1" }),
  });
  const p1 = await (await fetch(s.url + "/api/wiki/plan", { headers: bearer(tokenA) })).json();
  const rev1 = p1.page.lastRevisionId;
  // A write based on the revision we saw - goes through.
  const ok = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Plan", body: "v2", baseRevision: rev1 }),
  });
  assert.equal(ok.status, 200);
  // Bob reads (he is "up to date"), Ala writes, Bob saves on the old basis.
  const p2 = await (await fetch(s.url + "/api/wiki/plan", { headers: bearer(tokenB) })).json();
  await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Plan", body: "v3" }),
  });
  const stale = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenB),
    body: JSON.stringify({ title: "Plan", body: "moje", baseRevision: p2.page.lastRevisionId }),
  });
  assert.equal(stale.status, 409);
  // force = deliberate overwrite, accepted despite a revision mismatch
  const forced = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenB),
    body: JSON.stringify({ title: "Plan", body: "moje", force: true }),
  });
  assert.equal(forced.status, 200);
  // baseRevision=0 means "create it if it does not exist" - on an existing page, a 409
  const createOnly = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Plan", body: "x", baseRevision: 0 }),
  });
  assert.equal(createOnly.status, 409);
  // ...and on a new slug it goes through
  const fresh = await fetch(s.url + "/api/wiki/zupelnie-nowa", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Nowa", body: "x", baseRevision: 0 }),
  });
  assert.equal(fresh.status, 200);
  await s.close();
});

test("wiki attach: an attached file can be downloaded by another authenticated actor", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/dokumenty", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Dok", body: "x" }),
  });
  const up = await fetch(s.url + "/api/wiki/dokumenty/files", {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization, "content-type": "text/plain",
      "x-file-name": "notatka.txt" },
    body: "publiczna notatka",
  });
  assert.equal(up.status, 201);
  const fileId = (await up.json()).file.id;
  const got = await fetch(s.url + "/api/files/" + fileId, { headers: bearer(tokenB) });
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "publiczna notatka");
  await s.close();
});

test("wiki: a single revision preview returns the full body; another page's or a missing revision returns 404", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  await fetch(s.url + "/api/wiki/notatki", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "N", body: "wersja pierwsza" }),
  });
  await fetch(s.url + "/api/wiki/notatki", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "N", body: "wersja druga" }),
  });
  const hist = await (await fetch(s.url + "/api/wiki/notatki/history", { headers: bearer(tokenA) })).json();
  const firstId = hist.revisions.at(-1).id;
  const rev = await (await fetch(`${s.url}/api/wiki/notatki/revisions/${firstId}`, { headers: bearer(tokenA) })).json();
  assert.equal(rev.revision.body, "wersja pierwsza");
  assert.equal(rev.revision.actor, "ala");
  // a revision of another page under this slug -> 404 (ids are global)
  await fetch(s.url + "/api/wiki/inna", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "I", body: "x" }),
  });
  const otherHistory = await (await fetch(s.url + "/api/wiki/inna/history", { headers: bearer(tokenA) })).json();
  const foreignRevision = otherHistory.revisions[0].id;
  const bad = await fetch(`${s.url}/api/wiki/notatki/revisions/${foreignRevision}`, { headers: bearer(tokenA) });
  assert.equal(bad.status, 404);
  await s.close();
});

// --- admin panel -----------------------------------------------------------

test("admin panel: a human admin can enter; an agent cannot, even as admin", async () => {
  const s = await startTestServer();
  const { ala, tokenA } = seed(s);
  // an agent without admin
  const r1 = await fetch(s.url + "/api/admin/actors", { headers: bearer(tokenA) });
  assert.equal(r1.status, 403);
  // an agent WITH admin - still no: the panel is for a human
  s.ctx.db.prepare("UPDATE actors SET is_admin = 1 WHERE id = ?").run(ala.id);
  const r2 = await fetch(s.url + "/api/admin/actors", { headers: bearer(tokenA) });
  assert.equal(r2.status, 403);
  // a human admin through a cookie: 200 + actors with tokens and invites
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const r3 = await fetch(s.url + "/api/admin/actors", { headers: { cookie } });
  assert.equal(r3.status, 200);
  const data = await r3.json();
  assert.ok(Array.isArray(data.actors) && data.actors.length >= 3);
  const alaRow = data.actors.find((a: { handle: string }) => a.handle === "ala");
  assert.ok(alaRow.tokens.length >= 1, "tokens missing from the admin response");
  await s.close();
});

test("admin panel: a UI invite works for enrollment and stops working when revoked", async () => {
  const s = await startTestServer();
  seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const csrf = (await login.json()).csrf as string;
  const created = await (await fetch(s.url + "/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-at-csrf": csrf },
    body: JSON.stringify({ note: "test-ui", uses: 1 }),
  })).json();
  assert.match(created.code, /^ati_/);
  // enroll with the code from the panel
  const enr = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite: created.code, handle: "nowy-agent" }),
  });
  assert.equal(enr.status, 201);
  // the second invite: one revoked before use does not work
  const c2 = await (await fetch(s.url + "/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-at-csrf": csrf },
    body: JSON.stringify({ uses: 1 }),
  })).json();
  const rev = await fetch(s.url + `/api/admin/invites/${c2.invite.id}`, {
    method: "DELETE", headers: { cookie, "x-at-csrf": csrf },
  });
  assert.equal(rev.status, 200);
  const enr2 = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite: c2.code, handle: "spozniony" }),
  });
  assert.equal(enr2.status, 403);
  await s.close();
});

test("admin panel: disabling an account disables its token; enabling restores it", async () => {
  const s = await startTestServer();
  const { ala, tokenA } = seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const csrf = (await login.json()).csrf as string;
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 200);
  await fetch(s.url + `/api/admin/actors/${ala.id}/disable`, {
    method: "POST", headers: { cookie, "x-at-csrf": csrf },
  });
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 401);
  await fetch(s.url + `/api/admin/actors/${ala.id}/enable`, {
    method: "POST", headers: { cookie, "x-at-csrf": csrf },
  });
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 200);
  await s.close();
});

// --- notification center ----------------------------------------------------

test("notifications: mentions, DMs and reactions reach the center; marking read clears the counter", async () => {
  const s = await startTestServer();
  const { ala, tokenA, tokenB } = seed(s);
  const conv = await (await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ kind: "public", slug: "ogloszenia" }),
  })).json();
  const convId = conv.conversation.id;
  await fetch(`${s.url}/api/conversations/${convId}/join`, { method: "POST", headers: bearer(tokenB), body: "{}" });

  // 1. A mention on a channel - a notification for the person called, not for the author.
  await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "@bob zerknij na deploy" }),
  });
  let mine = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(mine.unread, 1);
  assert.equal(mine.notifications[0].kind, "mention");
  assert.equal(mine.notifications[0].from, "ala");
  assert.equal(mine.notifications[0].conversationId, convId);
  assert.match(mine.notifications[0].excerpt, /deploy/);
  const author = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenA) })).json();
  assert.equal(author.unread, 0, "an author's own mention is not an event for that author");

  // 2. A DM: every message counts, not only a mention by name.
  const dm = await (await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ kind: "dm", members: ["@bob"] }),
  })).json();
  await fetch(`${s.url}/api/conversations/${dm.conversation.id}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "na priv" }),
  });
  mine = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(mine.unread, 2);
  assert.equal(mine.notifications[0].kind, "dm");

  // 3. A reaction to SOMEBODY ELSE'S post notifies its author; removing a reaction does not.
  const post = await (await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ body: "gotowe" }),
  })).json();
  const msgId = post.message.id;
  await fetch(`${s.url}/api/messages/${msgId}/reactions`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ emoji: "🎉" }),
  });
  let bobNotifications = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(bobNotifications.notifications[0].kind, "reaction");
  const afterReaction = bobNotifications.unread;
  await fetch(`${s.url}/api/messages/${msgId}/reactions`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ emoji: "🎉" }),
  });
  bobNotifications = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(bobNotifications.unread, afterReaction, "removing a reaction is not a new notification");

  // 4. Mark everything read + the counter in /api/me.
  const read = await (await fetch(s.url + "/api/notifications/read", {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({}),
  })).json();
  assert.equal(read.unread, 0);
  assert.equal(read.changed, afterReaction);
  const me = await (await fetch(s.url + "/api/me", { headers: bearer(tokenB) })).json();
  assert.equal(me.notifications.unread, 0);
  assert.ok(ala);
  await s.close();
});

test("wiki notifications: a page change notifies those who have already written on it", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/wspolna-notatka", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Notatka", body: "od ali" }),
  });
  // Bob appends to the page (reads, then writes) - from now on he is a co-author.
  await fetch(s.url + "/api/wiki/wspolna-notatka", { headers: bearer(tokenB) });
  await fetch(s.url + "/api/wiki/wspolna-notatka", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Notatka", body: "od ali + boba" }),
  });
  // Ala sees a notification about a change in something she co-authored; Bob gets no
  // notification about his own edit.
  const alaNotifications = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenA) })).json();
  assert.equal(alaNotifications.notifications[0].kind, "wiki");
  assert.equal(alaNotifications.notifications[0].wikiSlug, "wspolna-notatka");
  assert.equal(alaNotifications.notifications[0].from, "bob");
  const bobNotifications = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(bobNotifications.unread, 0);

  // Ticking off a single notification by id - the unread list is empty.
  await fetch(s.url + "/api/notifications/read", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ ids: [alaNotifications.notifications[0].id] }),
  });
  const onlyNew = await (await fetch(s.url + "/api/notifications?unread=1", { headers: bearer(tokenA) })).json();
  assert.equal(onlyNew.notifications.length, 0);
  await s.close();
});

test("wiki: only the creator or an admin can delete a page; children survive", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, michal } = seed(s);
  const tokenAdmin = mintToken(s.ctx, michal.id, "admin").token;
  await fetch(s.url + "/api/wiki/dzial", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Dział", body: "korzeń" }),
  });
  await fetch(s.url + "/api/wiki/poddzial", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Poddział", body: "dziecko", parentSlug: "dzial" }),
  });
  // A stranger does not delete somebody else's page - writing together is not deleting.
  const outsider = await fetch(s.url + "/api/wiki/dzial", { method: "DELETE", headers: bearer(tokenB) });
  assert.equal(outsider.status, 403);
  assert.equal((await outsider.json()).code, "not_your_page");
  // The creator deletes; the child moves into the parent's place rather than disappearing.
  const del = await fetch(s.url + "/api/wiki/dzial", { method: "DELETE", headers: bearer(tokenA) });
  assert.equal(del.status, 200);
  const body = await del.json();
  assert.equal(body.deleted.movedChildren, 1);
  assert.equal(body.deleted.body, "korzeń", "the response carries the body being deleted");
  assert.equal((await fetch(s.url + "/api/wiki/dzial", { headers: bearer(tokenA) })).status, 404);
  const child = await (await fetch(s.url + "/api/wiki/poddzial", { headers: bearer(tokenA) })).json();
  assert.equal(child.page.parentSlug, null);
  // The instance admin deletes another actor's page.
  const adminDel = await fetch(s.url + "/api/wiki/poddzial", { method: "DELETE", headers: bearer(tokenAdmin) });
  assert.equal(adminDel.status, 200);
  await s.close();
});

test("reports: the fixer can mark fixed; only the author/admin can mark resolved", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, channelId } = seed(s);
  // Ala reports, Bob fixes.
  const report = await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "wiki nadpisuje w ciemno" }),
  })).json();
  const id = report.message.id;

  // The fixer does NOT close the report (that is a claim about the symptom, not about the code)...
  const attempt = await fetch(`${s.url}/api/messages/${id}/resolve`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ resolved: true }),
  });
  assert.equal(attempt.status, 403);

  // ...but they can say "done on my side".
  const fix = await fetch(`${s.url}/api/messages/${id}/fix`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ fixed: true }),
  });
  assert.equal(fix.status, 200);
  const afterFix = (await fix.json()).message;
  assert.ok(afterFix.fixedAt > 0);
  assert.equal(afterFix.resolvedAt, null, "fixed is NOT the same as resolved");

  // The report's author gets a notification OF ITS OWN KIND - not a "mention", because then the
  // list said "called you" and sent them looking in the channel for a call that is not there.
  // The excerpt is the report's content alone; the description of the action is added by the client.
  const notifications = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenA) })).json();
  assert.equal(notifications.notifications[0].kind, "fix");
  assert.match(notifications.notifications[0].excerpt, /wiki nadpisuje w ciemno/);

  // Confirmation stays with the author - and only then is the state complete.
  const res = await fetch(`${s.url}/api/messages/${id}/resolve`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ resolved: true }),
  });
  assert.equal(res.status, 200);
  const end = (await res.json()).message;
  assert.ok(end.resolvedAt > 0);
  assert.ok(end.fixedAt > 0, "resolving must not erase who fixed the issue");

  // Taking back "fixed" is possible (a fix can turn out to be wrong).
  const reverted = await (await fetch(`${s.url}/api/messages/${id}/fix`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ fixed: false }),
  })).json();
  assert.equal(reverted.message.fixedAt, null);
  await s.close();
});

test("a long body completes the full round trip without truncation (report [71])", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, channelId } = seed(s);
  // The marker at the VERY END: if anything along the way truncated the content, it is the
  // marker that disappears, while the length still matches "roughly" - which is worse than an
  // explicit error, because the report looks complete.
  const longText = `${"Raport z pomiarow. ".repeat(500)}ZNACZNIK-KONCA-9f3a`;
  const post = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: longText }),
  });
  assert.equal(post.status, 201);
  const list = await (await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    headers: bearer(tokenB),
  })).json();
  const readPage = list.messages.at(-1).body;
  assert.equal(readPage.length, longText.length, "the read length differs from the sent length");
  assert.equal(readPage, longText);
  assert.ok(readPage.endsWith("ZNACZNIK-KONCA-9f3a"), "the end of the body did not arrive");
  await s.close();
});

test("the length limit states HOW MUCH over the limit and is exposed in /api/me", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  const me = await (await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).json();
  assert.ok(me.limits.maxMessageBytes > 0, "the client does not know the limit and cannot show a counter");

  const tooLong = "x".repeat(me.limits.maxMessageBytes + 100);
  const r = await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: tooLong }),
  });
  assert.equal(r.status, 413);
  const err = await r.json();
  assert.equal(err.code, "message_too_long");
  // The message has to carry the number in question - "too long" without a number forces you to
  // guess how much to cut.
  assert.match(err.error, /100 B too long/);
  await s.close();
});

// --- anti-bot gate --------------------------------------------------------

test("gate: the site is closed without a cookie; the correct password allows entry and an incorrect one does not", async () => {
  const s = await startTestServer({ sitePassword: "tajne-haslo-bramki" });
  // The interface is closed...
  const closed = await fetch(s.url + "/");
  assert.equal(closed.status, 401);
  // ...but the API and onboarding are NOT, because an agent authenticates by token, and a fresh
  // agent has to fetch /install before it has any token at all.
  assert.equal((await fetch(s.url + "/api/health")).status, 200);
  assert.equal((await fetch(s.url + "/install")).status, 200);
  // ...and robots.txt says so too: a fetch tool that honours it must be allowed to read the
  // onboarding pages, while the interface stays disallowed. Allow lines come first, because
  // some parsers take the first matching rule rather than the longest one.
  const robots = await (await fetch(s.url + "/robots.txt")).text();
  const lines = robots.trim().split("\n");
  assert.equal(lines[0], "User-agent: *");
  for (const p of ["/install", "/install.md", "/skill.md", "/skill.version"]) {
    assert.ok(lines.includes(`Allow: ${p}`), `robots.txt allows ${p}`);
  }
  assert.equal(lines.at(-1), "Disallow: /");
  assert.ok(lines.indexOf("Disallow: /") > lines.indexOf("Allow: /install"));

  const invalid = await fetch(s.url + "/api/site-gate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "nie-to-haslo" }),
  });
  assert.equal(invalid.status, 401);

  const valid = await fetch(s.url + "/api/site-gate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "tajne-haslo-bramki" }),
  });
  assert.equal(valid.status, 200);
  const cookie = valid.headers.get("set-cookie")!.split(";")[0];
  // A 401 alone proves only that something is being rejected - only this checks that the gate
  // lets the owners in.
  const after = await fetch(s.url + "/", { headers: { cookie } });
  assert.equal(after.status, 200);
  await s.close();
});

test("a disabled gate with no password blocks nothing", async () => {
  const s = await startTestServer();
  assert.equal((await fetch(s.url + "/")).status, 200);
  await s.close();
});

test("login attempt limit: 429 after a series of attempts; successful login resets the counter", async () => {
  const s = await startTestServer();
  seed(s);
  const wrongPassword = () => fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "zle" }),
  });
  let saw429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await wrongPassword();
    if (r.status === 429) { saw429 = true; break; }
  }
  assert.ok(saw429, "the limiter failed; password guessing is unlimited");
  await s.close();
});

test("dead token diagnosis: 401 says to request a token for THE SAME actor", async () => {
  const s = await startTestServer();
  const { ala, tokenA } = seed(s);
  const { revokeToken, listTokens } = await import("../../src/core/tokens.ts");
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 200);

  revokeToken(s.ctx, listTokens(s.ctx, ala.id)[0].id);
  const r = await fetch(s.url + "/api/me", { headers: bearer(tokenA) });
  assert.equal(r.status, 401);
  const err = await r.json();
  assert.equal(err.code, "token_revoked");
  // Without that sentence an agent with no session memory draws the worst conclusion: "I will
  // redeem a new invite" - and the channel gains a second identity.
  assert.match(err.error, /ala/);
  assert.match(err.error, /rather than a new invite/);
  await s.close();
});

test("invalid percent-encoding in X-File-Name returns 400 with a hint rather than 500", async () => {
  const s = await startTestServer();
  const { tokenA, channelId } = seed(s);
  // "report%zz.txt" breaks decodeURIComponent (a URIError). An unhandled URIError is a 500, that
  // is, a server reporting ITS OWN failure in response to somebody else's junk - a message that
  // lies about who was at fault.
  const r = await fetch(`${s.url}/api/conversations/${channelId}/files`, {
    method: "POST",
    headers: {
      authorization: (bearer(tokenA) as unknown as { authorization: string }).authorization,
      "content-type": "text/plain",
      "x-file-name": "raport%zz.txt",
    },
    body: "cokolwiek",
  });
  assert.equal(r.status, 400);
  const err = await r.json();
  assert.equal(err.code, "invalid_name");
  assert.match(err.error, /encodeURIComponent/);

  // A correctly encoded name (with a space and accented characters) goes through.
  const ok = await fetch(`${s.url}/api/conversations/${channelId}/files`, {
    method: "POST",
    headers: {
      authorization: (bearer(tokenA) as unknown as { authorization: string }).authorization,
      "content-type": "text/plain",
      "x-file-name": encodeURIComponent("raport końcowy.txt"),
    },
    body: "tresc",
  });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).file.name, "raport końcowy.txt");
  await s.close();
});

/**
 * The fingerprint is to be a digest of the RESPONSE, not of the file on disk.
 *
 *The first version computed it from the template, BEFORE {{BASE_URL}} substitution - and
 *thereby broke the only property it exists for. Two agents reaching for the same skill through
 *different addresses received different content under THE SAME fingerprint, so the check "is
 *my copy current" answered "yes" for a copy that differs from the live one. Found by @zelda's
 *measurement on #bugs [164]: the same fingerprint, sizes 14,402 B and 14,613 B.
 */
test("the skill fingerprint hashes what the server ACTUALLY serves", async () => {
  const s = await startTestServer({ sitePassword: "haslo-bramki", trustProxy: true }); // SYNTH
  try {
    const { createHash } = await import("node:crypto");
    const summary = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);

    // PUBLIC like the skill itself: an agent has to be able to check freshness before it has a token.
    const r = await fetch(s.url + "/skill.version");
    assert.equal(r.status, 200);
    const fingerprint = (await r.text()).trim();
    assert.match(fingerprint, /^[0-9a-f]{16}$/);

    const content = await (await fetch(s.url + "/skill.md")).text();
    assert.equal(fingerprint, summary(content), "the fingerprint does not match the served skill content");

    // The same server under a DIFFERENT host name returns different content (the substituted
    // address), so it MUST return a different fingerprint too. An equal fingerprint with different
    // content is exactly the false calm this route exists to remove. The `host` header cannot be
    // set through fetch (a forbidden name), and `x-forwarded-host` comes first here anyway - it is
    // the same code path.
    const other = { "x-forwarded-host": "inna-nazwa.example" };
    const otherContent = await (await fetch(s.url + "/skill.md", { headers: other })).text();
    const otherFingerprint = (await (await fetch(s.url + "/skill.version", { headers: other })).text()).trim();
    assert.equal(otherFingerprint, summary(otherContent));
    assert.notEqual(content, otherContent, "URL substitution failed; the test checks nothing");
    assert.notEqual(fingerprint, otherFingerprint, "different content has the same fingerprint");
  } finally {
    await s.close();
  }
});

test("the skill no longer instructs users to paste a token into a file committed to the repository", async () => {
  const s = await startTestServer();
  const skill = await (await fetch(s.url + "/skill.md")).text();
  // .mcp.json exists in order to be shared through the repository - a token in it is a secret in
  // git. The instruction has to lead to a local registration.
  assert.ok(
    !/mcpServers[\s\S]{0,400}Bearer atk_/.test(skill),
    "the skill still shows a token in the MCP configuration",
  );
  assert.match(skill, /claude mcp add --scope local/);
  assert.match(skill, /\.agenttalks\.json/);
  await s.close();
});

test("the admin panel issues a token to an existing actor for rotation without SSH", async () => {
  const s = await startTestServer();
  const { ala } = seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  assert.equal(login.status, 200, `test login failed (${login.status})`);
  const auth = cookieAuth(login.headers.get("set-cookie")!);

  const r = await fetch(s.url + "/api/admin/tokens", {
    method: "POST", headers: auth, body: JSON.stringify({ actorId: ala.id, name: "rotacja" }),
  });
  assert.equal(r.status, 201);
  const { token } = await r.json();
  assert.match(token, /^atk_/);
  // The token has to really work for THAT actor - otherwise the panel only pretends to rotate.
  const me = await (await fetch(s.url + "/api/me", { headers: bearer(token) })).json();
  assert.equal(me.actor.handle, "ala");

  // The same threshold as in the console: a short TTL only deliberately.
  const shortText = await fetch(s.url + "/api/admin/tokens", {
    method: "POST", headers: auth, body: JSON.stringify({ actorId: ala.id, ttlSec: 600 }),
  });
  assert.equal(shortText.status, 400);
  assert.equal((await shortText.json()).code, "ttl_too_short");

  // An agent (even with a token) does not issue tokens - the panel is for a human.
  const agent = await fetch(s.url + "/api/admin/tokens", {
    method: "POST", headers: bearer(token), body: JSON.stringify({ actorId: ala.id }),
  });
  assert.equal(agent.status, 403);
  await s.close();
});

/**
 * Session registration accepts `doing` AND `workingOn`.
 *
 *For a long time the skill documented `workingOn` while the server read only `doing` - the
 *field simply disappeared, with no error and no trace, so a session registered itself
 *"empty". The skill is distributed by COPYING the file, so copies with the wrong name are
 *already circulating and will keep sending it even after the source is fixed. The alias is
 *for them; the canonical name stays `doing`.
 *
 *Found by running every command from the LIVE skill literally, the way a new agent will - not
 *by reading the code.
 */
test("POST /api/sessions: `doing` and `workingOn` mean the same thing; `doing` wins", async () => {
  const s = await startTestServer();
  try {
    const { tokenA } = seed(s);
    const { presence } = await import("../../src/core/presence.ts");
    const doing = () => presence(s.ctx).find((p) => p.sessionId === "s1")?.doing ?? null;

    const send = (body: Record<string, unknown>) =>
      fetch(`${s.url}/api/sessions`, {
        method: "POST", headers: bearer(tokenA),
        body: JSON.stringify({ sessionId: "s1", label: "test", ...body }),
      });

    assert.equal((await send({ workingOn: "z aliasu" })).status, 200);
    assert.equal(doing(), "z aliasu", "the field name from distributed skill copies still disappears");

    assert.equal((await send({ doing: "kanoniczne" })).status, 200);
    assert.equal(doing(), "kanoniczne");

    // Both at once: the canonical one wins, so that behaviour does not depend on the order of
    // fields in the JSON.
    assert.equal((await send({ doing: "kanoniczne", workingOn: "alias" })).status, 200);
    assert.equal(doing(), "kanoniczne");

    // A bare heartbeat (with neither field) does NOT erase what is already set.
    assert.equal((await send({})).status, 200);
    assert.equal(doing(), "kanoniczne");
  } finally {
    await s.close();
  }
});

/**
 * The table of contents and fetching one section of a wiki page.
 *
 *The reason is measured, not aesthetic: a page enters an agent's context window IN FULL, and
 *this instance's wiki has grown to ~270k characters - more than fits into one window. "Read
 *the wiki before you ask" became physically impossible, and nobody noticed, because nothing
 *broke (@milosz's question in #general [185]).
 *
 *The most important assertion is the last one: a fragment does NOT unlock writing. A read is
 *the proof of "I know what I am overwriting", and a write replaces the WHOLE content -
 *somebody who saw one section would delete the rest without knowing it.
 */
test("wiki: headings and sections; a fragment does NOT unlock writing", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, tokenB } = seed(s);
    const { savePage } = await import("../../src/core/wiki.ts");
    const author = s.ctx.db.prepare("SELECT id FROM actors LIMIT 1").get() as { id: number };
    savePage(s.ctx, {
      slug: "duza", title: "Duza", actorId: author.id,
      body: [
        "Wstep.", "", "# Wdrozenie", "krok po kroku", "", "### Krok 1", "zrob to", "",
        "```bash", "# to NIE jest naglowek, tylko komentarz w kodzie", "echo hej", "```", "",
        "## Wycofanie", "jak sie cofnac", "", "# Bezpieczenstwo", "o kluczach",
      ].join("\n"),
    });
    const get = async (q: string, token = tokenB) =>
      (await fetch(`${s.url}/api/wiki/duza${q}`, { headers: bearer(token) })).json();

    const outline = (await get("?outline=1")).outline as
      Array<{ heading: string; level: number; bytes: number }>;
    assert.deepEqual(outline.map((x) => x.heading), ["Wdrozenie", "Krok 1", "Wycofanie", "Bezpieczenstwo"],
      "a '#' comment in a code block must not become a page heading");
    assert.ok(outline[0].bytes > outline[3].bytes, "section sizes must make sense: parent > leaves");

    const section = (await get("?section=Wdrozenie")).section as { body: string };
    assert.match(section.body, /### Krok 1/, "a section must contain its subsections");
    assert.doesNotMatch(section.body, /Bezpieczenstwo/, "a section must not extend beyond the next heading");

    // Matched by the heading text, case-insensitively - an agent quotes what it saw in the outline.
    assert.ok(((await get("?section=wdrozenie")).section as { body: string }).body.length > 0);

    const missing = await (await fetch(`${s.url}/api/wiki/duza?section=Nie%20ma`, { headers: bearer(tokenB) }));
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /outline=1/, "the error must say where to find section names");

    // The crux: after an outline and a fragment, a write MUST bounce off the overwrite protection.
    const saved = await fetch(`${s.url}/api/wiki/duza`, {
      method: "PUT", headers: bearer(tokenB),
      body: JSON.stringify({ title: "Duza", body: "tylko moj akapit" }),
    });
    assert.equal(saved.status, 409, "a fragment unlocked writing; this silently deletes the rest of the page");

    // And a full read unlocks it, because then the author knows what they are overwriting.
    await get("");
    const afterFullRead = await fetch(`${s.url}/api/wiki/duza`, {
      method: "PUT", headers: bearer(tokenB),
      body: JSON.stringify({ title: "Duza", body: "tylko moj akapit" }),
    });
    assert.equal(afterFullRead.status, 200);
    assert.ok(tokenA);
  } finally {
    await s.close();
  }
});

/**
 * The summary in the INDEX, not on the page.
 *
 *@zelda's measurement (#general [193]) refuted "two sentences at the top of the page", and did
 *it precisely: an agent that fetches a page to read its beginning ALREADY HAS the whole page
 *in its window - the decision comes AFTER paying. A human can stop reading, an agent cannot
 *stop HAVING. What works is a list in which every page carries a sentence: then the choice
 *costs one request instead of forty pages.
 */
test("the wiki list provides a summary of each page without fetching their bodies", async () => {
  const s = await startTestServer();
  try {
    const { tokenA } = seed(s);
    const { savePage } = await import("../../src/core/wiki.ts");
    const author = s.ctx.db.prepare("SELECT id FROM actors LIMIT 1").get() as { id: number };
    savePage(s.ctx, {
      slug: "duza", title: "Duza", actorId: author.id,
      // The content deliberately has the SHAPE of this wiki's real pages: a bold start of a paragraph
      // and wrapping. The first version of the test had one bare paragraph and therefore did not
      // catch a bug that only showed up in production - "**Conclusion:**" was taken for a list item,
      // so the summary started in the middle of a sentence.
      body: [
        "# Naglowek, ktory NIE jest streszczeniem", "", "- punkt listy tez nie", "",
        "**To zdanie mowi, czym jest ta strona i ono ma trafic",
        "do indeksu w calosci.**",
        "", "x".repeat(50_000),
      ].join("\n"),
    });

    const list = await (await fetch(`${s.url}/api/wiki`, { headers: bearer(tokenA) })).json();
    const page = (list.pages as Array<{ slug: string; summary?: string; bytes: number }>)
      .find((p) => p.slug === "duza")!;

    assert.equal(
      page.summary,
      "To zdanie mowi, czym jest ta strona i ono ma trafic do indeksu w calosci.",
      "the summary must join a wrapped paragraph without treating bold text as a list",
    );
    assert.ok(page.bytes > 50_000, "the size must still be provided to show the cost of reading the page");

    // The crux of the saving: the index must NOT carry content. If it did, it would solve one
    // problem by creating the same one.
    const responseSize = JSON.stringify(list).length;
    assert.ok(
      responseSize < 5_000,
      `the index is ${responseSize} characters for a 50 kB page; it includes the body`,
    );
  } finally {
    await s.close();
  }
});

/**
 * Avatars: a picture instead of two letters on a coloured dot (@michal's request,
 * #general [192]).
 * 
 * The most important assertion is about SVG. The server recognises the format by CONTENT, not
 * by the header - the header is written by the client, so "content-type: image/png" with
 * arbitrary bytes means nothing. An SVG is a document with a script rather than a picture:
 * served from our domain it would be an XSS vector in the very place the session cookie lives.
 * Hence a whitelist of raster formats, not "image/*".
 */
test("avatar: bytes rather than a URL, format detected from content, SVG rejected", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, tokenB } = seed(s);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7),
    ]);
    const send = (data: Buffer, ct = "image/png") =>
      fetch(`${s.url}/api/me/avatar`, {
        method: "PUT",
        headers: { ...bearer(tokenA), "content-type": ct },
        body: new Uint8Array(data),
      });

    const ok = await send(png);
    assert.equal(ok.status, 200);
    const { url } = await ok.json() as { url: string };
    assert.match(url, /^\/api\/actors\/\d+\/avatar\?v=[0-9a-f]{16}$/,
      "the URL must carry a content fingerprint or avatar changes will not be visible");

    // Everybody signed in sees it, which is the point.
    const image = await fetch(s.url + url, { headers: bearer(tokenB) });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(image.headers.get("x-content-type-options"), "nosniff");

    // An SVG with a header pretending to be a PNG: the content is what counts.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const invalid = await send(svg, "image/png");
    assert.equal(invalid.status, 400, "SVG was accepted as an avatar; this allows XSS on our origin");
    assert.equal((await invalid.json()).code, "invalid_format");

    // The fingerprint changes with the content, so the browser will not show the old one.
    const second = await (await send(Buffer.concat([png, Buffer.alloc(8, 9)]))).json() as { url: string };
    assert.notEqual(second.url, url);

    // The actor directory carries the fingerprint, so the client can assemble the URL.
    const list = await (await fetch(`${s.url}/api/actors`, { headers: bearer(tokenB) })).json();
    const self = (list.actors as Array<{ handle: string; avatar: string | null }>)
      .find((a) => a.avatar !== null);
    assert.ok(self, "the actor directory does not indicate who has an avatar");

    // Removing it goes back to the dot with initials.
    const remove = await fetch(`${s.url}/api/me/avatar`, { method: "DELETE", headers: bearer(tokenA) });
    assert.equal(remove.status, 200);
    assert.equal((await fetch(s.url + url, { headers: bearer(tokenB) })).status, 404);
  } finally {
    await s.close();
  }
});

/**
 * Who is writing - visible where an agent MAKES ITS DECISION, not only in the roster.
 *
 *@michal's request (#general [226]): "make it so that the api shows who is writing, maybe that
 *will unblock the conversations". The signal existed, but only in the presence list - you had
 *to ask for it separately and know that it was worth it. An agent reading new messages and
 *getting ready to answer did not ask for the roster, so it had no way of learning that
 *somebody is already answering.
 */
test("/api/me shows who is typing without requesting the presence list", async () => {
  const s = await startTestServer();
  try {
    // seed() returns the actors directly - the first version of this test took "the last one by
    // id" and hit @michal instead of @bob, so the assertion about seeing yourself was checking
    // somebody else.
    const { tokenA, tokenB, bob } = seed(s);
    const { registerSession, signal } = await import("../../src/core/presence.ts");

    const myStatus = async (token: string) =>
      (await (await fetch(`${s.url}/api/me`, { headers: bearer(token) })).json()) as
        { typing: Array<{ handle: string; in: string | null }> };

    assert.deepEqual((await myStatus(tokenA)).typing, [], "nobody is typing; the list must be empty");

    registerSession(s.ctx, { sessionId: "sB", actorId: bob.id, kind: "durable" });
    signal(s.ctx, "sB", "typing", { typingIn: "c:1", sec: 60 });

    const seen = (await myStatus(tokenA)).typing;
    assert.equal(seen.length, 1);
    assert.equal(seen[0].in, "c:1", "location missing; WHERE someone is typing is unknown");

    // Your own writing is not information for yourself.
    assert.deepEqual((await myStatus(tokenB)).typing, [], "I see myself as typing");
  } finally {
    await s.close();
  }
});

/**
 * Deleting a wiki page takes its history WITH IT - and that is intended.
 *
 *The test exists because the skill promised "nothing is ever lost - every write is a
 *revision", which was true for WRITES and untrue for deletion: the foreign key
 *`wiki_revisions.page_id` has ON DELETE CASCADE. The cascade is right (you delete a page so
 *that its content stops existing), so I fixed the SENTENCE, not the behaviour - and this
 *keeps the sentence and the behaviour in agreement.
 *
 *The class was found by applying @flowstate's question from #general [274] to my own system:
 *"does this guarantee come from construction or from convention". Here the other way round
 *than for him - the construction said something different from the promise.
 */
test("deleting a wiki page also deletes its revisions and moves its children to its parent", async () => {
  const s = await startTestServer();
  try {
    const { tokenA } = seed(s);
    const { savePage, pageId, pageHistory, getPage } = await import("../../src/core/wiki.ts");
    const author = s.ctx.db.prepare("SELECT id FROM actors LIMIT 1").get() as { id: number };

    savePage(s.ctx, { slug: "rodzic", title: "Rodzic", body: "wersja 1", actorId: author.id });
    savePage(s.ctx, { slug: "rodzic", title: "Rodzic", body: "wersja 2", actorId: author.id, force: true });
    savePage(s.ctx, { slug: "dziecko", title: "Dziecko", body: "tresc", actorId: author.id, parentSlug: "rodzic" });
    const id = pageId(s.ctx, "rodzic")!;
    assert.equal(pageHistory(s.ctx, "rodzic").length, 2, "every save must leave a revision");

    const res = await fetch(`${s.url}/api/wiki/rodzic`, { method: "DELETE", headers: bearer(tokenA) });
    assert.equal(res.status, 200);
    // The response carries the content back - that is the only route out of a mistake.
    assert.match(JSON.stringify(await res.json()), /wersja 2/, "deletion does not return the body for undo");

    assert.equal(getPage(s.ctx, "rodzic"), null);
    const remaining = s.ctx.db.prepare("SELECT COUNT(*) n FROM wiki_revisions WHERE page_id = ?")
      .get(id) as { n: number };
    assert.equal(remaining.n, 0, "history survived deletion; the skill promises the content disappears");

    // The child STAYS, it only moves up: deleting a folder must not delete somebody else's pages
    // created under it.
    assert.ok(getPage(s.ctx, "dziecko"), "the child disappeared with its parent");
    assert.equal(getPage(s.ctx, "dziecko")!.parentSlug, null);
  } finally {
    await s.close();
  }
});

/**
 * A multipart envelope on a raw-bytes route: an error, not silent corruption.
 *
 *The case is NOT invented - it comes from @milosz's report (#general [310]): "the route is
 *PUT /api/me/avatar, but not multipart and not JSON - raw bytes. Multipart returns 'this is
 *not an image in a supported format', which sounds like a bad file and is a bad wrapper. It
 *took me three attempts."
 *
 *While checking it, it turned out that with FILES it was worse than reported: the envelope
 *went through with a 201 and was stored AS THE FILE'S CONTENT (160 B instead of 48). No error,
 *no warning - the downloadable file was corrupt. Silent corruption is worse than a readable
 *refusal, so both routes now refuse alike, and the message speaks about the WRAPPER, not the file.
 */
test("multipart on a raw-byte route: a clear refusal instead of a saved envelope", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, dmId } = seed(s);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7),
    ]);
    const B = "----granica";
    const envelope = Buffer.concat([
      Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`),
      png, Buffer.from(`\r\n--${B}--\r\n`),
    ]);
    const send = (url: string, ct: string, extra: Record<string, string> = {}, method = "POST") =>
      fetch(url, {
        method: method,
        headers: { authorization: (bearer(tokenA) as { authorization: string }).authorization,
                   "content-type": ct, ...extra },
        body: new Uint8Array(envelope),
      });

    for (const [description, res] of [
      ["awatar", await send(`${s.url}/api/me/avatar`, `multipart/form-data; boundary=${B}`, {}, "PUT")],
      ["plik", await send(`${s.url}/api/conversations/${dmId}/files`,
        `multipart/form-data; boundary=${B}`, { "x-file-name": "a.png" })],
    ] as Array<[string, Response]>) {
      assert.equal(res.status, 400, `${description}: the multipart envelope was not rejected`);
      const b = await res.json() as { code: string; error: string };
      assert.equal(b.code, "multipart_unsupported");
      // The message has to lead to the goal, not merely refuse: the body's shape AND an example in
      // more than one tool (the report came from somebody using Python, while the first version spoke
      // only about curl).
      assert.match(b.error, /RAW FILE BYTES/, `${description}: the message does not say WHAT to send instead`);
      assert.match(b.error, /curl:/, `${description}: curl example missing`);
      assert.match(b.error, /python:/, `${description}: example provided for only one tool`);
    }

    // Recognition by CONTENT, not by the header - the header is written by the client.
    const withoutHeader = await send(`${s.url}/api/me/avatar`, "image/png", {}, "PUT");
    assert.equal(withoutHeader.status, 400, "an envelope disguised as image/png was accepted");
    assert.equal((await withoutHeader.json() as { code: string }).code, "multipart_unsupported");

    // Real raw bytes still work; the refusal concerns the ENVELOPE.
    const ok = await fetch(`${s.url}/api/me/avatar`, {
      method: "PUT",
      headers: { authorization: (bearer(tokenA) as { authorization: string }).authorization,
                 "content-type": "image/png" },
      body: new Uint8Array(png),
    });
    assert.equal(ok.status, 200);
  } finally {
    await s.close();
  }
});

/**
 * `actorHandle` directly in the message - because the `actors` map has STRING keys.
 *
 *Measured by @zelda (#bugs [386]): JSON has no numeric object keys, so `actors` arrives with
 *the keys "3", "7", while `actorId` is a number. In Python `actors[msg["actorId"]]` silently
 *returns None despite a correct field name and a correct idea; in JS it works by accident (key
 *coercion), so from the side the server was written on, the bug IS INVISIBLE.
 *
 *It previously cost @milosz the misattribution of somebody else's work - harm, not
 *inconvenience. No documentation removes this, because it is a difference between JSON and a
 *language's types.
 */
test("messages carry actorHandle, not just actorId for a map with string keys", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, ala, channelId } = seed(s);
    const { postMessage } = await import("../../src/core/messages.ts");
    postMessage(s.ctx, { conversationId: channelId, actorId: ala.id, body: "czesc" });

    for (const url of [
      `/api/conversations/${channelId}/messages`,
      `/api/search?q=czesc`,
    ]) {
      const d = await (await fetch(s.url + url, { headers: bearer(tokenA) })).json() as
        { messages: Array<{ actorId: number; actorHandle?: string }>; actors: Record<string, unknown> };
      const m = d.messages.find((x) => x.actorId === ala.id)!;
      assert.equal(m.actorHandle, "ala", `${url}: actorHandle missing from the message`);

      // Proof that the trap is REAL rather than theoretical: the map's keys are strings.
      assert.ok(Object.keys(d.actors).every((k) => typeof k === "string"));
      assert.equal((d.actors as Record<number, unknown>)[ala.id as number] !== undefined, true,
        "JS key coercion works; that is why the bug was invisible here");
      // The map stays: it carries displayName and kind, which we do not repeat.
      assert.ok(JSON.stringify(d.actors).includes("displayName"));

      // TWO SOURCES OF THE SAME TRUTH have to agree. @motowolt's warning (#bugs [394]): adding a
      // field while keeping the map is the moment when drift becomes easy - "if a cache ever appears
      // here, this is the place where it will crack". Today both come from the same read, so drift is
      // impossible; this assertion keeps it that way.
      for (const w of d.messages) {
        const fromMap = (d.actors as Record<string, { handle: string }>)[String(w.actorId)];
        assert.equal(w.actorHandle, fromMap?.handle,
          `${url}: actorHandle differs from the actors map for actor ${w.actorId}`);
      }
    }
  } finally {
    await s.close();
  }
});
