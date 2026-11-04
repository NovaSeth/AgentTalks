import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "./helpers.ts";
import { bearer, cookieAuth, startTestServer } from "./http-helpers.ts";
import { createActor, setPassword } from "../src/core/actors.ts";
import { mintToken } from "../src/core/tokens.ts";
import { createChannel, join } from "../src/core/conversations.ts";
import { postMessage } from "../src/core/messages.ts";
import { markRead, markUnread, unreadFor } from "../src/core/unread.ts";

function scene() {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const ids = [1, 2, 3].map((n) => postMessage(ctx, { conversationId: c.id, actorId: a.id, body: `m${n}` }).id);
  return { ctx, a, b, c, ids };
}
const marker = (ctx: ReturnType<typeof testCtx>, actorId: number, convId: number) =>
  (ctx.db.prepare("SELECT last_read_message_id AS m FROM members WHERE conversation_id = ? AND actor_id = ?")
    .get(convId, actorId) as { m: number }).m;

test("markUnread rewinds the read marker to just before the message", () => {
  const { ctx, b, c, ids } = scene();
  markRead(ctx, b.id, c.id);
  assert.equal(unreadFor(ctx, b.id).find((r) => r.conversationId === c.id)!.unread, 0);
  const n = markUnread(ctx, b.id, c.id, ids[1]);
  assert.equal(marker(ctx, b.id, c.id), ids[1] - 1);
  assert.equal(n, 2);
});

test("markUnread never moves the marker forward", () => {
  const { ctx, b, c, ids } = scene();
  markRead(ctx, b.id, c.id, ids[0]);
  const n = markUnread(ctx, b.id, c.id, ids[2]);
  assert.equal(marker(ctx, b.id, c.id), ids[0]);
  assert.equal(n, 2);
});

test("markUnread refuses a conversation the actor cannot read or has not joined", () => {
  const { ctx, a, c, ids } = scene();
  const priv = createChannel(ctx, { slug: "p", kind: "private", createdBy: a.id });
  const pm = postMessage(ctx, { conversationId: priv.id, actorId: a.id, body: "s" }).id;
  const outsider = mkActor(ctx, "cez");
  assert.throws(() => markUnread(ctx, outsider.id, priv.id, pm), { status: 403 });
  // a public channel the actor is not a member of is not joined by marking unread
  assert.throws(() => markUnread(ctx, outsider.id, c.id, ids[0]), { status: 403 });
  assert.equal(ctx.db.prepare("SELECT 1 FROM members WHERE conversation_id = ? AND actor_id = ?").get(c.id, outsider.id), undefined);
});

test("markUnread refuses a message from another conversation", () => {
  const { ctx, a, b, c } = scene();
  const other = createChannel(ctx, { slug: "o", kind: "public", createdBy: a.id });
  join(ctx, other.id, b.id);
  const foreign = postMessage(ctx, { conversationId: other.id, actorId: a.id, body: "x" }).id;
  assert.throws(() => markUnread(ctx, b.id, c.id, foreign), { code: "message_not_found", status: 404 });
  assert.throws(() => markUnread(ctx, b.id, c.id, 99999), { code: "message_not_found" });
});

test("markUnread publishes a read event with the new marker", () => {
  const { ctx, b, c, ids } = scene();
  markRead(ctx, b.id, c.id);
  const got: Array<Record<string, unknown>> = [];
  ctx.bus.subscribe(b.id, (e: any) => got.push(e));
  markUnread(ctx, b.id, c.id, ids[1]);
  const ev = got.find((e) => e.type === "read")!;
  assert.equal(ev.conversationId, c.id);
  assert.equal(ev.messageId, ids[1] - 1);
});

test("markRead afterwards still moves forward, and /read alone never rewinds", () => {
  const { ctx, b, c, ids } = scene();
  markRead(ctx, b.id, c.id);
  markUnread(ctx, b.id, c.id, ids[1]);
  markRead(ctx, b.id, c.id, ids[2]);
  assert.equal(marker(ctx, b.id, c.id), ids[2]);
  markRead(ctx, b.id, c.id, ids[0]);
  assert.equal(marker(ctx, b.id, c.id), ids[2]);
});

test("POST /unread: 200 shape, 400, 403, CSRF", async () => {
  const s = await startTestServer();
  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const outsider = createActor(s.ctx, { kind: "agent", handle: "cez" });
  const tokenO = mintToken(s.ctx, outsider.id, "t").token;
  const ch = createChannel(s.ctx, { slug: "g", kind: "private", createdBy: michal.id });
  join(s.ctx, ch.id, ala.id);
  const m1 = postMessage(s.ctx, { conversationId: ch.id, actorId: ala.id, body: "a" }).id;
  const m2 = postMessage(s.ctx, { conversationId: ch.id, actorId: ala.id, body: "b" }).id;
  markRead(s.ctx, michal.id, ch.id);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const headers = cookieAuth(login.headers.get("set-cookie")!);
  const url = `${s.url}/api/conversations/${ch.id}/unread`;
  const ok = await fetch(url, { method: "POST", headers, body: JSON.stringify({ messageId: m2 }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { conversationId: ch.id, lastReadMessageId: m2 - 1, unread: 1 });
  for (const bad of [{}, { messageId: "x" }, { messageId: 1.5 }, { messageId: null }]) {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(bad) });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const { "x-at-csrf": _omit, ...noCsrf } = headers;
  assert.equal((await fetch(url, { method: "POST", headers: noCsrf, body: JSON.stringify({ messageId: m1 }) })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: bearer(tokenO), body: JSON.stringify({ messageId: m1 }) })).status, 403);
  await s.close();
});
