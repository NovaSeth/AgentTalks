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

// --- the shared scene for the API tests -------------------------------------

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

test("HEAD na trasie GET odpowiada jak GET, bez ciala (monitoring)", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/health", { method: "HEAD" });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "");
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

test("sfalszowane i wygasle cookie sesji daje 401 przez API", async () => {
  const s = await startTestServer();
  const { michal } = seed(s);
  // podpis od innego sekretu
  const fake = `at_session=${michal.id}.9999999999.deadbeef`;
  const r1 = await fetch(s.url + "/api/me", { headers: { cookie: fake } });
  assert.equal(r1.status, 401);
  // dobre cookie, ale wygasle (expiry w przeszlosci, podpis prawidlowy)
  const { makeCookie } = await import("../../src/http/auth.ts");
  const expired = makeCookie(s.ctx, s.config, michal.id, -10, false).split(";")[0];
  const r2 = await fetch(s.url + "/api/me", { headers: { cookie: expired } });
  assert.equal(r2.status, 401);
  await s.close();
});

test("cookie sesji jest ODWOLYWALNE: zmiana hasla uniewaznia wydane wczesniej", async () => {
  const s = await startTestServer();
  const { michal } = seed(s);
  const { makeCookie } = await import("../../src/http/auth.ts");
  const { setPassword } = await import("../../src/core/actors.ts");

  const cookie = makeCookie(s.ctx, s.config, michal.id, 3600, false).split(";")[0];
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 200);

  // Changing a password has to throw out every earlier session - otherwise "I changed my
  // password after the laptop was stolen" does not mean "I closed that door".
  setPassword(s.ctx, michal.id, "zupelnie-nowe-haslo");
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 401);

  // A new login works normally.
  const swieze = makeCookie(s.ctx, s.config, michal.id, 3600, false).split(";")[0];
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie: swieze } })).status, 200);
  await s.close();
});

test("wylaczenie konta uniewaznia otwarta sesje na cookie, nie tylko nastepne logowanie", async () => {
  const s = await startTestServer();
  const { michal } = seed(s);
  const { makeCookie } = await import("../../src/http/auth.ts");
  const { setDisabled } = await import("../../src/core/actors.ts");
  const cookie = makeCookie(s.ctx, s.config, michal.id, 3600, false).split(";")[0];
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 200);
  setDisabled(s.ctx, michal.id, true);
  assert.equal((await fetch(s.url + "/api/me", { headers: { cookie } })).status, 401);
  await s.close();
});

test("zle procent-kodowanie w sciezce daje 404, nie 500", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const r = await fetch(s.url + "/api/files/%zz/info", { headers: bearer(tokenA) });
  assert.equal(r.status, 404);
  await s.close();
});

test("watek nieistniejacy i watek bez dostepu daja te sama odpowiedz", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, prywatnyId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${prywatnyId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "tajne" }),
  })).json()).message;
  const noAccess = await fetch(`${s.url}/api/messages/${m.id}/thread`, {
    headers: bearer(tokenB),
  });
  const missing = await fetch(`${s.url}/api/messages/999999/thread`, {
    headers: bearer(tokenB),
  });
  assert.equal(noAccess.status, 404);
  assert.equal(missing.status, 404);
  await s.close();
});

test("kind=ask przemycone przez POST /messages nie tworzy pytania-sieroty", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  const r = await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ body: "podstepne pytanie?", kind: "ask" }),
  })).json();
  assert.equal(r.message.kind, "text", "kind ask ma isc wylacznie przez /ask");
  const n = s.ctx.db.prepare("SELECT count(*) AS n FROM questions").get() as { n: number };
  assert.equal(n.n, 0);
  await s.close();
});

test("nie da sie przymusowo dopisac kogos do kanalu publicznego", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  const r = await fetch(`${s.url}/api/conversations/${kanalId}/members`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ handle: "bob" }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "publiczny_sam");
  await s.close();
});

test("edycja wiadomosci aktualizuje indeks wyszukiwania", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  const m = (await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "pierwotna fraza" }),
  })).json()).message;
  await fetch(`${s.url}/api/messages/${m.id}`, {
    method: "PATCH", headers: bearer(tokenA), body: JSON.stringify({ body: "zmieniona tresc" }),
  });
  const stara = await (await fetch(s.url + "/api/search?q=pierwotna", {
    headers: bearer(tokenA),
  })).json();
  const nowa = await (await fetch(s.url + "/api/search?q=zmieniona", {
    headers: bearer(tokenA),
  })).json();
  assert.equal(stara.messages.length, 0, "stara tresc nie moze byc znajdowalna");
  assert.equal(nowa.messages.length, 1);
  await s.close();
});

test("dzierzawa przez API: 200 przy zajeciu, 409 z wlascicielem przy odmowie", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  const ok = await fetch(s.url + "/api/leases", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ resource: "deploy", ttlSec: 120, note: "wdrazam" }),
  });
  assert.equal(ok.status, 200);
  const denied = await fetch(s.url + "/api/leases", {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ resource: "deploy" }),
  });
  assert.equal(denied.status, 409);
  const body = await denied.json();
  assert.equal(body.heldBy.handle, "ala");
  await s.close();
});

test("upload pliku przez API, pobranie przez czlonka, odmowa dla obcego", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const up = await fetch(`${s.url}/api/conversations/${dmId}/files`, {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization,
      "content-type": "text/plain", "x-file-name": "raport.txt" },
    body: "tresc raportu",
  });
  assert.equal(up.status, 201);
  const fileId = (await up.json()).file.id;
  const got = await fetch(`${s.url}/api/files/${fileId}`, { headers: bearer(tokenB) });
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "tresc raportu");
  const obcy = createActor(s.ctx, { kind: "agent", handle: "obcy" });
  const tokenObcy = mintToken(s.ctx, obcy.id, "t").token;
  const denied = await fetch(`${s.url}/api/files/${fileId}`, {
    headers: bearer(tokenObcy),
  });
  assert.equal(denied.status, 404);
  await s.close();
});

/**
 * The file name arrives in a header, so it MUST be %-encoded (HTTP headers do not carry
 * accented characters). Bad encoding is not an exotic case: every client that assembles the
 * header by hand rather than through encodeURIComponent does it - and "report 50%.txt" is
 * enough to make decodeURIComponent throw. Without this test a 400 with a readable message
 * could quietly become a 500.
 */
test("X-File-Name ze zlym %-kodowaniem daje 400 z instrukcja, nie 500", async () => {
  const s = await startTestServer();
  try {
  const { tokenA, dmId } = seed(s);
  const wyslij = (nazwa: string) => fetch(`${s.url}/api/conversations/${dmId}/files`, {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization,
      "content-type": "text/plain", "x-file-name": nazwa },
    body: "tresc",
  });

  const zle = await wyslij("raport 50%.txt");
  assert.equal(zle.status, 400, "urwane %-kodowanie ma dac blad zadania, nie awarie serwera");
  const blad = await zle.json();
  assert.equal(blad.code, "zla_nazwa");
  assert.match(blad.error, /encodeURIComponent/, "komunikat ma mowic, CO zrobic");

  // The same name, correctly encoded, goes through and comes back in its original form - that
  // is, the rejection is about the encoding, not about the percent sign itself.
  const dobre = await wyslij(encodeURIComponent("raport 50%.txt"));
  assert.equal(dobre.status, 201);
  assert.equal((await dobre.json()).file.name, "raport 50%.txt");
  } finally { await s.close(); }
});

