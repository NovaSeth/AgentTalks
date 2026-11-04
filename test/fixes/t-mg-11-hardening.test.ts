/** T-MG-11 items 8-11: at_dev signed issue time + epoch, digest cap, notification read-all
 *  filter, wiki revision growth. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { bearer, cookieAuth, startTestServer, type TestServer } from "../http-helpers.ts";
import { mkActor, testCtx } from "../helpers.ts";
import { bumpSessionEpoch, createActor, sessionEpoch, setDisabled, setPassword } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";
import { UNREAD_CAP } from "../../src/core/unread.ts";
import { digestFor } from "../../src/core/digest.ts";
import { listNotifications, markNotificationsRead, unreadNotificationCount } from "../../src/core/notifications.ts";
import { getPage, pageHistory, savePage } from "../../src/core/wiki.ts";
import { AppError } from "../../src/core/errors.ts";

// --- item 8 (B-MG-96): at_dev carries a signed issue time and the session epoch ----------

function seed(s: TestServer) {
  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  return { michal };
}
async function login(s: TestServer, ip: string, password: string, dev?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (dev) headers.cookie = dev;
  return fetch(s.url + "/api/login", { method: "POST", headers, body: JSON.stringify({ handle: "michal", password }) });
}
function devOf(r: Response): string {
  return r.headers.getSetCookie().find((x) => x.startsWith("at_dev="))!.split(";")[0];
}
/** Burns the per-account cap from many IPs, so only a valid device cookie gets through. */
async function capAccount(s: TestServer) {
  for (let i = 0; i < 20; i++) await login(s, `10.1.0.${i + 1}`, "wrong" + i);
  assert.equal((await login(s, "10.9.9.9", "haslo1234")).status, 429, "cap precondition");
}
function forgeDev(s: TestServer, actorId: number, issuedAt: number, epoch: number): string {
  const nonce = "ab".repeat(16);
  const mac = createHmac("sha256", s.config.secret).update(`dev|${actorId}|${nonce}|${issuedAt}|${epoch}`).digest("hex");
  return `at_dev=${mac}.${nonce}.${actorId}.${issuedAt}.${epoch}`;
}
const DAY = 24 * 3600;

test("at_dev: fresh exempts; a validly signed cookie older than 180 days or from the future does not (B-MG-96)", async () => {
  const s = await startTestServer({ trustProxy: true });
  const { michal } = seed(s);
  const fresh = devOf(await login(s, "10.0.0.1", "haslo1234"));
  assert.equal(fresh.split("=")[1].split(".").length, 5, "value carries issuedAt and epoch");
  await capAccount(s);
  const now = Math.floor(Date.now() / 1000);
  const epoch = sessionEpoch(s.ctx, michal.id);
  assert.equal((await login(s, "10.7.7.7", "haslo1234", fresh)).status, 200);
  assert.equal((await login(s, "10.7.7.8", "haslo1234", forgeDev(s, michal.id, now - 179 * DAY, epoch))).status, 200,
    "control: the forging helper produces a cookie the server accepts when young");
  assert.equal((await login(s, "10.7.7.9", "haslo1234", forgeDev(s, michal.id, now - 181 * DAY, epoch))).status, 429);
  assert.equal((await login(s, "10.7.7.10", "haslo1234", forgeDev(s, michal.id, now + 3600, epoch))).status, 429);
  // Tampering with issuedAt of a real cookie breaks the MAC.
  const parts = fresh.split("=")[1].split(".");
  parts[3] = String(now - 181 * DAY + 400 * DAY);
  assert.equal((await login(s, "10.7.7.11", "haslo1234", "at_dev=" + parts.join("."))).status, 429);
  // The legacy 3-part format no longer exempts.
  assert.equal((await login(s, "10.7.7.12", "haslo1234", "at_dev=" + parts.slice(0, 3).join("."))).status, 429);
  await s.close();
});

