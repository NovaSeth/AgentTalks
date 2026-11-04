/** T-MG-11 fix round 1: https baseUrl makes cookies Secure; at_dev MAC is really verified. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, testConfig, type TestServer } from "../http-helpers.ts";
import { bumpSessionEpoch, createActor, sessionEpoch, setPassword } from "../../src/core/actors.ts";
import { makeCookie, makeDeviceCookie } from "../../src/http/auth.ts";
import { mkActor, testCtx } from "../helpers.ts";

test("both cookies are Secure when baseUrl is https, even on plain http without trustProxy", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala", "human");
  for (const baseUrl of ["https://example.test", "HTTPS://Example.test"]) {
    const cfg = testConfig({ baseUrl, trustProxy: false });
    assert.match(makeCookie(ctx, cfg, a.id, 60, false), /; Secure/, baseUrl);
    assert.match(makeDeviceCookie(ctx, cfg, a.id, false), /; Secure/, baseUrl);
  }
  for (const baseUrl of ["", "http://example.test"]) {
    const cfg = testConfig({ baseUrl, trustProxy: false });
    assert.doesNotMatch(makeCookie(ctx, cfg, a.id, 60, false), /; Secure/, baseUrl);
    assert.doesNotMatch(makeDeviceCookie(ctx, cfg, a.id, false), /; Secure/, baseUrl);
  }
});

test("over HTTP login with an https baseUrl sets Secure on both cookies", async () => {
  const s = await startTestServer({ baseUrl: "https://example.test" });
  const m = createActor(s.ctx, { kind: "human", handle: "michal" });
  setPassword(s.ctx, m.id, "haslo1234");
  const r = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const all = r.headers.getSetCookie();
  assert.equal(all.length, 2);
  for (const c of all) assert.match(c, /; Secure/);
  await s.close();
});

// --- at_dev: the MAC itself must be what rejects a tampered value ------------------------

async function login(s: TestServer, ip: string, dev?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (dev) headers.cookie = dev;
  return fetch(s.url + "/api/login", {
    method: "POST", headers, body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
}
async function setup() {
  const s = await startTestServer({ trustProxy: true });
  const m = createActor(s.ctx, { kind: "human", handle: "michal" });
  setPassword(s.ctx, m.id, "haslo1234");
  const dev = (await login(s, "10.0.0.1")).headers.getSetCookie().find((c) => c.startsWith("at_dev="))!.split(";")[0];
  for (let i = 0; i < 20; i++) {
    await fetch(s.url + "/api/login", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${i + 1}` },
      body: JSON.stringify({ handle: "michal", password: "bad" + i }),
    });
  }
  assert.equal((await login(s, "10.9.9.9")).status, 429, "cap precondition");
  assert.equal((await login(s, "10.9.9.8", dev)).status, 200, "control: the untouched cookie exempts");
  return { s, m, dev, parts: dev.split("=")[1].split(".") };
}

test("at_dev with issuedAt changed to another in-window value and the old MAC is not exempt", async () => {
  const { s, parts } = await setup();
  const issued = Number(parts[3]);
  const tampered = [...parts]; tampered[3] = String(issued - 10 * 24 * 3600); // inside 180 days
  assert.equal((await login(s, "10.7.7.1", "at_dev=" + tampered.join("."))).status, 429);
  await s.close();
});

test("at_dev with the epoch field changed to the current epoch and the old MAC is not exempt", async () => {
  const { s, m, parts } = await setup();
  bumpSessionEpoch(s.ctx, m.id);
  const current = sessionEpoch(s.ctx, m.id);
  assert.notEqual(String(current), parts[4]);
  const tampered = [...parts]; tampered[4] = String(current); // passes the epoch check, MAC is stale
  assert.equal((await login(s, "10.7.7.2", "at_dev=" + tampered.join("."))).status, 429);
  await s.close();
});
