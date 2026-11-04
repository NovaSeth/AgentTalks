// Polish fixture slugs and topics exercise channel updates and access checks with Polish input.
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

test("a public channel is readable without membership; posting joins it", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "nestor");
  const c = createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  assert.equal(canRead(ctx, c.id, b.id), true);
  assert.equal(isMember(ctx, c.id, b.id), false);
  assertCanPost(ctx, c.id, b.id);
  assert.equal(isMember(ctx, c.id, b.id), true);
});

test("the channel creator is its admin", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal");
  const c = createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  assert.equal(members(ctx, c.id)[0].role, "admin");
});

test("a private channel is invisible to an outsider", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "infra", kind: "private", createdBy: a.id });
  assert.equal(canRead(ctx, c.id, b.id), false);
  assert.throws(() => assertCanRead(ctx, c.id, b.id), /do not have access/);
  assert.throws(() => assertCanPost(ctx, c.id, b.id), /do not have access/);
});

test("a missing conversation and a forbidden one return the same error", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "infra", kind: "private", createdBy: a.id });
  const missing = (() => { try { assertCanRead(ctx, 9999, b.id); } catch (e) { return e as Error; } })();
  const forbidden = (() => { try { assertCanRead(ctx, c.id, b.id); } catch (e) { return e as Error; } })();
  assert.equal(missing!.message, forbidden!.message);
});

test("two channels cannot have the same name", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal");
  createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  assert.throws(
    () => createChannel(ctx, { slug: "#General", kind: "public", createdBy: a.id }),
    /already exists/,
  );
});

test("ensureDirect for two actors returns a DM and is idempotent regardless of order", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d1 = ensureDirect(ctx, [a.id, b.id]);
  const d2 = ensureDirect(ctx, [b.id, a.id]);
  assert.equal(d1.id, d2.id);
  assert.equal(d1.kind, "dm");
  assert.equal(members(ctx, d1.id).length, 2);
});

test("ensureDirect for three actors returns a group distinct from the pair's DM", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c = mkActor(ctx, "cez");
  const dm = ensureDirect(ctx, [a.id, b.id]);
  const gr = ensureDirect(ctx, [a.id, b.id, c.id]);
  assert.equal(gr.kind, "group");
  assert.notEqual(gr.id, dm.id);
  assert.equal(members(ctx, gr.id).length, 3);
});

test("a direct conversation delivers every message, including those without mentions", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  assert.ok(members(ctx, d.id).every((m) => m.notify === "all"));
});

test("ensureDirect rejects fewer than two actors and duplicates", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  assert.throws(() => ensureDirect(ctx, [a.id]), /at least/);
  assert.throws(() => ensureDirect(ctx, [a.id, a.id]), /at least/);
});

test("a direct conversation cannot be left, but a channel can", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const d = ensureDirect(ctx, [a.id, b.id]);
  assert.throws(() => leave(ctx, d.id, a.id), /cannot leave/);
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  leave(ctx, c.id, b.id);
  assert.equal(isMember(ctx, c.id, b.id), false);
});

test("listForActor returns public channels and the actor's private channels, excluding others' private channels", () => {
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

test("listForActor shows DMs the actor participates in", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c = mkActor(ctx, "cez");
  ensureDirect(ctx, [a.id, b.id]);
  ensureDirect(ctx, [b.id, c.id]);
  assert.equal(listForActor(ctx, a.id).filter((x) => x.kind === "dm").length, 1);
});

test("recipientsOf returns members rather than all actors", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  mkActor(ctx, "obserwator-ktory-nie-dolaczyl");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  assert.deepEqual(recipientsOf(ctx, c.id).sort(), [a.id, b.id].sort());
});

test("setNotify joins an actor who is not yet a member", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  setNotify(ctx, c.id, b.id, "all");
  assert.equal(isMember(ctx, c.id, b.id), true);
});

// --- channel management (editing, archiving, removing members) -----------

test("updateConversation: a channel admin can change the topic and slug; an ordinary member cannot", async () => {
  const { updateConversation } = await import("../../src/core/conversations.ts");
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "stary", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const upd = updateConversation(ctx, {
    convId: c.id, actorId: a.id, isInstanceAdmin: false, topic: "Nowy temat", slug: "nowy",
  });
  assert.equal(upd.topic, "Nowy temat");
  assert.equal(upd.slug, "nowy");
  assert.throws(
    () => updateConversation(ctx, { convId: c.id, actorId: b.id, isInstanceAdmin: false, topic: "hack" }),
    /can manage/,
  );
  // the instance admin can, despite having no role in the channel
  const upd2 = updateConversation(ctx, { convId: c.id, actorId: b.id, isInstanceAdmin: true, topic: "od admina" });
  assert.equal(upd2.topic, "od admina");
});

test("updateConversation: another channel's slug is rejected; DMs have no slug", async () => {
  const { updateConversation } = await import("../../src/core/conversations.ts");
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  createChannel(ctx, { slug: "zajety", kind: "public", createdBy: a.id });
  const c2 = createChannel(ctx, { slug: "wolny", kind: "public", createdBy: a.id });
  assert.throws(
    () => updateConversation(ctx, { convId: c2.id, actorId: a.id, isInstanceAdmin: false, slug: "zajety" }),
    /exists/,
  );
  const dm = ensureDirect(ctx, [a.id, b.id]);
  assert.throws(
    () => updateConversation(ctx, { convId: dm.id, actorId: a.id, isInstanceAdmin: true, slug: "x" }),
    /slug/,
  );
});

test("archiveConversation: disappears from lists and refuses messages; DMs are protected", async () => {
  const { archiveConversation, assertCanPost: acp } = await import("../../src/core/conversations.ts");
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "do-kasacji", kind: "public", createdBy: a.id });
  archiveConversation(ctx, { convId: c.id, actorId: a.id, isInstanceAdmin: false });
  assert.equal(listForActor(ctx, a.id).some((x) => x.id === c.id), false);
  assert.throws(() => acp(ctx, c.id, a.id), /archived/);
  const dm = ensureDirect(ctx, [a.id, b.id]);
  assert.throws(
    () => archiveConversation(ctx, { convId: dm.id, actorId: a.id, isInstanceAdmin: true }),
    /one-to-one/,
  );
});

test("removeMember: a channel admin can remove others, anyone can remove themselves; DMs/groups refuse removal", async () => {
  const { removeMember } = await import("../../src/core/conversations.ts");
  const ctx = testCtx();
  const a = mkActor(ctx, "ala"), b = mkActor(ctx, "bob"), c3 = mkActor(ctx, "celina");
  const c = createChannel(ctx, { slug: "priv", kind: "private", createdBy: a.id });
  join(ctx, c.id, b.id);
  join(ctx, c.id, c3.id);
  // an ordinary member does not throw others out
  assert.throws(
    () => removeMember(ctx, { convId: c.id, actorId: b.id, targetActorId: c3.id, isInstanceAdmin: false }),
    /can manage/,
  );
  // yourself - allowed
  removeMember(ctx, { convId: c.id, actorId: b.id, targetActorId: b.id, isInstanceAdmin: false });
  assert.equal(isMember(ctx, c.id, b.id), false);
  // a channel admin throws others out
  removeMember(ctx, { convId: c.id, actorId: a.id, targetActorId: c3.id, isInstanceAdmin: false });
  assert.equal(isMember(ctx, c.id, c3.id), false);
  const grp = ensureDirect(ctx, [a.id, b.id, c3.id]);
  assert.throws(
    () => removeMember(ctx, { convId: grp.id, actorId: a.id, targetActorId: b.id, isInstanceAdmin: true }),
    /direct conversation/,
  );
});