test("at_dev is revoked by a password change, a disable and a logout-everywhere (epoch bump) (B-MG-96)", async () => {
  const s = await startTestServer({ trustProxy: true });
  const { michal } = seed(s);
  // password change
  let first = await login(s, "10.0.0.1", "haslo1234");
  const dev1 = devOf(first);
  await capAccount(s);
  assert.equal((await login(s, "10.7.7.7", "haslo1234", dev1)).status, 200);
  setPassword(s.ctx, michal.id, "nowe-haslo-99");
  assert.equal((await login(s, "10.7.7.8", "nowe-haslo-99", dev1)).status, 429, "after a password change");
  // logout everywhere through the HTTP endpoint, with a fresh session
  const s2 = await startTestServer({ trustProxy: true });
  seed(s2);
  first = await login(s2, "10.0.0.1", "haslo1234");
  const dev2 = devOf(first);
  const auth = cookieAuth(first.headers.getSetCookie().find((c) => c.startsWith("at_session="))!);
  await capAccount(s2);
  assert.equal((await login(s2, "10.7.7.7", "haslo1234", dev2)).status, 200);
  assert.equal((await fetch(s2.url + "/api/logout", { method: "POST", headers: auth })).status, 200);
  assert.equal((await login(s2, "10.7.7.8", "haslo1234", dev2)).status, 429, "after logout-everywhere");
  // disable then enable bumps the epoch as well
  const s3 = await startTestServer({ trustProxy: true });
  const m3 = seed(s3).michal;
  const dev3 = devOf(await login(s3, "10.0.0.1", "haslo1234"));
  await capAccount(s3);
  const before = sessionEpoch(s3.ctx, m3.id);
  setDisabled(s3.ctx, m3.id, true);
  setDisabled(s3.ctx, m3.id, false);
  assert.ok(sessionEpoch(s3.ctx, m3.id) > before, "disable bumps the epoch");
  assert.equal((await login(s3, "10.7.7.8", "haslo1234", dev3)).status, 429, "after disable");
  void bumpSessionEpoch;
  await s.close(); await s2.close(); await s3.close();
});

// --- item 9 (B-MG-94): digestFor counts under the same cap as unreadFor -----------------

test("digest counts exactly under the cap and stops counting at UNREAD_CAP per conversation (B-MG-94)", () => {
  const ctx = testCtx();
  const me = mkActor(ctx, "me"), ala = mkActor(ctx, "ala");
  const small = createChannel(ctx, { slug: "small", kind: "public", createdBy: ala.id });
  const big = createChannel(ctx, { slug: "big", kind: "public", createdBy: ala.id });
  join(ctx, small.id, me.id); join(ctx, big.id, me.id);
  for (let i = 0; i < 7; i++) postMessage(ctx, { conversationId: small.id, actorId: ala.id, body: `s${i}` });
  let d = digestFor(ctx, me.id)!;
  assert.equal(d.count, 7);
  assert.deepEqual(d.byWho, [["ala", 7]]);
  for (let i = 0; i < UNREAD_CAP + 50; i++) postMessage(ctx, { conversationId: big.id, actorId: ala.id, body: `b${i}` });
  d = digestFor(ctx, me.id)!;
  assert.equal(d.count, 7 + UNREAD_CAP, "the big conversation is capped, the small one exact");
  assert.deepEqual(d.byConversation.find(([c]) => c === "#big"), ["#big", UNREAD_CAP]);
  assert.deepEqual(d.byConversation.find(([c]) => c === "#small"), ["#small", 7]);
  assert.equal(d.last?.body, `b${UNREAD_CAP + 49}`, "last is still the newest unread message");
});

