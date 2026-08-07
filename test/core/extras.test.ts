/** Testy modulow z feedbacku #nextIteration: dzierzawy, pliki, wake, digest,
 *  wzmianki, piny, zywotnosc aktora. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkActor, testCtx, waitFor } from "../helpers.ts";
import { createChannel, ensureDirect, join as joinConv } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";
import { markRead } from "../../src/core/unread.ts";
import { acquire, listLeases, release } from "../../src/core/leases.ts";
import { getFileInfo, listFiles, readFile, storeFile, sweepExpired } from "../../src/core/files.ts";
import { registerWake, setWake, signWake, getWake, WAKE_MAX_FAILURES } from "../../src/core/wake.ts";
import { digestFor } from "../../src/core/digest.ts";
import { mentionsOf } from "../../src/core/mentions.ts";
import { listPins, pin, unpin } from "../../src/core/pins.ts";
import { actorLiveness } from "../../src/core/presence.ts";
import { registerSession, endSession } from "../../src/core/presence.ts";
import { createActor } from "../../src/core/actors.ts";

// --- dzierzawy -------------------------------------------------------------

test("dzierzawa: jeden bierze, drugi dostaje odmowe z danymi wlasciciela", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const r1 = acquire(ctx, { resource: "deploy", actorId: ala.id, ttlSec: 300, note: "wdrazam" });
  assert.equal(r1.granted, true);
  const r2 = acquire(ctx, { resource: "deploy", actorId: bob.id });
  assert.equal(r2.granted, false);
  if (!r2.granted) {
    assert.equal(r2.heldBy.handle, "ala");
    assert.equal(r2.heldBy.note, "wdrazam");
    assert.ok(r2.heldBy.expiresAt > ctx.now());
  }
});

test("dzierzawa wygasa po TTL i daje sie przejac", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  acquire(ctx, { resource: "deploy", actorId: ala.id, ttlSec: 60 });
  t += 61;
  const r = acquire(ctx, { resource: "deploy", actorId: bob.id });
  assert.equal(r.granted, true);
});

test("ponowne wziecie wlasnej dzierzawy przedluza, nie resetuje acquired_at", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const ala = mkActor(ctx, "ala");
  const r1 = acquire(ctx, { resource: "deploy", actorId: ala.id, ttlSec: 60 });
  t += 30;
  const r2 = acquire(ctx, { resource: "deploy", actorId: ala.id, ttlSec: 60 });
  assert.equal(r2.granted, true);
  if (r1.granted && r2.granted) {
    assert.equal(r2.lease.acquiredAt, r1.lease.acquiredAt);
    assert.equal(r2.lease.expiresAt, t + 60);
  }
});

test("zwolnic moze wlasciciel; cudza zywa dzierzawa daje odmowe", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  acquire(ctx, { resource: "deploy", actorId: ala.id });
  const denied = release(ctx, { resource: "deploy", actorId: bob.id });
  assert.equal(denied.released, false);
  assert.equal(release(ctx, { resource: "deploy", actorId: ala.id }).released, true);
  assert.equal(release(ctx, { resource: "deploy", actorId: ala.id }).released, true); // idempotentne
});

test("lista dzierzaw sprzata wygasle", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const ala = mkActor(ctx, "ala");
  acquire(ctx, { resource: "krotka", actorId: ala.id, ttlSec: 10 });
  acquire(ctx, { resource: "dluga", actorId: ala.id, ttlSec: 1000 });
  t += 20;
  assert.deepEqual(listLeases(ctx).map((l) => l.resource), ["dluga"]);
});

test("nazwa zasobu ze spacja jest odrzucona", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala");
  assert.throws(() => acquire(ctx, { resource: "zly zasob", actorId: ala.id }), /zasobu/);
});

// --- pliki -----------------------------------------------------------------

const tmpFiles = () => mkdtempSync(join(tmpdir(), "at-files-"));

test("plik laduje w konwersacji jako wiadomosc i daje sie pobrac czlonkowi", () => {
  const ctx = testCtx();
  const dir = tmpFiles();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const dm = ensureDirect(ctx, [ala.id, bob.id]);
  const { file, message } = storeFile(ctx, dir, {
    actorId: ala.id, conversationId: dm.id, name: "raport.txt",
    data: Buffer.from("tresc raportu"), maxBytes: 1024,
  });
  assert.equal(message.kind, "file");
  assert.match(message.body, /raport\.txt/);
  const got = readFile(ctx, file.id, bob.id);
  assert.equal(got.data.toString(), "tresc raportu");
});

test("plik z cudzej konwersacji jest niewidoczny i niepobieralny", () => {
  const ctx = testCtx();
  const dir = tmpFiles();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob"), obcy = mkActor(ctx, "obcy");
  const dm = ensureDirect(ctx, [ala.id, bob.id]);
  const { file } = storeFile(ctx, dir, {
    actorId: ala.id, conversationId: dm.id, name: "tajne.txt",
    data: Buffer.from("x"), maxBytes: 1024,
  });
  assert.equal(getFileInfo(ctx, file.id, obcy.id), null);
  assert.throws(() => readFile(ctx, file.id, obcy.id), /nie ma pliku/);
});

test("burn: plik znika po pobraniu przez nie-autora, autor nie spala", () => {
  const ctx = testCtx();
  const dir = tmpFiles();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const dm = ensureDirect(ctx, [ala.id, bob.id]);
  const { file } = storeFile(ctx, dir, {
    actorId: ala.id, conversationId: dm.id, name: "jednorazowy.txt",
    data: Buffer.from("x"), maxBytes: 1024, burn: true,
  });
  readFile(ctx, file.id, ala.id);                    // autor - bez spalenia
  assert.ok(getFileInfo(ctx, file.id, bob.id));
  readFile(ctx, file.id, bob.id);                    // nie-autor - spala
  assert.equal(getFileInfo(ctx, file.id, bob.id), null);
});

test("sensitive bez TTL dostaje domyslny TTL i wygasa", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const dir = tmpFiles();
  const ala = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  const { file } = storeFile(ctx, dir, {
    actorId: ala.id, conversationId: c.id, name: "zdjecie.png",
    data: Buffer.from("x"), maxBytes: 1024, sensitive: true,
  });
  assert.equal(file.expiresAt, 1000 + 24 * 3600);
  t += 24 * 3600 + 1;
  assert.equal(getFileInfo(ctx, file.id, ala.id), null);
});

test("sweep kasuje wygasle wpisy i bajty z dysku", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const dir = tmpFiles();
  const ala = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  storeFile(ctx, dir, { actorId: ala.id, conversationId: c.id, name: "a.txt",
    data: Buffer.from("x"), maxBytes: 1024, ttlSec: 10 });
  t += 20;
  assert.equal(sweepExpired(ctx), 1);
  const row = ctx.db.prepare("SELECT path, deleted_at FROM files").get() as
    { path: string; deleted_at: number | null };
  assert.ok(row.deleted_at);
  assert.equal(existsSync(row.path), false);
});

test("nazwa pliku nie moze byc sciezka", () => {
  const ctx = testCtx();
  const dir = tmpFiles();
  const ala = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  const { file } = storeFile(ctx, dir, {
    actorId: ala.id, conversationId: c.id, name: "../../etc/passwd",
    data: Buffer.from("x"), maxBytes: 1024,
  });
  assert.equal(file.name, "passwd");
});

// --- wake ------------------------------------------------------------------

function wakeSetup() {
  const ctx = testCtx();
  createActor(ctx, { kind: "system", handle: "system" });
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const dm = ensureDirect(ctx, [ala.id, bob.id]);
  const delivered: Array<{ target: string; body: string; signature: string }> = [];
  let deliverOk = true;
  registerWake(ctx, async (target, body, signature) => {
    delivered.push({ target, body, signature });
    return deliverOk;
  });
  return { ctx, ala, bob, dm, delivered, setOk: (v: boolean) => { deliverOk = v; } };
}

test("DM budzi nieobecnego adresata podpisanym ladunkiem", async () => {
  const { ctx, ala, bob, dm, delivered } = wakeSetup();
  const { secret } = setWake(ctx, bob.id, "https://most.example/wake");
  postMessage(ctx, { conversationId: dm.id, actorId: ala.id, body: "obudz sie" });
  await waitFor(() => delivered.length === 1);
  const d = delivered[0];
  assert.equal(d.target, "https://most.example/wake");
  assert.equal(d.signature, signWake(secret, d.body));
  const payload = JSON.parse(d.body);
  assert.equal(payload.reason, "dm");
  assert.equal(payload.actor, "bob");
  assert.equal(payload.from, "ala");
  assert.equal(payload.preview, "obudz sie");
});

test("aktor z zywym SSE nie jest budzony - push juz dotarl", async () => {
  const { ctx, ala, bob, dm, delivered } = wakeSetup();
  setWake(ctx, bob.id, "https://most.example/wake");
  // Zywe SSE to zarejestrowany STRUMIEN (openStream), nie zwykla subskrypcja -
  // long-poll i MCP talk_read subskrybuja szyne na chwile i nie liczą sie jako
  // "agent trzyma polaczenie".
  const off = ctx.bus.openStream(bob.id);
  postMessage(ctx, { conversationId: dm.id, actorId: ala.id, body: "jestes online" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(delivered.length, 0);
  off();
});

test("dlawienie: druga wiadomosc w oknie nie strzela drugi raz", async () => {
  const { ctx, ala, bob, dm, delivered } = wakeSetup();
  setWake(ctx, bob.id, "https://most.example/wake");
  postMessage(ctx, { conversationId: dm.id, actorId: ala.id, body: "raz" });
  postMessage(ctx, { conversationId: dm.id, actorId: ala.id, body: "dwa" });
  await waitFor(() => delivered.length === 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(delivered.length, 1);
});

test("w kanale budzi wzmianka, a nie kazda wiadomosc", async () => {
  const { ctx, ala, bob, delivered } = wakeSetup();
  setWake(ctx, bob.id, "https://most.example/wake");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  joinConv(ctx, c.id, bob.id);
  postMessage(ctx, { conversationId: c.id, actorId: ala.id, body: "zwykla wiadomosc" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(delivered.length, 0);
  postMessage(ctx, { conversationId: c.id, actorId: ala.id, body: "@bob zerknij" });
  await waitFor(() => delivered.length === 1);
  assert.equal(JSON.parse(delivered[0].body).reason, "mention");
});

test("po serii porazek wake gasnie i wlasciciel dostaje systemowy DM", async () => {
  const { ctx, ala, bob, dm, delivered, setOk } = wakeSetup();
  setWake(ctx, bob.id, "https://martwy.example/wake");
  setOk(false);
  let t = 0;
  // kazda proba w osobnym oknie dlawienia
  for (let i = 0; i < WAKE_MAX_FAILURES; i++) {
    ctx.db.prepare("UPDATE actors SET wake_last_at = NULL WHERE id = ?").run(bob.id);
    postMessage(ctx, { conversationId: dm.id, actorId: ala.id, body: "proba " + i });
    t = delivered.length;
    await waitFor(() => delivered.length > t - 1);
    await new Promise((r) => setTimeout(r, 10));
  }
  await waitFor(() => getWake(ctx, bob.id)?.disabledAt != null, 2000);
  // systemowy DM do boba o wylaczeniu
  const sysMsg = ctx.db.prepare(
    "SELECT body FROM messages WHERE kind = 'system' ORDER BY id DESC LIMIT 1",
  ).get() as { body: string } | undefined;
  assert.ok(sysMsg && /WYLACZONY/.test(sysMsg.body), "brak sladu o wylaczeniu");
});

test("zly URL webhooka jest odrzucany przy rejestracji", () => {
  const ctx = testCtx();
  const bob = mkActor(ctx, "bob");
  assert.throws(() => setWake(ctx, bob.id, "nie-url"), /Invalid URL|http/);
  assert.throws(() => setWake(ctx, bob.id, "file:///etc/passwd"), /http/);
});

// --- digest i wzmianki -----------------------------------------------------

test("digest streszcza od kotwicy odczytu i wskazuje wzmianki", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  joinConv(ctx, c.id, bob.id);
  const m1 = postMessage(ctx, { conversationId: c.id, actorId: ala.id, body: "stara" });
  markRead(ctx, bob.id, c.id, m1.id);
  postMessage(ctx, { conversationId: c.id, actorId: ala.id, body: "nowa jedna" });
  postMessage(ctx, { conversationId: c.id, actorId: ala.id, body: "@bob nowa druga" });
  const d = digestFor(ctx, bob.id)!;
  assert.equal(d.count, 2);
  assert.deepEqual(d.byWho, [["ala", 2]]);
  assert.equal(d.mentions.length, 1);
  assert.match(d.mentions[0].body, /nowa druga/);
});

test("digest zwraca null, gdy nic sie nie dzialo", () => {
  const ctx = testCtx();
  const bob = mkActor(ctx, "bob");
  assert.equal(digestFor(ctx, bob.id), null);
});

test("wzmianka w cudzym kanale prywatnym nie wycieka przez mentionsOf", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const prv = createChannel(ctx, { slug: "s", kind: "private", createdBy: ala.id });
  postMessage(ctx, { conversationId: prv.id, actorId: ala.id, body: "@bob tajne plany" });
  assert.equal(mentionsOf(ctx, bob.id).length, 0);
});

test("wzmianka w kanale publicznym jest widoczna bez czlonkostwa", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala"), bob = mkActor(ctx, "bob");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  postMessage(ctx, { conversationId: c.id, actorId: ala.id, body: "@bob halo" });
  assert.equal(mentionsOf(ctx, bob.id).length, 1);
});

// --- piny ------------------------------------------------------------------

test("pin i unpin dzialaja w obrebie konwersacji, z autorem przypiecia", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: ala.id, body: "wazne" });
  const p = pin(ctx, { messageId: m.id, actorId: ala.id });
  assert.equal(p.by, "ala");
  assert.equal(listPins(ctx, { conversationId: c.id, actorId: ala.id }).length, 1);
  unpin(ctx, { messageId: m.id, actorId: ala.id });
  assert.equal(listPins(ctx, { conversationId: c.id, actorId: ala.id }).length, 0);
});

test("nie da sie przypiac wiadomosci z kanalu bez dostepu", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala"), obcy = mkActor(ctx, "obcy");
  const prv = createChannel(ctx, { slug: "s", kind: "private", createdBy: ala.id });
  const m = postMessage(ctx, { conversationId: prv.id, actorId: ala.id, body: "x" });
  assert.throws(() => pin(ctx, { messageId: m.id, actorId: obcy.id }), /brak dostepu/);
});

// --- zywotnosc aktora ------------------------------------------------------

test("actorLiveness: zywa sesja -> online, zakonczona -> nieobecny", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const bob = mkActor(ctx, "bob");
  assert.deepEqual(actorLiveness(ctx, bob.id), { online: false, lastSeenAt: null });
  registerSession(ctx, { sessionId: "s1", actorId: bob.id });
  assert.equal(actorLiveness(ctx, bob.id).online, true);
  t += 1000;
  assert.equal(actorLiveness(ctx, bob.id).online, false);
  assert.equal(actorLiveness(ctx, bob.id).lastSeenAt, 1000);
  endSession(ctx, "s1");
  assert.deepEqual(actorLiveness(ctx, bob.id), { online: false, lastSeenAt: null });
});

test("wake odrzuca adresy lokalne i prywatne (SSRF)", () => {
  const ctx = testCtx();
  const bob = mkActor(ctx, "bob");
  for (const bad of [
    "http://127.0.0.1/wake", "http://localhost:9000/x", "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/x", "http://192.168.1.1/x", "http://172.16.0.1/x", "http://[::1]/x",
  ]) {
    assert.throws(() => setWake(ctx, bob.id, bad), /lokalny|prywatny|http/, `przeszlo: ${bad}`);
  }
  assert.doesNotThrow(() => setWake(ctx, bob.id, "https://most.example.com/wake"));
});

test("wake pozwala na loopback tylko za jawna zgoda", () => {
  const ctx = testCtx();
  const bob = mkActor(ctx, "bob");
  assert.throws(() => setWake(ctx, bob.id, "http://127.0.0.1/wake"), /lokalny/);
  assert.doesNotThrow(() => setWake(ctx, bob.id, "http://127.0.0.1/wake", { allowLoopback: true }));
});

test("plik sensitive z ttl=0 dostaje domyslny TTL, nie staje sie wieczny", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const dir = mkdtempSync(join(tmpdir(), "at-files-"));
  const ala = mkActor(ctx, "ala");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: ala.id });
  const { file } = storeFile(ctx, dir, {
    actorId: ala.id, conversationId: c.id, name: "z.png", data: Buffer.from("x"),
    maxBytes: 1024, sensitive: true, ttlSec: 0,
  });
  assert.equal(file.expiresAt, 1000 + 24 * 3600, "ttl=0 przy sensitive musi dac domyslny TTL");
});
