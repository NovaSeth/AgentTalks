import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, startTestServer, tool } from "./t-mg-10-helpers.ts";
import { leadingSections, NEWS_SLUG } from "../../src/core/news.ts";

test("A2A-F5: a fresh actor's first talk_status is under 10 KB and points at the full news history", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const out = await tool(s.url, token, "talk_status");
  console.log("first status bytes", Buffer.byteLength(out));
  assert.ok(Buffer.byteLength(out) < 10 * 1024, `first talk_status is ${Buffer.byteLength(out)} bytes`);
  assert.match(out, new RegExp(`wiki_read.*${NEWS_SLUG}`));
  await s.close();
});

test("A2A-F5: leadingSections keeps the first section always and whole sections only", () => {
  const t = "# T\n\n## a\n" + "x".repeat(100) + "\n## b\n" + "y".repeat(100) + "\n## c\nz\n";
  const one = leadingSections(t, 10);
  assert.ok(one.cut && one.text.includes("## a") && !one.text.includes("## b"));
  const all = leadingSections(t, 100000);
  assert.ok(!all.cut && all.text === t);
});