test("plik z aktywnym MIME (text/html) jest serwowany inertnie (anty stored-XSS)", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, dmId } = seed(s);
  const up = await fetch(`${s.url}/api/conversations/${dmId}/files`, {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization,
      "content-type": "text/html", "x-file-name": "atak.html" },
    body: "<script>document.title='xss'</script>",
  });
  assert.equal(up.status, 201);
  const fileId = (await up.json()).file.id;
  const got = await fetch(`${s.url}/api/files/${fileId}`, { headers: bearer(tokenB) });
  assert.equal(got.status, 200);
  // typ zneutralizowany, wymuszone pobranie, brak wachania, sandbox
  assert.equal(got.headers.get("content-type"), "application/octet-stream");
  assert.match(got.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.match(got.headers.get("content-security-policy") ?? "", /sandbox/);
  await s.close();
});

test("wake: rejestracja zwraca sekret raz, GET pokazuje konfiguracje bez sekretu", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const put = await (await fetch(s.url + "/api/wake", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ target: "https://most.example/wake" }),
  })).json();
  assert.ok(put.secret.length > 20);
  const got = await (await fetch(s.url + "/api/wake", { headers: bearer(tokenA) })).json();
  assert.equal(got.wake.target, "https://most.example/wake");
  assert.equal(got.wake.secret, undefined, "sekret nie moze byc odczytywalny po fakcie");
  await s.close();
});

test("odpowiedz z wiadomosciami niesie mape aktorow z kind (egzekwowanie human)", async () => {
  const s = await startTestServer();
  const { tokenA, michal, kanalId } = seed(s);
  await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "od agenta" }),
  });
  const r = await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    headers: bearer(tokenA),
  })).json();
  const authorId = r.messages.at(-1).actorId;
  assert.ok(r.actors[authorId], "brak mapy aktorow w odpowiedzi");
  assert.equal(r.actors[authorId].kind, "agent");
  void michal;
  await s.close();
});

test("health robi realna sonde DB (liczby, nie tylko ok)", async () => {
  const s = await startTestServer();
  seed(s);
  const h = await (await fetch(s.url + "/api/health")).json();
  assert.equal(h.ok, true);
  assert.equal(typeof h.actors, "number");
  assert.ok(h.actors >= 3, "health nie odczytal realnej liczby aktorow");
  assert.equal(typeof h.lastMessageId, "number");
  await s.close();
});

test("clientMsgId przez API: powtorzony POST zwraca to samo id, bez drugiej wiadomosci", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  const body = JSON.stringify({ body: "deploy prod", clientMsgId: "req-42" });
  const m1 = (await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body,
  })).json()).message;
  const m2 = (await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body,
  })).json()).message;
  assert.equal(m1.id, m2.id);
  const list = await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    headers: bearer(tokenA),
  })).json();
  assert.equal(list.messages.filter((m: any) => m.body === "deploy prod").length, 1);
  await s.close();
});

test("pierwsze polaczenie serwuje zasady z promptem, drugie juz nie", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const me1 = await (await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).json();
  assert.ok(me1.guidelines, "pierwsze /api/me nie podalo zasad");
  assert.match(me1.guidelines.prompt, /przeczytaj/i);
  assert.match(me1.guidelines.text, /AgentTalks/);
  const me2 = await (await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).json();
  assert.equal(me2.guidelines, undefined, "zasady podane drugi raz");
  await s.close();
});

test("GET /api/guidelines zwraca tekst zasad na zadanie", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const r = await (await fetch(s.url + "/api/guidelines", { headers: bearer(tokenA) })).json();
  assert.match(r.text, /jak się tu odnaleźć|AgentTalks/);
  await s.close();
});

test("enroll: zaproszenie zaklada aktora, token dziala; zly kod = 403", async () => {
  const s = await startTestServer();
  const { createInvite } = await import("../../src/core/invites.ts");
  const { code } = createInvite(s.ctx, { createdBy: null, uses: 2 });
  const r = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    // kind:"human" in the body MUST be ignored - enroll creates an agent only.
    body: JSON.stringify({ invite: code, handle: "swiezak", kind: "human" }),
  });
  assert.equal(r.status, 201);
  const { token, actor } = await r.json();
  assert.equal(actor.handle, "swiezak");
  assert.equal(actor.kind, "agent");
  const me = await fetch(s.url + "/api/me", { headers: bearer(token) });
  assert.equal(me.status, 200);
  const bad = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite: "ati_zle", handle: "ktos" }),
  });
  assert.equal(bad.status, 403);
  await s.close();
});

test("wiki przez API: zapis, odczyt, szukanie, historia, revert", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  const put = await fetch(s.url + "/api/wiki/projekt", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Projekt", body: "wersja jeden z frazą kanarek" }),
  });
  // The wiki is saved with PUT; there is no POST on that address. There used to be an assertion
  // here admitting 404, 405 OR 200 - that is, a condition that could not be broken, with a
  // comment saying "fix this". A test that cannot fail protects nothing; this one checks a
  // specific response.
  assert.equal(put.status, 404);
  assert.equal((await put.json()).code, "nie_znaleziono");
  const put2 = await fetch(s.url + "/api/wiki/projekt", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Projekt", body: "wersja jeden z frazą kanarek" }),
  });
  assert.equal(put2.status, 200);
  const read = await (await fetch(s.url + "/api/wiki/projekt", { headers: bearer(tokenA) })).json();
  assert.equal(read.page.title, "Projekt");
  const found = await (await fetch(s.url + "/api/wiki/search?q=kanarek", { headers: bearer(tokenA) })).json();
  assert.equal(found.hits.length, 1);
  assert.equal(found.hits[0].slug, "projekt");
  await fetch(s.url + "/api/wiki/projekt", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Projekt", body: "zepsute" }),
  });
  const hist = await (await fetch(s.url + "/api/wiki/projekt/history", { headers: bearer(tokenA) })).json();
  assert.equal(hist.revisions.length, 2);
  const firstRev = hist.revisions.at(-1).id;
  const rev = await fetch(s.url + "/api/wiki/projekt/revert", {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ revisionId: firstRev }),
  });
  assert.equal(rev.status, 200);
  const after = await (await fetch(s.url + "/api/wiki/projekt", { headers: bearer(tokenA) })).json();
  assert.match(after.page.body, /kanarek/);
  await s.close();
});

test("wiki: strona jest wspolna - inny aktor tez ja edytuje (po przeczytaniu)", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/wspolna", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "W", body: "od ali" }),
  });
  // Bob reads first (a GET means "I have seen it"), then writes - and that goes through.
  await fetch(s.url + "/api/wiki/wspolna", { headers: bearer(tokenB) });
  const r = await fetch(s.url + "/api/wiki/wspolna", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "W", body: "od boba" }),
  });
  assert.equal(r.status, 200);
  const read = await (await fetch(s.url + "/api/wiki/wspolna", { headers: bearer(tokenB) })).json();
  assert.equal(read.page.body, "od boba");
  await s.close();
});

test("wiki: slepy zapis na cudza strone -> 409 z numerem rewizji, po przeczytaniu -> 200", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/korzen", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Ala ma strone", body: "tresc ali" }),
  });
  // Bob has never seen this page - a PUT would silently overwrite somebody else's work.
  const blind = await fetch(s.url + "/api/wiki/korzen", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Bob ma strone", body: "tresc boba" }),
  });
  assert.equal(blind.status, 409);
  const err = await blind.json();
  assert.equal(err.code, "konflikt_wiki");
  // The error has to lead to the content that would be lost: the revision id and the author.
  const page = await (await fetch(s.url + "/api/wiki/korzen", { headers: bearer(tokenB) })).json();
  assert.ok(page.page.lastRevisionId > 0);
  assert.match(err.error, new RegExp(String(page.page.lastRevisionId)));
  assert.match(err.error, /ala/);
  // Ala's content stands untouched.
  assert.equal(page.page.body, "tresc ali");
  // After reading it (the GET above) the same write goes through.
  const after = await fetch(s.url + "/api/wiki/korzen", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Bob ma strone", body: "tresc boba" }),
  });
  assert.equal(after.status, 200);
  await s.close();
});

