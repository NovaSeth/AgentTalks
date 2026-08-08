import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { createInvite, redeemInvite, revokeInvite } from "../../src/core/invites.ts";
import { verifyToken } from "../../src/core/tokens.ts";
import { getActorByHandle } from "../../src/core/actors.ts";

test("zaproszenie: agent zaklada nim aktora i dziala token", () => {
  const ctx = testCtx();
  const admin = mkActor(ctx, "admin");
  const { code } = createInvite(ctx, { createdBy: admin.id });
  const { actor, token } = redeemInvite(ctx, { code, handle: "nowy" });
  assert.equal(actor.handle, "nowy");
  assert.equal(actor.kind, "agent");
  assert.equal(verifyToken(ctx, token)?.id, actor.id);
});

test("zaproszenie z limitem uzyc wyczerpuje sie", () => {
  const ctx = testCtx();
  const { code } = createInvite(ctx, { createdBy: null, uses: 1 });
  redeemInvite(ctx, { code, handle: "pierwszy" });
  assert.throws(() => redeemInvite(ctx, { code, handle: "drugi" }), /zuzyte|nieprawidlowe/);
});

test("zaproszenie wygasa po TTL", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const { code } = createInvite(ctx, { createdBy: null, ttlSec: 60 });
  t = 1061;
  assert.throws(() => redeemInvite(ctx, { code, handle: "spozniony" }), /wygasle|nieprawidlowe/);
});

test("zajeta nazwa NIE zuzywa zaproszenia", () => {
  const ctx = testCtx();
  mkActor(ctx, "zajety");
  const { code } = createInvite(ctx, { createdBy: null, uses: 1 });
  assert.throws(() => redeemInvite(ctx, { code, handle: "zajety" }), /zajeta/);
  // uzycie nie przepadlo - inna nazwa przechodzi
  const r = redeemInvite(ctx, { code, handle: "wolny" });
  assert.equal(r.actor.handle, "wolny");
});

test("odwolane zaproszenie nie dziala", () => {
  const ctx = testCtx();
  const { code, info } = createInvite(ctx, { createdBy: null });
  revokeInvite(ctx, info.id);
  assert.throws(() => redeemInvite(ctx, { code, handle: "ktos" }), /nieprawidlowe/);
});

test("zaproszenie --admin nadaje aktorowi uprawnienia admina", () => {
  const ctx = testCtx();
  const { code } = createInvite(ctx, { createdBy: null, makeAdmin: true });
  const { actor } = redeemInvite(ctx, { code, handle: "szef" });
  assert.equal(actor.isAdmin, true);
  assert.equal(getActorByHandle(ctx, "szef")?.isAdmin, true);
});

test("smieciowy kod jest odrzucany bez tworzenia aktora", () => {
  const ctx = testCtx();
  assert.throws(() => redeemInvite(ctx, { code: "smiec", handle: "x" }), /nieprawidlowy/);
  assert.equal(getActorByHandle(ctx, "x"), null);
});
