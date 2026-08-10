/**
 * MCP through a live HTTP server: a real JSON-RPC handshake, with no transport stubs.
 * A Streamable HTTP response can be application/json or text/event-stream - we parse both,
 * as every MCP client does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, startTestServer, type TestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, ensureDirect, join } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";
import { savePage } from "../../src/core/wiki.ts";
import { tx } from "../../src/store/db.ts";

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

  // The tool list is the source of truth - the test keeps no copy of its own, so a new tool
  // enters the coverage automatically. Previously the test checked only the NAMES on the list
  // (an assertion against a constant array) while actually calling four out of twenty-odd -
  // that is, most of "the main interface for agents" had not a single run.
  const lista = await mcpCall(s.url, token, {
    jsonrpc: "2.0", id: 100, method: "tools/list", params: {},
  });
  const narzedzia = (lista.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.ok(narzedzia.length >= 15, `spodziewalem sie kompletu narzedzi, jest ${narzedzia.length}`);

  // Minimal arguments that make sense for every tool. Tools requiring state from outside this
  // test (wake, files) get arguments for which the answer "there is no such thing" is CORRECT -
  // we are checking that the tool answers in human terms rather than blowing up with a protocol
  // error.
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
    // A DOMAIN error ("there is no such page") is fine - that is an answer.
    // A PROTOCOL error (r.error) means the tool does not work at all.
    assert.equal(r.error, undefined, `narzedzie ${nazwa} zwrocilo blad protokolu`);
    const tresc = (r.result as { content?: Array<{ text: string }> }).content;
    assert.ok(Array.isArray(tresc) && tresc.length > 0, `narzedzie ${nazwa} nie zwrocilo tresci`);
  }
  assert.deepEqual(bezPokrycia, [], `narzedzia bez wywolania w tescie: ${bezPokrycia.join(", ")}`);
  assert.ok(bob);
  await s.close();
});

/**
 * @motowolt's report [149]: `talk_read {afterId: 0}` on a channel with 133 messages returned
 * 132,355 characters in one block and the client REJECTED all of it - the agent did not get
 * even the first message. We guard both ends at once, because each alone fails:
 * 
 *   - a page size (`limit`) is not enough, because rejection is decided by SIZE, and one
 *     message can be 65 kB;
 *   - a character budget is not enough, because without a cursor pointing at the LAST MESSAGE
 *     SHOWN, truncation silently skips the rest.
 */
test("talk_read: odcinek, budzet znakow i kursor po ostatniej POKAZANEJ wiadomosci", async () => {
  const s = await startTestServer();
  const { ala, kanal, token } = seed(s);
  // 60 messages of ~2 kB: ~120 kB in total, that is, above the 40,000-character budget.
  const duza = "x".repeat(2000);
  for (let i = 0; i < 60; i++) {
    postMessage(s.ctx, { conversationId: kanal.id, actorId: ala.id, body: `${i} ${duza}` });
  }
  await mcpCall(s.url, token, INIT);

  const wynik = async (args: Record<string, unknown>) => {
    const r = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 300, method: "tools/call", params: { name: "talk_read", arguments: args },
    });
    return (r.result as { content: Array<{ text: string }> }).content[0].text;
  };

  const pierwszy = await wynik({ afterId: 0 });
  assert.ok(pierwszy.length < 60_000, `wynik ma ${pierwszy.length} znakow - budzet nie zadzialal`);
  assert.match(pierwszy, /To nie wszystko - powtorz talk_read z afterId=(\d+)\./);
  const kursor = Number(pierwszy.match(/afterId=(\d+)\./)![1]);

  // The cursor MUST point at a message the agent really saw. If it pointed at the last one
  // FETCHED, everything between the truncation and it would disappear irreversibly. The result
  // is grouped by conversation, so "the last one shown" is the highest id shown, not the last
  // line.
  const idWyniku = (t: string) => [...t.matchAll(/^[>\s]*\[(\d+)\] /gm)].map((m) => Number(m[1]));
  assert.equal(kursor, Math.max(...idWyniku(pierwszy)));

  // The cursor loop reaches the end and loses not a single message.
  const widziane = new Set<number>();
  let cursor = 0;
  for (let obrot = 0; obrot < 20; obrot++) {
    const t = await wynik({ afterId: cursor });
    if (t.startsWith("Brak nowych")) break;
    for (const id of idWyniku(t)) widziane.add(id);
    cursor = Number(t.match(/Kursor: afterId=(\d+)/)![1]);
    if (!t.includes("To nie wszystko")) break;
  }
  assert.equal(widziane.size, 60, `petla po kursorze zobaczyla ${widziane.size} z 60 wiadomosci`);

  // An explicit `limit` sets the page size - this is the field MCP was missing.
  const maly = await wynik({ afterId: 0, limit: 3 });
  assert.match(maly, /^3 nowych w \d+ rozmow/);
  await s.close();
});

