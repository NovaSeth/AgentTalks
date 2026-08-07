import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, openSse, startTestServer, type TestServer } from "../http-helpers.ts";
import { waitFor } from "../helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, ensureDirect, join } from "../../src/core/conversations.ts";

function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const kanal = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  join(s.ctx, kanal.id, bob.id);
  const prywatny = createChannel(s.ctx, { slug: "tajne", kind: "private", createdBy: ala.id });
  const dm = ensureDirect(s.ctx, [ala.id, bob.id]);
  return {
    ala, bob,
    tokenA: mintToken(s.ctx, ala.id, "t").token,
    tokenB: mintToken(s.ctx, bob.id, "t").token,
    kanalId: kanal.id,
    prywatnyId: prywatny.id,
    dmId: dm.id,
  };
}

test("SSE dostarcza wiadomosc do czlonka konwersacji", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, kanalId } = seed(s);
  const es = await openSse(s.url + "/api/events", tokenB);
  await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "push" }),
  });
  const ev = await es.next(2000) as any;
  assert.equal(ev.type, "message");
  assert.equal(ev.message.body, "push");
  es.close();
  await s.close();
});

test("SSE nie dostarcza z konwersacji, ktorej nie jestem czlonkiem", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, prywatnyId } = seed(s);
  const es = await openSse(s.url + "/api/events", tokenB);
  await fetch(`${s.url}/api/conversations/${prywatnyId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "tajne" }),
  });
  await assert.rejects(() => es.next(500), /timeout/);
  es.close();
  await s.close();
});

test("SSE wznawia sie od kursora i dosyla zaleglosci", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "zaleglosc" }),
  });
  const es = await openSse(s.url + "/api/events?after=0", tokenB);
  const ev = await es.next(2000) as any;
  assert.equal(ev.message.body, "zaleglosc");
  es.close();
  await s.close();
});

test("zerwany klient SSE zwalnia subskrypcje", async () => {
  const s = await startTestServer();
  const { bob, tokenB } = seed(s);
  const es = await openSse(s.url + "/api/events", tokenB);
  await waitFor(() => s.ctx.bus.subscriberCount(bob.id) === 1, 2000);
  es.close();
  await waitFor(() => s.ctx.bus.subscriberCount(bob.id) === 0, 3000);
  await s.close();
});

test("long-poll wraca natychmiast, gdy sa zalegle wiadomosci", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "zaleglosc" }),
  });
  const t0 = Date.now();
  const r = await (await fetch(`${s.url}/api/messages?after=0&wait=30`, {
    headers: bearer(tokenB),
  })).json();
  assert.ok(Date.now() - t0 < 1000, "long-poll czekal mimo zaleglosci");
  assert.equal(r.messages.length, 1);
  await s.close();
});

test("long-poll budzi sie na wiadomosc NATYCHMIAST, nie przez timeout", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const t0 = Date.now();
  const pending = fetch(`${s.url}/api/messages?after=0&wait=10`, { headers: bearer(tokenB) });
  await new Promise((r) => setTimeout(r, 120));
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "w trakcie" }),
  });
  const r = await (await pending).json();
  const elapsed = Date.now() - t0;
  // Zepsute wybudzanie tez zwroci wiadomosc - ale dopiero po 10 s timeoutu.
  // Dowodem dziala wybudzanie jest CZAS, nie sama tresc odpowiedzi.
  assert.ok(elapsed < 5000, `long-poll wrocil po ${elapsed} ms - to byl timeout, nie wybudzenie`);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].body, "w trakcie");
  await s.close();
});

test("SSE bez kursora NIE dosyla historii - tylko to, co nadejdzie", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "historia" }),
  });
  const es = await openSse(s.url + "/api/events", tokenB);
  await assert.rejects(() => es.next(400), /timeout/);
  es.close();
  await s.close();
});

test("SSE wznawia z Last-Event-ID i dosyla backlog wiekszy niz jedna strona", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  // 205 wiadomosci > strona wznowienia (200) - pojedyncza strona ucinalaby ogon
  for (let i = 0; i < 205; i++) {
    await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
      method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "zaleglosc " + i }),
    });
  }
  const es = await openSse(s.url + "/api/events?after=0", tokenB);
  const got: string[] = [];
  for (let i = 0; i < 205; i++) {
    const ev = await es.next(5000) as any;
    got.push(ev.message.body);
  }
  assert.equal(got.length, 205);
  assert.equal(got[204], "zaleglosc 204", "ogon backlogu powyzej 200 zostal uciety");
  es.close();
  await s.close();
});

test("wznowienie SSE dosyla message_updated dla edycji sprzed kursora", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "pierwotna" }),
  })).json()).message;
  // klient widzial wiadomosc (kursor za nia), rozlaczyl sie, autor edytowal
  await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "PATCH", headers: bearer(tokenA), body: JSON.stringify({ body: "po edycji" }),
  });
  const es = await openSse(`${s.url}/api/events?after=${m.id}`, tokenB);
  const ev = await es.next(3000) as any;
  assert.equal(ev.type, "message_updated");
  assert.equal(ev.message.body, "po edycji");
  es.close();
  await s.close();
});

test("long-poll konczy sie pusta lista po uplywie wait", async () => {
  const s = await startTestServer();
  const { tokenB } = seed(s);
  const r = await (await fetch(`${s.url}/api/messages?after=999999&wait=1`, {
    headers: bearer(tokenB),
  })).json();
  assert.deepEqual(r.messages, []);
  await s.close();
});

test("long-poll nie zwraca wlasnych wiadomosci", async () => {
  const s = await startTestServer();
  const { tokenA, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "moja" }),
  });
  const r = await (await fetch(`${s.url}/api/messages?after=0&wait=0`, {
    headers: bearer(tokenA),
  })).json();
  assert.deepEqual(r.messages, []);
  await s.close();
});

test("long-poll bez uwierzytelnienia daje 401", async () => {
  const s = await startTestServer();
  const r = await fetch(`${s.url}/api/messages?after=0&wait=0`);
  assert.equal(r.status, 401);
  await s.close();
});
