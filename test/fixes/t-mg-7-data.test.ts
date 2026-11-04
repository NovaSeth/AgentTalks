/**
 * T-MG-7, package A2: data integrity in the core. Findings B-MG-24 (wiki force), B-MG-28
 * (notification sweep), B-MG-30 (markRead clamp), B-MG-31 (dedup key), B-MG-32 (unread cap),
 * B-MG-47 (wiki X-File-Name).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { startTestServer } from "../http-helpers.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join } from "../../src/core/conversations.ts";
import { listMessages, postMessage } from "../../src/core/messages.ts";
import { notify } from "../../src/core/notifications.ts";
import { markRead, unreadFor, UNREAD_CAP } from "../../src/core/unread.ts";
import { pageHistory, savePage } from "../../src/core/wiki.ts";

// ---- B-MG-24 ---------------------------------------------------------------

test("B-MG-24: force=true wins over a stale baseRevision", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const p1 = savePage(ctx, { slug: "notes", title: "Notes", body: "v1", actorId: alice.id });
  savePage(ctx, { slug: "notes", title: "Notes", body: "v2", actorId: alice.id, baseRevision: p1.lastRevisionId });
  // Bob read revision 1, got the 409, and follows its hint: force=true.
  assert.throws(() => savePage(ctx, {
    slug: "notes", title: "Notes", body: "bob", actorId: bob.id, baseRevision: p1.lastRevisionId,
  }), (e: any) => e.status === 409 && /force=true/.test(e.message));
  const forced = savePage(ctx, {
    slug: "notes", title: "Notes", body: "bob", actorId: bob.id, baseRevision: p1.lastRevisionId, force: true,
  });
  assert.equal(forced.body, "bob");
  assert.equal(pageHistory(ctx, "notes").length, 3);
});

// ---- B-MG-28 ---------------------------------------------------------------

test("B-MG-28: the notification sweep runs at most once per 60 s", () => {
  let now = 100_000_000;
  const ctx = testCtx(() => now);
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const ancient = now - 200 * 24 * 3600;
  const plant = () => ctx.db.prepare(
    "INSERT INTO notifications(actor_id, kind, created_at) VALUES(?, 'mention', ?)",
  ).run(bob.id, ancient);
  const ancientCount = () => (ctx.db.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE created_at = ?",
  ).get(ancient) as { n: number }).n;

  plant();
  notify(ctx, { actorIds: [bob.id], kind: "mention", fromActorId: alice.id });
  assert.equal(ancientCount(), 0, "the first notify sweeps");

  plant();
  now += 1;
  notify(ctx, { actorIds: [bob.id], kind: "mention", fromActorId: alice.id });
  assert.equal(ancientCount(), 1, "a second notify within a second does not sweep again");

  now += 60;
  notify(ctx, { actorIds: [bob.id], kind: "mention", fromActorId: alice.id });
  assert.equal(ancientCount(), 0, "after 60 s the sweep runs again");
});

// ---- B-MG-30 ---------------------------------------------------------------

test("B-MG-30: markRead past the end is clamped, so a later message is unread", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const pub = createChannel(ctx, { slug: "general", kind: "public", createdBy: alice.id });
  join(ctx, pub.id, bob.id);
  postMessage(ctx, { conversationId: pub.id, actorId: alice.id, body: "one" });
  markRead(ctx, bob.id, pub.id, 1_000_000);
  postMessage(ctx, { conversationId: pub.id, actorId: alice.id, body: "two" });
  const row = unreadFor(ctx, bob.id).find((r) => r.conversationId === pub.id)!;
  assert.equal(row.unread, 1);
});

// ---- B-MG-31 ---------------------------------------------------------------

test("B-MG-31: the same clientMsgId in two channels creates two messages, a retry still dedups", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const c1 = createChannel(ctx, { slug: "one", kind: "public", createdBy: alice.id });
  const c2 = createChannel(ctx, { slug: "two", kind: "public", createdBy: alice.id });
  const a = postMessage(ctx, { conversationId: c1.id, actorId: alice.id, body: "x", clientMsgId: "k1" });
  const b = postMessage(ctx, { conversationId: c2.id, actorId: alice.id, body: "x", clientMsgId: "k1" });
  assert.notEqual(a.id, b.id);
  assert.equal(b.conversationId, c2.id);
  const retry = postMessage(ctx, { conversationId: c2.id, actorId: alice.id, body: "x", clientMsgId: "k1" });
  assert.equal(retry.id, b.id);
  assert.equal(listMessages(ctx, { conversationId: c2.id }).length, 1);
});

test("B-MG-31: a row with the old key format still deduplicates in its own conversation", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const c1 = createChannel(ctx, { slug: "one", kind: "public", createdBy: alice.id });
  const c2 = createChannel(ctx, { slug: "two", kind: "public", createdBy: alice.id });
  const old = postMessage(ctx, { conversationId: c1.id, actorId: alice.id, body: "x" });
  ctx.db.prepare("UPDATE messages SET dedup_key = ? WHERE id = ?").run(`${alice.id}:legacy`, old.id);
  const retry = postMessage(ctx, { conversationId: c1.id, actorId: alice.id, body: "x", clientMsgId: "legacy" });
  assert.equal(retry.id, old.id);
  const other = postMessage(ctx, { conversationId: c2.id, actorId: alice.id, body: "x", clientMsgId: "legacy" });
  assert.notEqual(other.id, old.id);
});

// ---- B-MG-32 ---------------------------------------------------------------

function bulk(ctx: ReturnType<typeof testCtx>, convIds: number[], actorId: number, n: number, mentionId?: number, every = 2) {
  ctx.db.exec("BEGIN");
  const st = ctx.db.prepare("INSERT INTO messages(conversation_id,actor_id,ts,kind,body) VALUES(?,?,?,?,?)");
  const mn = ctx.db.prepare("INSERT INTO mentions(message_id, actor_id) VALUES(last_insert_rowid(), ?)");
  for (let i = 0; i < n; i++) {
    st.run(convIds[i % convIds.length], actorId, 1000 + i, "text", `hello ${i}`);
    if (mentionId !== undefined && i % every === 0) mn.run(mentionId);
  }
  ctx.db.exec("COMMIT");
}

test("B-MG-32: unread counts are exact under the cap and capped above it", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const small = createChannel(ctx, { slug: "small", kind: "public", createdBy: alice.id });
  const big = createChannel(ctx, { slug: "big", kind: "public", createdBy: alice.id });
  join(ctx, small.id, bob.id);
  join(ctx, big.id, bob.id);
  bulk(ctx, [small.id], alice.id, 37, bob.id);
  // every other message mentions bob, so the badge also crosses the cap
  bulk(ctx, [big.id], alice.id, UNREAD_CAP * 2 + 10, bob.id);
  const rows = unreadFor(ctx, bob.id);
  const s = rows.find((r) => r.conversationId === small.id)!;
  const b = rows.find((r) => r.conversationId === big.id)!;
  assert.equal(s.unread, 37);
  assert.equal(s.badge, 19);
  assert.equal(b.unread, UNREAD_CAP);
  assert.equal(b.badge, UNREAD_CAP);
  const lastBig = (ctx.db.prepare("SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?")
    .get(big.id) as { id: number }).id;
  assert.equal(b.lastUnreadMessageId, lastBig);
});

test("B-MG-32: unreadFor over 200 channels and 300k unread messages stays under 50 ms", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const chans: number[] = [];
  for (let i = 0; i < 200; i++) {
    const c = createChannel(ctx, { slug: `c${i}`, kind: "public", createdBy: alice.id });
    join(ctx, c.id, bob.id);
    chans.push(c.id);
  }
  // One message in 51 mentions bob (51 is coprime with 200, so ~29 per channel).
  bulk(ctx, chans, alice.id, 300_000, bob.id, 51);
  const first = unreadFor(ctx, bob.id); // also warms the statement cache
  assert.equal(first.length, 200);
  assert.ok(first.every((r) => r.unread === UNREAD_CAP && r.badge > 0 && r.badge < UNREAD_CAP));
  assert.equal(first.reduce((n, r) => n + r.badge, 0), Math.floor((300_000 - 1) / 51) + 1);
  const runs = 5;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) unreadFor(ctx, bob.id);
  const ms = (performance.now() - t0) / runs;
  console.log(`unreadFor 200 channels / 300k messages: ${ms.toFixed(1)} ms per call`);
  assert.ok(ms < 50, `unreadFor took ${ms.toFixed(1)} ms`);
});

// ---- B-MG-47 ---------------------------------------------------------------

test("B-MG-47: a bad %-sequence in a wiki X-File-Name is a 400, not a 500", async () => {
  const s = await startTestServer();
  try {
    const alice = mkActor(s.ctx, "alice");
    savePage(s.ctx, { slug: "docs", title: "Docs", body: "x", actorId: alice.id });
    const token = mintToken(s.ctx, alice.id, "t").token;
    const r = await fetch(s.url + "/api/wiki/docs/files", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain", "x-file-name": "bad%zz.txt" },
      body: "data",
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "invalid_name");
    const ok = await fetch(s.url + "/api/wiki/docs/files", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain",
        "x-file-name": encodeURIComponent("report final.txt") },
      body: "data",
    });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).file.name, "report final.txt");
  } finally {
    await s.close();
  }
});
