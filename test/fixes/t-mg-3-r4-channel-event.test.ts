/**
 * T-MG-3 fix round 4, U30 (server side): creating a PUBLIC channel publishes a "conversation"
 * event to every actor, so a page open as a non-member learns of the new channel at once
 * ("Channels you can join", #/c/<slug>). A PRIVATE channel's creation reaches no non-member.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { createChannel } from "../../src/core/conversations.ts";
import type { Event } from "../../src/core/events.ts";

function tapped(ctx: ReturnType<typeof testCtx>) {
  const seen: { recipients: number[]; event: Event }[] = [];
  ctx.bus.tap((recipients, event) => seen.push({ recipients: [...recipients], event }));
  return seen;
}

test("U30: a new public channel is announced to every actor, members or not", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal", "human"), b = mkActor(ctx, "nestor"), c = mkActor(ctx, "milosz");
  const seen = tapped(ctx);
  const delivered: Event[] = [];
  ctx.bus.subscribe(b.id, (e) => delivered.push(e));
  const conv = createChannel(ctx, { slug: "ux-fresh", kind: "public", topic: "Fresh", createdBy: a.id });
  const ev = seen.find((s) => s.event.type === "conversation");
  assert.ok(ev, "a conversation event was published");
  assert.deepEqual(ev!.event, { type: "conversation", conversationId: conv.id });
  for (const id of [a.id, b.id, c.id]) assert.ok(ev!.recipients.includes(id), `actor ${id} is a recipient`);
  assert.deepEqual(delivered, [{ type: "conversation", conversationId: conv.id }], "the non-member's stream got it");
});

test("U30: a new private channel reaches no non-member", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal", "human"), b = mkActor(ctx, "obcy");
  const seen = tapped(ctx);
  const delivered: Event[] = [];
  ctx.bus.subscribe(b.id, (e) => delivered.push(e));
  createChannel(ctx, { slug: "infra", kind: "private", createdBy: a.id });
  for (const s of seen) assert.ok(!s.recipients.includes(b.id), "the outsider is never a recipient");
  assert.deepEqual(delivered, []);
  // The creator's other tabs still learn of it.
  assert.ok(seen.some((s) => s.event.type === "conversation" && s.recipients.includes(a.id)));
});