test("wiki: baseRevision - zgodny przechodzi, rozjechany daje 409, 0 = tylko zaloz", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Plan", body: "v1" }),
  });
  const p1 = await (await fetch(s.url + "/api/wiki/plan", { headers: bearer(tokenA) })).json();
  const rev1 = p1.page.lastRevisionId;
  // A write based on the revision we saw - goes through.
  const ok = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Plan", body: "v2", baseRevision: rev1 }),
  });
  assert.equal(ok.status, 200);
  // Bob reads (he is "up to date"), Ala writes, Bob saves on the old basis.
  const p2 = await (await fetch(s.url + "/api/wiki/plan", { headers: bearer(tokenB) })).json();
  await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Plan", body: "v3" }),
  });
  const stale = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenB),
    body: JSON.stringify({ title: "Plan", body: "moje", baseRevision: p2.page.lastRevisionId }),
  });
  assert.equal(stale.status, 409);
  // force = swiadome nadpisanie, przechodzi mimo rozjazdu
  const forced = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenB),
    body: JSON.stringify({ title: "Plan", body: "moje", force: true }),
  });
  assert.equal(forced.status, 200);
  // baseRevision=0 means "create it if it does not exist" - on an existing page, a 409
  const createOnly = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Plan", body: "x", baseRevision: 0 }),
  });
  assert.equal(createOnly.status, 409);
  // ...and on a new slug it goes through
  const fresh = await fetch(s.url + "/api/wiki/zupelnie-nowa", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Nowa", body: "x", baseRevision: 0 }),
  });
  assert.equal(fresh.status, 200);
  await s.close();
});

test("wiki attach: plik podpiety, pobieralny przez innego zalogowanego", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/dokumenty", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Dok", body: "x" }),
  });
  const up = await fetch(s.url + "/api/wiki/dokumenty/files", {
    method: "POST",
    headers: { authorization: (bearer(tokenA) as any).authorization, "content-type": "text/plain",
      "x-file-name": "notatka.txt" },
    body: "publiczna notatka",
  });
  assert.equal(up.status, 201);
  const fileId = (await up.json()).file.id;
  const got = await fetch(s.url + "/api/files/" + fileId, { headers: bearer(tokenB) });
  assert.equal(got.status, 200);
  assert.equal(await got.text(), "publiczna notatka");
  await s.close();
});

test("wiki: podglad pojedynczej rewizji zwraca pelna tresc; cudza/nieistniejaca -> 404", async () => {
  const s = await startTestServer();
  const { tokenA } = seed(s);
  await fetch(s.url + "/api/wiki/notatki", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "N", body: "wersja pierwsza" }),
  });
  await fetch(s.url + "/api/wiki/notatki", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "N", body: "wersja druga" }),
  });
  const hist = await (await fetch(s.url + "/api/wiki/notatki/history", { headers: bearer(tokenA) })).json();
  const firstId = hist.revisions.at(-1).id;
  const rev = await (await fetch(`${s.url}/api/wiki/notatki/revisions/${firstId}`, { headers: bearer(tokenA) })).json();
  assert.equal(rev.revision.body, "wersja pierwsza");
  assert.equal(rev.revision.actor, "ala");
  // a revision of another page under this slug -> 404 (ids are global)
  await fetch(s.url + "/api/wiki/inna", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "I", body: "x" }),
  });
  const histInna = await (await fetch(s.url + "/api/wiki/inna/history", { headers: bearer(tokenA) })).json();
  const obcaRewizja = histInna.revisions[0].id;
  const bad = await fetch(`${s.url}/api/wiki/notatki/revisions/${obcaRewizja}`, { headers: bearer(tokenA) });
  assert.equal(bad.status, 404);
  await s.close();
});

// --- panel admina -----------------------------------------------------------

test("panel admina: czlowiek-admin wchodzi, agent (nawet adminowski) nie", async () => {
  const s = await startTestServer();
  const { ala, tokenA } = seed(s);
  // an agent without admin
  const r1 = await fetch(s.url + "/api/admin/actors", { headers: bearer(tokenA) });
  assert.equal(r1.status, 403);
  // an agent WITH admin - still no: the panel is for a human
  s.ctx.db.prepare("UPDATE actors SET is_admin = 1 WHERE id = ?").run(ala.id);
  const r2 = await fetch(s.url + "/api/admin/actors", { headers: bearer(tokenA) });
  assert.equal(r2.status, 403);
  // a human admin through a cookie: 200 + actors with tokens and invites
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const r3 = await fetch(s.url + "/api/admin/actors", { headers: { cookie } });
  assert.equal(r3.status, 200);
  const data = await r3.json();
  assert.ok(Array.isArray(data.actors) && data.actors.length >= 3);
  const alaRow = data.actors.find((a: { handle: string }) => a.handle === "ala");
  assert.ok(alaRow.tokens.length >= 1, "brak tokenow w odpowiedzi admina");
  await s.close();
});

test("panel admina: zaproszenie z UI dziala w enrollu, odwolane przestaje", async () => {
  const s = await startTestServer();
  seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const csrf = (await login.json()).csrf as string;
  const created = await (await fetch(s.url + "/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-at-csrf": csrf },
    body: JSON.stringify({ note: "test-ui", uses: 1 }),
  })).json();
  assert.match(created.code, /^ati_/);
  // enroll kodem z panelu
  const enr = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite: created.code, handle: "nowy-agent" }),
  });
  assert.equal(enr.status, 201);
  // the second invite: one revoked before use does not work
  const c2 = await (await fetch(s.url + "/api/admin/invites", {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-at-csrf": csrf },
    body: JSON.stringify({ uses: 1 }),
  })).json();
  const rev = await fetch(s.url + `/api/admin/invites/${c2.invite.id}`, {
    method: "DELETE", headers: { cookie, "x-at-csrf": csrf },
  });
  assert.equal(rev.status, 200);
  const enr2 = await fetch(s.url + "/api/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite: c2.code, handle: "spozniony" }),
  });
  assert.equal(enr2.status, 403);
  await s.close();
});

test("panel admina: wylaczenie konta gasi token, wlaczenie przywraca", async () => {
  const s = await startTestServer();
  const { ala, tokenA } = seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const csrf = (await login.json()).csrf as string;
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 200);
  await fetch(s.url + `/api/admin/actors/${ala.id}/disable`, {
    method: "POST", headers: { cookie, "x-at-csrf": csrf },
  });
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 401);
  await fetch(s.url + `/api/admin/actors/${ala.id}/enable`, {
    method: "POST", headers: { cookie, "x-at-csrf": csrf },
  });
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 200);
  await s.close();
});

// --- centrum powiadomien ----------------------------------------------------

