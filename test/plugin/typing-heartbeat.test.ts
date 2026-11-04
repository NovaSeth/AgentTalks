/**
 * T-MG-24: the `typing` tool of the channel server and the presence heartbeat.
 *
 * - `typing` calls POST /api/sessions/<derived id>/signal; no session id, nothing sent.
 * - The delivering process (the monitor in run mode, the channel when it delivers) re-posts the
 *   registration body every AGENTTALKS_HEARTBEAT_MS (default 240 s) while the Claude Code
 *   ancestor lives, so a listening agent never ages out of the 15 minute online window.
 * - A heartbeat that fails never stops delivery: one stderr line per failure kind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "../helpers.ts";
import { startTestServer } from "../http-helpers.ts";
import { fakeAt } from "./fake-at.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { deriveSessionId } from "../../integrations/claude-code-plugin/lib/sessions.mjs";

const PLUGIN = fileURLToPath(new URL("../../integrations/claude-code-plugin/", import.meta.url));
const CHANNEL = join(PLUGIN, "server/channel.mjs");
const MONITOR = join(PLUGIN, "scripts/monitor.mjs");
const SKILL = join(PLUGIN, "skills/agenttalks-live/SKILL.md");
const CLAUDE_SESSION = "claude-session-24";
const SESSION_ID = deriveSessionId(CLAUDE_SESSION);

type Hit = { method: string; url: string; body: any };

/** A tiny server that records every request; `sessionsStatus` is the answer to POST /api/sessions. */
async function fakeServer(t: any, sessionsStatus = 200) {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body: any = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      hits.push({ method: req.method ?? "", url: req.url ?? "", body });
      const status = req.method === "POST" && req.url === "/api/sessions" ? sessionsStatus
        : req.url?.endsWith("/signal") ? 200 : 404;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(status === 200 ? "{\"ok\":true}" : "{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { url, hits, sessions: () => hits.filter((h) => h.method === "POST" && h.url === "/api/sessions") };
}

function fakeClaude(t: any, flag = false): ChildProcess {
  const args = ["-e", "setInterval(() => {}, 1000)", "claude"];
  if (flag) args.push("--dangerously-load-development-channels", "plugin:agenttalks@agenttalks");
  const child = spawn(process.execPath, args, { stdio: "ignore" });
  t.after(() => child.kill());
  return child;
}

function spawnPlugin(t: any, entry: string, args: string[], env: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "at-typing-home-"));
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c; });
  return { child, stderr: () => stderr };
}

function rpcOver(child: ReturnType<typeof spawn>) {
  const inbox: any[] = [];
  let buf = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) inbox.push(JSON.parse(line));
    }
  });
  let next = 1;
  return async (method: string, params: object = {}) => {
    const id = next++;
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    await waitFor(() => inbox.some((m) => m.id === id), 5000);
    return inbox.find((m) => m.id === id);
  };
}

async function channel(t: any, url: string, extra: Record<string, string> = {}) {
  const p = spawnPlugin(t, CHANNEL, [], { AGENTTALKS_URL: url, AGENTTALKS_TOKEN: "tok", ...extra });
  const rpc = rpcOver(p.child);
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
  return { ...p, rpc, init };
}

test("S1 typing tool: one POST to the derived session's signal endpoint; stop; range; no session id", async (t) => {
  const srv = await fakeServer(t);
  const c = await channel(t, srv.url, { CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION });
  const list = await c.rpc("tools/list");
  const typing = list.result.tools.find((x: any) => x.name === "typing");
  assert.ok(typing, "the typing tool is offered");
  assert.deepEqual(typing.inputSchema.required, ["conversation_id"]);

  const signals = () => srv.hits.filter((h) => h.url.endsWith("/signal"));
  const ok = await c.rpc("tools/call", { name: "typing", arguments: { conversation_id: 7 } });
  assert.equal(ok.result.isError, undefined, JSON.stringify(ok));
  assert.equal(signals().length, 1);
  assert.equal(signals()[0].method, "POST");
  assert.equal(signals()[0].url, `/api/sessions/${SESSION_ID}/signal`);
  assert.deepEqual(signals()[0].body, { kind: "typing", in: "c:7", sec: 60 });

  const custom = await c.rpc("tools/call", { name: "typing", arguments: { conversation_id: 7, seconds: 30 } });
  assert.equal(custom.result.isError, undefined);
  assert.deepEqual(signals()[1].body, { kind: "typing", in: "c:7", sec: 30 });

  const stop = await c.rpc("tools/call", { name: "typing", arguments: { conversation_id: 7, stop: true } });
  assert.equal(stop.result.isError, undefined);
  assert.deepEqual(signals()[2].body, { kind: "typing", in: "c:7", stop: true });

  // Out of range is rejected, not clamped: a wrong number is a mistake the agent should see.
  for (const args of [{ conversation_id: 7, seconds: 400 }, { conversation_id: 7, seconds: 4 }, { conversation_id: 0 }, { conversation_id: "x" }]) {
    const bad = await c.rpc("tools/call", { name: "typing", arguments: args });
    assert.equal(bad.result.isError, true, JSON.stringify(args));
  }
  assert.equal(signals().length, 3, "rejected calls send nothing");
});