/**
 * Reading a wiki page unlocks writing to it, and a write replaces the WHOLE content. If a
 * truncated read also unlocked it, an agent sending back "what I read plus my paragraph" would
 * delete the missing part and nobody would find out.
 */
test("wiki_read: przycieta strona NIE odblokowuje zapisu", async () => {
  const s = await startTestServer();
  try {
    const { ala, token } = seed(s);
    const dlugaTresc = Array.from({ length: 3000 }, (_, i) => `linia ${i} ${"y".repeat(40)}`)
      .join("\n");
    savePage(s.ctx, { slug: "wielka", title: "Wielka", body: dlugaTresc, actorId: ala.id });

    await mcpCall(s.url, token, INIT);
    const r = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 301, method: "tools/call",
      params: { name: "wiki_read", arguments: { slug: "wielka" } },
    });
    const t = (r.result as { content: Array<{ text: string }> }).content[0].text;
    assert.ok(t.length < 60_000, `wiki_read oddal ${t.length} znakow`);
    assert.match(t, /przycieto/);
    assert.match(t, /NIE zapisuj/);

    // Bob saw only a fragment, so the write has to bounce off the overwrite protection.
    const zapis = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 302, method: "tools/call",
      params: {
        name: "wiki_write",
        arguments: { slug: "wielka", title: "Wielka", body: "moj akapit" },
      },
    });
    const tz = zapis.result as { content: Array<{ text: string }>; isError?: boolean };
    assert.ok(tz.isError, "przyciety odczyt wpuscil do zapisu - to cicha kasacja tresci");
    assert.match(tz.content[0].text, /konflikt_wiki|nie czytales/);
  } finally {
    await s.close();
  }
});

/**
 * @michal's request in [143]: "find a way to handle several conversations". A flat
 * chronological list says WHAT happened; an agent after a break needs to know WHERE to reply.
 * The test enforces that the order of the blocks carries that answer: a personal conversation
 * before a channel with a mention, that before the rest.
 */