test("powiadomienia: wzmianka, DM i reakcja trafiaja do centrum; odhaczenie zeruje licznik", async () => {
  const s = await startTestServer();
  const { ala, tokenA, tokenB } = seed(s);
  const conv = await (await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ kind: "public", slug: "ogloszenia" }),
  })).json();
  const convId = conv.conversation.id;
  await fetch(`${s.url}/api/conversations/${convId}/join`, { method: "POST", headers: bearer(tokenB), body: "{}" });

  // 1. A mention on a channel - a notification for the person called, not for the author.
  await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "@bob zerknij na deploy" }),
  });
  let mine = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(mine.unread, 1);
  assert.equal(mine.notifications[0].kind, "mention");
  assert.equal(mine.notifications[0].from, "ala");
  assert.equal(mine.notifications[0].conversationId, convId);
  assert.match(mine.notifications[0].excerpt, /deploy/);
  const autor = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenA) })).json();
  assert.equal(autor.unread, 0, "wlasna wzmianka nie jest zdarzeniem dla autora");

  // 2. A DM: every message counts, not only a mention by name.
  const dm = await (await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ kind: "dm", members: ["@bob"] }),
  })).json();
  await fetch(`${s.url}/api/conversations/${dm.conversation.id}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "na priv" }),
  });
  mine = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(mine.unread, 2);
  assert.equal(mine.notifications[0].kind, "dm");

  // 3. A reaction to SOMEBODY ELSE'S post notifies its author; removing a reaction does not.
  const post = await (await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ body: "gotowe" }),
  })).json();
  const msgId = post.message.id;
  await fetch(`${s.url}/api/messages/${msgId}/reactions`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ emoji: "🎉" }),
  });
  let bobowe = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(bobowe.notifications[0].kind, "reaction");
  const poReakcji = bobowe.unread;
  await fetch(`${s.url}/api/messages/${msgId}/reactions`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ emoji: "🎉" }),
  });
  bobowe = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(bobowe.unread, poReakcji, "zdjecie reakcji nie jest nowym powiadomieniem");

  // 4. Odhaczenie wszystkiego + licznik w /api/me.
  const read = await (await fetch(s.url + "/api/notifications/read", {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({}),
  })).json();
  assert.equal(read.unread, 0);
  assert.equal(read.changed, poReakcji);
  const me = await (await fetch(s.url + "/api/me", { headers: bearer(tokenB) })).json();
  assert.equal(me.notifications.unread, 0);
  assert.ok(ala);
  await s.close();
});

test("powiadomienia wiki: zmiana strony wola tych, ktorzy juz na niej pisali", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB } = seed(s);
  await fetch(s.url + "/api/wiki/wspolna-notatka", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Notatka", body: "od ali" }),
  });
  // Bob appends to the page (reads, then writes) - from now on he is a co-author.
  await fetch(s.url + "/api/wiki/wspolna-notatka", { headers: bearer(tokenB) });
  await fetch(s.url + "/api/wiki/wspolna-notatka", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Notatka", body: "od ali + boba" }),
  });
  // Ala sees a notification about a change in something she co-authored; Bob gets no
  // notification about his own edit.
  const alowe = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenA) })).json();
  assert.equal(alowe.notifications[0].kind, "wiki");
  assert.equal(alowe.notifications[0].wikiSlug, "wspolna-notatka");
  assert.equal(alowe.notifications[0].from, "bob");
  const bobowe = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(bobowe.unread, 0);

  // Ticking off a single notification by id - the unread list is empty.
  await fetch(s.url + "/api/notifications/read", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ ids: [alowe.notifications[0].id] }),
  });
  const tylkoNowe = await (await fetch(s.url + "/api/notifications?unread=1", { headers: bearer(tokenA) })).json();
  assert.equal(tylkoNowe.notifications.length, 0);
  await s.close();
});

test("wiki: kasowanie strony - tylko zalozyciel albo admin; dzieci nie gina", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, michal } = seed(s);
  const tokenAdmin = mintToken(s.ctx, michal.id, "admin").token;
  await fetch(s.url + "/api/wiki/dzial", {
    method: "PUT", headers: bearer(tokenA), body: JSON.stringify({ title: "Dział", body: "korzeń" }),
  });
  await fetch(s.url + "/api/wiki/poddzial", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Poddział", body: "dziecko", parentSlug: "dzial" }),
  });
  // A stranger does not delete somebody else's page - writing together is not deleting.
  const obcy = await fetch(s.url + "/api/wiki/dzial", { method: "DELETE", headers: bearer(tokenB) });
  assert.equal(obcy.status, 403);
  assert.equal((await obcy.json()).code, "nie_twoja_strona");
  // The creator deletes; the child moves into the parent's place rather than disappearing.
  const del = await fetch(s.url + "/api/wiki/dzial", { method: "DELETE", headers: bearer(tokenA) });
  assert.equal(del.status, 200);
  const body = await del.json();
  assert.equal(body.deleted.movedChildren, 1);
  assert.equal(body.deleted.body, "korzeń", "odpowiedz niesie tresc, ktora znika");
  assert.equal((await fetch(s.url + "/api/wiki/dzial", { headers: bearer(tokenA) })).status, 404);
  const dziecko = await (await fetch(s.url + "/api/wiki/poddzial", { headers: bearer(tokenA) })).json();
  assert.equal(dziecko.page.parentSlug, null);
  // Admin instancji kasuje cudza strone.
  const adminDel = await fetch(s.url + "/api/wiki/poddzial", { method: "DELETE", headers: bearer(tokenAdmin) });
  assert.equal(adminDel.status, 200);
  await s.close();
});

test("zgloszenia: 'naprawione' moze naprawiajacy, 'potwierdzone' tylko autor/admin", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, kanalId } = seed(s);
  // Ala zglasza, Bob naprawia.
  const zgl = await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "wiki nadpisuje w ciemno" }),
  })).json();
  const id = zgl.message.id;

  // The fixer does NOT close the report (that is a claim about the symptom, not about the code)...
  const proba = await fetch(`${s.url}/api/messages/${id}/resolve`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ resolved: true }),
  });
  assert.equal(proba.status, 403);

  // ...but they can say "done on my side".
  const fix = await fetch(`${s.url}/api/messages/${id}/fix`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ fixed: true }),
  });
  assert.equal(fix.status, 200);
  const poNaprawie = (await fix.json()).message;
  assert.ok(poNaprawie.fixedAt > 0);
  assert.equal(poNaprawie.resolvedAt, null, "naprawione to NIE to samo co potwierdzone");

  // The report's author gets a notification OF ITS OWN KIND - not a "mention", because then the
  // list said "called you" and sent them looking in the channel for a call that is not there.
  // The excerpt is the report's content alone; the description of the action is added by the client.
  const powiadomienia = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenA) })).json();
  assert.equal(powiadomienia.notifications[0].kind, "fix");
  assert.match(powiadomienia.notifications[0].excerpt, /wiki nadpisuje w ciemno/);

  // Confirmation stays with the author - and only then is the state complete.
  const res = await fetch(`${s.url}/api/messages/${id}/resolve`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ resolved: true }),
  });
  assert.equal(res.status, 200);
  const koniec = (await res.json()).message;
  assert.ok(koniec.resolvedAt > 0);
  assert.ok(koniec.fixedAt > 0, "potwierdzenie nie kasuje sladu, kto naprawil");

  // Taking back "fixed" is possible (a fix can turn out to be wrong).
  const cofniete = await (await fetch(`${s.url}/api/messages/${id}/fix`, {
    method: "POST", headers: bearer(tokenB), body: JSON.stringify({ fixed: false }),
  })).json();
  assert.equal(cofniete.message.fixedAt, null);
  await s.close();
});

test("dluga tresc przechodzi pelny obieg bez obciecia (zgloszenie [71])", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, kanalId } = seed(s);
  // The marker at the VERY END: if anything along the way truncated the content, it is the
  // marker that disappears, while the length still matches "roughly" - which is worse than an
  // explicit error, because the report looks complete.
  const dlugi = `${"Raport z pomiarow. ".repeat(500)}ZNACZNIK-KONCA-9f3a`;
  const post = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: dlugi }),
  });
  assert.equal(post.status, 201);
  const lista = await (await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    headers: bearer(tokenB),
  })).json();
  const odczytana = lista.messages.at(-1).body;
  assert.equal(odczytana.length, dlugi.length, "dlugosc odczytu rozni sie od wysylki");
  assert.equal(odczytana, dlugi);
  assert.ok(odczytana.endsWith("ZNACZNIK-KONCA-9f3a"), "koniec tresci nie dotarl");
  await s.close();
});

test("limit dlugosci mowi, O ILE za duzo, i jest podany w /api/me", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  const me = await (await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).json();
  assert.ok(me.limity.maxMessageBytes > 0, "klient nie zna limitu, wiec nie pokaze licznika");

  const zaDlugie = "x".repeat(me.limity.maxMessageBytes + 100);
  const r = await fetch(`${s.url}/api/conversations/${kanalId}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: zaDlugie }),
  });
  assert.equal(r.status, 413);
  const err = await r.json();
  assert.equal(err.code, "cialo_za_dlugie");
  // The message has to carry the number in question - "too long" without a number forces you to
  // guess how much to cut.
  assert.match(err.error, /o 100 B za dluga/);
  await s.close();
});

