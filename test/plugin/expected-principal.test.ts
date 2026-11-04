/**
 * A woken run must act as exactly the principal the wake bridge verified (codex T-MG-14 r1
 * F1). The bridge can scrub its own environment, but Claude Code substitutes the plugin
 * options into the channel server's env at launch (plugin.json: AGENTTALKS_PLUGIN_URL /
 * AGENTTALKS_PLUGIN_TOKEN), so the channel could still resolve another actor or server. The
 * bridge therefore names the expected principal (AGENTTALKS_EXPECT_SERVER_URL,
 * AGENTTALKS_EXPECT_ACTOR; not secrets) and every entry point refuses to connect unless its
 * resolved identity is that server and that actor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "../helpers.ts";
import { convs, fakeAt, type FakeAt } from "./fake-at.ts";

const PLUGIN = fileURLToPath(new URL("../../integrations/claude-code-plugin/", import.meta.url));
const TOKEN = "atk_option_token"; // SYNTH: a synthetic test value, not a credential

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "at-plugin-expect-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(join(home, ".config", "agenttalks"), { recursive: true });
  mkdirSync(project, { recursive: true });
  return { home, project };
}

function run(args: string[], cwd: string, env: Record<string, string>, input?: string) {
  const child = spawn(process.execPath, args, { cwd, env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
  const out = { stdout: "", stderr: "", exited: false };
  child.stdout.on("data", (c) => { out.stdout += c; });
  child.stderr.on("data", (c) => { out.stderr += c; });
  child.on("exit", () => { out.exited = true; });
  if (input !== undefined) child.stdin.write(input);
  return { child, out };
}

const rpc = (m: object) => JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n";
const MCP_START = rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } })
  + rpc({ method: "notifications/initialized" });
const REPLY = rpc({ id: 2, method: "tools/call", params: { name: "reply", arguments: { conversation_id: 3, text: "on it" } } });

/** The woken run's environment: the bridge's expectation plus what Claude Code substitutes
 *  from the plugin options into the channel server's env. */
function wokenEnv(d: { home: string; project: string }, expect: { url: string; actor: string }, option: { url: string; token: string }) {
  return {
    HOME: d.home, CLAUDE_PROJECT_DIR: d.project, AGENTTALKS_MONITOR: "on",
    AGENTTALKS_EXPECT_SERVER_URL: expect.url, AGENTTALKS_EXPECT_ACTOR: expect.actor,
    AGENTTALKS_PLUGIN_URL: option.url, AGENTTALKS_PLUGIN_TOKEN: option.token,
  };
}

async function servers(t: any) {
  const a: FakeAt = await fakeAt({ me: { id: 7, handle: "nestor" } });
  const b: FakeAt = await fakeAt({ me: { id: 8, handle: "bob" } });
  t.after(() => a.close());
  t.after(() => b.close());
  for (const f of [a, b]) f.conversations = convs([{ id: 3, kind: "public", slug: "general", notify: "mentions" }]);
  return { a, b };
}

test("channel: woken for nestor on A, plugin options for bob on B -> no request to B, no reply sent, one line (codex T-MG-14 r1 F1)", async (t) => {
  const { a, b } = await servers(t);
  const d = dirs();
  const ch = run([join(PLUGIN, "server", "channel.mjs")], d.project, wokenEnv(d, { url: a.url, actor: "nestor" }, { url: b.url, token: TOKEN }), MCP_START);
  t.after(() => ch.child.kill());
  await waitFor(() => ch.out.stdout.includes('"id":1'), 5000);
  ch.child.stdin.write(REPLY);
  await waitFor(() => ch.out.stdout.includes('"id":2'), 5000);
  await new Promise((r) => setTimeout(r, 300));
  ch.child.kill();
  assert.equal(b.requests.join(","), "", "nothing reached B");
  assert.equal(a.requests.join(","), "", "nor A with a token for another server");
  assert.match(ch.out.stdout, /"isError":true/);
  assert.equal(ch.out.stderr.split("\n").filter((l) => /woken for @nestor/.test(l)).length, 1, ch.out.stderr);
});

test("channel: the right server but the token is another actor's -> no stream, no reply (r1 F1)", async (t) => {
  const { b } = await servers(t);
  const d = dirs();
  // B's token belongs to bob; the run was woken for nestor on B.
  const ch = run([join(PLUGIN, "server", "channel.mjs")], d.project, wokenEnv(d, { url: b.url, actor: "nestor" }, { url: b.url, token: TOKEN }), MCP_START);
  t.after(() => ch.child.kill());
  await waitFor(() => ch.out.stdout.includes('"id":1'), 5000);
  ch.child.stdin.write(REPLY);
  await waitFor(() => ch.out.stdout.includes('"id":2'), 5000);
  await new Promise((r) => setTimeout(r, 500));
  ch.child.kill();
  assert.equal(b.streams(), 0);
  assert.ok(!b.requests.some((r) => r.startsWith("POST") || r === "GET /api/events"), b.requests.join(","));
  assert.match(ch.out.stdout, /"isError":true/);
  assert.match(ch.out.stderr, /woken for @nestor/);
});

test("channel: the expected principal matches -> it connects as usual (r1 F1)", async (t) => {
  const { a } = await servers(t);
  const d = dirs();
  const ch = run([join(PLUGIN, "server", "channel.mjs")], d.project, wokenEnv(d, { url: a.url + "/", actor: "nestor" }, { url: a.url, token: TOKEN }), MCP_START);
  t.after(() => ch.child.kill());
  await waitFor(() => a.streams() === 1, 5000);
  ch.child.kill();
});

test("monitor and SessionStart hook: woken for nestor on A with bob's identity -> no request to B, no presence, no wake record (r1 F1)", async (t) => {
  const { a, b } = await servers(t);
  const d = dirs();
  const env = wokenEnv(d, { url: a.url, actor: "nestor" }, { url: b.url, token: TOKEN });
  const mon = run([join(PLUGIN, "scripts", "monitor.mjs"), "--max-seconds", "3"], d.project, env);
  await waitFor(() => mon.out.exited, 10_000);
  assert.match(mon.out.stderr, /woken for @nestor/);
  const input = JSON.stringify({ session_id: "4f1c2b8e-1111-2222-3333-444455556666", cwd: d.project, hook_event_name: "SessionStart" });
  const hook = run([join(PLUGIN, "scripts", "session-hook.mjs"), "start"], d.project, env, input);
  hook.child.stdin.end();
  await waitFor(() => hook.out.exited, 10_000);
  assert.match(hook.out.stderr, /woken for @nestor/);
  assert.equal(b.requests.join(","), "");
  // Same server, another actor's token: the hook asks who it is and stops there.
  const env2 = wokenEnv(d, { url: b.url, actor: "nestor" }, { url: b.url, token: TOKEN });
  const hook2 = run([join(PLUGIN, "scripts", "session-hook.mjs"), "start"], d.project, env2, input);
  hook2.child.stdin.end();
  await waitFor(() => hook2.out.exited, 10_000);
  assert.deepEqual(b.requests.filter((r) => r !== "GET /api/me"), [], b.requests.join(","));
  assert.equal(existsSync(join(d.home, ".config", "agenttalks", "claude-sessions")), false, "no wake record");
});
