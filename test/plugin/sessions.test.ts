/**
 * The session store the SessionStart hook writes and the wake bridge reads. Several Claude
 * Code sessions start at once (a team of agents, a restart of the terminal), so their hooks
 * write concurrently: no record may be lost, and no record may be readable by others.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSessions, recordSession, latestSessionFor, pruneSessions, SESSION_TTL_MS } from "../../integrations/claude-code-plugin/lib/sessions.mjs";
import { waitFor } from "../helpers.ts";

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
  recordSession(store, { sessionId: "s-0001-session", cwd: "/", handle: "nestor", url: "https://a", updatedAt: Date.now() - 1 });
  recordSession(store, { sessionId: "s-0001-session", cwd: "/tmp", handle: "nestor", url: "https://a", updatedAt: Date.now() });
  const list = readSessions(store);
  assert.equal(list.length, 1);
  assert.equal(list[0].cwd, "/tmp");
  assert.equal(statSync(store).mode & 0o777, 0o700);
  for (const f of readdirSync(store)) assert.equal(statSync(join(store, f)).mode & 0o777, 0o600, f);
});

const DAY = 24 * 3600 * 1000;
const RECORD = /^[0-9a-f]{32}\.json$/;

/**
 * A pruner in its own process that stops at hook points: "afterSelect" (it has read the
 * victim and found it stale) and "afterClaim" (it has taken the victim's name). "wait" holds
 * there until the test writes <sync>.<point>.go; "die" exits on the spot (a pruner killed
 * midway). The test refreshes the victim from ANOTHER process in the gap: codex's
 * interleaving (r3 F7).
 */
function pruner(store: string, sync: string, spec: Partial<Record<"afterSelect" | "afterClaim", "wait" | "die">>) {
  const hooks = Object.entries(spec).map(([point, what]) => `${point}() {
      writeFileSync(${JSON.stringify(sync)} + ".${point}.at", "1");
      if ("${what}" === "die") process.exit(9);
      while (!existsSync(${JSON.stringify(sync)} + ".${point}.go")) Atomics.wait(pause, 0, 0, 10);
    }`).join(",\n");
  const code = `
    const { writeFileSync, existsSync } = await import("node:fs");
    const { pruneSessions } = await import(${JSON.stringify("file://" + SESSIONS)});
    const pause = new Int32Array(new SharedArrayBuffer(4));
    pruneSessions(${JSON.stringify(store)}, { hooks: { ${hooks} } });`;
  return new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (c) => resolve(c));
  });
}

/** SessionStart of the victim's session in another process: a fresh record. */
function refresher(store: string, rec: object) {
  const code = `
    const { recordSession } = await import(${JSON.stringify("file://" + SESSIONS)});
    recordSession(${JSON.stringify(store)}, ${JSON.stringify(rec)});`;
  return new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("exit", (c) => resolve(c));
  });
}

/** A record written as an old hook left it (recordSession would prune it at once). */
function writeStale(store: string, rec: { sessionId: string; [k: string]: unknown }) {
  const name = createHash("sha256").update(rec.sessionId).digest("hex").slice(0, 32) + ".json";
  writeFileSync(join(store, name), JSON.stringify(rec) + "\n", { mode: 0o600 });
}

function staleStore(name: string) {
  const root = mkdtempSync(join(tmpdir(), "at-plugin-prune-"));
  const store = join(root, "claude-sessions");
  const victim = { sessionId: `victim-${name}-session`, cwd: "/", handle: "nestor", url: "https://at.example" };
  recordSession(store, { ...victim, sessionId: `other-${name}-session`, updatedAt: Date.now() });
  writeStale(store, { ...victim, updatedAt: Date.now() - 40 * DAY }); // past the TTL: a prune victim
  return { store, sync: join(root, "sync"), victim };
}

function assertRefreshed(store: string, victim: { sessionId: string }) {
  const rec = readSessions(store).find((r: any) => r.sessionId === victim.sessionId);
  assert.ok(rec, "the refreshed record was deleted by the concurrent prune");
  assert.equal(rec.cwd, "/tmp");
  assert.ok(Date.now() - rec.updatedAt < DAY);
  assert.deepEqual(readdirSync(store).filter((f) => !RECORD.test(f)), [], "no tombstone or temp file left");
}

for (const point of ["afterSelect", "afterClaim"] as const) {
  test(`sessions: a record refreshed by another process while a pruner holds it (${point}) survives the prune (codex r3 F7)`, async () => {
    const { store, sync, victim } = staleStore(point);
    const done = pruner(store, sync, { [point]: "wait" });
    await waitFor(() => existsSync(`${sync}.${point}.at`), 5000);
    assert.equal(await refresher(store, { ...victim, cwd: "/tmp", updatedAt: Date.now() }), 0);
    writeFileSync(`${sync}.${point}.go`, "1");
    assert.equal(await done, 0);
    assertRefreshed(store, victim);
  });
}

test("sessions: a pruner that dies holding a refreshed record leaves a tombstone the next prune restores", async () => {
  const { store, sync, victim } = staleStore("dies");
  const done = pruner(store, sync, { afterSelect: "wait", afterClaim: "die" });
  await waitFor(() => existsSync(`${sync}.afterSelect.at`), 5000);
  assert.equal(await refresher(store, { ...victim, cwd: "/tmp", updatedAt: Date.now() }), 0);
  writeFileSync(`${sync}.afterSelect.go`, "1");
  assert.equal(await done, 9, "the pruner died after taking the refreshed record's name");
  // Its owner is dead: the next prune (any SessionStart) puts the fresh record back.
  pruneSessions(store);
  assertRefreshed(store, victim);
});

test("sessions: pruning is by age only - many fresh records are all kept, a record past the TTL goes", () => {
  const store = join(mkdtempSync(join(tmpdir(), "at-plugin-sess-")), "claude-sessions");
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    recordSession(store, { sessionId: `fresh-${String(i).padStart(4, "0")}-session`, cwd: "/", handle: "nestor", url: "https://b.example", updatedAt: now - i });
  }
  writeStale(store, { sessionId: "old-0001-session", cwd: "/", handle: "nestor", url: "https://a.example", updatedAt: now - SESSION_TTL_MS - DAY } as any);
  assert.equal(readSessions(store).length, 61);
  pruneSessions(store);
  const ids = readSessions(store).map((r: any) => r.sessionId);
  assert.equal(ids.length, 60, "a count limit must not push out a live session's record");
  assert.ok(!ids.includes("old-0001-session"));
});
