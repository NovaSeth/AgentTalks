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

test("parseMentions wyciaga handle bez duplikatow i bez wielkosci liter", () => {
  assert.deepEqual(
    parseMentions("czesc @Nestor i @michal, @nestor jeszcze raz"),
    ["nestor", "michal"],
  );
});

test("adres e-mail nie jest wzmianka", () => {
  assert.deepEqual(parseMentions("napisz na michal@example.com"), []);
});

test("wzmianka na poczatku i po nawiasie jest lapana, interpunkcja odcieta", () => {
  assert.deepEqual(parseMentions("@ala (@bob) [@cez] @del."), ["ala", "bob", "cez", "del"]);
});

test("postMessage nadaje rosnace id i zapisuje wzmianki", () => {
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

test("postMessage odrzuca puste cialo i cialo ponad limit", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  assert.throws(
    () => postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "   " }),
    /pusta/,
  );
  assert.throws(
    () => postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x".repeat(70000) }),
    /za dluga/,
  );
});

test("postMessage do cudzego kanalu prywatnego jest odrzucone", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "s", kind: "private", createdBy: a.id });
  assert.throws(
    () => postMessage(ctx, { conversationId: c.id, actorId: b.id, body: "hej" }),
    /brak dostepu/,
  );
});

test("listMessages stronicuje po id, nie po czasie", () => {
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

test("watek grupuje odpowiedzi pod korzeniem", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const root = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "pytanie" });
  const r1 = postMessage(ctx, {
    conversationId: c.id, actorId: a.id, body: "odp", threadId: root.id,
  });
  assert.deepEqual(listThread(ctx, root.id).map((m) => m.id), [root.id, r1.id]);
});

test("odpowiedz na odpowiedz splaszcza sie do korzenia watku", () => {
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

test("watek z innej konwersacji jest odrzucony", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c1 = createChannel(ctx, { slug: "g1", kind: "public", createdBy: a.id });
  const c2 = createChannel(ctx, { slug: "g2", kind: "public", createdBy: a.id });
  const root = postMessage(ctx, { conversationId: c1.id, actorId: a.id, body: "r" });
  assert.throws(
    () => postMessage(ctx, {
      conversationId: c2.id, actorId: a.id, body: "x", threadId: root.id,
    }),
    /innej konwersacji/,
  );
});

test("edytowac i kasowac moze tylko autor", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.throws(() => editMessage(ctx, m.id, b.id, "y"), /nie jestes autorem/);
  assert.equal(editMessage(ctx, m.id, a.id, "y").body, "y");
  assert.ok(deleteMessage(ctx, m.id, a.id).deletedAt);
});

test("edycja przelicza wzmianki od nowa", () => {
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

test("skasowana wiadomosc traci tresc, ale zostaje w kolejnosci", () => {
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
  assert.equal(raw.body, "", "tresc ma zniknac z bazy, nie tylko z odpowiedzi");
});

test("inboxAfter zwraca cudze wiadomosci z moich konwersacji, bez wlasnych", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c3 = mkActor(ctx, "cez");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const obcy = createChannel(ctx, { slug: "obcy", kind: "private", createdBy: c3.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "moja" });
  postMessage(ctx, { conversationId: c.id, actorId: b.id, body: "twoja" });
  postMessage(ctx, { conversationId: obcy.id, actorId: c3.id, body: "nie dla mnie" });
  assert.deepEqual(inboxAfter(ctx, b.id, 0).map((m) => m.body), ["moja"]);
});

test("publish trafia tylko do subskrybentow z listy odbiorcow", () => {
  const bus = new EventBus();
  const got: number[] = [];
  bus.subscribe(1, () => got.push(1));
  bus.subscribe(2, () => got.push(2));
  bus.publish([2], { type: "presence" });
  assert.deepEqual(got, [2]);
});

test("odsubskrybowanie przestaje dostarczac i zwalnia licznik", () => {
  const bus = new EventBus();
  const off = bus.subscribe(1, () => { throw new Error("nie powinno dojsc"); });
  off();
  assert.equal(bus.subscriberCount(1), 0);
  bus.publish([1], { type: "presence" });
});

test("wyjatek jednego subskrybenta nie blokuje pozostalych", () => {
  const bus = new EventBus();
  let ok = false;
  bus.subscribe(1, () => { throw new Error("bum"); });
  bus.subscribe(1, () => { ok = true; });
  bus.publish([1], { type: "presence" });
  assert.equal(ok, true);
});

test("postMessage publikuje zdarzenie do czlonkow konwersacji", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  const seen: Event[] = [];
  ctx.bus.subscribe(b.id, (e) => seen.push(e));
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "hej" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "message");
});

test("zdarzenie widzi wiadomosc juz zapisana w bazie", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  let widzianeWBazie: unknown = null;
  ctx.bus.subscribe(b.id, (e) => {
    if (e.type !== "message") return;
    widzianeWBazie = ctx.db.prepare("SELECT id FROM messages WHERE id=?").get(e.message.id);
  });
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "hej" });
  assert.ok(widzianeWBazie, "subskrybent nie znalazl wiadomosci - publikacja przed commitem");
});
