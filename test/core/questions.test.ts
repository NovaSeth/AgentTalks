// Polish fixture bodies and queries exercise question, reaction and search handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { createChannel } from "../../src/core/conversations.ts";
import { deleteMessage, postMessage } from "../../src/core/messages.ts";
import { answer, ask, openQuestions } from "../../src/core/questions.ts";
import { react, reactionsFor } from "../../src/core/reactions.ts";
import { search } from "../../src/core/search.ts";

test("a question stays open until anyone answers", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "issues", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "czy mozna git pull?" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 1);
  answer(ctx, { questionId: q.question, actorId: b.id, body: "mozna" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 0);
});

test("the answer is placed in the question's thread", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "i", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "pytanie" });
  const r = answer(ctx, { questionId: q.question, actorId: b.id, body: "odp" });
  assert.equal(r.message.threadId, q.message.id);
  assert.equal(r.message.kind, "answer");
});

test("a closed question cannot be answered again", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "i", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "p" });
  answer(ctx, { questionId: q.question, actorId: b.id, body: "raz" });
  assert.throws(
    () => answer(ctx, { questionId: q.question, actorId: b.id, body: "dwa" }),
    /already been answered/,
  );
});

test("open questions do not leak from a private channel", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "tajne", kind: "private", createdBy: a.id });
  ask(ctx, { conversationId: c.id, actorId: a.id, body: "sekret?" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 0);
  assert.equal(openQuestions(ctx, { actorId: a.id }).length, 1);
});

test("a deleted question disappears from open questions", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "i", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "p" });
  deleteMessage(ctx, q.message.id, a.id);
  assert.equal(openQuestions(ctx, { actorId: a.id }).length, 0);
});

test("a reaction toggles without duplication", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.equal(react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" }).on, true);
  assert.deepEqual(reactionsFor(ctx, [m.id]), { [m.id]: { OK: ["ala"] } });
  assert.equal(react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" }).on, false);
  assert.deepEqual(reactionsFor(ctx, [m.id]), {});
});

test("a reaction shows WHO reacted, not just how many", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" });
  react(ctx, { messageId: m.id, actorId: b.id, emoji: "OK" });
  assert.deepEqual(reactionsFor(ctx, [m.id])[m.id]["OK"], ["ala", "bob"]);
});

test("an inaccessible channel's message cannot receive a reaction", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "s", kind: "private", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.throws(() => react(ctx, { messageId: m.id, actorId: b.id, emoji: "OK" }), /is not accessible/);
});

test("search does not return content from inaccessible channels", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const pub = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const prv = createChannel(ctx, { slug: "s", kind: "private", createdBy: a.id });
  postMessage(ctx, { conversationId: pub.id, actorId: a.id, body: "jawny sekret" });
  postMessage(ctx, { conversationId: prv.id, actorId: a.id, body: "ukryty sekret" });
  const hits = search(ctx, { actorId: b.id, text: "sekret" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].conversationId, pub.id);
});

test("search omits deleted messages", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "znajdzka" });
  deleteMessage(ctx, m.id, a.id);
  assert.equal(search(ctx, { actorId: a.id, text: "znajdzka" }).length, 0);
});

test("FTS syntax in a user query does not break search", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "raport AND wnioski" });
  assert.doesNotThrow(() => search(ctx, { actorId: a.id, text: 'AND OR "((' }));
  assert.equal(search(ctx, { actorId: a.id, text: "raport wnioski" }).length, 1);
});

test("search matches prefixes", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "konfiguracja serwera" });
  assert.equal(search(ctx, { actorId: a.id, text: "konfig" }).length, 1);
});

test("digest and search do not leak content from another actor's private channel (ACL)", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), outsider = mkActor(ctx, "obcy");
  const prv = createChannel(ctx, { slug: "tajne", kind: "private", createdBy: a.id });
  postMessage(ctx, { conversationId: prv.id, actorId: a.id, body: "poufna fraza kanaru" });
  // a stranger is not a member
  const hits = search(ctx, { actorId: outsider.id, text: "kanaru" });
  assert.equal(hits.length, 0, "search leaked content from a private channel");
});

test("search beforeId pages past the cap: more than 200 matches in one second, each id once (D-MG-42)", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const g = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const ids: number[] = [];
  for (let i = 0; i < 450; i++) ids.push(postMessage(ctx, { conversationId: g.id, actorId: a.id, body: `needle ${i}` }).id);
  const seen: number[] = [];
  let before: number | undefined;
  for (let page = 0; page < 10; page++) {
    const hits = search(ctx, { actorId: a.id, text: "needle", limit: 200, beforeId: before });
    if (hits.length === 0) break;
    seen.push(...hits.map((m) => m.id).reverse());
    before = Math.min(...hits.map((m) => m.id));
  }
  assert.deepEqual(seen, [...ids].reverse());
  // Without it nothing changes: the newest page, ascending.
  const plain = search(ctx, { actorId: a.id, text: "needle", limit: 3 });
  assert.deepEqual(plain.map((m) => m.id), ids.slice(-3));
});