test("talk_read grupuje po rozmowach i stawia na gorze to, co czeka na Ciebie", async () => {
  const s = await startTestServer();
  try {
    const { ala, bob, kanal, token } = seed(s);
    const cichy = createChannel(s.ctx, { slug: "cichy", kind: "public", createdBy: ala.id });
    join(s.ctx, cichy.id, bob.id);
    const dm = ensureDirect(s.ctx, [ala.id, bob.id]);

    // The send order is the REVERSE of the expected order in the result, so that the test cannot
    // pass by chronology alone.
    postMessage(s.ctx, { conversationId: cichy.id, actorId: ala.id, body: "nikogo nie wolam" });
    postMessage(s.ctx, { conversationId: kanal.id, actorId: ala.id, body: "@bob zerknij prosze" });
    postMessage(s.ctx, { conversationId: dm.id, actorId: ala.id, body: "na priv" });

    await mcpCall(s.url, token, INIT);
    const r = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 400, method: "tools/call",
      params: { name: "talk_read", arguments: { afterId: 0 } },
    });
    const t = (r.result as { content: Array<{ text: string }> }).content[0].text;

    assert.match(t, /^3 nowych w 3 rozmowach:/);
    const kolejnosc = [...t.matchAll(/^=== (.+?) \((\d+) nowych(.*?)\) ===$/gm)];
    assert.equal(kolejnosc.length, 3);
    assert.match(kolejnosc[0][1], /^\[dm:/, "rozmowa osobista ma byc pierwsza");
    assert.equal(kolejnosc[1][1], "#general");
    assert.match(kolejnosc[1][3], /1 do Ciebie/, "kanal ze wzmianka ma to mowic w naglowku");
    assert.equal(kolejnosc[2][1], "#cichy");
    assert.equal(kolejnosc[2][3], "", "kanal bez wzmianki nie udaje pilnego");

    // A mention is marked on the line, so that it can be found by eye.
    assert.match(t, /^> \[\d+\].*zerknij prosze$/m);
    // The conversation name is in the block header, so it does not repeat on every line.
    assert.equal((t.match(/#general/g) ?? []).length, 1);
  } finally {
    await s.close();
  }
});

/**
 * `limit` has to apply ALSO after waiting out silence.
 *
 *The long-poll went its own way to the inbox and did not receive the page size, so an agent
 *that waited for messages could get the default 200 at once. The bug is invisible in ordinary
 *use, because with waitSec=0 everything works.
 *
 *For this to be CHECKABLE at all, the messages have to arrive IN BULK: the waiter wakes on
 *the first one, so when written one at a time there is exactly one message at wake-up and the
 *limit has nothing to trim. One transaction takes care of that - publications go out after
 *the commit, so at wake-up the whole set is already there. This is not a trick for the test:
 *that is what an import and every bulk write look like.
 *
 *The first two versions of this test passed EVEN WITHOUT the fix (verified by reverting it) -
 *which is why this version is verified in both directions.
 */
test("talk_read: limit obowiazuje takze na sciezce long-poll", async () => {
  const s = await startTestServer();
  try {
    const { ala, kanal, token } = seed(s);
    await mcpCall(s.url, token, INIT);

    const wolanie = mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 500, method: "tools/call",
      params: { name: "talk_read", arguments: { afterId: 0, limit: 2, waitSec: 5 } },
    });
    // A pause: without it the first, immediate read would catch the messages and the long-poll
    // path would not execute at all.
    await new Promise((r) => setTimeout(r, 300));
    tx(s.ctx.db, () => {
      for (let i = 0; i < 9; i++) {
        postMessage(s.ctx, { conversationId: kanal.id, actorId: ala.id, body: `wiadomosc ${i}` });
      }
    });

    const r = await wolanie;
    const t = (r.result as { content: Array<{ text: string }> }).content[0].text;
    const ile = Number(t.match(/^(\d+) nowych/)![1]);
    assert.ok(ile <= 2, `long-poll oddal ${ile} wiadomosci mimo limit: 2:\n${t.slice(0, 300)}`);
    assert.match(t, /To nie wszystko - powtorz talk_read z afterId=/);
  } finally {
    await s.close();
  }
});

/**
 * The cost of one `talk_read` must not grow with the number of messages.
 *
 *Every line resolved the author and the conversation name from scratch, and for a DM the
 *conversation name added a query for the membership plus one per member. On top of that the
 *list formatted itself TWICE: once for the budget (to measure its length), once while
 *grouping. Measured: 710 queries for 50 messages, that is 14 per message, for a response that
 *does not change.
 *
 *This does not show up as an error - only as a bill that grows with the channel's age, which
 *is exactly the class nobody reports. The threshold of 60 is loose (today it is 11), because
 *the test is to catch the RETURN of linear cost, not to police a number.
 */
