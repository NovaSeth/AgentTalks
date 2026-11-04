/** Shared helpers for the T-MG-10 tests: a tiny MCP client over a live test server. */
import { bearer, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join } from "../../src/core/conversations.ts";

export type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

export async function mcpRaw(url: string, token: string, body: unknown): Promise<Response> {
  return fetch(url + "/mcp", {
    method: "POST",
    headers: { ...bearer(token), accept: "application/json, text/event-stream" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export async function mcpJson(url: string, token: string, body: unknown): Promise<any> {
  const res = await mcpRaw(url, token, body);
  const text = await res.text();
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const all = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    return all.length === 1 ? all[0] : all.flat();
  }
  return JSON.parse(text);
}

let nextId = 100;
/** Calls one tool and returns its text (isError included as text). */
export async function tool(url: string, token: string, name: string, args: Record<string, unknown> = {}):
  Promise<string> {
  const r = await mcpJson(url, token, {
    jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args },
  });
  return r.result.content.map((c: { text: string }) => c.text).join("\n");
}

export function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const kanal = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  join(s.ctx, kanal.id, bob.id);
  return {
    ala, bob, kanal,
    alaToken: mintToken(s.ctx, ala.id, "mcp").token,
    token: mintToken(s.ctx, bob.id, "mcp").token,
  };
}

export { startTestServer };
