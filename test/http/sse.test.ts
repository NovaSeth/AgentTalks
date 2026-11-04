// Polish fixture message bodies exercise exact content delivery through SSE and long-poll.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, openSse, startTestServer, type TestServer } from "../http-helpers.ts";
import { waitFor } from "../helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, ensureDirect, join } from "../../src/core/conversations.ts";

function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const channel = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  join(s.ctx, channel.id, bob.id);
  const privateChannel = createChannel(s.ctx, { slug: "tajne", kind: "private", createdBy: ala.id });
  const dm = ensureDirect(s.ctx, [ala.id, bob.id]);
  return {
    ala, bob,
    tokenA: mintToken(s.ctx, ala.id, "t").token,
    tokenB: mintToken(s.ctx, bob.id, "t").token,
    channelId: channel.id,
    privateChannelId: privateChannel.id,
    dmId: dm.id,
  };
}

test("SSE delivers a message to a conversation member", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, channelId } = seed(s);
  const es = await openSse(s.url + "/api/events", tokenB);
  await fetch(`${s.url}/api/conversations/${channelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "push" }),
  });
  const ev = await es.next(2000) as any;
  assert.equal(ev.type, "message");
  assert.equal(ev.message.body, "push");
  es.close();
  await s.close();
});

test("SSE does not deliver from a conversation the actor has not joined", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, privateChannelId } = seed(s);
  const es = await openSse(s.url + "/api/events", tokenB);
  await fetch(`${s.url}/api/conversations/${privateChannelId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "tajne" }),
  });
  await assert.rejects(() => es.next(500), /timeout/);
  es.close();
  await s.close();
});

test("SSE resumes from a cursor and delivers the backlog", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "zaleglosc" }),
  });
  const es = await openSse(s.url + "/api/events?after=0", tokenB);
  const ev = await es.next(2000) as any;
  assert.equal(ev.message.body, "zaleglosc");
  es.close();
  await s.close();
});

test("a disconnected SSE client releases its subscription", async () => {
  const s = await startTestServer();
  const { bob, tokenB } = seed(s);
  const es = await openSse(s.url + "/api/events", tokenB);
  await waitFor(() => s.ctx.bus.subscriberCount(bob.id) === 1, 2000);
  es.close();
  await waitFor(() => s.ctx.bus.subscriberCount(bob.id) === 0, 3000);
  await s.close();
});

test("long-poll returns immediately when there are pending messages", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "zaleglosc" }),
  });
  const t0 = Date.now();
  const r = await (await fetch(`${s.url}/api/messages?after=0&wait=30`, {
    headers: bearer(tokenB),
  })).json();
  assert.ok(Date.now() - t0 < 1000, "long-poll waited despite pending messages");
  assert.equal(r.messages.length, 1);
  await s.close();
});

test("long-poll wakes IMMEDIATELY on a message rather than timing out", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const t0 = Date.now();
  const pending = fetch(`${s.url}/api/messages?after=0&wait=10`, { headers: bearer(tokenB) });
  await new Promise((r) => setTimeout(r, 120));
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "w trakcie" }),
  });
  const r = await (await pending).json();
  const elapsed = Date.now() - t0;
  // Broken waking would also return the message - but only after a 10 s timeout.
  // The proof that waking works is the TIME, not the content of the response.
  assert.ok(elapsed < 5000, `long-poll returned after ${elapsed} ms; it timed out instead of waking`);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].body, "w trakcie");
  await s.close();
});

test("SSE without a cursor does NOT deliver history, only new arrivals", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "historia" }),
  });
  const es = await openSse(s.url + "/api/events", tokenB);
  await assert.rejects(() => es.next(400), /timeout/);
  es.close();
  await s.close();
});

test("SSE resumes from Last-Event-ID and delivers a backlog larger than one page", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  // 205 messages > the resumption page (200) - a single page would cut off the tail
  for (let i = 0; i < 205; i++) {
    await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
      method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "zaleglosc " + i }),
    });
  }
  const es = await openSse(s.url + "/api/events?after=0", tokenB);
  const got: string[] = [];
  for (let i = 0; i < 205; i++) {
    const ev = await es.next(5000) as any;
    got.push(ev.message.body);
  }
  assert.equal(got.length, 205);
  assert.equal(got[204], "zaleglosc 204", "the backlog beyond 200 was truncated");
  es.close();
  await s.close();
});

test("resuming SSE delivers message_updated for an edit before the cursor", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "pierwotna" }),
  })).json()).message;
  // the client saw the message (its cursor is past it), disconnected, the author edited it
  await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "PATCH", headers: bearer(tokenA), body: JSON.stringify({ body: "po edycji" }),
  });
  const es = await openSse(`${s.url}/api/events?after=${m.id}`, tokenB);
  const ev = await es.next(3000) as any;
  assert.equal(ev.type, "message_updated");
  assert.equal(ev.message.body, "po edycji");
  es.close();
  await s.close();
});

test("long-poll ends with an empty list when wait expires", async () => {
  const s = await startTestServer();
  const { tokenB } = seed(s);
  const r = await (await fetch(`${s.url}/api/messages?after=999999&wait=1`, {
    headers: bearer(tokenB),
  })).json();
  assert.deepEqual(r.messages, []);
  await s.close();
});

test("long-poll does not return the actor's own messages", async () => {
  const s = await startTestServer();
  const { tokenA, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "moja" }),
  });
  const r = await (await fetch(`${s.url}/api/messages?after=0&wait=0`, {
    headers: bearer(tokenA),
  })).json();
  assert.deepEqual(r.messages, []);
  await s.close();
});

test("long-poll without authentication returns 401", async () => {
  const s = await startTestServer();
  const r = await fetch(`${s.url}/api/messages?after=0&wait=0`);
  assert.equal(r.status, 401);
  await s.close();
});