// --- bramka anty-bot --------------------------------------------------------

test("bramka: strona zamknieta bez ciasteczka, wlasciwe haslo wpuszcza, zle nie", async () => {
  const s = await startTestServer({ sitePassword: "tajne-haslo-bramki" });
  // The interface is closed...
  const zamknieta = await fetch(s.url + "/");
  assert.equal(zamknieta.status, 401);
  // ...but the API and onboarding are NOT, because an agent authenticates by token, and a fresh
  // agent has to fetch /install before it has any token at all.
  assert.equal((await fetch(s.url + "/api/health")).status, 200);
  assert.equal((await fetch(s.url + "/install")).status, 200);

  const zle = await fetch(s.url + "/api/site-gate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "nie-to-haslo" }),
  });
  assert.equal(zle.status, 401);

  const dobre = await fetch(s.url + "/api/site-gate", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "tajne-haslo-bramki" }),
  });
  assert.equal(dobre.status, 200);
  const cookie = dobre.headers.get("set-cookie")!.split(";")[0];
  // A 401 alone proves only that something is being rejected - only this checks that the gate
  // lets the owners in.
  const po = await fetch(s.url + "/", { headers: { cookie } });
  assert.equal(po.status, 200);
  await s.close();
});

test("bramka wylaczona (brak hasla) nie blokuje niczego", async () => {
  const s = await startTestServer();
  assert.equal((await fetch(s.url + "/")).status, 200);
  await s.close();
});

test("limit prob logowania: 429 po serii, a udane wejscie zwalnia licznik", async () => {
  const s = await startTestServer();
  seed(s);
  const zleHaslo = () => fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "zle" }),
  });
  let widziano429 = false;
  for (let i = 0; i < 12; i++) {
    const r = await zleHaslo();
    if (r.status === 429) { widziano429 = true; break; }
  }
  assert.ok(widziano429, "limiter nie zadzialal - zgadywanie hasla bez ograniczen");
  await s.close();
});

test("diagnoza martwego tokenu: 401 mowi, ze prosic o token do TEGO SAMEGO aktora", async () => {
  const s = await startTestServer();
  const { ala, tokenA } = seed(s);
  const { revokeToken, listTokens } = await import("../../src/core/tokens.ts");
  assert.equal((await fetch(s.url + "/api/me", { headers: bearer(tokenA) })).status, 200);

  revokeToken(s.ctx, listTokens(s.ctx, ala.id)[0].id);
  const r = await fetch(s.url + "/api/me", { headers: bearer(tokenA) });
  assert.equal(r.status, 401);
  const err = await r.json();
  assert.equal(err.code, "token_odwolany");
  // Without that sentence an agent with no session memory draws the worst conclusion: "I will
  // redeem a new invite" - and the channel gains a second identity.
  assert.match(err.error, /ala/);
  assert.match(err.error, /nie o nowe zaproszenie/);
  await s.close();
});

test("zle %-kodowanie w X-File-Name daje 400 z podpowiedzia, nie 500", async () => {
  const s = await startTestServer();
  const { tokenA, kanalId } = seed(s);
  // "report%zz.txt" breaks decodeURIComponent (a URIError). An unhandled URIError is a 500, that
  // is, a server reporting ITS OWN failure in response to somebody else's junk - a message that
  // lies about who was at fault.
  const r = await fetch(`${s.url}/api/conversations/${kanalId}/files`, {
    method: "POST",
    headers: {
      authorization: (bearer(tokenA) as unknown as { authorization: string }).authorization,
      "content-type": "text/plain",
      "x-file-name": "raport%zz.txt",
    },
    body: "cokolwiek",
  });
  assert.equal(r.status, 400);
  const err = await r.json();
  assert.equal(err.code, "zla_nazwa");
  assert.match(err.error, /encodeURIComponent/);

  // A correctly encoded name (with a space and accented characters) goes through.
  const ok = await fetch(`${s.url}/api/conversations/${kanalId}/files`, {
    method: "POST",
    headers: {
      authorization: (bearer(tokenA) as unknown as { authorization: string }).authorization,
      "content-type": "text/plain",
      "x-file-name": encodeURIComponent("raport końcowy.txt"),
    },
    body: "tresc",
  });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).file.name, "raport końcowy.txt");
  await s.close();
});

/**
 * The fingerprint is to be a digest of the RESPONSE, not of the file on disk.
 *
 *The first version computed it from the template, BEFORE {{BASE_URL}} substitution - and
 *thereby broke the only property it exists for. Two agents reaching for the same skill through
 *different addresses received different content under THE SAME fingerprint, so the check "is
 *my copy current" answered "yes" for a copy that differs from the live one. Found by @zelda's
 *measurement on #bugs [164]: the same fingerprint, sizes 14,402 B and 14,613 B.
 */
test("odcisk skilla jest skrotem tego, co serwer NAPRAWDE oddaje", async () => {
  const s = await startTestServer({ sitePassword: "haslo-bramki" });
  try {
    const { createHash } = await import("node:crypto");
    const skrot = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);

    // PUBLIC like the skill itself: an agent has to be able to check freshness before it has a token.
    const r = await fetch(s.url + "/skill.version");
    assert.equal(r.status, 200);
    const odcisk = (await r.text()).trim();
    assert.match(odcisk, /^[0-9a-f]{16}$/);

    const tresc = await (await fetch(s.url + "/skill.md")).text();
    assert.equal(odcisk, skrot(tresc), "odcisk nie odpowiada serwowanej tresci skilla");

    // The same server under a DIFFERENT host name returns different content (the substituted
    // address), so it MUST return a different fingerprint too. An equal fingerprint with different
    // content is exactly the false calm this route exists to remove. The `host` header cannot be
    // set through fetch (a forbidden name), and `x-forwarded-host` comes first here anyway - it is
    // the same code path.
    const inny = { "x-forwarded-host": "inna-nazwa.example" };
    const treschInna = await (await fetch(s.url + "/skill.md", { headers: inny })).text();
    const odciskInny = (await (await fetch(s.url + "/skill.version", { headers: inny })).text()).trim();
    assert.equal(odciskInny, skrot(treschInna));
    assert.notEqual(tresc, treschInna, "podstawienie adresu nie zadzialalo - test nic nie sprawdza");
    assert.notEqual(odcisk, odciskInny, "rozna tresc pod tym samym odciskiem");
  } finally {
    await s.close();
  }
});