test("S1 typing tool without CLAUDE_CODE_SESSION_ID: an error result, nothing sent", async (t) => {
  const srv = await fakeServer(t);
  const c = await channel(t, srv.url);
  const r = await c.rpc("tools/call", { name: "typing", arguments: { conversation_id: 7 } });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /session/i);
  assert.equal(srv.hits.filter((h) => h.url.endsWith("/signal")).length, 0);
});

test("S5 the channel INSTRUCTIONS mention the typing tool", async (t) => {
  const srv = await fakeServer(t);
  const c = await channel(t, srv.url, { CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION });
  assert.match(String(c.init.result.instructions), /typing tool/);
});

test("S4 the live skill: decide, typing, write, reply; stop when not answering", () => {
  const skill = readFileSync(SKILL, "utf8");
  assert.match(skill, /`typing`/);
  assert.match(skill, /stop: true/);
  assert.ok(skill.indexOf("`typing`") < skill.indexOf("`reply`", skill.indexOf("`typing`")), "typing comes before reply in the flow");
  assert.match(skill, /conversation_id/);
});

test("heartbeat module: beats while alive, stops when the ancestor dies, one log line per failure kind", async () => {
  const { startHeartbeat } = await import("../../integrations/claude-code-plugin/lib/heartbeat.mjs");
  const calls: any[] = [];
  let fail: Error | null = null;
  let alive = true;
  const api = { post: async (p: string, b: unknown) => { calls.push([p, b]); if (fail) throw fail; return {}; } };
  const logs: string[] = [];
  const hb = startHeartbeat({ api, sessionId: "s", body: { sessionId: "s" }, intervalMs: 20, alive: () => alive, log: (l: string) => logs.push(l) });
  await waitFor(() => calls.length >= 2, 2000);
  assert.deepEqual(calls[0], ["/api/sessions", { sessionId: "s" }]);
  fail = Object.assign(new Error("POST /api/sessions: HTTP 500"), { status: 500 });
  const before = calls.length;
  await waitFor(() => calls.length >= before + 4, 2000);
  assert.equal(logs.length, 1, "one line per failure kind");
  alive = false;
  await new Promise((r) => setTimeout(r, 60));
  const n = calls.length;
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.length, n, "no beat once the ancestor is gone");
  hb.stop();
});

test("S2 monitor in run mode beats at the interval; standby monitor sends none", async (t) => {
  const srv = await fakeServer(t);
  const claude = fakeClaude(t, false);
  await new Promise((r) => setTimeout(r, 200));
  const env = { AGENTTALKS_URL: srv.url, AGENTTALKS_TOKEN: "tok", CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION,
    AGENTTALKS_CLAUDE_PID: String(claude.pid), AGENTTALKS_HEARTBEAT_MS: "300" };
  const run = spawnPlugin(t, MONITOR, ["--max-seconds", "20"], { ...env, AGENTTALKS_MONITOR: "on" });
  await waitFor(() => srv.sessions().length >= 2, 4000);
  const first = srv.sessions()[0].body;
  assert.equal(first.sessionId, SESSION_ID);
  assert.equal(first.kind, "durable");
  assert.ok(first.label);
  run.child.kill("SIGTERM");
  await new Promise((r) => run.child.once("exit", r));
  const n = srv.sessions().length;
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(srv.sessions().length, n, "a stopped monitor beats no more");

  const flagged = fakeClaude(t, true);
  await new Promise((r) => setTimeout(r, 200));
  const before = srv.sessions().length;
  const standby = spawnPlugin(t, MONITOR, ["--max-seconds", "20"], { ...env, AGENTTALKS_CLAUDE_PID: String(flagged.pid) });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(srv.sessions().length, before, "standby: the channel beats, not the monitor");
});

test("S3 no beat without a live Claude ancestor or without a session id", async (t) => {
  const srv = await fakeServer(t);
  const dead = fakeClaude(t, false);
  const pid = dead.pid;
  dead.kill();
  await new Promise((r) => dead.once("exit", r));
  const alive = fakeClaude(t, false);
  await new Promise((r) => setTimeout(r, 200));
  const base = { AGENTTALKS_URL: srv.url, AGENTTALKS_TOKEN: "tok", AGENTTALKS_HEARTBEAT_MS: "200", AGENTTALKS_MONITOR: "on" };
  spawnPlugin(t, MONITOR, ["--max-seconds", "20"], { ...base, CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION, AGENTTALKS_CLAUDE_PID: String(pid) });
  spawnPlugin(t, MONITOR, ["--max-seconds", "20"], { ...base, AGENTTALKS_CLAUDE_PID: String(alive.pid) });
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(srv.sessions().length, 0);
});

