/**
 * MCP przez zywy serwer HTTP: prawdziwy handshake JSON-RPC, bez atrap transportu.
 * Odpowiedz Streamable HTTP moze byc application/json albo text/event-stream -
 * parsujemy obie, jak zrobi to kazdy klient MCP.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";

type Rpc = { jsonrpc: "2.0"; id?: number; method: string; params?: unknown };

async function mcpCall(url: string, token: string, body: Rpc | Rpc[]):
  Promise<Record<string, unknown>> {
  const res = await fetch(url + "/mcp", {
    method: "POST",
    headers: {
      ...bearer(token),
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(dataLine!.slice(6)) as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

const INIT: Rpc = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

function seed(s: TestServer) {
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const kanal = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  join(s.ctx, kanal.id, bob.id);
  return { ala, bob, kanal, token: mintToken(s.ctx, bob.id, "mcp").token };
}

test("MCP bez tokenu daje 401, z tokenem odpowiada na initialize", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const noAuth = await fetch(s.url + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(INIT),
  });
  assert.equal(noAuth.status, 401);

  const init = await mcpCall(s.url, token, INIT);
  const serverInfo = (init.result as { serverInfo: { name: string } }).serverInfo;
  assert.equal(serverInfo.name, "agenttalks");
  await s.close();
});

test("tools/list zwraca komplet narzedzi talk_*", async () => {
  const s = await startTestServer();
  const { token } = seed(s);
  const r = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
  });
  const tools = (r.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  for (const expected of ["talk_status", "talk_send", "talk_read", "talk_ask", "talk_answer",
                          "talk_claim", "talk_release", "talk_search", "talk_digest"]) {
    assert.ok(tools.includes(expected), `brak narzedzia ${expected}`);
  }
  await s.close();
});

test("talk_send przez MCP pisze jako aktor z tokenu i wraca z id wiadomosci", async () => {
  const s = await startTestServer();
  const { bob, token } = seed(s);
  const r = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "talk_send", arguments: { to: "#general", body: "z mcp" } },
  });
  const content = (r.result as { content: Array<{ text: string }> }).content[0].text;
  assert.match(content, /wyslane \[\d+\]/);
  const row = s.ctx.db.prepare("SELECT actor_id, body FROM messages ORDER BY id DESC LIMIT 1")
    .get() as { actor_id: number; body: string };
  assert.equal(row.actor_id, bob.id, "wiadomosc MCP ma byc podpisana aktorem z tokenu");
  assert.equal(row.body, "z mcp");
  await s.close();
});

test("talk_log numerem cudzej prywatnej konwersacji jest odrzucone", async () => {
  const s = await startTestServer();
  const { ala, token } = seed(s);
  const prywatny = createChannel(s.ctx, { slug: "tajne", kind: "private", createdBy: ala.id });
  postMessage(s.ctx, { conversationId: prywatny.id, actorId: ala.id, body: "sekret" });
  const r = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "talk_log", arguments: { conversation: String(prywatny.id) } },
  });
  const result = r.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /brak dostepu/);
  assert.doesNotMatch(result.content[0].text, /sekret/);
  await s.close();
});

test("talk_claim i talk_release przechodza pelny cykl dzierzawy", async () => {
  const s = await startTestServer();
  const { ala, token } = seed(s);
  const tokenAla = mintToken(s.ctx, ala.id, "t").token;
  const granted = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "talk_claim", arguments: { resource: "deploy", ttlSec: 300 } },
  });
  assert.match((granted.result as { content: Array<{ text: string }> }).content[0].text,
    /GRANTED/);
  const denied = await mcpCall(s.url, tokenAla, {
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "talk_claim", arguments: { resource: "deploy" } },
  });
  const dr = denied.result as { isError?: boolean; content: Array<{ text: string }> };
  assert.equal(dr.isError, true);
  assert.match(dr.content[0].text, /HELD-BY @bob/);
  const released = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 7, method: "tools/call",
    params: { name: "talk_release", arguments: { resource: "deploy" } },
  });
  assert.match((released.result as { content: Array<{ text: string }> }).content[0].text,
    /UNLOCKED/);
  await s.close();
});

test("KAZDE zadeklarowane narzedzie MCP da sie wywolac i zwraca tresc, nie blad protokolu", async () => {
  const s = await startTestServer();
  const { ala, bob, kanal, token } = seed(s);
  const wiadomosc = postMessage(s.ctx, {
    conversationId: kanal.id, actorId: ala.id, body: "material do testow narzedzi",
  });

  // Lista narzedzi jest zrodlem prawdy - test nie ma wlasnej kopii, wiec nowe
  // narzedzie automatycznie wchodzi do pokrycia. Wczesniej test sprawdzal same
  // NAZWY na liscie (asercja na stalej tablicy), a realnie wywolywal cztery
  // z dwudziestu kilku - czyli wiekszosc "glownego interfejsu agentow" nie miala
  // ani jednego przebiegu.
  const lista = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 100, method: "tools/list", params: {},
  });
  const narzedzia = (lista.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.ok(narzedzia.length >= 15, `spodziewalem sie kompletu narzedzi, jest ${narzedzia.length}`);

  // Argumenty minimalne, ktore maja sens dla kazdego narzedzia. Narzedzia
  // wymagajace stanu spoza tego testu (wake, pliki) dostaja argumenty, przy
  // ktorych odpowiedz "nie ma czegos takiego" jest POPRAWNA - sprawdzamy, ze
  // narzedzie odpowiada po ludzku, a nie wywala sie bledem protokolu.
  const argumenty: Record<string, Record<string, unknown>> = {
    talk_status: {},
    talk_send: { to: "#general", body: "z testu pokrycia" },
    talk_read: { wait: 0 },
    talk_log: { conversation: "#general", limit: 5 },
    talk_thread: { messageId: wiadomosc.id },
    talk_ask: { conversation: "#general", body: "pytanie z testu" },
    talk_answer: { questionId: 1, body: "odpowiedz z testu" },
    talk_search: { q: "material" },
    talk_digest: {},
    talk_claim: { resource: "deploy", ttlSec: 60 },
    talk_release: { resource: "deploy" },
    talk_react: { messageId: wiadomosc.id, emoji: "👍" },
    talk_register: { sessionId: "test-sesja" },
    talk_typing: { to: "#general" },
    talk_channels: {},
    talk_join: { conversation: "#general" },
    talk_who: {},
    talk_wake: {},
    talk_file_get: { fileId: "nie-ma-takiego" },
    wiki_search: { q: "cokolwiek" },
    wiki_read: { slug: "nie-ma-takiej" },
    wiki_list: {},
    wiki_write: { slug: "strona-z-testu", title: "Strona", body: "tresc" },
    wiki_history: { slug: "strona-z-testu" },
    talk_whoami: {},
    talk_guidelines: {},
    talk_open: { conversation: "#general" },
    talk_mentions: {},
    talk_seen: { conversation: "#general" },
    talk_leases: {},
  };

  const bezPokrycia: string[] = [];
  for (const nazwa of narzedzia) {
    const args = argumenty[nazwa];
    if (args === undefined) { bezPokrycia.push(nazwa); continue; }
    const r = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 200, method: "tools/call", params: { name: nazwa, arguments: args },
    });
    // Blad DOMENOWY ("nie ma takiej strony") jest w porzadku - to odpowiedz.
    // Blad PROTOKOLU (r.error) znaczy, ze narzedzie w ogole nie dziala.
    assert.equal(r.error, undefined, `narzedzie ${nazwa} zwrocilo blad protokolu`);
    const tresc = (r.result as { content?: Array<{ text: string }> }).content;
    assert.ok(Array.isArray(tresc) && tresc.length > 0, `narzedzie ${nazwa} nie zwrocilo tresci`);
  }
  assert.deepEqual(bezPokrycia, [], `narzedzia bez wywolania w tescie: ${bezPokrycia.join(", ")}`);
  assert.ok(bob);
  await s.close();
});
