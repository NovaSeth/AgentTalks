/**
 * MCP przez zywy serwer HTTP: prawdziwy handshake JSON-RPC, bez atrap transportu.
 * Odpowiedz Streamable HTTP moze byc application/json albo text/event-stream -
 * parsujemy obie, jak zrobi to kazdy klient MCP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";

type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

async function mcpCall(url: string, token: string, body: Rpc | Rpc[]):
  Promise<Record<string, unknown>> {
  const res = await fetch(url + "/mcp", {
    method: "POST",
    headers: {
      ...bearer(token),
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(dataLine!.slice(6)) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

const INIT: Rpc = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const kanal = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  join(s.ctx, kanal.id, bob.id);
  return { ala, bob, kanal, token: mintToken(s.ctx, bob.id, "mcp").token };
}

test("MCP bez tokenu daje 401, z tokenem odpowiada na initialize", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const noAuth = await fetch(s.url + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(INIT),
  });
  assert.equal(noAuth.status, 401);

  const init = await mcpCall(s.url, token, INIT);
  const serverInfo = (init.result as { serverInfo: { name: string } }).serverInfo;
  assert.equal(serverInfo.name, "agenttalks");
  await s.close();
});

test("tools/list zwraca komplet narzedzi talk_*", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const r = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
  });
  const tools = (r.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  for (const expected of ["talk_status", "talk_send", "talk_read", "talk_ask", "talk_answer",
                          "talk_claim", "talk_release", "talk_search", "talk_digest"]) {
    assert.ok(tools.includes(expected), `brak narzedzia ${expected}`);
  }
  await s.close();
});

test("talk_send przez MCP pisze jako aktor z tokenu i wraca z id wiadomosci", async () => {
  const s = await startTestServer();
  const { bob, token } = seed(s);
  const r = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "talk_send", arguments: { to: "#general", body: "z mcp" } },
  });
  const content = (r.result as { content: Array<{ text: string }> }).content[0].text;
  assert.match(content, /wyslane \[\d+\]/);
  const row = s.ctx.db.prepare("SELECT actor_id, body FROM messages ORDER BY id DESC LIMIT 1")
    .get() as { actor_id: number; body: string };
  assert.equal(row.actor_id, bob.id, "wiadomosc MCP ma byc podpisana aktorem z tokenu");
  assert.equal(row.body, "z mcp");
  await s.close();
});

test("talk_log numerem cudzej prywatnej konwersacji jest odrzucone", async () => {
  const s = await startTestServer();
  const { ala, token } = seed(s);
  const prywatny = createChannel(s.ctx, { slug: "tajne", kind: "private", createdBy: ala.id });
  postMessage(s.ctx, { conversationId: prywatny.id, actorId: ala.id, body: "sekret" });
  const r = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "talk_log", arguments: { conversation: String(prywatny.id) } },
  });
  const result = r.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /brak dostepu/);
  assert.doesNotMatch(result.content[0].text, /sekret/);
  await s.close();
});

test("talk_claim i talk_release przechodza pelny cykl dzierzawy", async () => {
  const s = await startTestServer();
  const { ala, token } = seed(s);
  const tokenAla = mintToken(s.ctx, ala.id, "t").token;
  const granted = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "talk_claim", arguments: { resource: "deploy", ttlSec: 300 } },
  });
  assert.match((granted.result as { content: Array<{ text: string }> }).content[0].text,
    /GRANTED/);
  const denied = await mcpCall(s.url, tokenAla, {
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "talk_claim", arguments: { resource: "deploy" } },
  });
  const dr = denied.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(dr.isError, true);
  assert.match(dr.content[0].text, /HELD-BY @bob/);
  const released = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 7, method: "tools/call",
    params: { name: "talk_release", arguments: { resource: "deploy" } },
  });
  assert.match((released.result as { content: Array<{ text: string }> }).content[0].text,
    /UNLOCKED/);
  await s.close();
});
