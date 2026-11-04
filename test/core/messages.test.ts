// Polish fixture bodies exercise message storage and mention parsing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { parseMentions } from "../../src/core/mentions.ts";
import { createChannel, ensureDirect, join } from "../../src/core/conversations.ts";
import {
  deleteMessage,
  editMessage,
  inboxAfter,
  listMessages,
  listThread,
  postMessage,
} from "../../src/core/messages.ts";
import { EventBus, type Event } from "../../src/core/events.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { openDb } from "../../src/store/db.ts";
import { createCtx } from "../../src/core/ctx.ts";
import { ask } from "../../src/core/questions.ts";

test("parseMentions extracts handles without duplicates and ignores case", () => {
  assert.deepEqual(
    parseMentions("czesc @Nestor i @michal, @nestor jeszcze raz"),
    ["nestor", "michal"],
  );
});

test("an email address is not a mention", () => {
  assert.deepEqual(parseMentions("napisz na michal@example.com"), []);
});

test("a mention at the start or after a parenthesis is recognized, with punctuation removed", () => {
  assert.deepEqual(parseMentions("@ala (@bob) [@cez] @del."), ["ala", "bob", "cez", "del"]);
});

test("postMessage assigns increasing ids and stores mentions", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "nestor");
  const c = createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  const m1 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "czesc" });
  const m2 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "@nestor zerknij" });
  assert.ok(m2.id > m1.id);
  const rows = ctx.db.prepare("SELECT actor_id FROM mentions WHERE message_id=?")
    .all(m2.id) as Array<{ actor_id: number }>;
  assert.deepEqual(rows.map((r) => r.actor_id), [b.id]);
});

test("postMessage rejects an empty body and a body over the limit", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  assert.throws(
    () => postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "   " }),
    /empty/,
  );
  assert.throws(
    () => postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x".repeat(70000) }),
    /too long/,
  );
});

test("postMessage rejects posting to another actor's private channel", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "s", kind: "private", createdBy: a.id });
  assert.throws(
    () => postMessage(ctx, { conversationId: c.id, actorId: b.id, body: "hej" }),
    /do not have access/,
  );
});

test("listMessages paginates by id rather than time", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "m" + i }).id);
  }
  assert.deepEqual(
    listMessages(ctx, { conversationId: c.id, after: ids[2] }).map((m) => m.id),
    [ids[3], ids[4]],
  );
  assert.deepEqual(
    listMessages(ctx, { conversationId: c.id, limit: 2 }).map((m) => m.id),
    [ids[3], ids[4]],
  );
  assert.deepEqual(
    listMessages(ctx, { conversationId: c.id, before: ids[2], limit: 2 }).map((m) => m.id),
    [ids[0], ids[1]],
  );
});

test("a thread groups replies under its root", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const root = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "pytanie" });
  const r1 = postMessage(ctx, {
    conversationId: c.id, actorId: a.id, body: "odp", threadId: root.id,
  });
  assert.deepEqual(listThread(ctx, root.id).map((m) => m.id), [root.id, r1.id]);
});

test("a reply to a reply is flattened to the thread root", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const root = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "r" });
  const r1 = postMessage(ctx, {
    conversationId: c.id, actorId: a.id, body: "a", threadId: root.id,
  });
  const r2 = postMessage(ctx, {
    conversationId: c.id, actorId: a.id, body: "b", threadId: r1.id,
  });
  assert.equal(r2.threadId, root.id);
});

test("a thread from another conversation is rejected", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c1 = createChannel(ctx, { slug: "g1", kind: "public", createdBy: a.id });
  const c2 = createChannel(ctx, { slug: "g2", kind: "public", createdBy: a.id });
  const root = postMessage(ctx, { conversationId: c1.id, actorId: a.id, body: "r" });
  assert.throws(
    () => postMessage(ctx, {
      conversationId: c2.id, actorId: a.id, body: "x", threadId: root.id,
    }),
    /another conversation/,
  );
});

test("only the author can edit and delete", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.throws(() => editMessage(ctx, m.id, b.id, "y"), /only the author/);
  assert.equal(editMessage(ctx, m.id, a.id, "y").body, "y");
  assert.ok(deleteMessage(ctx, m.id, a.id).deletedAt);
});

test("editing recalculates mentions", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c3 = mkActor(ctx, "cez");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "@bob patrz" });
  editMessage(ctx, m.id, a.id, "@cez patrz");
  const rows = ctx.db.prepare("SELECT actor_id FROM mentions WHERE message_id=?")
    .all(m.id) as Array<{ actor_id: number }>;
  assert.deepEqual(rows.map((r) => r.actor_id), [c3.id]);
  assert.ok(!rows.some((r) => r.actor_id === b.id));
});