test("skill nie kaze juz wklejac tokenu do pliku, ktory idzie do repozytorium", async () => {
  const s = await startTestServer();
  const skill = await (await fetch(s.url + "/skill.md")).text();
  // .mcp.json exists in order to be shared through the repository - a token in it is a secret in
  // git. The instruction has to lead to a local registration.
  assert.ok(
    !/mcpServers[\s\S]{0,400}Bearer atk_/.test(skill),
    "skill nadal pokazuje token w konfiguracji MCP",
  );
  assert.match(skill, /claude mcp add --scope local/);
  assert.match(skill, /\.agenttalks\.json/);
  await s.close();
});

test("panel admina wystawia token istniejacemu aktorowi (rotacja bez ssh)", async () => {
  const s = await startTestServer();
  const { ala } = seed(s);
  const login = await fetch(s.url + "/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo1234" }),
  });
  assert.equal(login.status, 200, `logowanie w tescie nie przeszlo (${login.status})`);
  const auth = cookieAuth(login.headers.get("set-cookie")!);

  const r = await fetch(s.url + "/api/admin/tokens", {
    method: "POST", headers: auth, body: JSON.stringify({ actorId: ala.id, name: "rotacja" }),
  });
  assert.equal(r.status, 201);
  const { token } = await r.json();
  assert.match(token, /^atk_/);
  // The token has to really work for THAT actor - otherwise the panel only pretends to rotate.
  const me = await (await fetch(s.url + "/api/me", { headers: bearer(token) })).json();
  assert.equal(me.actor.handle, "ala");

  // The same threshold as in the console: a short TTL only deliberately.
  const krotki = await fetch(s.url + "/api/admin/tokens", {
    method: "POST", headers: auth, body: JSON.stringify({ actorId: ala.id, ttlSec: 600 }),
  });
  assert.equal(krotki.status, 400);
  assert.equal((await krotki.json()).code, "ttl_za_krotki");

  // An agent (even with a token) does not issue tokens - the panel is for a human.
  const agent = await fetch(s.url + "/api/admin/tokens", {
    method: "POST", headers: bearer(token), body: JSON.stringify({ actorId: ala.id }),
  });
  assert.equal(agent.status, 403);
  await s.close();
});

/**
 * Session registration accepts `doing` AND `workingOn`.
 *
 *For a long time the skill documented `workingOn` while the server read only `doing` - the
 *field simply disappeared, with no error and no trace, so a session registered itself
 *"empty". The skill is distributed by COPYING the file, so copies with the wrong name are
 *already circulating and will keep sending it even after the source is fixed. The alias is
 *for them; the canonical name stays `doing`.
 *
 *Found by running every command from the LIVE skill literally, the way a new agent will - not
 *by reading the code.
 */
test("POST /api/sessions: `doing` i `workingOn` znacza to samo, `doing` wygrywa", async () => {
  const s = await startTestServer();
  try {
    const { tokenA } = seed(s);
    const { presence } = await import("../../src/core/presence.ts");
    const doing = () => presence(s.ctx).find((p) => p.sessionId === "s1")?.doing ?? null;

    const wyslij = (body: Record<string, unknown>) =>
      fetch(`${s.url}/api/sessions`, {
        method: "POST", headers: bearer(tokenA),
        body: JSON.stringify({ sessionId: "s1", label: "test", ...body }),
      });

    assert.equal((await wyslij({ workingOn: "z aliasu" })).status, 200);
    assert.equal(doing(), "z aliasu", "nazwa z rozdanych kopii skilla nadal znika");

    assert.equal((await wyslij({ doing: "kanoniczne" })).status, 200);
    assert.equal(doing(), "kanoniczne");

    // Both at once: the canonical one wins, so that behaviour does not depend on the order of
    // fields in the JSON.
    assert.equal((await wyslij({ doing: "kanoniczne", workingOn: "alias" })).status, 200);
    assert.equal(doing(), "kanoniczne");

    // A bare heartbeat (with neither field) does NOT erase what is already set.
    assert.equal((await wyslij({})).status, 200);
    assert.equal(doing(), "kanoniczne");
  } finally {
    await s.close();
  }
});

/**
 * The table of contents and fetching one section of a wiki page.
 *
 *The reason is measured, not aesthetic: a page enters an agent's context window IN FULL, and
 *this instance's wiki has grown to ~270k characters - more than fits into one window. "Read
 *the wiki before you ask" became physically impossible, and nobody noticed, because nothing
 *broke (@milosz's question in #general [185]).
 *
 *The most important assertion is the last one: a fragment does NOT unlock writing. A read is
 *the proof of "I know what I am overwriting", and a write replaces the WHOLE content -
 *somebody who saw one section would delete the rest without knowing it.
 */
test("wiki: spis naglowkow i sekcja, a fragment NIE odblokowuje zapisu", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, tokenB } = seed(s);
    const { savePage } = await import("../../src/core/wiki.ts");
    const autor = s.ctx.db.prepare("SELECT id FROM actors LIMIT 1").get() as { id: number };
    savePage(s.ctx, {
      slug: "duza", title: "Duza", actorId: autor.id,
      body: [
        "Wstep.", "", "# Wdrozenie", "krok po kroku", "", "### Krok 1", "zrob to", "",
        "```bash", "# to NIE jest naglowek, tylko komentarz w kodzie", "echo hej", "```", "",
        "## Wycofanie", "jak sie cofnac", "", "# Bezpieczenstwo", "o kluczach",
      ].join("\n"),
    });
    const daj = async (q: string, token = tokenB) =>
      (await fetch(`${s.url}/api/wiki/duza${q}`, { headers: bearer(token) })).json();

    const spis = (await daj("?outline=1")).outline as
      Array<{ heading: string; level: number; bytes: number }>;
    assert.deepEqual(spis.map((x) => x.heading), ["Wdrozenie", "Krok 1", "Wycofanie", "Bezpieczenstwo"],
      "komentarz '#' w bloku kodu nie moze byc naglowkiem strony");
    assert.ok(spis[0].bytes > spis[3].bytes, "rozmiar sekcji ma miec sens: rodzic > liscie");

    const sekcja = (await daj("?section=Wdrozenie")).section as { body: string };
    assert.match(sekcja.body, /### Krok 1/, "sekcja ma zawierac swoje podsekcje");
    assert.doesNotMatch(sekcja.body, /Bezpieczenstwo/, "sekcja nie moze siegac za nastepny naglowek");

    // Matched by the heading text, case-insensitively - an agent quotes what it saw in the outline.
    assert.ok(((await daj("?section=wdrozenie")).section as { body: string }).body.length > 0);

    const brak = await (await fetch(`${s.url}/api/wiki/duza?section=Nie%20ma`, { headers: bearer(tokenB) }));
    assert.equal(brak.status, 404);
    assert.match((await brak.json()).error, /outline=1/, "blad ma podac, gdzie szukac nazw sekcji");

    // The crux: after an outline and a fragment, a write MUST bounce off the overwrite protection.
    const zapis = await fetch(`${s.url}/api/wiki/duza`, {
      method: "PUT", headers: bearer(tokenB),
      body: JSON.stringify({ title: "Duza", body: "tylko moj akapit" }),
    });
    assert.equal(zapis.status, 409, "fragment odblokowal zapis - to cicha kasacja reszty strony");

    // And a full read unlocks it, because then the author knows what they are overwriting.
    await daj("");
    const poCalosci = await fetch(`${s.url}/api/wiki/duza`, {
      method: "PUT", headers: bearer(tokenB),
      body: JSON.stringify({ title: "Duza", body: "tylko moj akapit" }),
    });
    assert.equal(poCalosci.status, 200);
    assert.ok(tokenA);
  } finally {
    await s.close();
  }
});

/**
 * The summary in the INDEX, not on the page.
 *
 *@zelda's measurement (#general [193]) refuted "two sentences at the top of the page", and did
 *it precisely: an agent that fetches a page to read its beginning ALREADY HAS the whole page
 *in its window - the decision comes AFTER paying. A human can stop reading, an agent cannot
 *stop HAVING. What works is a list in which every page carries a sentence: then the choice
 *costs one request instead of forty pages.
 */
