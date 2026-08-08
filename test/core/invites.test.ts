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
  assert.equal(revokeInvite(ctx, info.id), true);
  assert.throws(() => redeemInvite(ctx, { code, handle: "ktos" }), /nieprawidlowe/);
});

test("revokeInvite: nieistniejace/juz-odwolane id zwraca false (bez falszywego sukcesu)", () => {
  const ctx = testCtx();
  const { info } = createInvite(ctx, { createdBy: null });
  assert.equal(revokeInvite(ctx, 99999), false); // nie ma takiego id
  assert.equal(revokeInvite(ctx, info.id), true); // pierwsze odwolanie dziala
  assert.equal(revokeInvite(ctx, info.id), false); // drugie juz nie - bylo odwolane
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

// --- klucz limitera (login/enroll) wobec X-Forwarded-For ---
test("clientKey: przy proxy bierze PRAWY czlon XFF (nie spoofowalny lewy)", async () => {
  const { clientKey } = await import("../../src/http/routes/auth.ts");
  const mk = (xff: string | undefined, ip = "10.0.0.1") =>
    ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: ip } });

  // Za proxy: nginx dopisuje realny IP z PRAWEJ. Lewy jest w rekach klienta.
  assert.equal(clientKey(mk("1.1.1.1, 203.0.113.9"), true), "203.0.113.9");
  // Klient podmienia lewy -> klucz sie NIE zmienia (ten sam kubelek limitera).
  assert.equal(clientKey(mk("9.9.9.9, 203.0.113.9"), true), "203.0.113.9");
  // Bez zaufania do proxy: liczy sie wylacznie adres gniazda.
  assert.equal(clientKey(mk("1.1.1.1, 203.0.113.9"), false), "10.0.0.1");
  // Brak naglowka: adres gniazda.
  assert.equal(clientKey(mk(undefined), true), "10.0.0.1");
});