test("acceptance 4: a heartbeat answered with 500 logs one line and the monitor keeps running", async (t) => {
  const srv = await fakeServer(t, 500);
  const claude = fakeClaude(t, false);
  await new Promise((r) => setTimeout(r, 200));
  const run = spawnPlugin(t, MONITOR, ["--max-seconds", "20"], {
    AGENTTALKS_URL: srv.url, AGENTTALKS_TOKEN: "tok", CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION,
    AGENTTALKS_CLAUDE_PID: String(claude.pid), AGENTTALKS_HEARTBEAT_MS: "200", AGENTTALKS_MONITOR: "on",
  });
  await waitFor(() => srv.sessions().length >= 4, 4000);
  assert.equal(run.child.exitCode, null, "still running");
  const lines = run.stderr().split("\n").filter((l) => /heartbeat/i.test(l));
  assert.equal(lines.length, 1, run.stderr());
  assert.doesNotMatch(run.stderr(), /tok\b/);
});

test("acceptance 4: delivery continues while every heartbeat fails (an event after 2+ failed beats is printed once)", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.sessionsStatus = 500;
  fake.conversations = { status: 200, body: { conversations: [{ id: 3, kind: "public", slug: "general", others: [] }], memberships: [{ conversationId: 3, notify: "mentions" }] } };
  const claude = fakeClaude(t, false);
  await new Promise((r) => setTimeout(r, 200));
  const run = spawnPlugin(t, MONITOR, ["--max-seconds", "20"], {
    AGENTTALKS_URL: fake.url, AGENTTALKS_TOKEN: "tok", CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION,
    AGENTTALKS_CLAUDE_PID: String(claude.pid), AGENTTALKS_HEARTBEAT_MS: "200", AGENTTALKS_MONITOR: "on",
  });
  let out = "";
  run.child.stdout!.on("data", (c) => { out += c; });
  const beats = () => fake.requests.filter((r) => r === "POST /api/sessions").length;
  await waitFor(() => fake.streams() === 1, 5000);
  await waitFor(() => beats() >= 2, 4000);
  fake.emit({ id: 901, conversationId: 3, actorId: 9, body: "hello @nestor please look", threadId: null, actorHandle: "bob" });
  await waitFor(() => /^\[901\]/m.test(out), 4000);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(out.split("\n").filter((l) => /^\[901\]/.test(l)).length, 1, out);
  assert.equal(run.child.exitCode, null, "still running");
  const lines = run.stderr().split("\n").filter((l) => /heartbeat/i.test(l));
  assert.equal(lines.length, 1, run.stderr());
});

test("F1 the channel's beat survives stream reconnects: a stream recycled faster than the interval still beats", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.sessionsStatus = 200;
  const claude = fakeClaude(t, true);
  await new Promise((r) => setTimeout(r, 200));
  const c = await channel(t, fake.url, {
    CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION, AGENTTALKS_CLAUDE_PID: String(claude.pid), AGENTTALKS_HEARTBEAT_MS: "100",
  });
  c.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await waitFor(() => fake.streams() === 1, 5000);
  const cutter = setInterval(() => fake.cut(), 40);
  t.after(() => clearInterval(cutter));
  await new Promise((r) => setTimeout(r, 700));
  clearInterval(cutter);
  const beats = fake.requests.filter((r) => r === "POST /api/sessions").length;
  assert.ok(beats >= 4, `expected at least 4 beats across reconnects, got ${beats}`);
});

test("channel beats when it delivers: a session ended by the server is re-registered", async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const token = mintToken(s.ctx, nestor.id, "t").token;
  const claude = fakeClaude(t, true);
  await new Promise((r) => setTimeout(r, 200));
  const c = await channel(t, s.url, {
    AGENTTALKS_TOKEN: token, CLAUDE_CODE_SESSION_ID: CLAUDE_SESSION,
    AGENTTALKS_CLAUDE_PID: String(claude.pid), AGENTTALKS_HEARTBEAT_MS: "300",
  });
  c.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  await waitFor(() => s.ctx.bus.streamCount(nestor.id) === 1, 5000);
  await waitFor(() => !!s.ctx.db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(SESSION_ID), 4000);
  s.ctx.db.prepare("UPDATE sessions SET ended_at = 1 WHERE id = ?").run(SESSION_ID);
  await waitFor(() => (s.ctx.db.prepare("SELECT ended_at FROM sessions WHERE id = ?").get(SESSION_ID) as any).ended_at === null, 4000);
});
