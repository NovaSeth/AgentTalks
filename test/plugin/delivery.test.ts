/**
 * The cursor follows DELIVERY (codex r3 F8). A message counts as handled for the cursor only
 * once its notification (channel) or its line (monitor) is written; the channel's rate limit
 * holds messages for up to a second, so "decided" is not "delivered". The heartbeat the
 * channel leaves for a monitor that takes over, and the monitor's saved state, carry only the
 * delivered cursors, for events and for mentions alike.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { waitFor } from "../helpers.ts";
import { createFeed } from "../../integrations/claude-code-plugin/lib/feed.mjs";
import { heartbeatFile, readHeartbeat } from "../../integrations/claude-code-plugin/lib/launch.mjs";
import { convs, fakeAt } from "./fake-at.ts";

const PLUGIN = fileURLToPath(new URL("../../integrations/claude-code-plugin/", import.meta.url));
const BOB = 8;

/** A stand-in for the claude process whose command line asks for the channel. */
function fakeClaude(t: any): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "claude",
    "--dangerously-load-development-channels", "plugin:agenttalks@agenttalks"], { stdio: "ignore" });
  t.after(() => child.kill());
  return child;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

test("feed: the event and mention cursors pass a message only once its delivery is confirmed, in order", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.conversations = convs([{ id: 9, kind: "dm", notify: "all" }, { id: 3, kind: "public", notify: "mentions" }]);
  const deliveries = new Map<number, ReturnType<typeof deferred>>();
  const cursors: number[] = [];
  const feed = createFeed({
    identity: { url: fake.url, token: "atk_test" },
    onItem: (it: any) => { const d = deferred(); deliveries.set(it.id, d); return d.promise; },
    onCursor: (id: number) => { cursors.push(id); },
    sse: { initialBackoffMs: 50, maxBackoffMs: 100 },
  } as any);
  t.after(() => feed.stop());
  await feed.start();
  await waitFor(() => fake.streams() === 1, 3000);
  const startCursor = feed.lastEventId;
  fake.emit({ id: 41, conversationId: 9, actorId: BOB, body: "dm one", threadId: null });
  fake.emit({ id: 42, conversationId: 9, actorId: BOB, body: "dm two", threadId: null });
  fake.emit({ id: 43, conversationId: 3, actorId: BOB, body: "chatter, not for nestor", threadId: null });
  await waitFor(() => deliveries.size === 2, 3000);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok((feed.lastEventId ?? 0) < 41, `cursor ${feed.lastEventId} passed undelivered 41`);
  assert.ok(!cursors.some((c) => c >= 41), `onCursor reported ${cursors}`);
  deliveries.get(41)!.resolve();
  await waitFor(() => feed.lastEventId === 41, 2000);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(feed.lastEventId, 41, "43 is decided but behind undelivered 42");
  deliveries.get(42)!.resolve();
  await waitFor(() => feed.lastEventId === 43, 2000);
  void startCursor;

  // A call into a public conversation nestor is not a member of comes only from the mention
  // list: the mention cursor waits for its delivery too.
  const before = feed.mentionCursor;
  fake.mentions.push({ id: 44, conversationId: 5, actorId: BOB, body: "@nestor look", threadId: null });
  fake.notify();
  await waitFor(() => deliveries.has(44), 3000);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(feed.mentionCursor, before, "mention cursor passed an undelivered mention");
  deliveries.get(44)!.resolve();
  await waitFor(() => feed.mentionCursor === 44, 2000);
});

test("channel -> monitor handover: 51 pushed, 52 still held by the rate limit at SIGTERM; the heartbeat says 51 and the monitor delivers 52 exactly once (codex r3 F8)", async (t) => {
  const fake = await fakeAt();
  t.after(() => fake.close());
  fake.conversations = convs([{ id: 9, kind: "dm", notify: "all" }]);
  const home = mkdtempSync(join(tmpdir(), "at-plugin-hand-"));
  const claude = fakeClaude(t);
  const env = { PATH: process.env.PATH, HOME: home, AGENTTALKS_URL: fake.url, AGENTTALKS_TOKEN: "atk_test",
    AGENTTALKS_CLAUDE_PID: String(claude.pid) };
  const channel = spawn(process.execPath, [join(PLUGIN, "server", "channel.mjs")], { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => channel.kill("SIGKILL"));
  let out = "";
  channel.stdout!.setEncoding("utf8");
  channel.stdout!.on("data", (c) => { out += c; });
  channel.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }) + "\n");
  channel.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const hb = heartbeatFile(join(home, ".config", "agenttalks", "state"), claude.pid!);
  await waitFor(() => readHeartbeat(hb)?.state === "open" && fake.streams() === 1, 5000);

  fake.emit({ id: 51, conversationId: 9, actorId: BOB, body: "first", threadId: null });
  fake.emit({ id: 52, conversationId: 9, actorId: BOB, body: "second, inside the rate-limit window", threadId: null });
  await waitFor(() => out.includes('"message_id":"51"'), 3000);
  const exited = new Promise((r) => channel.on("exit", r));
  channel.kill("SIGTERM");
  await exited;
  assert.ok(!out.includes('"message_id":"52"'), "52 was not written before the stop");
  const left = readHeartbeat(hb);
  assert.equal(left?.state, "closed");
  assert.equal(left?.lastEventId, 51, "the heartbeat must not claim the undelivered 52");

  // The monitor of the same session takes over from the channel's delivered cursor.
  const mon = spawn(process.execPath, [join(PLUGIN, "scripts", "monitor.mjs"), "--max-seconds", "6"], {
    cwd: home, env: { ...env, AGENTTALKS_CHANNEL_POLL_MS: "50", AGENTTALKS_CHANNEL_GRACE_MS: "100" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => mon.kill("SIGKILL"));
  let lines = "";
  let err = "";
  mon.stdout!.on("data", (c) => { lines += c; });
  mon.stderr!.on("data", (c) => { err += c; });
  await waitFor(() => lines.includes("[52]"), 5000).catch(() => assert.fail(`monitor did not deliver 52: ${err}`));
  fake.cut(); // a reconnect replays from the cursor: still no second copy
  await new Promise((r) => setTimeout(r, 800));
  const events = lines.split("\n").filter((l) => /^\[\d+\]/.test(l)).map((l) => l.slice(0, 4));
  assert.deepEqual(events, ["[52]"], lines);
});