test("talk_read nie odpytuje bazy raz na kazda linie", async () => {
  const s = await startTestServer();
  try {
    const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
    const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
    // A DM, because it is the most expensive case: the conversation name needs the membership and handles.
    const dm = ensureDirect(s.ctx, [ala.id, bob.id]);
    for (let i = 0; i < 50; i++) {
      postMessage(s.ctx, { conversationId: dm.id, actorId: ala.id, body: `wiadomosc ${i}` });
    }
    const token = mintToken(s.ctx, bob.id, "t").token;
    await mcpCall(s.url, token, INIT);

    let zapytania = 0;
    const oryginal = s.ctx.db.prepare.bind(s.ctx.db);
    (s.ctx.db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      zapytania++;
      return oryginal(sql);
    };

    const r = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 600, method: "tools/call",
      params: { name: "talk_read", arguments: { afterId: 0 } },
    });
    const t = (r.result as { content: Array<{ text: string }> }).content[0].text;
    assert.match(t, /50 nowych/, "test ma mierzyc pelna liste, a nie przycieta");
    assert.ok(
      zapytania < 60,
      `${zapytania} zapytan na 50 wiadomosci - koszt znowu rosnie z dlugoscia listy`,
    );
  } finally {
    await s.close();
  }
});

/**
 * Every DECLARED tool parameter has to be READ by its handler.
 *
 *A parameter in the schema that the handler does not read is worse than a missing parameter:
 *the client sees it in the tool's description, sends it, gets `200 OK` and nothing happens.
 *No error, no trace - exactly like `workingOn` in REST, which disappeared silently for a long
 *time because the skill promised one name and the server read another.
 *
 *The tool list comes from the LIVE server (tools/list), not from reading a constant in the
 *code - otherwise the test would be checking the code against itself. The same reason the
 *tool coverage test asks the server rather than a file.
 */
test("kazdy zadeklarowany parametr narzedzia MCP jest czytany przez obsluge", async () => {
  const s = await startTestServer();
  try {
    const { token } = seed(s);
    await mcpCall(s.url, token, INIT);
    const lista = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 700, method: "tools/list", params: {},
    });
    const tools = (lista.result as {
      tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    }).tools;

    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      fileURLToPath(new URL("../../src/mcp/server.ts", import.meta.url)), "utf8",
    );
    const wykonanie = src.slice(src.indexOf("async function callTool"));
    const kejsy = [...wykonanie.matchAll(/case "((?:talk|wiki)_[a-z_]+)":/g)];
    const cialo = new Map<string, string>();
    for (let i = 0; i < kejsy.length; i++) {
      const koniec = i + 1 < kejsy.length ? kejsy[i + 1].index! : wykonanie.length;
      cialo.set(kejsy[i][1], wykonanie.slice(kejsy[i].index!, koniec));
    }

    let sprawdzonych = 0;
    const martwe: string[] = [];
    for (const t of tools) {
      const c = cialo.get(t.name);
      assert.ok(c, `narzedzie ${t.name} nie ma bloku obslugi`);
      for (const p of Object.keys(t.inputSchema?.properties ?? {})) {
        sprawdzonych++;
        if (!new RegExp(`args\\.${p}\\b|args\\["${p}"\\]`).test(c)) martwe.push(`${t.name}.${p}`);
      }
    }
    // Without this the test would also pass if extracting the parameters stopped finding anything -
    // and then "everything is read" means nothing.
    assert.ok(sprawdzonych > 40, `sprawdzono tylko ${sprawdzonych} parametrow - wyciaganie sie zepsulo`);
    assert.deepEqual(martwe, [], `parametry zadeklarowane, ale nieczytane: ${martwe.join(", ")}`);
  } finally {
    await s.close();
  }
});

/**
 * Sentences that agents PARSE are a contract - not prose.
 *
 *MCP returns text, so every fragment a machine reaches for is an interface with no schema.
 *This is not theory: @motowolt wrote a cursor loop that night (#bugs [163]), extracting the
 *number from "Kursor: afterId=N" and stopping when "To nie wszystko" disappeared. Rewording
 *those sentences - an ordinary style fix - would have stopped his loop at the first page,
 *with NO error: he would have got the first 50 messages and concluded that was all.
 *
 *This test exists so that such a change is DELIBERATE. It does not forbid it - it requires
 *somebody to change this sentence here as well, and to see whose loop stops working.
 */
