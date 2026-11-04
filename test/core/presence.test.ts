// Polish fixture labels exercise session updates without changing the supplied text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import {
  endSession,
  heartbeat,
  presence,
  registerSession,
  setDoing,
  signal,
} from "../../src/core/presence.ts";

test("typing expires after 7 s; busy lasts 30 s", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  signal(ctx, "s1", "typing");
  signal(ctx, "s1", "busy");
  assert.equal(presence(ctx)[0].typing, true);
  assert.equal(presence(ctx)[0].busy, true);
  t += 8;
  assert.equal(presence(ctx)[0].typing, false);
  assert.equal(presence(ctx)[0].busy, true);
  t += 30;
  assert.equal(presence(ctx)[0].busy, false);
});

test("an ephemeral session disappears from presence sooner than a durable session", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "efem", actorId: a.id, kind: "ephemeral" });
  registerSession(ctx, { sessionId: "trwala", actorId: a.id, kind: "durable" });
  t += 120;
  const byId = Object.fromEntries(presence(ctx).map((p) => [p.sessionId, p]));
  assert.equal(byId["efem"], undefined);
  assert.equal(byId["trwala"].stale, false);
});

test("an ended session disappears from presence; its identity remains in the roster", () => {
  // Feedback from #nextIteration: the prototype's participant list grew monotonically, because
  // ended sessions never disappeared. Presence shows who you can talk to NOW; who EXISTS is what
  // the actor roster says.
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "efem", actorId: a.id, kind: "ephemeral" });
  registerSession(ctx, { sessionId: "trwala", actorId: a.id, kind: "durable" });
  endSession(ctx, "efem");
  endSession(ctx, "trwala");
  assert.deepEqual(presence(ctx), []);
});

test("a durable session without a heartbeat disappears after retention; before then it is stale", () => {
  let t = 1_000_000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, kind: "durable" });
  t += 6 * 24 * 3600;
  assert.equal(presence(ctx).length, 1);
  assert.equal(presence(ctx)[0].stale, true);
  t += 2 * 24 * 3600;
  assert.deepEqual(presence(ctx), []);
});

test("session kind is declared rather than guessed from the name", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  // The prototype guessed from the "bs/" prefix and treated that as ephemeral.
  registerSession(ctx, { sessionId: "x", actorId: a.id, label: "bs/uzytkownik" });
  assert.equal(presence(ctx)[0].kind, "durable");
});

test("two sessions of the same actor are one participant, without suffixes", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "vps" });
  registerSession(ctx, { sessionId: "s2", actorId: a.id, label: "laptop" });
  const rows = presence(ctx);
  assert.equal(rows.length, 2);
  assert.deepEqual([...new Set(rows.map((r) => r.handle))], ["nestor"]);
});

test("registering the same session again updates it rather than duplicating it", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "stara" });
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "nowa" });
  assert.equal(presence(ctx).length, 1);
  assert.equal(presence(ctx)[0].label, "nowa");
});

test("a heartbeat refreshes the session so it is no longer stale", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  t += 700;
  assert.equal(presence(ctx)[0].stale, true);
  heartbeat(ctx, "s1");
  assert.equal(presence(ctx)[0].stale, false);
});

test("doing is visible in presence", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  setDoing(ctx, "s1", "deploy motowolt");
  assert.equal(presence(ctx)[0].doing, "deploy motowolt");
});

test("registering a session for a missing actor is rejected", () => {
  const ctx = testCtx();
  assert.throws(() => registerSession(ctx, { sessionId: "s1", actorId: 999 }), /actor .* was not found/);
});

test("heartbeats and signals do NOT erase a label set through me", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "vps-deploy", kind: "durable" });
  // atalk ping/busy calls registerSession with only a sessionId
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  signal(ctx, "s1", "busy");
  const p = presence(ctx)[0];
  assert.equal(p.label, "vps-deploy", "heartbeat erased the label");
  assert.equal(p.kind, "durable");
});

/**
 * Broadcasting presence ONLY on a real change.
 *
 *The interface beats a heartbeat every 30 s with the same `registerSession`. If every such
 *call published an event, with N open sessions each of them would wake all the others every
 *30 s - traffic grows with the SQUARE of the number of participants, and the event's content
 *is the same every time. The damping is invisible in operation (nothing breaks, it merely
 *gets expensive), so without a test it comes back at the first refactoring.
 */
test("presence broadcasts on changes rather than every heartbeat", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala");
  let broadcasts = 0;
  const original = ctx.bus.publish.bind(ctx.bus);
  ctx.bus.publish = (recipients, ev) => {
    if (ev.type === "presence") broadcasts++;
    return original(recipients, ev);
  };

  registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "praca", kind: "durable" });
  assert.equal(broadcasts, 1, "a new session MUST wake others");

  // Three heartbeats through the same call, nothing changes.
  for (let i = 0; i < 3; i++) {
    registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "praca", kind: "durable" });
  }
  assert.equal(broadcasts, 1, "an unchanged heartbeat must not wake anyone");

  // A label change IS visible to others, so it has to be broadcast.
  registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "deploy", kind: "durable" });
  assert.equal(broadcasts, 2, "a label change must be broadcast");

  // Coming back after a session ended is a state change too.
  endSession(ctx, "s1");
  const afterEnd = broadcasts;
  registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "deploy", kind: "durable" });
  assert.equal(broadcasts, afterEnd + 1, "a returning session must be broadcast");
});

/**
 * The "typing" signal with its own lifetime.
 *
 *Seven seconds is right for a HUMAN - every key refreshes the signal. For an agent it is
 *useless: an agent composes an answer in one move lasting tens of seconds with nothing to
 *refresh along the way, so the bubble went out before anybody managed to see it. Measured in
 *production before this change: the signal was set EVER by 8 of 26 sessions, mostly my own
 *attempts.
 */
test("a typing signal may carry its own lifetime, defaulting to 7 s", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, kind: "durable" });
  const isTyping = () => presence(ctx).find((p) => p.sessionId === "s1")?.typing ?? false;

  // By default: 7 s, as before.
  signal(ctx, "s1", "typing", { typingIn: "c:1" });
  assert.equal(isTyping(), true);
  t += 8;
  assert.equal(isTyping(), false, "the default lifetime must not increase");

  // Custom: the agent declares how long composing an answer will really take it.
  t += 1;
  signal(ctx, "s1", "typing", { typingIn: "c:1", sec: 90 });
  t += 60;
  assert.equal(isTyping(), true, "the signal expired halfway through its declared window");
  t += 31;
  assert.equal(isTyping(), false, "the signal must not outlive its declared lifetime");

  // The upper bound: a declaration must not turn the bubble into a permanent light.
  t += 1;
  signal(ctx, "s1", "typing", { typingIn: "c:1", sec: 99_999 });
  t += 301;
  assert.equal(isTyping(), false, "no upper bound; the indicator could remain for hours");

  // stop clears it at once, a long signal included.
  t += 1;
  signal(ctx, "s1", "typing", { typingIn: "c:1", sec: 300 });
  assert.equal(isTyping(), true);
  signal(ctx, "s1", "typing", { stop: true });
  assert.equal(isTyping(), false, "stop must also clear a signal with a long window");
});
