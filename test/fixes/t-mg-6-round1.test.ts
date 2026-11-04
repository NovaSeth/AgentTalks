/** T-MG-6 fix round 1: review findings on the login limiter, logging and logout. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, cookieAuth, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor, setPassword } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";

function seed(s: TestServer) {
  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  return { michal, ala };
}
async function login(s: TestServer, handle: string, password: string, ip?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ip) headers["x-forwarded-for"] = ip;
  return fetch(s.url + "/api/login", { method: "POST", headers, body: JSON.stringify({ handle, password }) });
}
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { console.warn = orig; } };
}

test("an '@' prefix does not open fresh limiter buckets (item 1)", async () => {
  const s = await startTestServer();
  seed(s);
  for (let i = 0; i < 8; i++) assert.equal((await login(s, "michal", "zle" + i)).status, 401);
  assert.equal((await login(s, "@michal", "zle-x")).status, 429);
  await s.close();
});

test("the michal, @michal, @@michal, @@@michal sequence is limited from the 9th (item 1)", async () => {
  const s = await startTestServer();
  seed(s);
  const names = ["michal", "@michal", "@@michal", "@@@michal"];
  const codes: number[] = [];
  for (let i = 0; i < 9; i++) codes.push((await login(s, names[i % 4], "zle" + i)).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(401));
  assert.equal(codes[8], 429);
  await s.close();
});

test("security lines never contain the handle string a user typed (item 2)", async () => {
  const s = await startTestServer();
  seed(s);
  const c = capture();
  try {
    await login(s, "Sup3r-Secret-Pass!", "x");
    await login(s, "michal", "zle");
  } finally { c.restore(); }
  const all = c.lines.join("\n");
  assert.ok(!all.includes("Sup3r-Secret-Pass!") && !all.includes("sup3r-secret-pass!"));
  const first = JSON.parse(c.lines.filter((l) => l.startsWith("security:"))[0].slice(9));
  assert.equal(first.handleLen, 18);
  assert.match(first.handleHash, /^[0-9a-f]{8}$/);
  const second = JSON.parse(c.lines.filter((l) => l.startsWith("security:"))[1].slice(9));
  assert.equal(typeof second.actorId, "number");
  await s.close();
});

// Superseded by D-MG-14 (the per-account cap applies before verification unless the browser holds
// a valid at_dev cookie): the right password from a fresh IP without at_dev is now refused.
test("a high handle-wide failure count refuses a browser without at_dev (item 3, D-MG-14)", async () => {
  const s = await startTestServer({ trustProxy: true });
  seed(s);
  for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) {
    const n = ip === "10.0.0.3" ? 6 : 7;
    for (let i = 0; i < n; i++) assert.equal((await login(s, "michal", "zle" + i, ip)).status, 401);
  }
  assert.equal((await login(s, "michal", "haslo1234", "10.0.0.9")).status, 429);
  // A source that exhausted its own IP+handle cap stays blocked.
  for (let i = 0; i < 8; i++) await login(s, "michal", "zle" + i, "10.0.0.50");
  assert.equal((await login(s, "michal", "zle", "10.0.0.50")).status, 429);
  await s.close();
});

test("logout with a bad CSRF clears the cookie, keeps the epoch and answers 403 (item 4)", async () => {
  const s = await startTestServer();
  seed(s);
  const auth = cookieAuth((await login(s, "michal", "haslo1234")).headers.get("set-cookie")!);
  const bad = await fetch(s.url + "/api/logout", { method: "POST", headers: { cookie: auth.cookie } });
  assert.equal(bad.status, 403);
  assert.match(bad.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie: auth.cookie } })).status, 200);
  const ok = await fetch(s.url + "/api/logout", { method: "POST", headers: auth });
  assert.deepEqual(await ok.json(), { ok: true, signedOutEverywhere: true });
  await s.close();
});

test("invite minted and actor disabled are logged, enroll limit is logged (item 5)", async () => {
  const s = await startTestServer();
  const { ala } = seed(s);
  const auth = cookieAuth((await login(s, "michal", "haslo1234")).headers.get("set-cookie")!);
  const c = capture();
  let code = "";
  try {
    const inv = await fetch(s.url + "/api/admin/invites", { method: "POST", headers: auth, body: "{}" });
    assert.equal(inv.status, 201);
    code = (await inv.json()).code;
    assert.equal((await fetch(`${s.url}/api/admin/actors/${ala.id}/disable`, { method: "POST", headers: auth })).status, 200);
    assert.equal((await fetch(`${s.url}/api/admin/actors/${ala.id}/enable`, { method: "POST", headers: auth })).status, 200);
    for (let i = 0; i < 22; i++) {
      await fetch(s.url + "/api/enroll", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite: "zly", handle: "x" + i }) });
    }
  } finally { c.restore(); }
  const events = c.lines.filter((l) => l.startsWith("security:")).map((l) => JSON.parse(l.slice(9)));
  const names = events.map((e) => e.event);
  assert.ok(names.includes("invite_minted"));
  assert.ok(names.includes("actor_disabled"));
  assert.ok(names.includes("actor_enabled"));
  assert.ok(events.some((e) => e.event === "rate_limited" && e.scope === "enroll"));
  assert.ok(!c.lines.join("\n").includes(code));
  void bearer; void mintToken;
  await s.close();
});
