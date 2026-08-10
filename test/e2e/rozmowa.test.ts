/**
 * The full path through a live server: a human creates a group conversation, one agent writes,
 * the other receives it by push, and the counters tell "something new" from "concerns YOU".
 * 
 * This is a test that would have been impossible in the prototype: there were no group
 * conversations, no authentication and no push to an agent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, cookieAuth, openSse, startTestServer } from "../http-helpers.ts";
import { createActor, setPassword } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";

test("czlowiek i dwoch agentow rozmawiaja przez zywy serwer", async () => {
  const s = await startTestServer();

  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const eipa = createActor(s.ctx, { kind: "agent", handle: "eipa" });
  const tn = mintToken(s.ctx, nestor.id, "vps").token;
  const te = mintToken(s.ctx, eipa.id, "mac").token;

  // 1. The human logs in with a password and gets a cookie session.
  const login = await fetch(s.url + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  assert.equal(login.status, 200);
  const auth = cookieAuth(login.headers.get("set-cookie")!);

  // 2. Creates a conversation for three. They are a participant without naming themselves.
  const created = await fetch(s.url + "/api/conversations", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ kind: "group", members: ["nestor", "eipa"] }),
  });
  assert.equal(created.status, 201);
  const conv = (await created.json()).conversation;
  assert.equal(conv.kind, "group");

  // 3. Eipa listens over SSE, Nestor writes with a mention.
  const es = await openSse(s.url + "/api/events", te);
  const posted = await fetch(`${s.url}/api/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: bearer(tn),
    body: JSON.stringify({ body: "@eipa przejmij deploy" }),
  });
  assert.equal(posted.status, 201);

  const ev = await es.next(3000) as any;
  assert.equal(ev.type, "message");
  assert.equal(ev.message.body, "@eipa przejmij deploy");

  // 4. Eipa odpowiada w watku tej wiadomosci.
  const rootId = ev.message.id;
  await fetch(`${s.url}/api/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: bearer(te),
    body: JSON.stringify({ body: "biore", threadId: rootId }),
  });
  const thread = await (await fetch(`${s.url}/api/messages/${rootId}/thread`, {
    headers: bearer(tn),
  })).json();
  assert.equal(thread.messages.length, 2);

  // 5. Counters: in a direct conversation every message is a badge.
  const unread = await (await fetch(s.url + "/api/unread", { headers: bearer(te) })).json();
  const row = unread.rows.find((r: any) => r.conversationId === conv.id);
  assert.equal(row.badge, 1, "wzmianka w grupie ma dawac plakietke");

  // 6. The human sees the same conversation and the same content as the agents - interface parity.
  const me = await (await fetch(s.url + "/api/me", { headers: auth })).json();
  assert.ok(me.conversations.some((c: any) => c.id === conv.id));
  const widok = await (await fetch(`${s.url}/api/conversations/${conv.id}/messages`, {
    headers: auth,
  })).json();
  assert.deepEqual(widok.messages.map((m: any) => m.body),
                   ["@eipa przejmij deploy", "biore"]);

  es.close();
  await s.close();
});

test("obcy agent nie widzi cudzej rozmowy grupowej", async () => {
  const s = await startTestServer();
  const a = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const b = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const obcy = createActor(s.ctx, { kind: "agent", handle: "obcy" });
  const ta = mintToken(s.ctx, a.id, "t").token;
  const tobcy = mintToken(s.ctx, obcy.id, "t").token;
  void b;

  const conv = (await (await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(ta), body: JSON.stringify({ kind: "group", members: ["bob"] }),
  })).json()).conversation;

  await fetch(`${s.url}/api/conversations/${conv.id}/messages`, {
    method: "POST", headers: bearer(ta), body: JSON.stringify({ body: "poufne" }),
  });

  const r = await fetch(`${s.url}/api/conversations/${conv.id}/messages`, {
    headers: bearer(tobcy),
  });
  assert.equal(r.status, 403);

  const szukaj = await (await fetch(s.url + "/api/search?q=poufne", {
    headers: bearer(tobcy),
  })).json();
  assert.equal(szukaj.messages.length, 0, "wyszukiwarka nie moze byc obejsciem uprawnien");

  const inbox = await (await fetch(`${s.url}/api/messages?after=0&wait=0`, {
    headers: bearer(tobcy),
  })).json();
  assert.equal(inbox.messages.length, 0);

  await s.close();
});
