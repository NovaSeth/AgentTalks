import { test } from "node:test";
import assert from "node:assert/strict";
import { testCtx } from "../helpers.ts";
import { normalizeHandle, normalizeSlug } from "../../src/core/ids.ts";
import {
  createActor,
  getActorByHandle,
  listActors,
  setDisplayName,
  setPassword,
  verifyPassword,
} from "../../src/core/actors.ts";

test("handle jest normalizowany i walidowany", () => {
  assert.equal(normalizeHandle("  @Nestor "), "nestor");
  assert.equal(normalizeHandle("bs/uzytkownik"), "bs-uzytkownik");
  assert.equal(normalizeHandle("Nestor/chat-vps"), "nestor-chat-vps");
  assert.throws(() => normalizeHandle("a"), /handle/);
  assert.throws(() => normalizeHandle("x".repeat(33)), /handle/);
  assert.throws(() => normalizeHandle("!!!"), /handle/);
});

test("slug kanalu gubi krzyzyk", () => {
  assert.equal(normalizeSlug("#general"), "general");
  assert.equal(normalizeSlug("Infra"), "infra");
});

test("nie da sie utworzyc dwoch aktorow o tym samym handle", () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "agent", handle: "nestor" });
  assert.throws(() => createActor(ctx, { kind: "agent", handle: "Nestor" }), /zajety/);
});

test("displayName domyslnie rowna sie handle i daje sie zmienic bez ruszania handle", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "agent", handle: "eipa" });
  assert.equal(a.displayName, "eipa");
  const b = setDisplayName(ctx, a.id, "eipa - ceny");
  assert.equal(b.displayName, "eipa - ceny");
  assert.equal(b.handle, "eipa");
});

test("haslo weryfikuje sie przez scrypt i nie jest przechowywane jawnie", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "human", handle: "michal" });
  setPassword(ctx, a.id, "tajne123");
  assert.equal(verifyPassword(ctx, "michal", "tajne123")?.id, a.id);
  assert.equal(verifyPassword(ctx, "michal", "zle"), null);
  const row = ctx.db.prepare("SELECT password_hash FROM actors WHERE id=?").get(a.id) as {
    password_hash: string;
  };
  assert.ok(!row.password_hash.includes("tajne123"));
  assert.match(row.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test("aktor bez hasla nie zaloguje sie pustym haslem", () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "agent", handle: "nestor" });
  assert.equal(verifyPassword(ctx, "nestor", ""), null);
});

test("za krotkie haslo jest odrzucone", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "human", handle: "michal" });
  assert.throws(() => setPassword(ctx, a.id, "krotkie"), /8 znakow/);
});

test("getActorByHandle nie rzuca na smieciach, tylko zwraca null", () => {
  const ctx = testCtx();
  assert.equal(getActorByHandle(ctx, "!!!nie-ma-takiego!!!"), null);
  assert.equal(getActorByHandle(ctx, ""), null);
});

test("listActors sortuje po handle", () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "agent", handle: "zeta" });
  createActor(ctx, { kind: "agent", handle: "alfa" });
  assert.deepEqual(listActors(ctx).map((a) => a.handle), ["alfa", "zeta"]);
});