// 200 conversations with `perConv` unread rows each; returns a timer for one digestFor call.
function digestCost(perConv: number): { time: () => number; count: number } {
  const ctx = testCtx();
  const me = mkActor(ctx, "me"), ala = mkActor(ctx, "ala");
  for (let i = 0; i < 200; i++) {
    const ch = createChannel(ctx, { slug: `c${i}`, kind: "public", createdBy: ala.id });
    join(ctx, ch.id, me.id);
  }
  ctx.db.exec("BEGIN");
  ctx.db.prepare(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${Math.trunc(perConv)})
     INSERT INTO messages(conversation_id, actor_id, ts, kind, body)
     SELECT c.id, ?, 1, 'text', 'x' FROM conversations c, n WHERE c.kind = 'public'`,
  ).run(ala.id);
  ctx.db.exec("COMMIT");
  const total = (ctx.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;
  assert.equal(total, 200 * perConv);
  const count = digestFor(ctx, me.id)!.count; // also warms the statement cache
  const time = () => {
    const t0 = process.hrtime.bigint();
    digestFor(ctx, me.id);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  return { time, count };
}

test("digestFor on 300k unread rows is fast (B-MG-94)", () => {
  // D-MG-36: this used to assert `ms < 50`, an absolute wall-clock bound that failed under the
  // parallel load of `npm test` while the code was fine. The regression it guards is "digestFor stops
  // capping at UNREAD_CAP and scans every unread row", and then the cost grows with the history.
  // So both datasets are built once in this process and timed INTERLEAVED (small, large, small,
  // large, ...) for 9 pairs; the verdict is the MEDIAN of the per-pair ratios, so a load spike hits
  // both sides of a pair and one bad pair cannot decide. Capped, 1500 rows per conversation costs
  // about the same as 100 (ratio ~1-2, a few under heavy load); uncapped it is 22-70x. The
  // threshold 10 sits between the two with margin on both sides.
  assert.ok(UNREAD_CAP <= 100, "the small case must be at or above the cap");
  const small = digestCost(100);
  const big = digestCost(1500);
  assert.equal(small.count, 200 * UNREAD_CAP);
  assert.equal(big.count, 200 * UNREAD_CAP);
  const ratios: number[] = [], smalls: number[] = [], bigs: number[] = [];
  for (let i = 0; i < 9; i++) {
    const sm = small.time(), bg = big.time();
    smalls.push(sm); bigs.push(bg); ratios.push(bg / sm);
  }
  ratios.sort((x, y) => x - y);
  const median = ratios[4]!;
  const info = `20k min ${Math.min(...smalls).toFixed(2)} ms, 300k min ${Math.min(...bigs).toFixed(2)} ms`;
  console.log(`digestFor 9 interleaved pairs: median ratio ${median.toFixed(2)} (${info})`);
  // D-MG-36: load-independent ratio instead of an absolute millisecond bound.
  assert.ok(median < 10, `digestFor cost grew with history: median 300k/20k ratio ${median.toFixed(2)} (${info})`);
});

// --- item 10 (B-MG-95): read-all touches only currently readable notifications -----------

test("marking all notifications read leaves the ones the actor can no longer read untouched (B-MG-95)", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const eve = createActor(s.ctx, { kind: "agent", handle: "eve" });
  const tokenE = mintToken(s.ctx, eve.id, "t").token;
  const pub = createChannel(s.ctx, { slug: "open", kind: "public", createdBy: ala.id });
  const priv = createChannel(s.ctx, { slug: "closed", kind: "private", createdBy: ala.id });
  join(s.ctx, priv.id, eve.id);
  postMessage(s.ctx, { conversationId: priv.id, actorId: ala.id, body: "@eve geheim" });
  postMessage(s.ctx, { conversationId: pub.id, actorId: ala.id, body: "@eve jawny" });
  assert.equal(unreadNotificationCount(s.ctx, eve.id), 2);
  s.ctx.db.prepare("DELETE FROM members WHERE conversation_id = ? AND actor_id = ?").run(priv.id, eve.id);
  assert.equal(listNotifications(s.ctx, eve.id).length, 1, "precondition: one is hidden");
  const r = await fetch(s.url + "/api/notifications/read", { method: "POST", headers: bearer(tokenE), body: "{}" });
  const body = await r.json() as { changed: number; unread: number };
  assert.equal(body.changed, 1, "only the readable notification is reported as changed");
  const hidden = s.ctx.db.prepare("SELECT read_at FROM notifications WHERE actor_id = ? AND conversation_id = ?")
    .get(eve.id, priv.id) as { read_at: number | null };
  assert.equal(hidden.read_at, null, "the hidden notification was not touched");
  // Access returns: the notification is still unread.
  join(s.ctx, priv.id, eve.id);
  assert.equal(unreadNotificationCount(s.ctx, eve.id), 1);
  // The ids path respects the same filter.
  s.ctx.db.prepare("DELETE FROM members WHERE conversation_id = ? AND actor_id = ?").run(priv.id, eve.id);
  const id = (s.ctx.db.prepare("SELECT id FROM notifications WHERE actor_id = ? AND conversation_id = ?")
    .get(eve.id, priv.id) as { id: number }).id;
  assert.equal(markNotificationsRead(s.ctx, eve.id, [id]), 0);
  await s.close();
});

// --- item 11 (B-MG-33): wiki revisions do not grow without bound --------------------------

function wikiCtx() {
  let t = 1_000_000;
  const ctx = testCtx(() => t);
  return { ctx, advance: (sec: number) => { t += sec; } };
}

test("saving an identical title and body creates no new revision and answers with the current one (B-MG-33)", () => {
  const { ctx } = wikiCtx();
  const ala = mkActor(ctx, "ala");
  const first = savePage(ctx, { slug: "plan", title: "Plan", body: "tresc", actorId: ala.id });
  const again = savePage(ctx, { slug: "plan", title: "Plan", body: "tresc", actorId: ala.id, note: "nic" });
  assert.equal(again.lastRevisionId, first.lastRevisionId);
  assert.equal(pageHistory(ctx, "plan").length, 1);
  assert.equal(again.revisions, 1);
  const changed = savePage(ctx, { slug: "plan", title: "Plan", body: "tresc 2", actorId: ala.id });
  assert.ok(changed.lastRevisionId > first.lastRevisionId);
  const retitled = savePage(ctx, { slug: "plan", title: "Plan B", body: "tresc 2", actorId: ala.id });
  assert.ok(retitled.lastRevisionId > changed.lastRevisionId, "a title change is a change");
  assert.equal(pageHistory(ctx, "plan").length, 3);
});

test("an actor may save one page at most 60 times per hour; then 429 with an English hint (B-MG-33)", () => {
  const { ctx, advance } = wikiCtx();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  for (let i = 0; i < 60; i++) savePage(ctx, { slug: "busy", title: "T", body: `v${i}`, actorId: ala.id, force: true });
  assert.throws(
    () => savePage(ctx, { slug: "busy", title: "T", body: "v60", actorId: ala.id, force: true }),
    (e: unknown) => e instanceof AppError && e.status === 429 && /per hour/.test(e.message) && /^[\x20-\x7e]+$/.test(e.message),
  );
  assert.equal(pageHistory(ctx, "busy").length, 60);
  // Other actors and other pages are unaffected.
  savePage(ctx, { slug: "busy", title: "T", body: "bob", actorId: bob.id, force: true });
  savePage(ctx, { slug: "other", title: "T", body: "x", actorId: ala.id });
  // An identical save is a no-op and does not count or throw.
  assert.doesNotThrow(() => savePage(ctx, { slug: "busy", title: "T", body: "bob", actorId: ala.id, force: true }));
  // The window slides.
  advance(3601);
  assert.doesNotThrow(() => savePage(ctx, { slug: "busy", title: "T", body: "later", actorId: ala.id, force: true }));
  assert.ok(getPage(ctx, "busy"));
});

test("PUT /api/wiki/:slug answers 429 after 60 saves in an hour (B-MG-33)", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const token = mintToken(s.ctx, ala.id, "t").token;
  let last = 0;
  for (let i = 0; i < 61; i++) {
    const r = await fetch(s.url + "/api/wiki/rate", {
      method: "PUT", headers: bearer(token), body: JSON.stringify({ title: "T", body: `v${i}`, force: true }),
    });
    last = r.status;
    if (i < 60) assert.equal(r.status, 200);
  }
  assert.equal(last, 429);
  await s.close();
});
