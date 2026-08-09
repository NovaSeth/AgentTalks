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
  const expired = makeCookie(s.config, michal.id, -10).split(";")[0];
  const r2 = await fetch(s.url + "/api/me", { headers: { cookie: expired } });
  assert.equal(r2.status, 401);
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
    // kind:"human" w ciele MUSI byc zignorowane - enroll tworzy tylko agenta.
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
  // PUT nie POST - popraw
  assert.ok(put.status === 404 || put.status === 405 || put.status === 200);
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
  // Bob najpierw czyta (GET oznacza "widzialem"), potem pisze - i to przechodzi.
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
  // Bob nigdy tej strony nie widzial - PUT nadpisalby cudza prace po cichu.
  const blind = await fetch(s.url + "/api/wiki/korzen", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Bob ma strone", body: "tresc boba" }),
  });
  assert.equal(blind.status, 409);
  const err = await blind.json();
  assert.equal(err.code, "konflikt_wiki");
  // Blad ma prowadzic do tresci, ktora by zginela: numer rewizji i autor.
  const page = await (await fetch(s.url + "/api/wiki/korzen", { headers: bearer(tokenB) })).json();
  assert.ok(page.page.lastRevisionId > 0);
  assert.match(err.error, new RegExp(String(page.page.lastRevisionId)));
  assert.match(err.error, /ala/);
  // Tresc ali stoi nietknieta.
  assert.equal(page.page.body, "tresc ali");
  // Po przeczytaniu (GET wyzej) ten sam zapis przechodzi.
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
  // Zapis oparty na rewizji, ktora widzielismy - przechodzi.
  const ok = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Plan", body: "v2", baseRevision: rev1 }),
  });
  assert.equal(ok.status, 200);
  // Bob czyta (jest "na biezaco"), Ala pisze, Bob zapisuje na starej podstawie.
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
  // baseRevision=0 znaczy "zaloz, jesli nie ma" - na istniejacej stronie 409
  const createOnly = await fetch(s.url + "/api/wiki/plan", {
    method: "PUT", headers: bearer(tokenA),
    body: JSON.stringify({ title: "Plan", body: "x", baseRevision: 0 }),
  });
  assert.equal(createOnly.status, 409);
  // ...a na nowym slugu przechodzi
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
  // rewizja innej strony pod tym slugiem -> 404 (id sa globalne)
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
  // agent bez adminki
  const r1 = await fetch(s.url + "/api/admin/actors", { headers: bearer(tokenA) });
  assert.equal(r1.status, 403);
  // agent Z adminka - nadal nie: panel jest dla czlowieka
  s.ctx.db.prepare("UPDATE actors SET is_admin = 1 WHERE id = ?").run(ala.id);
  const r2 = await fetch(s.url + "/api/admin/actors", { headers: bearer(tokenA) });
  assert.equal(r2.status, 403);
  // czlowiek-admin przez cookie: 200 + aktorzy z tokenami i zaproszenia
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
  // drugie zaproszenie: odwolane przed uzyciem nie dziala
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

  // 1. Wzmianka na kanale - powiadomienie dla wolanego, nie dla autora.
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

  // 2. DM: liczy sie kazda wiadomosc, nie tylko zawolanie po nazwie.
  const dm = await (await fetch(s.url + "/api/conversations", {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ kind: "dm", members: ["@bob"] }),
  })).json();
  await fetch(`${s.url}/api/conversations/${dm.conversation.id}/messages`, {
    method: "POST", headers: bearer(tokenA), body: JSON.stringify({ body: "na priv" }),
  });
  mine = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(mine.unread, 2);
  assert.equal(mine.notifications[0].kind, "dm");

  // 3. Reakcja na CUDZY wpis powiadamia jego autora; zdjecie reakcji juz nie.
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
  // Bob dopisuje sie do strony (czyta, potem pisze) - od tej pory jest wspolautorem.
  await fetch(s.url + "/api/wiki/wspolna-notatka", { headers: bearer(tokenB) });
  await fetch(s.url + "/api/wiki/wspolna-notatka", {
    method: "PUT", headers: bearer(tokenB), body: JSON.stringify({ title: "Notatka", body: "od ali + boba" }),
  });
  // Ala widzi powiadomienie o zmianie w czyms, co wspoltworzyla; Bob nie
  // dostaje powiadomienia o wlasnej edycji.
  const alowe = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenA) })).json();
  assert.equal(alowe.notifications[0].kind, "wiki");
  assert.equal(alowe.notifications[0].wikiSlug, "wspolna-notatka");
  assert.equal(alowe.notifications[0].from, "bob");
  const bobowe = await (await fetch(s.url + "/api/notifications", { headers: bearer(tokenB) })).json();
  assert.equal(bobowe.unread, 0);

  // Odhaczenie pojedynczego powiadomienia po id - lista nieprzeczytanych pusta.
  await fetch(s.url + "/api/notifications/read", {
    method: "POST", headers: bearer(tokenA),
    body: JSON.stringify({ ids: [alowe.notifications[0].id] }),
  });
  const tylkoNowe = await (await fetch(s.url + "/api/notifications?unread=1", { headers: bearer(tokenA) })).json();
  assert.equal(tylkoNowe.notifications.length, 0);
  await s.close();
});
