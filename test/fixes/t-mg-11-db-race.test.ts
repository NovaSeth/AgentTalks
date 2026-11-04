/** T-MG-11 item 7 (B-MG-92): two handles migrating one fresh file at the same time. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "../../src/store/schema.ts";

const child = join(import.meta.dirname, "t-mg-11-db-race-child.ts");

function run(path: string, startAt: number): Promise<{ ok: boolean; version?: number; error?: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [child, path, String(startAt)], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("close", () => resolve(out ? JSON.parse(out) : { ok: false, error: "no output" }));
  });
}

test("concurrent migrations of one file end at one user_version with no duplicated work (B-MG-92)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "at-race-"));
  try {
    for (let round = 0; round < 4; round++) {
      const path = join(dir, `race-${round}.db`);
      const startAt = Date.now() + 700; // children need a moment to boot; both wait for this instant
      const results = await Promise.all([run(path, startAt), run(path, startAt), run(path, startAt)]);
      for (const r of results) assert.deepEqual(r, { ok: true, version: SCHEMA_VERSION }, JSON.stringify(results));
      const db = new DatabaseSync(path);
      const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      assert.equal(v, SCHEMA_VERSION);
      // A side effect of the migrations is visible exactly once: the tables exist and the
      // schema has no duplicated objects.
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      assert.equal(new Set(tables.map((t) => t.name)).size, tables.length);
      assert.ok(tables.some((t) => t.name === "messages"));
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
