import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpJson, mcpRaw, seed, startTestServer, tool } from "./t-mg-10-helpers.ts";
import { postMessage } from "../../src/core/messages.ts";
import { registerSession, whoIsTyping } from "../../src/core/presence.ts";

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};

test("B-MG-14: a 2 MB POST /mcp body gets 413 with an actionable JSON error", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const res = await mcpRaw(s.url, token, JSON.stringify({ ...INIT, pad: "x".repeat(2 * 1024 * 1024) }));
  assert.equal(res.status, 413);
  const body = await res.json() as { error: string; code: string };
  assert.equal(body.code, "body_too_large");
  assert.match(body.error, /1 MB/);
  await s.close();
});

test("B-MG-14: a 51-call JSON-RPC batch gets 400, 50 calls and single calls still work", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const call = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "talk_whoami", arguments: {} } });
  const big = await mcpRaw(s.url, token, Array.from({ length: 51 }, (_, i) => call(i + 1)));
  assert.equal(big.status, 400);
  assert.equal(((await big.json()) as { code: string }).code, "batch_too_large");
  const ok = await mcpJson(s.url, token, Array.from({ length: 50 }, (_, i) => call(i + 1)));
  assert.equal(ok.length, 50);
  assert.match(await tool(s.url, token, "talk_whoami"), /@bob/);
  await s.close();
});

test("B-MG-14: malformed JSON is a 400, not a crash", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const res = await mcpRaw(s.url, token, "{not json");
  assert.equal(res.status, 400);
  await s.close();
});

test("B-MG-15: the 4th concurrent talk_read wait of one actor returns at once with a hint", async () => {
  const s = await startTestServer();
  const { token, alaToken } = seed(s);
  const waits = [1, 2, 3].map(() => tool(s.url, token, "talk_read", { afterId: 999999, waitSec: 2 }));
  await new Promise((r) => setTimeout(r, 300));
  const t0 = Date.now();
  const fourth = await tool(s.url, token, "talk_read", { afterId: 999999, waitSec: 2 });
  assert.ok(Date.now() - t0 < 1000, "the 4th wait must not block");
  assert.match(fourth, /at most 3 concurrent waits/);
  // another actor is not affected by bob's waits
  const t1 = Date.now();
  const other = tool(s.url, alaToken, "talk_read", { afterId: 999999, waitSec: 1 });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(Date.now() - t1 < 1000);
  await Promise.all([...waits, other]);
  // after the waits ended the slot is free again
  const again = await tool(s.url, token, "talk_read", { afterId: 999999, waitSec: 0 });
  assert.doesNotMatch(again, /concurrent waits/);
  await s.close();
});

test("A2A-F2: talk_typing declares sec (1..300) in its schema and applies it as the TTL", async () => {
  const s = await startTestServer();
  const { token, bob } = seed(s);
  const list = await mcpJson(s.url, token, { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} });
  const typing = list.result.tools.find((t: { name: string }) => t.name === "talk_typing");
  assert.equal(typing.inputSchema.properties.sec.type, "number");
  assert.equal(typing.inputSchema.properties.sec.minimum, 1);
  assert.equal(typing.inputSchema.properties.sec.maximum, 300);
  registerSession(s.ctx, { sessionId: "sess-1", actorId: bob.id, kind: "durable" });
  await tool(s.url, token, "talk_typing", { sessionId: "sess-1", to: "#general", sec: 120 });
  const row = s.ctx.db.prepare("SELECT typing_sec FROM sessions WHERE id = 'sess-1'").get() as { typing_sec: number };
  assert.equal(row.typing_sec, 120);
  await s.close();
});
