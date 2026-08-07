import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, cookieAuth, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor, setPassword } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, ensureDirect } from "../../src/core/conversations.ts";
import { Router } from "../../src/http/router.ts";
import { readJson } from "../../src/http/respond.ts";
import { Readable } from "node:stream";
import type { Req } from "../../src/http/router.ts";

// --- router i czytanie ciala ----------------------------------------------

test("router dopasowuje parametry sciezki", () => {
  const r = new Router();
  r.add("GET", "/api/conversations/:id/messages", () => {});
  assert.equal(r.match("GET", "/api/conversations/42/messages")?.params.id, "42");
  assert.equal(r.match("GET", "/api/conversations/42"), null);
  assert.equal(r.match("POST", "/api/conversations/42/messages"), null);
});

test("readJson odrzuca cialo ponad limit", async () => {
  const req = Readable.from([Buffer.from("x".repeat(100))]) as unknown as Req;
  await assert.rejects(() => readJson(req, 10), /za duze/);
});

test("readJson odrzuca niepoprawny JSON", async () => {
  const req = Readable.from([Buffer.from("{ urwane")]) as unknown as Req;
  await assert.rejects(() => readJson(req, 1000), /poprawnym JSON/);
});

// --- scena wspolna dla testow API -----------------------------------------

function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const michal = createActor(s.ctx, { kind: "human", handle: "michal", isAdmin: true });
  setPassword(s.ctx, michal.id, "haslo1234");
  const kanal = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  const prywatny = createChannel(s.ctx, { slug: "tajne", kind: "private", createdBy: ala.id });
  const dm = ensureDirect(s.ctx, [ala.id, bob.id]);
  return {
    ala, bob, michal,
    tokenA: mintToken(s.ctx, ala.id, "test").token,
    tokenB: mintToken(s.ctx, bob.id, "test").token,
    kanalId: kanal.id,
    prywatnyId: prywatny.id,
    dmId: dm.id,
  };
}

test("bez uwierzytelnienia API zwraca 401, nie 500", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/conversations");
  assert.equal(r.status, 401);
  assert.equal((await r.json()).code, "nieuwierzytelniony");
  await s.close();
});

test("health dziala bez uwierzytelnienia", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  await s.close();
});

test("nieznana sciezka daje 404 z kodem", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/czegos-takiego-nie-ma");
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "nie_znaleziono");
  await s.close();
});

test("agent wysyla wiadomosc, a drugi ja czyta", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, kanalId } = seed(s);
  const post = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "czesc" }),
  });
  assert.equal(post.status, 201);
  const list = await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    headers: bearer(tokenB),
  })).json();
  assert.equal(list.messages.at(-1).body, "czesc");
  await s.close();
});

test("nie da sie czytac cudzego kanalu prywatnego przez API", async () => {
  const s = await startTestServer();
  const { tokenB, prywatnyId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${prywatnyId}/messages`, {
    headers: bearer(tokenB),
  });
  assert.equal(r.status, 403);
  await s.close();
});

test("klient nie moze podszyc sie pod innego aktora polem w ciele", async () => {
  const s = await startTestServer();
  const { tokenA, bob, kanalId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ body: "podszycie", actorId: bob.id }),
  });
  assert.notEqual((await r.json()).message.actorId, bob.id);
  await s.close();
});

test("blad domenowy mapuje sie na kod HTTP, nie na 500", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "" }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "puste_cialo");
  await s.close();
});

test("czlowiek loguje sie i dostaje cookie oraz token CSRF", async () => {
  const s = await startTestServer();
  seed(s);
  const r = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  assert.equal(r.status, 200);
  const setCookie = r.headers.get("set-cookie")!;
  assert.match(setCookie, /^at_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.ok((await r.json()).csrf.length > 0);
  await s.close();
});

test("zle haslo i nieistniejacy uzytkownik daja ten sam komunikat", async () => {
  const s = await startTestServer();
  seed(s);
  const zle = await (await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "nie-to" }),
  })).json();
  const brak = await (await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "nie-ma-takiego", password: "cokolwiek" }),
  })).json();
  assert.equal(zle.error, brak.error);
  await s.close();
});

test("mutacja z cookie bez naglowka CSRF jest odrzucona", async () => {
  const s = await startTestServer();
  const { kanalId } = seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const bez = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ body: "bez csrf" }),
  });
  assert.equal(bez.status, 403);
  const z = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: cookieAuth(login.headers.get("set-cookie")!),
    body: JSON.stringify({ body: "z csrf" }),
  });
  assert.equal(z.status, 201);
  await s.close();
});

test("zadanie z bearerem nie wymaga CSRF", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "bez csrf" }),
  });
  assert.equal(r.status, 201);
  await s.close();
});

test("rozmowa grupowa powstaje z listy handle i zawiera nadawce", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  createActor(s.ctx, { kind: "agent", handle: "cez" });
  const r = await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ kind: "group", members: ["bob", "cez"] }),
  });
  assert.equal(r.status, 201);
  const conv = (await r.json()).conversation;
  assert.equal(conv.kind, "group");
  const detail = await (await fetch(`${s.url}/api/conversations/${conv.id}`, {
    headers: bearer(tokenA),
  })).json();
  assert.equal(detail.members.length, 3);
  await s.close();
});

test("rozmowa z nieistniejacym aktorem daje 404 z nazwa", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const r = await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ kind: "dm", members: ["kogo-nie-ma"] }),
  });
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /kogo-nie-ma/);
  await s.close();
});

test("licznik nieprzeczytanych zeruje sie po oznaczeniu widoku", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  await fetch(`${s.url}/api/conversations/${dmId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "hej" }),
  });
  const przed = await (await fetch(s.url + "/api/unread", { headers: bearer(tokenB) })).json();
  assert.equal(przed.rows.find((r: any) => r.conversationId === dmId).badge, 1);
  await fetch(`${s.url}/api/conversations/${dmId}/read`, {
    method: "POST", headers: bearer(tokenB), body: "{}",
  });
  const po = await (await fetch(s.url + "/api/unread", { headers: bearer(tokenB) })).json();
  assert.equal(po.rows.find((r: any) => r.conversationId === dmId).unread, 0);
  await s.close();
});

