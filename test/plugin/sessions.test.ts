/**
 * The session store the SessionStart hook writes and the wake bridge reads. Several Claude
 * Code sessions start at once (a team of agents, a restart of the terminal), so their hooks
 * write concurrently: no record may be lost, and no record may be readable by others.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSessions, recordSession, latestSessionFor } from "../../integrations/claude-code-plugin/lib/sessions.mjs";

const SESSIONS = fileURLToPath(new URL("../../integrations/claude-code-plugin/lib/sessions.mjs", import.meta.url));

/** A child process that records `count` sessions as fast as it can. */
function writer(store: string, prefix: string, count: number) {
  const code = `
    const { recordSession } = await import(${JSON.stringify("file://" + SESSIONS)});
    for (let i = 0; i < ${count}; i++) {
      recordSession(${JSON.stringify(store)}, { sessionId: "${prefix}-" + String(i).padStart(4, "0") + "-session",
        cwd: "/", handle: "${prefix}", url: "https://at.example", updatedAt: Date.now() });
    }`;
  return new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (c) => resolve(c));
  });
}

test("sessions: two hooks writing at the same time lose no record (codex F6)", async () => {
  const store = join(mkdtempSync(join(tmpdir(), "at-plugin-sess-")), "claude-sessions");
  const codes = await Promise.all([writer(store, "alpha", 20), writer(store, "bravo", 20)]);
  assert.deepEqual(codes, [0, 0]);
  const ids = readSessions(store).map((r: any) => r.sessionId).sort();
  assert.equal(ids.length, 40, `records lost: ${40 - ids.length}`);
  assert.ok(latestSessionFor(store, "alpha"));
  assert.ok(latestSessionFor(store, "bravo"));
});

test("sessions: every record is private (0600 files in a 0700 directory) and a re-record replaces, not duplicates", () => {
  const store = join(mkdtempSync(join(tmpdir(), "at-plugin-sess-")), "claude-sessions");
  recordSession(store, { sessionId: "s-0001-session", cwd: "/", handle: "nestor", url: "https://a", updatedAt: 1 });
  recordSession(store, { sessionId: "s-0001-session", cwd: "/tmp", handle: "nestor", url: "https://a", updatedAt: 2 });
  const list = readSessions(store);
  assert.equal(list.length, 1);
  assert.equal(list[0].cwd, "/tmp");
  assert.equal(statSync(store).mode & 0o777, 0o700);
  for (const f of readdirSync(store)) assert.equal(statSync(join(store, f)).mode & 0o777, 0o600, f);
});
