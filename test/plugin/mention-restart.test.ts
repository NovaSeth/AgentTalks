/**
 * A mention in a conversation the agent is a member of may be left to the stream only when
 * the stream is certain to carry it (codex r3 F9). After a restart without an event cursor
 * (lastEventId null, a mention cursor saved) the stream starts at "now" and can never replay
 * a mention posted during the gap; deferring it to the stream while the mention cursor moves
 * past it loses it for good.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitFor } from "../helpers.ts";
import { createFeed } from "../../integrations/claude-code-plugin/lib/feed.mjs";
import { convs, fakeAt, type FakeAt } from "./fake-at.ts";

const BOB = 8;
const M51 = { id: 51, conversationId: 3, actorId: BOB, body: "@nestor can you check the build?", threadId: null };

async function run(t: any, fake: FakeAt, resume: { lastEventId: number | null; mentionCursor: number | null }) {
  const delivered: number[] = [];
  const feed = createFeed({
    identity: { url: fake.url, token: "atk_test" },
    onItem: (it: any) => { delivered.push(it.id); },
    ...resume,
    sse: { initialBackoffMs: 50, maxBackoffMs: 100 },
    retry: { initialMs: 50, maxMs: 100 },
  } as any);
  t.after(() => feed.stop());
  await feed.start();
  await waitFor(() => fake.streams() === 1, 3000);
  return { feed, delivered };
}

function gapFake(fake: FakeAt) {
  fake.conversations = convs([{ id: 3, kind: "public", slug: "general", notify: "mentions" }]);
  // 51 was posted while no feed ran: in the history and in the mention list, never live.
  fake.emit(M51, { live: false });
  fake.mentions.push(M51);
}

for (const status of [true, false]) {
  test(`feed restart without an event cursor (lastEventId null, mentionCursor 10): member mention 51 is delivered exactly once, even when the stream carries it later (${status ? "server with" : "server without"} GET /api/status) (codex r3 F9)`, async (t) => {
    const fake = await fakeAt();
    t.after(() => fake.close());
    gapFake(fake);
    if (status) fake.status = { status: 200, body: { ok: true, lastMessageId: 51 } };
    const { feed, delivered } = await run(t, fake, { lastEventId: null, mentionCursor: 10 });
    await waitFor(() => delivered.length >= 1, 3000).catch(() => assert.fail(`51 was lost: mentionCursor=${feed.mentionCursor}`));
    // The stream delivers it after all (a duplicate send, then a break and a replay).
    fake.emit(M51, { record: false });
    fake.cut();
    await waitFor(() => fake.streams() === 1, 3000);
    fake.emit({ id: 52, conversationId: 3, actorId: BOB, body: "chatter", threadId: null });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(delivered, [51]);
    assert.equal(feed.mentionCursor, 51);
  });
}

test("feed restart WITH an event cursor before the mention: the stream replays it, delivered exactly once", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  gapFake(fake);
  const { feed, delivered } = await run(t, fake, { lastEventId: 40, mentionCursor: 10 });
  await waitFor(() => delivered.length >= 1, 3000);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(delivered, [51]);
  assert.equal(feed.mentionCursor, 51);
  assert.equal(feed.lastEventId, 51);
});

test("feed restart with an event cursor PAST the mention: the run that committed it delivered it; not again", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  gapFake(fake);
  const { feed, delivered } = await run(t, fake, { lastEventId: 60, mentionCursor: 10 });
  await waitFor(() => feed.mentionCursor === 51, 3000);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(delivered, []);
});

test("fresh feed: the stream opens with the server's newest message id as its cursor, so nothing between start and connect is lost", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.conversations = convs([{ id: 9, kind: "dm", notify: "all" }]);
  fake.status = { status: 200, body: { ok: true, lastMessageId: 70 } };
  // 71 lands after GET /api/status but before the stream connects: the replay brings it.
  fake.emit({ id: 70, conversationId: 9, actorId: BOB, body: "old, the summary's job", threadId: null }, { live: false });
  fake.emit({ id: 71, conversationId: 9, actorId: BOB, body: "in the gap", threadId: null }, { live: false });
  const { feed, delivered } = await run(t, fake, { lastEventId: null, mentionCursor: null });
  await waitFor(() => delivered.length >= 1, 3000);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(delivered, [71]);
  assert.equal(feed.lastEventId, 71);
});

test("feed restart with mentionCursor 0 (no mention existed when the last run started): a member mention after the event cursor is replayed and delivered, not marked seen as 'old' (property seed 1)", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  gapFake(fake);
  const { feed, delivered } = await run(t, fake, { lastEventId: 3, mentionCursor: 0 });
  await waitFor(() => delivered.length >= 1, 3000).catch(() => assert.fail(`51 was lost: mentionCursor=${feed.mentionCursor}`));
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(delivered, [51]);
});