test("wyszukiwanie przez API respektuje dostep", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, prywatnyId } = seed(s);
  await fetch(`${s.url}/api/conversations/${prywatnyId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "poufna sprawa" }),
  });
  const mine = await (await fetch(s.url + "/api/search?q=poufna", {
    headers: bearer(tokenA),
  })).json();
  const theirs = await (await fetch(s.url + "/api/search?q=poufna", {
    headers: bearer(tokenB),
  })).json();
  assert.equal(mine.messages.length, 1);
  assert.equal(theirs.messages.length, 0);
  await s.close();
});

test("edycja i kasowanie cudzej wiadomosci daje 403", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, kanalId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "moje" }),
  })).json()).message;
  const patch = await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "PATCH", headers: bearer(tokenB), body: JSON.stringify({ body: "przejmuje" }),
  });
  assert.equal(patch.status, 403);
  const del = await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "DELETE", headers: bearer(tokenB),
  });
  assert.equal(del.status, 403);
  await s.close();
});

test("obecnosc pokazuje zarejestrowana sesje z sygnalem busy", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  await fetch(s.url + "/api/sessions", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ sessionId: "sesja-1", label: "vps", kind: "durable" }),
  });
  await fetch(s.url + "/api/sessions/sesja-1/signal", {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ kind: "busy" }),
  });
  const p = await (await fetch(s.url + "/api/presence", { headers: bearer(tokenA) })).json();
  assert.equal(p.presence[0].busy, true);
  assert.equal(p.presence[0].typing, false);
  await s.close();
});

test("otwarte pytanie zamyka odpowiedz od kogokolwiek", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, kanalId } = seed(s);
  const q = await (await fetch(`${s.url}/api/conversations/${kanalId}/ask`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "czy mozna deploy?" }),
  })).json();
  const otwarte = await (await fetch(s.url + "/api/questions/open", {
    headers: bearer(tokenB),
  })).json();
  assert.equal(otwarte.questions.length, 1);
  await fetch(`${s.url}/api/questions/${q.question}/answer`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ body: "mozna" }),
  });
  const po = await (await fetch(s.url + "/api/questions/open", { headers: bearer(tokenB) })).json();
  assert.equal(po.questions.length, 0);
  await s.close();
});

test("lista konwersacji rozroznia kanal moj od kanalu, ktory tylko widze", async () => {
  const s = await startTestServer();
  const { tokenB, kanalId } = seed(s);
  const przed = await (await fetch(s.url + "/api/conversations", {
    headers: bearer(tokenB),
  })).json();
  assert.ok(
    przed.conversations.some((c: any) => c.id === kanalId),
    "kanal publiczny ma byc widoczny",
  );
  assert.equal(
    przed.memberships.some((m: any) => m.conversationId === kanalId), false,
    "bob jeszcze nie dolaczyl",
  );
  await fetch(`${s.url}/api/conversations/${kanalId}/join`, {
    method: "POST", headers: bearer(tokenB),
  });
  const po = await (await fetch(s.url + "/api/conversations", {
    headers: bearer(tokenB),
  })).json();
  assert.ok(po.memberships.some((m: any) => m.conversationId === kanalId));
  await s.close();
});

test("nie da sie dolaczyc do kanalu prywatnego przez join", async () => {
  const s = await startTestServer();
  const { tokenB, prywatnyId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${prywatnyId}/join`, {
    method: "POST", headers: bearer(tokenB),
  });
  assert.equal(r.status, 403);
  await s.close();
});
