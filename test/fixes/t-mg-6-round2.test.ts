/** T-MG-6 fix round 2: per-account login cap BEFORE verification with an at_dev device cookie
 *  exemption (D-MG-14), CLI invite logging. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor, setPassword } from "../../src/core/actors.ts";
import { main } from "../../src/cli/main.ts";

function seed(s: TestServer) {
  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  const eve = createActor(s.ctx, { kind: "human", handle: "eve" });
  setPassword(s.ctx, eve.id, "eve-haslo-12");
  return { michal, eve };
}
async function login(s: TestServer, handle: string, password: string, ip: string, dev?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (dev) headers.cookie = dev;
  return fetch(s.url + "/api/login", { method: "POST", headers, body: JSON.stringify({ handle, password }) });
}
function devCookie(r: Response): string {
  const c = r.headers.getSetCookie().find((x) => x.startsWith("at_dev="));
  assert.ok(c, "no at_dev cookie");
  return c.split(";")[0];
}
async function distributedFailures(s: TestServer, n: number, handle = "michal") {
  for (let i = 0; i < n; i++) assert.equal((await login(s, handle, "zle" + i, `10.1.0.${i + 1}`)).status, i < 20 ? 401 : 429);
}
function capture() {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  return { lines, restore: () => { console.warn = orig; } };
}

test("distributed guesser: 25th IP with the right password and no at_dev gets 429, unverified (item 1a)", async () => {
  const s = await startTestServer({ trustProxy: true });
  seed(s);
  await distributedFailures(s, 20);
  const c = capture();
  let r: Response;
  try { r = await login(s, "michal", "haslo1234", "10.9.9.9"); } finally { c.restore(); }
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("set-cookie"), null);
  // 429 before verification: no login_failed line even for a wrong password either.
  const c2 = capture();
  try { assert.equal((await login(s, "michal", "zle", "10.9.9.8")).status, 429); } finally { c2.restore(); }
  assert.ok(!c2.lines.some((l) => l.includes("login_failed")));
  await s.close();
});

test("a known browser (valid at_dev) logs in despite the account cap (item 1b)", async () => {
  const s = await startTestServer({ trustProxy: true });
  seed(s);
  const first = await login(s, "michal", "haslo1234", "10.0.0.1");
  assert.equal(first.status, 200);
  const dev = devCookie(first);
  const attrs = first.headers.getSetCookie().find((x) => x.startsWith("at_dev="))!;
  assert.match(attrs, /HttpOnly/);
  assert.match(attrs, /SameSite=Lax/);
  assert.match(attrs, /Path=\/api\/login/);
  assert.match(attrs, /Max-Age=15552000/);
  await distributedFailures(s, 24);
  assert.equal((await login(s, "michal", "haslo1234", "10.7.7.7")).status, 429);
  assert.equal((await login(s, "michal", "haslo1234", "10.7.7.7", dev)).status, 200);
  await s.close();
});

test("a forged or other-actor at_dev does not exempt (item 1c)", async () => {
  const s = await startTestServer({ trustProxy: true });
  seed(s);
  const evesDev = devCookie(await login(s, "eve", "eve-haslo-12", "10.0.0.2"));
  await distributedFailures(s, 20);
  assert.equal((await login(s, "michal", "haslo1234", "10.7.7.7", evesDev)).status, 429);
  const forged = "at_dev=" + "0".repeat(64) + ".abc.1";
  assert.equal((await login(s, "michal", "haslo1234", "10.7.7.7", forged)).status, 429);
  const michalId = (s.ctx.db.prepare("SELECT id FROM actors WHERE handle='michal'").get() as { id: number }).id;
  const mixed = "at_dev=" + evesDev.split(".")[0].slice(7) + "." + evesDev.split(".")[1] + "." + michalId;
  assert.equal((await login(s, "michal", "haslo1234", "10.7.7.7", mixed)).status, 429);
  await s.close();
});

test("a valid at_dev also skips the IP+handle cap, the plain IP cap stays (item 2)", async () => {
  const s = await startTestServer({ trustProxy: true });
  seed(s);
  const dev = devCookie(await login(s, "michal", "haslo1234", "10.0.0.1"));
  // Someone else on the same shared IP burns the IP+handle cap (8).
  for (let i = 0; i < 8; i++) assert.equal((await login(s, "michal", "zle" + i, "10.5.5.5")).status, 401);
  assert.equal((await login(s, "michal", "haslo1234", "10.5.5.5")).status, 429);
  assert.equal((await login(s, "michal", "haslo1234", "10.5.5.5", dev)).status, 200);
  await s.close();
});

test("agenttalks invite create writes an invite_minted line with by cli (item 3)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "at-cli-"));
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const c = capture();
  try {
    assert.equal(await main(["init", "--data", dir]), 0);
    assert.equal(await main(["invite", "create", "--data", dir]), 0);
  } finally {
    c.restore();
    process.stdout.write = out as typeof process.stdout.write;
    process.stderr.write = err as typeof process.stderr.write;
  }
  const ev = c.lines.filter((l) => l.startsWith("security:")).map((l) => JSON.parse(l.slice(9)))
    .find((e) => e.event === "invite_minted");
  assert.ok(ev, c.lines.join("|"));
  assert.equal(ev.by, "cli");
});
