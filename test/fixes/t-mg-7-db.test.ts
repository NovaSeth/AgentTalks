/**
 * T-MG-7, package A2: the storage layer. Findings B-MG-9/27 (callbacks of a rolled-back
 * savepoint), B-MG-25 (concurrent first open), B-MG-26 (a database from a newer binary).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkActor, testCtx } from "../helpers.ts";
import { onCommitted, openDb, schemaVersion, tx } from "../../src/store/db.ts";
import { SCHEMA_VERSION } from "../../src/store/schema.ts";
import { createChannel } from "../../src/core/conversations.ts";
import { listMessages, postMessage } from "../../src/core/messages.ts";
import { registerSession, signal } from "../../src/core/presence.ts";

// ---- B-MG-9 + B-MG-27 ------------------------------------------------------

test("B-MG-9: callbacks of a rolled-back savepoint do not fire, the outer ones do", () => {
  const ctx = testCtx();
  const alice = mkActor(ctx, "alice");
  const bob = mkActor(ctx, "bob");
  const pub = createChannel(ctx, { slug: "general", kind: "public", createdBy: alice.id });
  registerSession(ctx, { sessionId: "s-alice", actorId: alice.id });
  signal(ctx, "s-alice", "typing", { typingIn: `c:${pub.id}` });

  const got: string[] = [];
  ctx.bus.subscribe(bob.id, (e) => got.push(e.type));
  ctx.bus.subscribe(alice.id, (e) => got.push(`alice:${e.type}`));
  const fired: string[] = [];

  tx(ctx.db, () => {
    onCommitted(ctx.db, () => fired.push("outer-before"));
    try {
      tx(ctx.db, () => {
        onCommitted(ctx.db, () => fired.push("phantom"));
        postMessage(ctx, {
          conversationId: pub.id, actorId: alice.id, body: "@bob ghost", sessionId: "s-alice",
        });
        throw new Error("inner fails");
      });
    } catch {
      // the outer transaction deliberately survives the inner failure
    }
    onCommitted(ctx.db, () => fired.push("outer-after"));
  });

  assert.deepEqual(fired, ["outer-before", "outer-after"]);
  assert.deepEqual(got, []);
  assert.equal(listMessages(ctx, { conversationId: pub.id }).length, 0);
});

test("B-MG-9: a released (successful) savepoint keeps its callbacks", () => {
  const ctx = testCtx();
  const fired: string[] = [];
  tx(ctx.db, () => {
    tx(ctx.db, () => onCommitted(ctx.db, () => fired.push("inner-ok")));
    try {
      tx(ctx.db, () => {
        tx(ctx.db, () => onCommitted(ctx.db, () => fired.push("nested-phantom")));
        throw new Error("x");
      });
    } catch {
      // ignored on purpose
    }
  });
  assert.deepEqual(fired, ["inner-ok"]);
});

// ---- B-MG-25 ---------------------------------------------------------------

const DB_TS = fileURLToPath(new URL("../../src/store/db.ts", import.meta.url));

function openInChild(path: string): Promise<{ code: number | null; out: string }> {
  const script =
    `import { openDb, schemaVersion } from ${JSON.stringify(DB_TS)};` +
    `const db = openDb(${JSON.stringify(path)}); console.log("ok", schemaVersion(db));`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("B-MG-25: six processes opening the same NEW file at once all succeed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t-mg-7-open-"));
  try {
    // Several rounds: one round of the race fails often but not always before the fix.
    for (let round = 0; round < 4; round++) {
      const path = join(dir, `r${round}.db`);
      const results = await Promise.all(Array.from({ length: 6 }, () => openInChild(path)));
      for (const r of results) {
        assert.equal(r.code, 0, `round ${round}: ${r.out}`);
        assert.match(r.out, new RegExp(`^ok ${SCHEMA_VERSION}`));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- B-MG-26 ---------------------------------------------------------------

test("B-MG-26: a database from a newer schema is refused with an actionable error", () => {
  const dir = mkdtempSync(join(tmpdir(), "t-mg-7-newer-"));
  try {
    const path = join(dir, "x.db");
    const db = openDb(path);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 3}`);
    db.close();
    assert.throws(() => openDb(path), (e: Error) =>
      /newer AgentTalks/.test(e.message) &&
      e.message.includes(`v${SCHEMA_VERSION + 3}`) &&
      /upgrade/.test(e.message));
    // The current version still opens.
    const ok = openDb(join(dir, "y.db"));
    assert.equal(schemaVersion(ok), SCHEMA_VERSION);
    ok.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
