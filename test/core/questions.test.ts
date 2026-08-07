import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { createChannel } from "../../src/core/conversations.ts";
import { deleteMessage, postMessage } from "../../src/core/messages.ts";
import { answer, ask, openQuestions } from "../../src/core/questions.ts";
import { react, reactionsFor } from "../../src/core/reactions.ts";
import { search } from "../../src/core/search.ts";

test("pytanie jest otwarte, dopoki ktokolwiek nie odpowie", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "issues", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "czy mozna git pull?" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 1);
  answer(ctx, { questionId: q.question, actorId: b.id, body: "mozna" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 0);
});

test("odpowiedz laduje w watku pytania", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "i", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "pytanie" });
  const r = answer(ctx, { questionId: q.question, actorId: b.id, body: "odp" });
  assert.equal(r.message.threadId, q.message.id);
  assert.equal(r.message.kind, "answer");
});

test("na zamkniete pytanie nie da sie odpowiedziec drugi raz", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "i", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "p" });
  answer(ctx, { questionId: q.question, actorId: b.id, body: "raz" });
  assert.throws(
    () => answer(ctx, { questionId: q.question, actorId: b.id, body: "dwa" }),
    /juz odpowiedzial/,
  );
});

test("otwarte pytania nie wyciekaja z kanalu prywatnego", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "tajne", kind: "private", createdBy: a.id });
  ask(ctx, { conversationId: c.id, actorId: a.id, body: "sekret?" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 0);
  assert.equal(openQuestions(ctx, { actorId: a.id }).length, 1);
});

test("skasowane pytanie znika z otwartych", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "i", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "p" });
  deleteMessage(ctx, q.message.id, a.id);
  assert.equal(openQuestions(ctx, { actorId: a.id }).length, 0);
});

test("reakcja jest przelacznikiem i nie duplikuje sie", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.equal(react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" }).on, true);
  assert.deepEqual(reactionsFor(ctx, [m.id]), { [m.id]: { OK: ["ala"] } });
  assert.equal(react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" }).on, false);
  assert.deepEqual(reactionsFor(ctx, [m.id]), {});
});

test("reakcja pokazuje KTO zareagowal, nie tylko ile", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" });
  react(ctx, { messageId: m.id, actorId: b.id, emoji: "OK" });
  assert.deepEqual(reactionsFor(ctx, [m.id])[m.id]["OK"], ["ala", "bob"]);
});

test("nie da sie zareagowac na wiadomosc z kanalu bez dostepu", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "s", kind: "private", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.throws(() => react(ctx, { messageId: m.id, actorId: b.id, emoji: "OK" }), /brak dostepu/);
});

test("wyszukiwanie nie zwraca tresci z kanalow bez dostepu", () => {
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

test("wyszukiwanie pomija skasowane", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "znajdzka" });
  deleteMessage(ctx, m.id, a.id);
  assert.equal(search(ctx, { actorId: a.id, text: "znajdzka" }).length, 0);
});

test("skladnia FTS w zapytaniu uzytkownika nie wywraca wyszukiwania", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "raport AND wnioski" });
  assert.doesNotThrow(() => search(ctx, { actorId: a.id, text: 'AND OR "((' }));
  assert.equal(search(ctx, { actorId: a.id, text: "raport wnioski" }).length, 1);
});

test("wyszukiwanie dopasowuje przedrostek", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "konfiguracja serwera" });
  assert.equal(search(ctx, { actorId: a.id, text: "konfig" }).length, 1);
});

test("digest i search nie wyciekaja tresci z cudzego kanalu prywatnego (ACL)", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), obcy = mkActor(ctx, "obcy");
  const prv = createChannel(ctx, { slug: "tajne", kind: "private", createdBy: a.id });
  postMessage(ctx, { conversationId: prv.id, actorId: a.id, body: "poufna fraza kanaru" });
  // obcy nie jest czlonkiem
  const hits = search(ctx, { actorId: obcy.id, text: "kanaru" });
  assert.equal(hits.length, 0, "search wyciekl z prywatnego kanalu");
});