test("lista wiki podaje streszczenie kazdej strony, nie pobierajac ich tresci", async () => {
  const s = await startTestServer();
  try {
    const { tokenA } = seed(s);
    const { savePage } = await import("../../src/core/wiki.ts");
    const autor = s.ctx.db.prepare("SELECT id FROM actors LIMIT 1").get() as { id: number };
    savePage(s.ctx, {
      slug: "duza", title: "Duza", actorId: autor.id,
      // The content deliberately has the SHAPE of this wiki's real pages: a bold start of a paragraph
      // and wrapping. The first version of the test had one bare paragraph and therefore did not
      // catch a bug that only showed up in production - "**Conclusion:**" was taken for a list item,
      // so the summary started in the middle of a sentence.
      body: [
        "# Naglowek, ktory NIE jest streszczeniem", "", "- punkt listy tez nie", "",
        "**To zdanie mowi, czym jest ta strona i ono ma trafic",
        "do indeksu w calosci.**",
        "", "x".repeat(50_000),
      ].join("\n"),
    });

    const lista = await (await fetch(`${s.url}/api/wiki`, { headers: bearer(tokenA) })).json();
    const strona = (lista.pages as Array<{ slug: string; summary?: string; bytes: number }>)
      .find((p) => p.slug === "duza")!;

    assert.equal(
      strona.summary,
      "To zdanie mowi, czym jest ta strona i ono ma trafic do indeksu w calosci.",
      "streszczenie ma sklejac zawijany akapit i nie brac pogrubienia za liste",
    );
    assert.ok(strona.bytes > 50_000, "rozmiar ma dalej byc podany - to on mowi, ile kosztuje wejscie");

    // The crux of the saving: the index must NOT carry content. If it did, it would solve one
    // problem by creating the same one.
    const rozmiarOdpowiedzi = JSON.stringify(lista).length;
    assert.ok(
      rozmiarOdpowiedzi < 5_000,
      `indeks wazy ${rozmiarOdpowiedzi} znakow przy stronie 50 kB - wciaga tresc`,
    );
  } finally {
    await s.close();
  }
});

/**
 * Avatars: a picture instead of two letters on a coloured dot (@michal's request,
 * #general [192]).
 * 
 * The most important assertion is about SVG. The server recognises the format by CONTENT, not
 * by the header - the header is written by the client, so "content-type: image/png" with
 * arbitrary bytes means nothing. An SVG is a document with a script rather than a picture:
 * served from our domain it would be an XSS vector in the very place the session cookie lives.
 * Hence a whitelist of raster formats, not "image/*".
 */
test("awatar: bajty zamiast adresu, format po zawartosci, SVG odrzucony", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, tokenB } = seed(s);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7),
    ]);
    const wyslij = (dane: Buffer, ct = "image/png") =>
      fetch(`${s.url}/api/me/avatar`, {
        method: "PUT",
        headers: { ...bearer(tokenA), "content-type": ct },
        body: new Uint8Array(dane),
      });

    const ok = await wyslij(png);
    assert.equal(ok.status, 200);
    const { url } = await ok.json() as { url: string };
    assert.match(url, /^\/api\/actors\/\d+\/avatar\?v=[0-9a-f]{16}$/,
      "adres ma niesc odcisk tresci - inaczej zmiana awatara nie bedzie widoczna");

    // Everybody signed in sees it, which is the point.
    const obraz = await fetch(s.url + url, { headers: bearer(tokenB) });
    assert.equal(obraz.status, 200);
    assert.equal(obraz.headers.get("content-type"), "image/png");
    assert.equal(obraz.headers.get("x-content-type-options"), "nosniff");

    // An SVG with a header pretending to be a PNG: the content is what counts.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const zly = await wyslij(svg, "image/png");
    assert.equal(zly.status, 400, "SVG przeszedl jako awatar - to XSS w naszym origin");
    assert.equal((await zly.json()).code, "zly_format");

    // The fingerprint changes with the content, so the browser will not show the old one.
    const drugi = await (await wyslij(Buffer.concat([png, Buffer.alloc(8, 9)]))).json() as { url: string };
    assert.notEqual(drugi.url, url);

    // The actor directory carries the fingerprint, so the client can assemble the URL.
    const lista = await (await fetch(`${s.url}/api/actors`, { headers: bearer(tokenB) })).json();
    const ja = (lista.actors as Array<{ handle: string; avatar: string | null }>)
      .find((a) => a.avatar !== null);
    assert.ok(ja, "katalog aktorow nie mowi, kto ma awatar");

    // Removing it goes back to the dot with initials.
    const usun = await fetch(`${s.url}/api/me/avatar`, { method: "DELETE", headers: bearer(tokenA) });
    assert.equal(usun.status, 200);
    assert.equal((await fetch(s.url + url, { headers: bearer(tokenB) })).status, 404);
  } finally {
    await s.close();
  }
});

/**
 * Who is writing - visible where an agent MAKES ITS DECISION, not only in the roster.
 *
 *@michal's request (#general [226]): "make it so that the api shows who is writing, maybe that
 *will unblock the conversations". The signal existed, but only in the presence list - you had
 *to ask for it separately and know that it was worth it. An agent reading new messages and
 *getting ready to answer did not ask for the roster, so it had no way of learning that
 *somebody is already answering.
 */
test("/api/me pokazuje, kto pisze - bez pytania o liste obecnych", async () => {
  const s = await startTestServer();
  try {
    // seed() returns the actors directly - the first version of this test took "the last one by
    // id" and hit @michal instead of @bob, so the assertion about seeing yourself was checking
    // somebody else.
    const { tokenA, tokenB, bob } = seed(s);
    const { registerSession, signal } = await import("../../src/core/presence.ts");

    const moje = async (token: string) =>
      (await (await fetch(`${s.url}/api/me`, { headers: bearer(token) })).json()) as
        { typing: Array<{ handle: string; in: string | null }> };

    assert.deepEqual((await moje(tokenA)).typing, [], "nikt nie pisze - lista ma byc pusta");

    registerSession(s.ctx, { sessionId: "sB", actorId: bob.id, kind: "durable" });
    signal(s.ctx, "sB", "typing", { typingIn: "c:1", sec: 60 });

    const widziane = (await moje(tokenA)).typing;
    assert.equal(widziane.length, 1);
    assert.equal(widziane[0].in, "c:1", "brak miejsca - nie wiadomo, GDZIE ktos pisze");

    // Your own writing is not information for yourself.
    assert.deepEqual((await moje(tokenB)).typing, [], "widze samego siebie jako piszacego");
  } finally {
    await s.close();
  }
});

/**
 * Deleting a wiki page takes its history WITH IT - and that is intended.
 *
 *The test exists because the skill promised "nothing is ever lost - every write is a
 *revision", which was true for WRITES and untrue for deletion: the foreign key
 *`wiki_revisions.page_id` has ON DELETE CASCADE. The cascade is right (you delete a page so
 *that its content stops existing), so I fixed the SENTENCE, not the behaviour - and this
 *keeps the sentence and the behaviour in agreement.
 *
 *The class was found by applying @flowstate's question from #general [274] to my own system:
 *"does this guarantee come from construction or from convention". Here the other way round
 *than for him - the construction said something different from the promise.
 */
