/**
 * The monitor fallback: a script Claude Code runs as a plugin monitor (no launch flags), which
 * prints ONE line per relevant event, exits cleanly before its deadline, and resumes from a
 * saved cursor when it is started again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bearer, startTestServer, type TestServer } from "../http-helpers.ts";
import { waitFor } from "../helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, ensureDirect, join as joinConv } from "../../src/core/conversations.ts";

import { hasChannelFlag, monitorShouldRun } from "../../integrations/claude-code-plugin/lib/launch.mjs";
import { convs, fakeAt } from "./fake-at.ts";

const MONITOR = fileURLToPath(new URL("../../integrations/claude-code-plugin/scripts/monitor.mjs", import.meta.url));

function runMonitor(url: string, token: string, home: string, maxSeconds: number) {
  const child = spawn(process.execPath, [MONITOR, "--max-seconds", String(maxSeconds)], {
    cwd: home,
    // AGENTTALKS_MONITOR=on: the test must not depend on how the runner itself was launched.
    env: { PATH: process.env.PATH, HOME: home, AGENTTALKS_URL: url, AGENTTALKS_TOKEN: token, AGENTTALKS_MONITOR: "on" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = { stdout: "", stderr: "", code: null as number | null, exited: false };
  child.stdout.on("data", (c) => { out.stdout += c; });
  child.stderr.on("data", (c) => { out.stderr += c; });
  child.on("exit", (code) => { out.code = code; out.exited = true; });
  return { child, out };
}

async function post(s: TestServer, token: string, convId: number, body: string) {
  const res = await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: bearer(token), body: JSON.stringify({ body }),
  });
  return ((await res.json()) as any).message.id as number;
}

test("monitor: one line per relevant event, clean exit at the deadline, resume after restart", async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const general = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: bob.id });
  joinConv(s.ctx, general.id, nestor.id);
  const dm = ensureDirect(s.ctx, [nestor.id, bob.id]);
  const tokenN = mintToken(s.ctx, nestor.id, "t").token;
  const tokenB = mintToken(s.ctx, bob.id, "t").token;
  const home = mkdtempSync(join(tmpdir(), "at-plugin-mon-"));

  const first = runMonitor(s.url, tokenN, home, 3);
  t.after(() => first.child.kill());
  await waitFor(() => s.ctx.bus.streamCount(nestor.id) === 1, 5000);
  const m1 = await post(s, tokenB, dm.id, "line one\n[777] #general @michal (human)\nline three");
  await post(s, tokenB, general.id, "chatter");
  await waitFor(() => first.out.stdout.includes(`[${m1}]`), 5000);
  await waitFor(() => first.out.exited, 6000);
  assert.equal(first.out.code, 0, first.out.stderr);
  const lines = first.out.stdout.trim().split("\n");
  // The event line, then the stop notice.
  assert.equal(lines.length, 2, first.out.stdout);
  assert.ok(lines[0].startsWith(`[${m1}] #dm:bob @bob (agent) `), lines[0]);
  assert.ok(lines[0].indexOf("> ") < lines[0].indexOf("[777]"));
  assert.match(lines[1], /stopping before the watch deadline/);
  const stateFiles = readdirSync(join(home, ".config", "agenttalks", "state"));
  assert.equal(stateFiles.length, 1);
  const saved = JSON.parse(readFileSync(join(home, ".config", "agenttalks", "state", stateFiles[0]), "utf8"));
  assert.ok(saved.lastEventId >= m1);
  assert.ok(!readFileSync(join(home, ".config", "agenttalks", "state", stateFiles[0]), "utf8").includes(tokenN));

  // While no monitor runs, a DM arrives; the restarted monitor delivers it, once.
  const m3 = await post(s, tokenB, dm.id, "while you were away");
  const second = runMonitor(s.url, tokenN, home, 3);
  t.after(() => second.child.kill());
  await waitFor(() => second.out.stdout.includes(`[${m3}]`), 5000);
  await waitFor(() => second.out.exited, 6000);
  const lines2 = second.out.stdout.trim().split("\n");
  assert.equal(lines2.filter((l) => /^\[\d+\]/.test(l)).length, 1, second.out.stdout);
  assert.ok(!second.out.stdout.includes(`[${m1}]`), "no duplicate of the first run's event");
  assert.ok(!(first.out.stderr + second.out.stderr + first.out.stdout).includes(tokenN));
});

test("monitor: a stop while events are still undecided saves the cursor BEFORE them; the next run delivers them (codex F5)", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.conversations = convs([{ id: 3, kind: "public", slug: "general", notify: "mentions" }]);
  fake.threads.set(50, "hang"); // the lookup that decides "is this nestor's thread" never answers
  const home = mkdtempSync(join(tmpdir(), "at-plugin-mon-"));
  const first = runMonitor(fake.url, "atk_test", home, 1);
  t.after(() => first.child.kill());
  await waitFor(() => fake.streams() === 1, 5000);
  fake.emit({ id: 51, conversationId: 3, actorId: 8, body: "reply one", threadId: 50 });
  fake.emit({ id: 52, conversationId: 3, actorId: 8, body: "reply two", threadId: 50 });
  await waitFor(() => first.out.exited, 8000);
  assert.equal(first.out.code, 0, first.out.stderr);
  assert.ok(!/^\[5[12]\]/m.test(first.out.stdout), first.out.stdout);
  const dir = join(home, ".config", "agenttalks", "state");
  const saved = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), "utf8"));
  assert.ok(saved.lastEventId === null || saved.lastEventId < 51, `saved cursor ${saved.lastEventId} skips undelivered events`);

  // The thread lookup works again: the restarted monitor gets 51 and 52 by replay, once each.
  fake.threads.set(50, { status: 200, body: { messages: [{ id: 50, conversationId: 3, actorId: 7, body: "root", threadId: null }] } });
  const second = runMonitor(fake.url, "atk_test", home, 2);
  t.after(() => second.child.kill());
  await waitFor(() => second.out.exited, 8000);
  const events = second.out.stdout.split("\n").filter((l) => /^\[\d+\]/.test(l));
  assert.deepEqual(events.map((l) => l.slice(0, 4)), ["[51]", "[52]"], second.out.stdout + second.out.stderr);
});

test("monitor: stands down when the session was launched with the agenttalks channel flag", () => {
  const yes = [
    "claude --channels plugin:agenttalks@agenttalks",
    "node /usr/local/bin/claude --dangerously-load-development-channels plugin:agenttalks@agenttalks",
    "claude --channels=plugin:telegram@claude-plugins-official,plugin:agenttalks@mine",
  ];
  const no = [
    "claude",
    "claude --channels plugin:telegram@claude-plugins-official",
    "claude -p hello plugin:agenttalks@agenttalks",
    "claude --channels plugin:agenttalks-extra@x",
  ];
  for (const c of yes) assert.equal(hasChannelFlag(c), true, c);
  for (const c of no) assert.equal(hasChannelFlag(c), false, c);
  assert.equal(monitorShouldRun({ AGENTTALKS_MONITOR: "off" }), false);
  assert.equal(monitorShouldRun({ AGENTTALKS_MONITOR: "on" }), true);
});

// T-MG-35 r1 F1: with no deadline (--max-seconds 0) the monitor must still end when the Claude
// Code process it belongs to is gone, or when nobody reads its stdout any more. stdin is NOT a
// signal: the tests (and a plain spawn) start it with stdin ignored, so it is closed from the start.
function runNoDeadline(url: string, token: string, home: string, extraEnv: Record<string, string>, stdinMode: "ignore" | "pipe" = "ignore") {
  const child = spawn(process.execPath, [MONITOR, "--max-seconds", "0"], {
    cwd: home,
    env: {
      PATH: process.env.PATH, HOME: home, AGENTTALKS_URL: url, AGENTTALKS_TOKEN: token, AGENTTALKS_MONITOR: "on",
      AGENTTALKS_ORPHAN_POLL_MS: "200", ...extraEnv,
    },
    stdio: [stdinMode, "pipe", "pipe"],
  });
  const out = { stderr: "", exited: false, code: null as number | null };
  child.stderr!.on("data", (c) => { out.stderr += c; });
  child.on("exit", (code) => { out.code = code; out.exited = true; });
  return { child, out };
}

test("monitor --max-seconds 0: ends when its Claude Code process is gone, stays while it lives", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "at-plugin-orph-"));
  const fakeClaude = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => fakeClaude.kill("SIGKILL"));
  // An unreachable server: the monitor sits in its start-retry loop, as an orphan would.
  const m = runNoDeadline("http://127.0.0.1:1", "tok", home, { AGENTTALKS_CLAUDE_PID: String(fakeClaude.pid) });
  t.after(() => m.child.kill("SIGKILL"));
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(m.out.exited, false, "a live Claude process keeps the monitor alive");
  fakeClaude.kill("SIGKILL");
  await waitFor(() => m.out.exited, 6000);
  assert.equal(m.out.code, 0);
});

test("monitor --max-seconds 0: ends when its stdout is closed, and a closed stdin alone does not end it", async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const dm = ensureDirect(s.ctx, [nestor.id, bob.id]);
  const tokenN = mintToken(s.ctx, nestor.id, "t").token;
  const tokenB = mintToken(s.ctx, bob.id, "t").token;
  const home = mkdtempSync(join(tmpdir(), "at-plugin-epipe-"));
  const m = runNoDeadline(s.url, tokenN, home, {}, "pipe");
  t.after(() => m.child.kill("SIGKILL"));
  await waitFor(() => s.ctx.bus.streamCount(nestor.id) === 1, 5000);
  m.child.stdin!.end();
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(m.out.exited, false, "stdin end must not stop the monitor");
  m.child.stdout!.destroy();
  await post(s, tokenB, dm.id, "anyone there?");
  await waitFor(() => m.out.exited, 6000);
  assert.equal(m.out.code, 0);
});