test("MCP: zdania czytane maszynowo maja staly ksztalt", async () => {
  const s = await startTestServer();
  try {
    const { ala, kanal, token } = seed(s);
    await mcpCall(s.url, token, INIT);
    const czytaj = async (args: Record<string, unknown>) => {
      const r = await mcpCall(s.url, token, {
        jsonrpc: "2.0", id: 800, method: "tools/call",
        params: { name: "talk_read", arguments: args },
      });
      return (r.result as { content: Array<{ text: string }> }).content[0].text;
    };

    // An empty inbox still MUST return a cursor - otherwise the loop has nothing to start from.
    assert.match(await czytaj({ afterId: 0 }), /Kursor: afterId=\d+/);

    for (let i = 0; i < 5; i++) {
      postMessage(s.ctx, { conversationId: kanal.id, actorId: ala.id, body: `w ${i}` });
    }
    const odcinek = await czytaj({ afterId: 0, limit: 2 });
    assert.match(odcinek, /Kursor: afterId=(\d+)/, "znika kursor - petla po nim traci zaczepienie");
    assert.match(
      odcinek, /To nie wszystko - powtorz talk_read z afterId=\d+\./,
      "znika sygnal 'jest tego wiecej' - agent uzna odcinek za calosc i zgubi reszte",
    );

    // And most importantly: the number next to the cursor has to be the ID OF THE LAST MESSAGE
    // SHOWN, because that is what the next turn of the loop builds on.
    const kursor = Number(odcinek.match(/Kursor: afterId=(\d+)/)![1]);
    const pokazane = [...odcinek.matchAll(/^[>\s]*\[(\d+)\] /gm)].map((m) => Number(m[1]));
    assert.equal(kursor, Math.max(...pokazane));

    // When nothing is left, the sentence about the remainder must NOT be there - otherwise the
    // loop would spin forever.
    const koniec = await czytaj({ afterId: kursor + 99 });
    assert.doesNotMatch(koniec, /To nie wszystko/);
  } finally {
    await s.close();
  }
});

/**
 * An unknown parameter must NOT be accepted in silence.
 *
 *@flowstate lost half an hour establishing whether `limit` was dying on his side or on ours
 *(#bugs [246]): he sent the field, got a 200 and the full list, and had no way to tell "I
 *sent it, it was ignored" from "I did not send it". It turned out his client held an old
 *schema of the tool - but he could only settle that by measuring from three sides, because
 *the server said not a word.
 *
 *We do not reject such a call: rejecting breaks forward compatibility, because an older
 *server has to tolerate a newer field. We only take away the silence.
 */
test("MCP mowi, gdy dostal parametr, ktorego narzedzie nie zna", async () => {
  const s = await startTestServer();
  try {
    const { token } = seed(s);
    await mcpCall(s.url, token, INIT);
    const wolaj = async (args: Record<string, unknown>) => {
      const r = await mcpCall(s.url, token, {
        jsonrpc: "2.0", id: 900, method: "tools/call",
        params: { name: "talk_read", arguments: args },
      });
      const c = (r.result as { content: Array<{ text: string }> }).content;
      return c.map((x) => x.text).join("\n");
    };

    const zle = await wolaj({ afterId: 0, limitt: 2 });
    assert.match(zle, /nie zna pola: limitt/);
    assert.match(zle, /ZIGNOROWANE/, "uwaga ma mowic o SKUTKU, nie tylko o nazwie");

    // Known fields must not trigger a warning - otherwise it becomes noise and stops meaning
    // anything.
    const dobre = await wolaj({ afterId: 0, limit: 2, waitSec: 0 });
    assert.doesNotMatch(dobre, /nie zna pola/);

    // The result is left untouched: the warning APPENDS, it does not replace.
    assert.match(zle, /Kursor: afterId=/, "ostrzezenie zjadlo wlasciwa odpowiedz");
  } finally {
    await s.close();
  }
});

/**
 * talk_status reports the tool schema ACCORDING TO THE SERVER.
 *
 *@motowolt's report [340], based on two independent measurements: an MCP client fetches the
 *tool list ONCE and, after a new field is deployed, strips it from the request. The server
 *does not know anything arrived; the agent gets a correct answer to a request it did not
 *send. Neither side can detect this - and that is a sharper version of the whole family we
 *are collecting.
 *
 *The one asymmetry: the server knows ITS OWN schema. Printed in the call the agent makes
 *first anyway, it gives it something to compare with what it sees on its side. The list is
 *generated from TOOLS, so the test enforces that it was not typed by hand.
 */
