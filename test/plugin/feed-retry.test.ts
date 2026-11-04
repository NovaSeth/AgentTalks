/**
 * The feed never acknowledges an event it could not decide on. A transient failure of a
 * lookup the filter needs (the membership list, a thread) must not turn into "not for me":
 * the event stays unhandled, its id is not committed as the cursor, and it is retried with
 * backoff until the lookup works. Otherwise a new DM that arrives during a server hiccup is
 * marked seen, the cursor passes it, and it is lost for good (codex F4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitFor } from "../helpers.ts";
import { createFeed } from "../../integrations/claude-code-plugin/lib/feed.mjs";
import { convs, fakeAt } from "./fake-at.ts";

const BOB = 8;

test("feed: a membership lookup failure (503) neither pushes nor commits the event; after recovery 41 then 42 arrive (codex F4)", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  const pushed: number[] = [];
  const cursors: number[] = [];
  const feed = createFeed({
    identity: { url: fake.url, token: "atk_test" },
    onItem: (it: any) => { pushed.push(it.id); },
    onCursor: (id: number) => { cursors.push(id); },
    sse: { initialBackoffMs: 50, maxBackoffMs: 100 },
    retry: { initialMs: 50, maxMs: 200 },
  } as any);
  t.after(() => feed.stop());
  await feed.start();
  await waitFor(() => fake.streams() === 1, 3000);

  // A DM created a moment ago (conversation 9 is not in the feed's list yet), and the server
  // answers the membership refresh with 503.
  fake.conversations = { status: 503, body: { error: "unavailable" } };
  fake.emit({ id: 41, conversationId: 9, actorId: BOB, body: "new DM", threadId: null });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(pushed, [], "an undecided event is not pushed");
  assert.ok(!cursors.some((c) => c >= 41), `cursor committed past an undecided event: ${cursors}`);
  assert.ok((feed.lastEventId ?? 0) < 41, `lastEventId ${feed.lastEventId}`);

  // The server recovers; the DM is now in the list. A replay (break + Last-Event-ID) and a new
  // message follow: 41 and 42 arrive, once each, in order.
  fake.conversations = convs([{ id: 9, kind: "dm", notify: "all" }]);
  fake.emit({ id: 42, conversationId: 9, actorId: BOB, body: "second DM", threadId: null });
  fake.cut();
  await waitFor(() => pushed.length >= 2, 5000);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(pushed, [41, 42]);
  assert.equal(cursors.at(-1), 42);
  assert.equal(feed.lastEventId, 42);
});

test("feed: a full queue behind an undecided event drops the stream and resumes it from the committed cursor, losing nothing", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.conversations = convs([{ id: 3, kind: "public", notify: "mentions" }, { id: 9, kind: "dm", notify: "all" }]);
  fake.threads.set(50, { status: 503 });
  const pushed: number[] = [];
  const feed = createFeed({
    identity: { url: fake.url, token: "atk_test" },
    onItem: (it: any) => { pushed.push(it.id); },
    sse: { initialBackoffMs: 50, maxBackoffMs: 100 },
    retry: { initialMs: 50, maxMs: 100 },
    maxQueue: 3,
  } as any);
  t.after(() => feed.stop());
  await feed.start();
  await waitFor(() => fake.streams() === 1, 3000);
  fake.emit({ id: 60, conversationId: 3, actorId: BOB, body: "reply in nestor's thread", threadId: 50 });
  for (let id = 61; id <= 70; id++) fake.emit({ id, conversationId: 9, actorId: BOB, body: `dm ${id}`, threadId: null });
  await waitFor(() => fake.streams() === 0, 3000); // the overflow closed the stream
  assert.deepEqual(pushed, []);
  fake.threads.set(50, { status: 200, body: { messages: [{ id: 50, conversationId: 3, actorId: 7, body: "root", threadId: null }] } });
  await waitFor(() => pushed.length >= 11, 5000);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(pushed, [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70]);
  assert.equal(feed.lastEventId, 70);
});

test("feed: a failed thread lookup is retried, not read as 'not my thread'", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.conversations = convs([{ id: 3, kind: "public", slug: "general", notify: "mentions" }]);
  fake.threads.set(50, { status: 503 });
  const pushed: Array<[number, string]> = [];
  const feed = createFeed({
    identity: { url: fake.url, token: "atk_test" },
    onItem: (it: any) => { pushed.push([it.id, it.kind]); },
    sse: { initialBackoffMs: 50, maxBackoffMs: 100 },
    retry: { initialMs: 50, maxMs: 200 },
  } as any);
  t.after(() => feed.stop());
  await feed.start();
  await waitFor(() => fake.streams() === 1, 3000);
  // A reply in thread 50, which nestor (id 7) took part in before the feed started.
  fake.emit({ id: 51, conversationId: 3, actorId: BOB, body: "a reply", threadId: 50 });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(pushed, []);
  fake.threads.set(50, { status: 200, body: { messages: [
    { id: 50, conversationId: 3, actorId: 7, body: "root by nestor", threadId: null },
  ] } });
  await waitFor(() => pushed.length >= 1, 3000);
  assert.deepEqual(pushed, [[51, "thread"]]);
});
