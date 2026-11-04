/**
 * T-MG-7, package A2: reads authorised against CURRENT access, and session ids that belong
 * to the caller. Findings B-MG-1/29, B-MG-6/53, B-MG-7/48, B-MG-23.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import { bearer, startTestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join, removeMember } from "../../src/core/conversations.ts";
import { deleteMessage, editMessage, getMessage, postMessage } from "../../src/core/messages.ts";
import { listNotifications, unreadNotificationCount } from "../../src/core/notifications.ts";
import { presence, presenceFor, registerSession, signal, whoIsTyping } from "../../src/core/presence.ts";
import { acquire } from "../../src/core/leases.ts";

function privateScene() {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const priv = createChannel(ctx, { slug: "secret", kind: "private", createdBy: alice.id });
  const pub = createChannel(ctx, { slug: "general", kind: "public", createdBy: alice.id });
  join(ctx, priv.id, bob.id);
  join(ctx, pub.id, bob.id);
  return { ctx, alice, bob, priv, pub };
}

// ---- B-MG-1 + B-MG-29 ------------------------------------------------------

test("B-MG-1: notifications from a private channel disappear after removal, public ones stay", () => {
  const { ctx, alice, bob, priv, pub } = privateScene();
  postMessage(ctx, { conversationId: priv.id, actorId: alice.id, body: "@bob the secret plan" });
  postMessage(ctx, { conversationId: pub.id, actorId: alice.id, body: "@bob public hello" });
  assert.equal(listNotifications(ctx, bob.id).length, 2);
  assert.equal(unreadNotificationCount(ctx, bob.id), 2);

  removeMember(ctx, { convId: priv.id, actorId: alice.id, targetActorId: bob.id, isInstanceAdmin: false });

  const rows = listNotifications(ctx, bob.id);
  assert.deepEqual(rows.map((n) => n.conversationId), [pub.id]);
  assert.ok(!rows.some((n) => (n.excerpt ?? "").includes("secret")));
  assert.equal(listNotifications(ctx, bob.id, { unreadOnly: true }).length, 1);
  assert.equal(unreadNotificationCount(ctx, bob.id), 1);
});

// ---- B-MG-6 + B-MG-53 ------------------------------------------------------

test("B-MG-6: whoIsTyping hides a typing location the viewer cannot read", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const carol = mkActor(ctx, "carol");
  const priv = createChannel(ctx, { slug: "review-room", kind: "private", createdBy: alice.id });
  join(ctx, priv.id, carol.id);
  registerSession(ctx, { sessionId: "s-alice", actorId: alice.id });
  signal(ctx, "s-alice", "typing", { typingIn: `c:${priv.id}` });

  assert.deepEqual(whoIsTyping(ctx, bob.id), []);
  assert.deepEqual(whoIsTyping(ctx, carol.id), [{ handle: "alice", in: `c:${priv.id}` }]);
});

test("B-MG-53: presenceFor hides private typing and foreign session details", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const admin = createActor(ctx, { kind: "human", handle: "boss", isAdmin: true });
  const agentAdmin = createActor(ctx, { kind: "agent", handle: "robo", isAdmin: true });
  const priv = createChannel(ctx, { slug: "review-room", kind: "private", createdBy: alice.id });
  registerSession(ctx, { sessionId: "s-alice", actorId: alice.id, cwd: "/home/alice/proj" });
  signal(ctx, "s-alice", "typing", { typingIn: `c:${priv.id}` });

  const asBob = presenceFor(ctx, bob.id).find((p) => p.handle === "alice")!;
  assert.equal(asBob.typing, false);
  assert.equal(asBob.typingIn, null);
  assert.equal(asBob.sessionId, null);
  assert.equal(asBob.cwd, null);

  const asAlice = presenceFor(ctx, alice.id).find((p) => p.handle === "alice")!;
  assert.equal(asAlice.typing, true);
  assert.equal(asAlice.typingIn, `c:${priv.id}`);
  assert.equal(asAlice.sessionId, "s-alice");
  assert.equal(asAlice.cwd, "/home/alice/proj");

  // A human admin sees the session details (but still not the private location).
  const asAdmin = presenceFor(ctx, admin.id).find((p) => p.handle === "alice")!;
  assert.equal(asAdmin.sessionId, "s-alice");
  assert.equal(asAdmin.cwd, "/home/alice/proj");
  assert.equal(asAdmin.typingIn, null);
  // An agent admin does not.
  const asRobo = presenceFor(ctx, agentAdmin.id).find((p) => p.handle === "alice")!;
  assert.equal(asRobo.sessionId, null);
  // The unfiltered presence(ctx) keeps its signature for its existing consumers.
  assert.equal(presence(ctx)[0].sessionId, "s-alice");
});

test("B-MG-53: GET /api/presence is filtered for the caller", async () => {
  const s = await startTestServer();
  try {
    const alice = mkActor(s.ctx, "alice");
    const bob = mkActor(s.ctx, "bob");
    const priv = createChannel(s.ctx, { slug: "review-room", kind: "private", createdBy: alice.id });
    registerSession(s.ctx, { sessionId: "s-alice", actorId: alice.id, label: "laptop", cwd: "/home/alice" });
    signal(s.ctx, "s-alice", "typing", { typingIn: `c:${priv.id}` });
    const tokenB = mintToken(s.ctx, bob.id, "t").token;
    const r = await fetch(s.url + "/api/presence", { headers: bearer(tokenB) });
    assert.equal(r.status, 200);
    const body = JSON.stringify(await r.json());
    assert.ok(!body.includes(`c:${priv.id}`), body);
    assert.ok(!body.includes("s-alice"), body);
    assert.ok(!body.includes("/home/alice"), body);
  } finally {
    await s.close();
  }
});

// ---- B-MG-7 + B-MG-48 ------------------------------------------------------

test("B-MG-7: a foreign sessionId is dropped from a post and does not clear the owner's typing", () => {
  const { ctx, alice, bob, pub } = privateScene();
  registerSession(ctx, { sessionId: "s-alice", actorId: alice.id });
  signal(ctx, "s-alice", "typing", { typingIn: `c:${pub.id}` });

  const m = postMessage(ctx, { conversationId: pub.id, actorId: bob.id, body: "hi", sessionId: "s-alice" });
  assert.equal(getMessage(ctx, m.id)!.sessionId, null);
  assert.equal(presence(ctx).find((p) => p.sessionId === "s-alice")!.typing, true);

  // The owner's own post keeps the id and does clear the bubble.
  const own = postMessage(ctx, { conversationId: pub.id, actorId: alice.id, body: "me", sessionId: "s-alice" });
  assert.equal(getMessage(ctx, own.id)!.sessionId, "s-alice");
  assert.equal(presence(ctx).find((p) => p.sessionId === "s-alice")!.typing, false);
});

test("B-MG-48: a lease does not record a foreign sessionId", () => {
  const { ctx, alice, bob } = privateScene();
  registerSession(ctx, { sessionId: "s-alice", actorId: alice.id });
  registerSession(ctx, { sessionId: "s-bob", actorId: bob.id });
  const foreign = acquire(ctx, { resource: "repo/a", actorId: bob.id, sessionId: "s-alice" });
  assert.equal(foreign.granted, true);
  assert.equal(foreign.granted && foreign.lease.sessionId, null);
  const own = acquire(ctx, { resource: "repo/b", actorId: bob.id, sessionId: "s-bob" });
  assert.equal(own.granted && own.lease.sessionId, "s-bob");
});

// ---- B-MG-23 ---------------------------------------------------------------

test("B-MG-23: an ex-member cannot edit or delete in a private channel; no event, no notification", () => {
  const { ctx, alice, bob, priv } = privateScene();
  const carol = mkActor(ctx, "carol");
  join(ctx, priv.id, carol.id);
  const m = postMessage(ctx, { conversationId: priv.id, actorId: bob.id, body: "draft" });
  removeMember(ctx, { convId: priv.id, actorId: alice.id, targetActorId: bob.id, isInstanceAdmin: false });

  const events: unknown[] = [];
  ctx.bus.subscribe(alice.id, (e) => events.push(e));
  ctx.bus.subscribe(carol.id, (e) => events.push(e));
  const before = unreadNotificationCount(ctx, carol.id);

  assert.throws(() => editMessage(ctx, m.id, bob.id, "@carol edited"), (e: any) => e.status === 403);
  assert.throws(() => deleteMessage(ctx, m.id, bob.id), (e: any) => e.status === 403);
  assert.equal(getMessage(ctx, m.id)!.body, "draft");
  assert.equal(getMessage(ctx, m.id)!.deletedAt, null);
  assert.deepEqual(events, []);
  assert.equal(unreadNotificationCount(ctx, carol.id), before);
});

test("B-MG-23: editing in an archived channel is refused", async () => {
  const { ctx, alice, pub } = privateScene();
  const { archiveConversation } = await import("../../src/core/conversations.ts");
  const m = postMessage(ctx, { conversationId: pub.id, actorId: alice.id, body: "old" });
  archiveConversation(ctx, { convId: pub.id, actorId: alice.id, isInstanceAdmin: true });
  assert.throws(() => editMessage(ctx, m.id, alice.id, "new"), (e: any) => e.status === 403);
});