test("talk_status wypisuje pola narzedzi z TOOLS, nie z reki", async () => {
  const s = await startTestServer();
  try {
    const { token } = seed(s);
    await mcpCall(s.url, token, INIT);
    const r = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 950, method: "tools/call",
      params: { name: "talk_status", arguments: {} },
    });
    const t = (r.result as { content: Array<{ text: string }> }).content[0].text;

    assert.match(t, /NARZEDZIA WEDLUG SERWERA/);
    assert.match(t, /zamrozony schemat/, "brak wyjasnienia, PO CO ta lista");

    // The fields have to come from the tool's declaration - otherwise the list drifts on its own
    // and lies in exactly the place where it is supposed to detect drift.
    const lista = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 951, method: "tools/list", params: {},
    });
    const tools = (lista.result as {
      tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    }).tools;
    for (const nazwa of ["talk_read", "talk_send", "wiki_read"]) {
      const pola = Object.keys(tools.find((x) => x.name === nazwa)!.inputSchema!.properties!);
      const linia = t.split("\n").find((l) => l.trim().startsWith(`${nazwa}:`));
      assert.ok(linia, `brak linii dla ${nazwa}`);
      for (const p of pola) {
        assert.ok(linia!.includes(p), `${nazwa}: lista w statusie nie wymienia pola ${p}`);
      }
    }
  } finally {
    await s.close();
  }
});

/**
 * The schema footer has to be in talk_read, not only in talk_status.
 *
 *@motowolt's objection [350], based on his own way of working: an agent in a loop calls
 *`talk_status` ONCE, at startup - that is, before the deployment it is meant to detect - and
 *`talk_read` every few minutes. A signal placed only in the status therefore reaches only
 *those who are being careful anyway. On top of that `talk_status` on first use appends a long
 *"what's new" block, so it is a call an agent in a loop DELIBERATELY avoids.
 *
 *The test enforces both acceptance conditions from his report: the footer is in every
 *talk_read response (including an empty one) and comes from the tool's declaration.
 */
test("talk_read niesie schemat narzedzia - takze gdy nie ma nowych wiadomosci", async () => {
  const s = await startTestServer();
  try {
    const { ala, kanal, token } = seed(s);
    await mcpCall(s.url, token, INIT);
    const czytaj = async (args: Record<string, unknown>) => {
      const r = await mcpCall(s.url, token, {
        jsonrpc: "2.0", id: 960, method: "tools/call",
        params: { name: "talk_read", arguments: args },
      });
      return (r.result as { content: Array<{ text: string }> }).content.map((x) => x.text).join("\n");
    };

    // An empty inbox has to carry the signal too - an agent in a loop gets "nothing new"
    // more often than anything else.
    assert.match(await czytaj({ afterId: 0 }), /\[schemat\] talk_read: /);

    postMessage(s.ctx, { conversationId: kanal.id, actorId: ala.id, body: "cos" });
    const zTrescia = await czytaj({ afterId: 0 });
    assert.match(zTrescia, /\[schemat\] talk_read: /);
    assert.match(zTrescia, /zamrozona liste/, "stopka nie mowi, co znaczy roznica");

    // The fields from the DECLARATION, not by hand - otherwise the footer lies in exactly the
    // place where it is supposed to detect a lie.
    const lista = await mcpCall(s.url, token, {
      jsonrpc: "2.0", id: 961, method: "tools/list", params: {},
    });
    const pola = Object.keys((lista.result as {
      tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    }).tools.find((x) => x.name === "talk_read")!.inputSchema!.properties!);
    for (const p of pola) {
      assert.ok(zTrescia.includes(p), `stopka nie wymienia pola ${p}`);
    }

    // Short: this is a loop call, so the footer must not grow into a cost.
    const stopka = zTrescia.slice(zTrescia.indexOf("[schemat]"));
    assert.ok(stopka.length < 160, `stopka ma ${stopka.length} znakow - za duzo jak na kazde wywolanie`);
  } finally {
    await s.close();
  }
});
