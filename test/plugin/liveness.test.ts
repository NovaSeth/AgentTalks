/**
 * The monitor stands down for the channel only once the channel PROVES it is alive (Claude
 * F8). The channel flag on the claude command line is not proof: Claude Code ignores a
 * channel that is not allowlisted or that org policy blocks, and then neither path would
 * deliver. Claude Code acknowledges no channel notification, so the observable proof is the
 * channel server itself: started by this claude, initialized over MCP, and holding an open
 * AgentTalks stream. It writes a heartbeat file keyed by the claude process id; the monitor
 * stands by while the heartbeat is fresh and takes over when it is missing or goes stale.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bearer, startTestServer } from "../http-helpers.ts";
import { waitFor } from "../helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { ensureDirect } from "../../src/core/conversations.ts";
import {
  channelAlive, heartbeatFile, monitorMode, readHeartbeat,
} from "../../integrations/claude-code-plugin/lib/launch.mjs";

const PLUGIN = fileURLToPath(new URL("../../integrations/claude-code-plugin/", import.meta.url));

/** A stand-in for the claude process: its command line carries the channel flag. */
function fakeClaude(t: any, flag = true): ChildProcess {
  const args = ["-e", "setInterval(() => {}, 1000)", "claude"];
  if (flag) args.push("--dangerously-load-development-channels", "plugin:agenttalks@agenttalks");
  const child = spawn(process.execPath, args, { stdio: "ignore" });
  t.after(() => child.kill());
  return child;
}

test("liveness: a heartbeat counts only while fresh and while its writer is alive", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "at-plugin-hb-"));
  const file = heartbeatFile(dir, 4242);
  assert.equal(channelAlive(file), false, "no file, no channel");
  const now = Date.now();
  writeFileSync(file, JSON.stringify({ pid: process.pid, at: now, state: "open" }));
  assert.equal(channelAlive(file, { now: () => now + 1000 }), true);
  assert.equal(channelAlive(file, { now: () => now + 120_000 }), false, "a stale heartbeat is no proof");
  writeFileSync(file, JSON.stringify({ pid: 999_999_9, at: now, state: "open" }));
  assert.equal(channelAlive(file, { now: () => now + 1000 }), false, "its writer is gone");
  writeFileSync(file, "{ not json");
  assert.equal(channelAlive(file), false);
  void t;
});

test("liveness: the monitor mode is 'standby' only with the channel flag, never just 'off'", async (t) => {
  assert.equal(monitorMode({ AGENTTALKS_MONITOR: "off" }), "off");
  assert.equal(monitorMode({ AGENTTALKS_MONITOR: "on" }), "run");
  const withFlag = fakeClaude(t, true);
  const without = fakeClaude(t, false);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(monitorMode({ AGENTTALKS_CLAUDE_PID: String(withFlag.pid) }), "standby");
  assert.equal(monitorMode({ AGENTTALKS_CLAUDE_PID: String(without.pid) }), "run");
});

test("liveness: the channel server writes its heartbeat once its stream is open and removes it on exit", async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const tokenN = mintToken(s.ctx, nestor.id, "t").token;
  const home = mkdtempSync(join(tmpdir(), "at-plugin-home-"));
  const claude = fakeClaude(t);
  const child = spawn(process.execPath, [join(PLUGIN, "server", "channel.mjs")], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: tokenN,
      AGENTTALKS_CLAUDE_PID: String(claude.pid) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }) + "\n");
  child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const file = heartbeatFile(join(home, ".config", "agenttalks", "state"), claude.pid!);
  await waitFor(() => existsSync(file), 5000);
  const hb = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(hb.pid, child.pid);
  assert.equal(hb.state, "open");
  assert.ok(!readFileSync(file, "utf8").includes(tokenN), "no token in the heartbeat");
  assert.equal(channelAlive(file), true);
  child.stdin!.end(); // Claude Code closes the MCP connection
  // Closed, with the handled cursors for a monitor that takes over.
  await waitFor(() => readHeartbeat(file)?.state === "closed", 5000);
  assert.equal(channelAlive(file), false);
});

test("liveness: the channel flag with a channel that never comes up (not allowlisted, policy): the monitor delivers after the grace period", async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const tokenN = mintToken(s.ctx, nestor.id, "t").token;
  const claude = fakeClaude(t);
  const home = mkdtempSync(join(tmpdir(), "at-plugin-mon-"));
  const mon = spawn(process.execPath, [join(PLUGIN, "scripts", "monitor.mjs"), "--max-seconds", "6"], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: tokenN,
      AGENTTALKS_CLAUDE_PID: String(claude.pid), AGENTTALKS_CHANNEL_POLL_MS: "100", AGENTTALKS_CHANNEL_GRACE_MS: "300" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => mon.kill());
  let err = "";
  mon.stderr!.on("data", (c) => { err += c; });
  await waitFor(() => s.ctx.bus.streamCount(nestor.id) === 1, 5000);
  assert.match(err, /no agenttalks channel proved alive/);
});

test("liveness: with the channel flag but no live channel, the monitor delivers; while the channel is alive it stands by", async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const bob = createActor(s.ctx, { kind: "human", handle: "bob" });
  const dm = ensureDirect(s.ctx, [nestor.id, bob.id]);
  const tokenN = mintToken(s.ctx, nestor.id, "t").token;
  const tokenB = mintToken(s.ctx, bob.id, "t").token;
  const claude = fakeClaude(t);
  const home = mkdtempSync(join(tmpdir(), "at-plugin-mon-"));
  const stateDir = join(home, ".config", "agenttalks", "state");
  mkdirSync(stateDir, { recursive: true });
  const file = heartbeatFile(stateDir, claude.pid!);
  // A live channel (the fake claude stands in for the channel server's pid).
  writeFileSync(file, JSON.stringify({ pid: claude.pid, at: Date.now(), state: "open" }));
  const mon = spawn(process.execPath, [join(PLUGIN, "scripts", "monitor.mjs"), "--max-seconds", "8"], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: tokenN,
      AGENTTALKS_CLAUDE_PID: String(claude.pid), AGENTTALKS_CHANNEL_POLL_MS: "100", AGENTTALKS_CHANNEL_GRACE_MS: "300" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => mon.kill());
  let out = "", err = "";
  mon.stdout!.on("data", (c) => { out += c; });
  mon.stderr!.on("data", (c) => { err += c; });
  await waitFor(() => /standing by/.test(err), 5000);
  assert.equal(s.ctx.bus.streamCount(nestor.id), 0, "no second stream while the channel delivers");
  // The channel dies: the monitor takes over and delivers.
  unlinkSync(file);
  await waitFor(() => s.ctx.bus.streamCount(nestor.id) === 1, 5000);
  const res = await fetch(`${s.url}/api/conversations/${dm.id}/messages`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ body: "anyone there?" }),
  });
  const id = ((await res.json()) as any).message.id;
  await waitFor(() => out.includes(`[${id}]`), 5000);
  assert.match(err, /taking over/);
});
