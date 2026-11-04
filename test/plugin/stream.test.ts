/**
 * The plugin's live feed against a real server: SSE with reconnect and resumption from the
 * last event id, the filter applied to real events, and no duplicates across a break.
 *
 * The break is a real one: the feed talks to the server through a TCP proxy, and the test
 * destroys the proxy's sockets. Messages posted while the feed is disconnected must arrive
 * exactly once after it reconnects (the server replays from Last-Event-ID), and messages it
 * already pushed must not arrive again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, connect, type Socket, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { bearer, startTestServer, type TestServer } from "../http-helpers.ts";
import { waitFor } from "../helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, ensureDirect, join } from "../../src/core/conversations.ts";
import { createFeed } from "../../integrations/claude-code-plugin/lib/feed.mjs";

type Proxy = { url: string; cut: () => void; close: () => Promise<void> };

async function tcpProxy(target: string): Promise<Proxy> {
  const { port: targetPort } = new URL(target);
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const upstream = connect(Number(targetPort), "127.0.0.1");
    sockets.add(client); sockets.add(upstream);
    client.pipe(upstream); upstream.pipe(client);
    const drop = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
    client.on("error", drop); upstream.on("error", drop);
    client.on("close", drop); upstream.on("close", drop);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    cut: () => { for (const s of [...sockets]) s.destroy(); },
    close: () => new Promise<void>((r) => { for (const s of [...sockets]) s.destroy(); server.close(() => r()); }),
  };
}

function seed(s: TestServer) {
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const bob = createActor(s.ctx, { kind: "human", handle: "bob" });
  const general = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: bob.id });
  join(s.ctx, general.id, nestor.id); // notify defaults to "mentions"
  const other = createChannel(s.ctx, { slug: "other", kind: "public", createdBy: bob.id });
  const dm = ensureDirect(s.ctx, [nestor.id, bob.id]);
  return {
    nestor, bob, generalId: general.id, otherId: other.id, dmId: dm.id,
    tokenN: mintToken(s.ctx, nestor.id, "t").token,
    tokenB: mintToken(s.ctx, bob.id, "t").token,
  };
}

async function post(s: TestServer, token: string, convId: number, body: string, threadId?: number) {
  const res = await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: bearer(token), body: JSON.stringify({ body, threadId }),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { message: { id: number } }).message.id;
}

test("feed: pushes only relevant events, resumes after a real break without loss or duplicates", async (t) => {
  const s = await startTestServer();
  const d = seed(s);
  const proxy = await tcpProxy(s.url);
  // Cleanup runs even when an assertion fails, so a failing test cannot hang the runner.
  t.after(() => s.close());
  t.after(() => proxy.close());
  const items: Array<{ id: number; kind: string; body: string; convLabel: string; authorKind: string }> = [];
  let connects = 0;
  const feed = createFeed({
    identity: { url: proxy.url, token: d.tokenN, source: "env" },
    onItem: (it: any) => { items.push(it); },
    onState: (st: string) => { if (st === "open") connects++; },
    sse: { initialBackoffMs: 300, maxBackoffMs: 600 },
  });
  t.after(() => feed.stop());
  await feed.start();
  await waitFor(() => connects === 1, 3000);

  const m1 = await post(s, d.tokenB, d.dmId, "dm one");
  await post(s, d.tokenB, d.generalId, "chatter, not for nestor");
  const m3 = await post(s, d.tokenB, d.generalId, "hey @nestor look");
  await post(s, d.tokenN, d.generalId, "my own message");
  await waitFor(() => items.length >= 2, 3000);

  // A real network break, then two messages while the feed is away.
  proxy.cut();
  const m5 = await post(s, d.tokenB, d.dmId, "sent during the break");
  const m6 = await post(s, d.tokenB, d.generalId, "@all during the break");
  await waitFor(() => connects >= 2, 5000);
  await waitFor(() => items.length >= 4, 5000);

  // An edit of an already pushed message is not a new message.
  await fetch(`${s.url}/api/messages/${m1}`, {
    method: "PATCH", headers: bearer(d.tokenB), body: JSON.stringify({ body: "dm one (edited)" }),
  });
  const m8 = await post(s, d.tokenB, d.dmId, "after the edit");
  await waitFor(() => items.some((i) => i.id === m8), 3000);
  // Give stragglers a moment, then check the exact list.
  await new Promise((r) => setTimeout(r, 200));

  assert.deepEqual(items.map((i) => i.id), [m1, m3, m5, m6, m8]);
  assert.deepEqual(items.map((i) => i.kind), ["dm", "mention", "dm", "all", "dm"]);
  assert.equal(items[0].authorKind, "human");
  assert.equal(items[1].convLabel, "general");
  assert.equal(items[0].convLabel, "dm:bob");
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, "no duplicates");
});

test("feed: thread replies in a thread I started reach me; a non-member mention comes via the server list", async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const d = seed(s);
  const items: Array<{ id: number; kind: string }> = [];
  let connects = 0;
  // A thread root written by nestor BEFORE the feed starts: the feed has to ask the server.
  const root = await post(s, d.tokenN, d.generalId, "I start a thread");
  const feed = createFeed({
    identity: { url: s.url, token: d.tokenN, source: "env" },
    onItem: (it: any) => { items.push(it); },
    onState: (st: string) => { if (st === "open") connects++; },
  });
  t.after(() => feed.stop());
  await feed.start();
  await waitFor(() => connects === 1, 3000);
  const reply = await post(s, d.tokenB, d.generalId, "a reply in your thread", root);
  // nestor is NOT a member of #other (public): the stream does not carry the message, the
  // notification does, and the feed reads the server's mention list.
  const called = await post(s, d.tokenB, d.otherId, "@nestor can you help here?");
  await post(s, d.tokenB, d.otherId, "no mention, not a member");
  await waitFor(() => items.length >= 2, 3000);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(items.map((i) => [i.id, i.kind]), [[reply, "thread"], [called, "mention"]]);
});