test("a deleted message loses its body but keeps its position", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "sekret" });
  deleteMessage(ctx, m.id, a.id);
  const got = listMessages(ctx, { conversationId: c.id })[0];
  assert.equal(got.id, m.id);
  assert.equal(got.body, "");
  assert.ok(got.deletedAt);
  const raw = ctx.db.prepare("SELECT body FROM messages WHERE id=?").get(m.id) as {
    body: string;
  };
  assert.equal(raw.body, "", "the body must disappear from the database as well as the response");
});

test("inboxAfter returns others' messages from my conversations, excluding my own", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c3 = mkActor(ctx, "cez");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const outsider = createChannel(ctx, { slug: "obcy", kind: "private", createdBy: c3.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "moja" });
  postMessage(ctx, { conversationId: c.id, actorId: b.id, body: "twoja" });
  postMessage(ctx, { conversationId: outsider.id, actorId: c3.id, body: "nie dla mnie" });
  assert.deepEqual(inboxAfter(ctx, b.id, 0).map((m) => m.body), ["moja"]);
});

test("publish reaches only subscribers in the recipient list", () => {
  const bus = new EventBus();
  const got: number[] = [];
  bus.subscribe(1, () => got.push(1));
  bus.subscribe(2, () => got.push(2));
  bus.publish([2], { type: "presence" });
  assert.deepEqual(got, [2]);
});

test("unsubscribing stops delivery and releases the counter", () => {
  const bus = new EventBus();
  const off = bus.subscribe(1, () => { throw new Error("must not be delivered"); });
  off();
  assert.equal(bus.subscriberCount(1), 0);
  bus.publish([1], { type: "presence" });
});

test("one subscriber's exception does not block the others", () => {
  const bus = new EventBus();
  let ok = false;
  bus.subscribe(1, () => { throw new Error("bum"); });
  bus.subscribe(1, () => { ok = true; });
  bus.publish([1], { type: "presence" });
  assert.equal(ok, true);
});

test("postMessage publishes an event to conversation members", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  const seen: Event[] = [];
  ctx.bus.subscribe(b.id, (e) => seen.push(e));
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "hej" });
  // A DM gives the recipient two events: the message itself and a notification (a separate
  // mechanism with its own read marker), so we check both rather than the count.
  assert.deepEqual(seen.map((e) => e.type).sort(), ["message", "notification"]);
});

test("the event sees the message already stored in the database, read through a SECOND connection", () => {
  // The same SQLite handle sees its own uncommitted transaction, so reading through it does not
  // distinguish publishing before a commit from publishing after one. A second connection to a
  // shared file sees only committed data - and that is the right judge.
  const path = joinPath(mkdtempSync(joinPath(tmpdir(), "at-msg-")), "test.sqlite");
  const ctx = createCtx(openDb(path), new EventBus(), () => 1_000_000);
  const reader = openDb(path);
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  let seenInDatabase: unknown = null;
  ctx.bus.subscribe(b.id, (e) => {
    if (e.type !== "message") return;
    seenInDatabase = reader.prepare("SELECT id FROM messages WHERE id=?").get(e.message.id);
  });
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "hej" });
  assert.ok(seenInDatabase, "the subscriber did not find the message; publication preceded commit");
});

test("ask publishes an event only when the question ALREADY exists, checked through a second connection", () => {
  const path = joinPath(mkdtempSync(joinPath(tmpdir(), "at-ask-")), "test.sqlite");
  const ctx = createCtx(openDb(path), new EventBus(), () => 1_000_000);
  const reader = openDb(path);
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  let questionVisible = false;
  ctx.bus.subscribe(b.id, (e) => {
    if (e.type !== "message" || e.message.kind !== "ask") return;
    questionVisible = !!reader.prepare("SELECT 1 FROM questions WHERE message_id = ?")
      .get(e.message.id);
  });
  ask(ctx, { conversationId: c.id, actorId: a.id, body: "atomowe?" });
  assert.equal(questionVisible, true,
    "the ask message event was emitted before the question was in the database");
});

test("clientMsgId: retry duplicates neither the message nor the event", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const events: number[] = [];
  ctx.bus.subscribe(b.id, (e) => { if (e.type === "message") events.push(e.message.id); });
  const m1 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "deploy", clientMsgId: "x1" });
  const m2 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "deploy", clientMsgId: "x1" });
  assert.equal(m1.id, m2.id, "retry must return the same message");
  const n = ctx.db.prepare("SELECT count(*) AS n FROM messages WHERE conversation_id=?")
    .get(c.id) as { n: number };
  assert.equal(n.n, 1, "a second message was created despite deduplication");
  assert.equal(events.length, 1, "duplicate push; event idempotency failed");
});

test("clientMsgId is per actor; two actors may use the same id", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const ma = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "a", clientMsgId: "x" });
  const mb = postMessage(ctx, { conversationId: c.id, actorId: b.id, body: "b", clientMsgId: "x" });
  assert.notEqual(ma.id, mb.id);
});
