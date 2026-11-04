import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { listTokens, mintToken, revokeToken, verifyToken } from "../../src/core/tokens.ts";

test("a token verifies and returns the actor", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  const { token } = mintToken(ctx, a.id, "vps");
  assert.match(token, /^atk_[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyToken(ctx, token)?.id, a.id);
});

test("the database stores the hash rather than the token", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  const { token } = mintToken(ctx, a.id, "vps");
  const rows = ctx.db.prepare("SELECT hash FROM tokens").all() as Array<{ hash: string }>;
  assert.ok(rows.every((r) => !r.hash.includes(token)));
  assert.match(rows[0].hash, /^[0-9a-f]{64}$/);
});

test("a revoked token stops working; other tokens remain valid", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  const vps = mintToken(ctx, a.id, "vps");
  const mac = mintToken(ctx, a.id, "mac");
  revokeToken(ctx, vps.info.id);
  assert.equal(verifyToken(ctx, vps.token), null);
  assert.equal(verifyToken(ctx, mac.token)?.id, a.id);
});

test("an invalid token returns null rather than throwing", () => {
  const ctx = testCtx();
  assert.equal(verifyToken(ctx, "atk_" + "x".repeat(43)), null);
  // Polish garbage input verifies that malformed tokens are rejected without throwing.
  assert.equal(verifyToken(ctx, "smiec"), null);
  assert.equal(verifyToken(ctx, ""), null);
});

test("token use is recorded in last_used_at", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "nestor");
  const { token, info } = mintToken(ctx, a.id, "vps");
  assert.equal(info.lastUsedAt, null);
  t = 2000;
  verifyToken(ctx, token);
  assert.equal(listTokens(ctx, a.id)[0].lastUsedAt, 2000);
});

test("a disabled actor's token does not work", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  const { token } = mintToken(ctx, a.id, "vps");
  ctx.db.prepare("UPDATE actors SET disabled_at = 1 WHERE id = ?").run(a.id);
  assert.equal(verifyToken(ctx, token), null);
});

test("a token with a TTL expires and stops authenticating", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "nestor");
  const { token, info } = mintToken(ctx, a.id, "ci", 60);
  assert.equal(info.expiresAt, 1060);
  assert.equal(verifyToken(ctx, token)?.id, a.id);
  t = 1061;
  assert.equal(verifyToken(ctx, token), null, "the expired token still works");
});

test("a token without a TTL does not expire", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "nestor");
  const { token, info } = mintToken(ctx, a.id, "vps");
  assert.equal(info.expiresAt, null);
  t = 10 ** 12;
  assert.equal(verifyToken(ctx, token)?.id, a.id);
});
