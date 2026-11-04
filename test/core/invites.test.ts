// Polish fixture actor names exercise invite redemption and name-conflict handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { createInvite, redeemInvite, revokeInvite } from "../../src/core/invites.ts";
import { verifyToken } from "../../src/core/tokens.ts";
import { getActorByHandle } from "../../src/core/actors.ts";

test("invite: an agent creates an actor with it and the token works", () => {
  const ctx = testCtx();
  const admin = mkActor(ctx, "admin");
  const { code } = createInvite(ctx, { createdBy: admin.id });
  const { actor, token } = redeemInvite(ctx, { code, handle: "nowy" });
  assert.equal(actor.handle, "nowy");
  assert.equal(actor.kind, "agent");
  assert.equal(verifyToken(ctx, token)?.id, actor.id);
});

test("an invite with a usage limit runs out", () => {
  const ctx = testCtx();
  const { code } = createInvite(ctx, { createdBy: null, uses: 1 });
  redeemInvite(ctx, { code, handle: "pierwszy" });
  assert.throws(() => redeemInvite(ctx, { code, handle: "drugi" }), /used up|invalid/);
});

test("an invite expires after its TTL", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const { code } = createInvite(ctx, { createdBy: null, ttlSec: 60 });
  t = 1061;
  assert.throws(() => redeemInvite(ctx, { code, handle: "spozniony" }), /expired|invalid/);
});

test("an occupied name does NOT consume the invite", () => {
  const ctx = testCtx();
  mkActor(ctx, "zajety");
  const { code } = createInvite(ctx, { createdBy: null, uses: 1 });
  assert.throws(() => redeemInvite(ctx, { code, handle: "zajety" }), /already taken/);
  // the use was not consumed - a different name goes through
  const r = redeemInvite(ctx, { code, handle: "wolny" });
  assert.equal(r.actor.handle, "wolny");
});

test("a revoked invite no longer works", () => {
  const ctx = testCtx();
  const { code, info } = createInvite(ctx, { createdBy: null });
  assert.equal(revokeInvite(ctx, info.id), true);
  assert.throws(() => redeemInvite(ctx, { code, handle: "ktos" }), /invalid/);
});

test("revokeInvite: a missing/already-revoked id returns false without false success", () => {
  const ctx = testCtx();
  const { info } = createInvite(ctx, { createdBy: null });
  assert.equal(revokeInvite(ctx, 99999), false); // there is no such id
  assert.equal(revokeInvite(ctx, info.id), true); // the first revocation works
  assert.equal(revokeInvite(ctx, info.id), false); // the second does not - it was already revoked
});

test("an --admin invite gives the actor admin privileges", () => {
  const ctx = testCtx();
  const { code } = createInvite(ctx, { createdBy: null, makeAdmin: true });
  const { actor } = redeemInvite(ctx, { code, handle: "szef" });
  assert.equal(actor.isAdmin, true);
  assert.equal(getActorByHandle(ctx, "szef")?.isAdmin, true);
});

test("a garbage code is rejected without creating an actor", () => {
  const ctx = testCtx();
  assert.throws(() => redeemInvite(ctx, { code: "smiec", handle: "x" }), /invalid/);
  assert.equal(getActorByHandle(ctx, "x"), null);
});

// --- limiter key (login/enroll) with X-Forwarded-For ---
test("clientKey: behind a proxy, uses the RIGHT XFF entry, not the spoofable left one", async () => {
  const { clientKey } = await import("../../src/http/routes/auth.ts");
  const mk = (xff: string | undefined, ip = "10.0.0.1") =>
    ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: ip } });

  // Behind a proxy: nginx appends the real IP on the RIGHT. The left one is in the client's hands.
  assert.equal(clientKey(mk("1.1.1.1, 203.0.113.9"), true), "203.0.113.9");
  // The client swaps the left one -> the key does NOT change (the same limiter bucket).
  assert.equal(clientKey(mk("9.9.9.9, 203.0.113.9"), true), "203.0.113.9");
  // Without trusting a proxy: only the socket address counts.
  assert.equal(clientKey(mk("1.1.1.1, 203.0.113.9"), false), "10.0.0.1");
  // No header: use the socket address.
  assert.equal(clientKey(mk(undefined), true), "10.0.0.1");
});
