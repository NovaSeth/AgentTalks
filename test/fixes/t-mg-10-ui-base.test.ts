import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startTestServer } from "../http-helpers.ts";

function get(url: string, path: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ host: u.hostname, port: u.port, path, headers }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve(b));
    });
    req.on("error", reject); req.end();
  });
}

test("B-MG-18: an evil Host header is HTML-escaped in /install and /skill.md", async () => {
  const s = await startTestServer();
  for (const p of ["/install", "/install.md", "/skill.md"]) {
    const body = await get(s.url, p, { host: "<script>alert(1)</script>" });
    assert.ok(!body.includes("<script>alert(1)</script>"), `${p}: raw host reflected`);
    assert.ok(body.includes("&lt;script&gt;"), `${p}: escaped host missing`);
  }
  await s.close();
});

test("B-MG-49: a plain http instance advertises http://; forwarded headers only with trustProxy", async () => {
  const s = await startTestServer();
  const body = await get(s.url, "/install", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
  assert.ok(body.includes(s.url.replace("http://", "http://")), "must use the real Host over http");
  assert.ok(!body.includes("evil.example"), "forwarded host must be ignored without trustProxy");
  assert.ok(!body.includes("https://127.0.0.1"));
  await s.close();
  const t = await startTestServer({ trustProxy: true });
  const b2 = await get(t.url, "/install", { "x-forwarded-host": "agents.example", "x-forwarded-proto": "https" });
  assert.ok(b2.includes("https://agents.example"));
  await t.close();
});
