import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpJson, seed, startTestServer, tool } from "./t-mg-10-helpers.ts";
import { bearer } from "../http-helpers.ts";
import { unresolvedMentions } from "../../src/core/mentions.ts";

test("B-MG-21: talk_send description says @a creates the conversation and may wake the addressee", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const list = await mcpJson(s.url, token, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const d = list.result.tools.find((t: { name: string }) => t.name === "talk_send").description as string;
  assert.match(d, /@a,@b/);
  assert.match(d, /creates the conversation/);
  assert.match(d, /wake/);
  await s.close();
});

test("A2A-F6/F7: bare 'general' gets an address hint; '@@ghost' is reported once", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const bare = await tool(s.url, token, "talk_send", { to: "general", body: "x" });
  assert.match(bare, /address must be #channel, @handle or @a,@b/);
  const ghost = await tool(s.url, token, "talk_send", { to: "@@ghost", body: "x" });
  assert.doesNotMatch(ghost, /@@/);
  assert.match(ghost, /@ghost/);
  await s.close();
});

test("A2A-F7: unresolvedMentions in POST messages 201 and in talk_send", async () => {
  const s = await startTestServer();
  const { channel, token } = seed(s);
  assert.deepEqual(unresolvedMentions(s.ctx, "hi @ala @ghost @all and a@b.com"), ["ghost"]);
  const res = await fetch(`${s.url}/api/conversations/${channel.id}/messages`, {
    method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
    body: JSON.stringify({ body: "hi @ala @ghost" }),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(((await res.json()) as { unresolvedMentions: string[] }).unresolvedMentions, ["ghost"]);
  const ok = await fetch(`${s.url}/api/conversations/${channel.id}/messages`, {
    method: "POST", headers: { ...bearer(token), "content-type": "application/json" },
    body: JSON.stringify({ body: "hi @ala" }),
  });
  assert.equal("unresolvedMentions" in ((await ok.json()) as object), false);
  const out = await tool(s.url, token, "talk_send", { to: "#general", body: "yo @ghost" });
  assert.match(out, /did not resolve.*@ghost/);
  await s.close();
});
