import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import {
  assertCanPost,
  assertCanRead,
  canRead,
  createChannel,
  ensureDirect,
  isMember,
  join,
  leave,
  listForActor,
  members,
  recipientsOf,
  setNotify,
} from "../../src/core/conversations.ts";

test("kanal publiczny jest czytelny bez czlonkostwa, pisanie dolacza", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "nestor");
  const c = createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  assert.equal(canRead(ctx, c.id, b.id), true);
  assert.equal(isMember(ctx, c.id, b.id), false);
  assertCanPost(ctx, c.id, b.id);
  assert.equal(isMember(ctx, c.id, b.id), true);
});

test("tworca kanalu jest jego adminem", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal");
  const c = createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  assert.equal(members(ctx, c.id)[0].role, "admin");
});

test("kanal prywatny jest niewidoczny dla obcego", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "infra", kind: "private", createdBy: a.id });
  assert.equal(canRead(ctx, c.id, b.id), false);
  assert.throws(() => assertCanRead(ctx, c.id, b.id), /brak dostepu/);
  assert.throws(() => assertCanPost(ctx, c.id, b.id), /brak dostepu/);
});

test("nieistniejaca konwersacja i zabroniona daja ten sam blad", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "infra", kind: "private", createdBy: a.id });
  const brak = (() => { try { assertCanRead(ctx, 9999, b.id); } catch (e) { return e as Error; } })();
  const zabroniona = (() => { try { assertCanRead(ctx, c.id, b.id); } catch (e) { return e as Error; } })();
  assert.equal(brak!.message, zabroniona!.message);
});

test("nie da sie zalozyc dwoch kanalow o tej samej nazwie", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal");
  createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  assert.throws(
    () => createChannel(ctx, { slug: "#General", kind: "public", createdBy: a.id }),
    /juz istnieje/,
  );
});

test("ensureDirect dla dwoch daje dm i jest idempotentne niezaleznie od kolejnosci", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d1 = ensureDirect(ctx, [a.id, b.id]);
  const d2 = ensureDirect(ctx, [b.id, a.id]);
  assert.equal(d1.id, d2.id);
  assert.equal(d1.kind, "dm");
  assert.equal(members(ctx, d1.id).length, 2);
});

test("ensureDirect dla trzech daje grupe i nie miesza sie z dm-em pary", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c = mkActor(ctx, "cez");
  const dm = ensureDirect(ctx, [a.id, b.id]);
  const gr = ensureDirect(ctx, [a.id, b.id, c.id]);
  assert.equal(gr.kind, "group");
  assert.notEqual(gr.id, dm.id);
  assert.equal(members(ctx, gr.id).length, 3);
});

test("rozmowa bezposrednia dochodzi w calosci, nie tylko przy wzmiance", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  assert.ok(members(ctx, d.id).every((m) => m.notify === "all"));
});

test("ensureDirect odrzuca liste krotsza niz dwa i duplikaty", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  assert.throws(() => ensureDirect(ctx, [a.id]), /co najmniej/);
  assert.throws(() => ensureDirect(ctx, [a.id, a.id]), /co najmniej/);
});

test("z rozmowy bezposredniej nie da sie wyjsc, z kanalu tak", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  assert.throws(() => leave(ctx, d.id, a.id), /nie da sie wyjsc/);
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  leave(ctx, c.id, b.id);
  assert.equal(isMember(ctx, c.id, b.id), false);
});

test("listForActor zwraca kanaly publiczne i wlasne prywatne, bez cudzych", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  createChannel(ctx, { slug: "sekret", kind: "private", createdBy: a.id });
  assert.deepEqual(listForActor(ctx, b.id).map((c) => c.slug), ["general"]);
  assert.deepEqual(
    listForActor(ctx, a.id).map((c) => c.slug).sort(),
    ["general", "sekret"],
  );
});

test("listForActor pokazuje DM-y, ktorych jestem uczestnikiem", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c = mkActor(ctx, "cez");
  ensureDirect(ctx, [a.id, b.id]);
  ensureDirect(ctx, [b.id, c.id]);
  assert.equal(listForActor(ctx, a.id).filter((x) => x.kind === "dm").length, 1);
});

test("recipientsOf zwraca czlonkow, a nie wszystkich aktorow", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  mkActor(ctx, "obserwator-ktory-nie-dolaczyl");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  assert.deepEqual(recipientsOf(ctx, c.id).sort(), [a.id, b.id].sort());
});

test("setNotify dolacza aktora, jesli jeszcze nie byl czlonkiem", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  setNotify(ctx, c.id, b.id, "all");
  assert.equal(isMember(ctx, c.id, b.id), true);
});