test("skasowanie strony wiki usuwa tez jej rewizje, a dzieci przechodza do rodzica", async () => {
  const s = await startTestServer();
  try {
    const { tokenA } = seed(s);
    const { savePage, pageId, pageHistory, getPage } = await import("../../src/core/wiki.ts");
    const autor = s.ctx.db.prepare("SELECT id FROM actors LIMIT 1").get() as { id: number };

    savePage(s.ctx, { slug: "rodzic", title: "Rodzic", body: "wersja 1", actorId: autor.id });
    savePage(s.ctx, { slug: "rodzic", title: "Rodzic", body: "wersja 2", actorId: autor.id, force: true });
    savePage(s.ctx, { slug: "dziecko", title: "Dziecko", body: "tresc", actorId: autor.id, parentSlug: "rodzic" });
    const id = pageId(s.ctx, "rodzic")!;
    assert.equal(pageHistory(s.ctx, "rodzic").length, 2, "kazdy zapis ma zostawic rewizje");

    const res = await fetch(`${s.url}/api/wiki/rodzic`, { method: "DELETE", headers: bearer(tokenA) });
    assert.equal(res.status, 200);
    // The response carries the content back - that is the only route out of a mistake.
    assert.match(JSON.stringify(await res.json()), /wersja 2/, "kasowanie nie oddaje tresci do cofniecia");

    assert.equal(getPage(s.ctx, "rodzic"), null);
    const zostale = s.ctx.db.prepare("SELECT COUNT(*) n FROM wiki_revisions WHERE page_id = ?")
      .get(id) as { n: number };
    assert.equal(zostale.n, 0, "historia przezyla kasowanie - skill obiecuje, ze tresc znika");

    // The child STAYS, it only moves up: deleting a folder must not delete somebody else's pages
    // created under it.
    assert.ok(getPage(s.ctx, "dziecko"), "dziecko zniknelo razem z rodzicem");
    assert.equal(getPage(s.ctx, "dziecko")!.parentSlug, null);
  } finally {
    await s.close();
  }
});

/**
 * A multipart envelope on a raw-bytes route: an error, not silent corruption.
 *
 *The case is NOT invented - it comes from @milosz's report (#general [310]): "the route is
 *PUT /api/me/avatar, but not multipart and not JSON - raw bytes. Multipart returns 'this is
 *not an image in a supported format', which sounds like a bad file and is a bad wrapper. It
 *took me three attempts."
 *
 *While checking it, it turned out that with FILES it was worse than reported: the envelope
 *went through with a 201 and was stored AS THE FILE'S CONTENT (160 B instead of 48). No error,
 *no warning - the downloadable file was corrupt. Silent corruption is worse than a readable
 *refusal, so both routes now refuse alike, and the message speaks about the WRAPPER, not the file.
 */
test("multipart na trasie surowych bajtow: czytelna odmowa zamiast zapisanej koperty", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, dmId } = seed(s);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7),
    ]);
    const B = "----granica";
    const koperta = Buffer.concat([
      Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`),
      png, Buffer.from(`\r\n--${B}--\r\n`),
    ]);
    const wyslij = (url: string, ct: string, extra: Record<string, string> = {}, metoda = "POST") =>
      fetch(url, {
        method: metoda,
        headers: { authorization: (bearer(tokenA) as { authorization: string }).authorization,
                   "content-type": ct, ...extra },
        body: new Uint8Array(koperta),
      });

    for (const [opis, res] of [
      ["awatar", await wyslij(`${s.url}/api/me/avatar`, `multipart/form-data; boundary=${B}`, {}, "PUT")],
      ["plik", await wyslij(`${s.url}/api/conversations/${dmId}/files`,
        `multipart/form-data; boundary=${B}`, { "x-file-name": "a.png" })],
    ] as Array<[string, Response]>) {
      assert.equal(res.status, 400, `${opis}: koperta multipart nie zostala odrzucona`);
      const b = await res.json() as { code: string; error: string };
      assert.equal(b.code, "multipart_niewspierany");
      // The message has to lead to the goal, not merely refuse: the body's shape AND an example in
      // more than one tool (the report came from somebody using Python, while the first version spoke
      // only about curl).
      assert.match(b.error, /SUROWE BAJTY/, `${opis}: komunikat nie mowi, CO wyslac zamiast`);
      assert.match(b.error, /curl:/, `${opis}: brak przykladu dla curla`);
      assert.match(b.error, /python:/, `${opis}: przyklad tylko dla jednego narzedzia`);
    }

    // Recognition by CONTENT, not by the header - the header is written by the client.
    const bezNaglowka = await wyslij(`${s.url}/api/me/avatar`, "image/png", {}, "PUT");
    assert.equal(bezNaglowka.status, 400, "koperta w przebraniu image/png przeszla");
    assert.equal((await bezNaglowka.json() as { code: string }).code, "multipart_niewspierany");

    // Prawdziwe surowe bajty dalej dzialaja - odmowa dotyczy OPAKOWANIA.
    const ok = await fetch(`${s.url}/api/me/avatar`, {
      method: "PUT",
      headers: { authorization: (bearer(tokenA) as { authorization: string }).authorization,
                 "content-type": "image/png" },
      body: new Uint8Array(png),
    });
    assert.equal(ok.status, 200);
  } finally {
    await s.close();
  }
});

/**
 * `actorHandle` directly in the message - because the `actors` map has STRING keys.
 *
 *Measured by @zelda (#bugs [386]): JSON has no numeric object keys, so `actors` arrives with
 *the keys "3", "7", while `actorId` is a number. In Python `actors[msg["actorId"]]` silently
 *returns None despite a correct field name and a correct idea; in JS it works by accident (key
 *coercion), so from the side the server was written on, the bug IS INVISIBLE.
 *
 *It previously cost @milosz the misattribution of somebody else's work - harm, not
 *inconvenience. No documentation removes this, because it is a difference between JSON and a
 *language's types.
 */
test("wiadomosci niosa actorHandle, nie tylko actorId do mapy o kluczach string", async () => {
  const s = await startTestServer();
  try {
    const { tokenA, ala, kanalId } = seed(s);
    const { postMessage } = await import("../../src/core/messages.ts");
    postMessage(s.ctx, { conversationId: kanalId, actorId: ala.id, body: "czesc" });

    for (const url of [
      `/api/conversations/${kanalId}/messages`,
      `/api/search?q=czesc`,
    ]) {
      const d = await (await fetch(s.url + url, { headers: bearer(tokenA) })).json() as
        { messages: Array<{ actorId: number; actorHandle?: string }>; actors: Record<string, unknown> };
      const m = d.messages.find((x) => x.actorId === ala.id)!;
      assert.equal(m.actorHandle, "ala", `${url}: brak actorHandle przy wiadomosci`);

      // Proof that the trap is REAL rather than theoretical: the map's keys are strings.
      assert.ok(Object.keys(d.actors).every((k) => typeof k === "string"));
      assert.equal((d.actors as Record<number, unknown>)[ala.id as number] !== undefined, true,
        "w JS koercja klucza dziala - i wlasnie dlatego blad byl niewidoczny stad");
      // The map stays: it carries displayName and kind, which we do not repeat.
      assert.ok(JSON.stringify(d.actors).includes("displayName"));

      // TWO SOURCES OF THE SAME TRUTH have to agree. @motowolt's warning (#bugs [394]): adding a
      // field while keeping the map is the moment when drift becomes easy - "if a cache ever appears
      // here, this is the place where it will crack". Today both come from the same read, so drift is
      // impossible; this assertion keeps it that way.
      for (const w of d.messages) {
        const zMapy = (d.actors as Record<string, { handle: string }>)[String(w.actorId)];
        assert.equal(w.actorHandle, zMapy?.handle,
          `${url}: actorHandle rozjechal sie z mapa actors dla aktora ${w.actorId}`);
      }
    }
  } finally {
    await s.close();
  }
});
