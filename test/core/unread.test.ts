import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { createChannel, ensureDirect, join } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";
import { markRead, totalBadge, unreadFor } from "../../src/core/unread.ts";

const rowFor = (ctx: ReturnType<typeof testCtx>, actorId: number, convId: number) =>
  unreadFor(ctx, actorId).find((r) => r.conversationId === convId)!;

test("wlasne wiadomosci nie licza sie jako nieprzeczytane", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.equal(rowFor(ctx, a.id, c.id).unread, 0);
});

test("w kanale plakietka liczy tylko wzmianki, licznik liczy wszystko", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "zwykla" });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "@bob spojrz" });
  const row = rowFor(ctx, b.id, c.id);
  assert.equal(row.unread, 2);
  assert.equal(row.badge, 1);
});

test("w DM kazda wiadomosc jest plakietka, bez wzmianki", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "bez wzmianki" });
  const row = rowFor(ctx, b.id, d.id);
  assert.equal(row.unread, 1);
  assert.equal(row.badge, 1);
});

test("w grupie kazda wiadomosc jest plakietka", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c3 = mkActor(ctx, "cez");
  const g = ensureDirect(ctx, [a.id, b.id, c3.id]);
  postMessage(ctx, { conversationId: g.id, actorId: a.id, body: "do wszystkich" });
  assert.equal(rowFor(ctx, c3.id, g.id).badge, 1);
});

test("markRead bez argumentu zeruje do najnowszej", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  markRead(ctx, b.id, c.id);
  assert.equal(rowFor(ctx, b.id, c.id).unread, 0);
});

test("markRead nie cofa sie do starszej wiadomosci", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const m1 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "1" });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "2" });
  markRead(ctx, b.id, c.id);
  markRead(ctx, b.id, c.id, m1.id);
  assert.equal(rowFor(ctx, b.id, c.id).unread, 0);
});

test("skasowana wiadomosc nie utrzymuje licznika", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  ctx.db.prepare("UPDATE messages SET deleted_at = 1 WHERE id = ?").run(m.id);
  assert.equal(rowFor(ctx, b.id, c.id).unread, 0);
});

test("liczniki nie wyciekaja z konwersacji, ktorych nie jestem czlonkiem", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "@bob nawet ze wzmianka" });
  assert.equal(unreadFor(ctx, b.id).length, 0, "bob nie dolaczyl, wiec nie ma licznika");
  assert.equal(totalBadge(ctx, b.id), 0);
});

test("totalBadge sumuje plakietki ze wszystkich konwersacji", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const d = ensureDirect(ctx, [a.id, b.id]);
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "@bob raz" });
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "dwa" });
  assert.equal(totalBadge(ctx, b.id), 2);
});
