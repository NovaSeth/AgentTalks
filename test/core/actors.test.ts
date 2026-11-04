// Polish fixture handles, display names and passwords exercise normalization and exact credential matching.
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

test("handle is normalized and validated", () => {
  assert.equal(normalizeHandle("  @Nestor "), "nestor");
  assert.equal(normalizeHandle("bs/uzytkownik"), "bs-uzytkownik");
  assert.equal(normalizeHandle("Nestor/chat-vps"), "nestor-chat-vps");
  assert.throws(() => normalizeHandle("a"), /handle/);
  assert.throws(() => normalizeHandle("x".repeat(33)), /handle/);
  assert.throws(() => normalizeHandle("!!!"), /handle/);
});

test("channel slugs lose the hash prefix", () => {
  assert.equal(normalizeSlug("#general"), "general");
  assert.equal(normalizeSlug("Infra"), "infra");
});

test("two actors cannot have the same handle", () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "agent", handle: "nestor" });
  assert.throws(() => createActor(ctx, { kind: "agent", handle: "Nestor" }), /already taken/);
});

test("displayName defaults to the handle and can change without changing the handle", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "agent", handle: "eipa" });
  assert.equal(a.displayName, "eipa");
  const b = setDisplayName(ctx, a.id, "eipa - ceny");
  assert.equal(b.displayName, "eipa - ceny");
  assert.equal(b.handle, "eipa");
});

test("passwords are verified with scrypt and are not stored in plaintext", () => {
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

test("an actor without a password cannot log in with an empty password", () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "agent", handle: "nestor" });
  assert.equal(verifyPassword(ctx, "nestor", ""), null);
});

test("a password that is too short is rejected", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "human", handle: "michal" });
  assert.throws(() => setPassword(ctx, a.id, "krotkie"), /8 characters/);
});

test("getActorByHandle returns null for garbage input rather than throwing", () => {
  const ctx = testCtx();
  assert.equal(getActorByHandle(ctx, "!!!nie-ma-takiego!!!"), null);
  assert.equal(getActorByHandle(ctx, ""), null);
});

test("listActors sorts by handle", () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "agent", handle: "zeta" });
  createActor(ctx, { kind: "agent", handle: "alfa" });
  assert.deepEqual(listActors(ctx).map((a) => a.handle), ["alfa", "zeta"]);
});

for (const source of ["message", "session", "token", "created"] as const) {
  test(`listActors uses the newest ${source} timestamp for lastActiveAt`, (t) => {
    const times = { message: 1200, session: 1300, token: 1400, created: 1000, [source]: 2000 };
    const ctx = testCtx(() => times.created);
    t.after(() => ctx.db.close());
    const actor = createActor(ctx, { kind: "agent", handle: "active-agent" });
    const other = createActor(ctx, { kind: "agent", handle: "other-agent" });
    ctx.db.prepare("INSERT INTO conversations(kind, slug, created_at) VALUES('public', 'general', 1000)").run();
    for (const [id, message, session, token] of [
      [actor.id, times.message, times.session, times.token],
      [other.id, 9000, 9000, 9000],
    ]) {
      for (const offset of [0, -100]) {
        ctx.db.prepare("INSERT INTO messages(conversation_id, actor_id, ts, body) VALUES(1, ?, ?, 'hello')")
          .run(id, message + offset);
        ctx.db.prepare("INSERT INTO sessions(id, actor_id, label, started_at, last_seen_at) VALUES(?, ?, 'test', 1000, ?)")
          .run(`${id}:${offset}`, id, session + offset);
        ctx.db.prepare("INSERT INTO tokens(actor_id, hash, name, created_at, last_used_at) VALUES(?, ?, 'test', 1000, ?)")
          .run(id, `${id}:${offset}`, token + offset);
      }
    }
    assert.equal(listActors(ctx).find((a) => a.id === actor.id)?.lastActiveAt, 2000);
  });
}

test("listActors uses account creation when an actor has no activity", (t) => {
  const ctx = testCtx(() => 1234);
  t.after(() => ctx.db.close());
  const actor = createActor(ctx, { kind: "agent", handle: "new-agent" });
  assert.equal(listActors(ctx)[0].lastActiveAt, actor.createdAt);
  assert.equal(listActors(ctx)[0].lastActiveAt, 1234);
});

for (const kind of ["private", "dm", "group", "deleted public"] as const) {
  test(`listActors does not expose the timestamp of a ${kind} message`, (t) => {
    const ctx = testCtx(() => 1000);
    t.after(() => ctx.db.close());
    const actor = createActor(ctx, { kind: "agent", handle: "private-agent" });
    ctx.db.prepare("INSERT INTO conversations(kind, created_at) VALUES(?, 1000)")
      .run(kind === "deleted public" ? "public" : kind);
    ctx.db.prepare("INSERT INTO messages(conversation_id, actor_id, ts, body, deleted_at) VALUES(1, ?, 2000, 'hidden', ?)")
      .run(actor.id, kind === "deleted public" ? 2100 : null);
    assert.equal(listActors(ctx)[0].lastActiveAt, 1000);
    ctx.db.prepare("INSERT INTO conversations(kind, created_at) VALUES('public', 1000)").run();
    ctx.db.prepare("INSERT INTO messages(conversation_id, actor_id, ts, body) VALUES(2, ?, 1400, 'visible')")
      .run(actor.id);
    assert.equal(listActors(ctx)[0].lastActiveAt, 1400);
  });
}

test("listActors looks up activity by actor without scanning message or session history", (t) => {
  const ctx = testCtx();
  t.after(() => ctx.db.close());
  createActor(ctx, { kind: "agent", handle: "indexed-agent" });
  const prepare = ctx.db.prepare.bind(ctx.db);
  const queries: string[] = [];
  const spy = t.mock.method(ctx.db, "prepare", (sql: string) => {
    queries.push(sql);
    return prepare(sql);
  });
  listActors(ctx);
  spy.mock.restore();
  const plans = queries.flatMap((sql) => prepare(`EXPLAIN QUERY PLAN ${sql}`).all()) as Array<{ detail: string }>;
  const plan = plans.map((row) => row.detail).join("\n");
  assert.doesNotMatch(plan, /\bSCAN (?:messages|m|sessions|s|tokens|t)\b/, plan);
  assert.match(plan, /SEARCH (?:messages|m) USING (?:COVERING )?INDEX .*\(actor_id=\?\)/, plan);
  assert.match(plan, /SEARCH (?:sessions|s) USING (?:COVERING )?INDEX .*\(actor_id=\?\)/, plan);
  assert.match(plan, /SEARCH (?:tokens|t) USING (?:COVERING )?INDEX .*\(actor_id=\?\)/, plan);
});
