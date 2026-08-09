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

/**
 * Zgloszenie [149] @motowolta: `talk_read {afterId: 0}` na kanale z 133 wiadomosciami
 * zwrocil 132 355 znakow w jednym bloku i klient ODRZUCIL calosc - agent nie dostal
 * nawet pierwszej wiadomosci. Pilnujemy obu konców naraz, bo kazdy z osobna zawodzi:
 *
 *   - odcinek (`limit`) nie wystarczy, bo o odrzuceniu decyduje ROZMIAR, a jedna
 *     wiadomosc miewa 65 kB;
 *   - budzet znakow nie wystarczy, bo bez kursora wskazujacego OSTATNIA POKAZANA
 *     wiadomosc obciecie po cichu przeskakuje reszte.
 */
test("talk_read: odcinek, budzet znakow i kursor po ostatniej POKAZANEJ wiadomosci", async () => {
  const s = await startTestServer();
  const { ala, kanal, token } = seed(s);
  // 60 wiadomosci po ~2 kB: razem ~120 kB, czyli powyzej budzetu 40 000 znakow.
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

  // Kursor MUSI wskazywac wiadomosc, ktora agent naprawde zobaczyl. Gdyby wskazywal
  // ostatnia POBRANA, wszystko miedzy obcieciem a nim zniknieloby bezpowrotnie.
  // Wynik jest grupowany po rozmowach, wiec "ostatnia pokazana" to najwyzsze
  // pokazane id, a nie ostatnia linia.
  const idWyniku = (t: string) => [...t.matchAll(/^[>\s]*\[(\d+)\] /gm)].map((m) => Number(m[1]));
  assert.equal(kursor, Math.max(...idWyniku(pierwszy)));

  // Petla po kursorze dochodzi do konca i nie gubi ani jednej wiadomosci.
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

  // Jawny `limit` tnie odcinek - to jest to pole, ktorego brakowalo w MCP.
  const maly = await wynik({ afterId: 0, limit: 3 });
  assert.match(maly, /^3 nowych w \d+ rozmow/);
  await s.close();
});

/**
 * Odczyt strony wiki odblokowuje jej zapis, a zapis podmienia CALA tresc. Gdyby
 * przyciety odczyt tez odblokowywal, agent odsylajacy "to, co przeczytalem, plus
 * moj akapit" skasowalby brakujaca czesc i nikt by sie nie dowiedzial.
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

    // Bob widzial tylko kawalek, wiec zapis ma odbic sie o ochrone przed nadpisaniem.
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
 * Prosba @michal z [143]: "znajdzcie sposob, zeby ogarniac wiele rozmow".
 * Plaska lista chronologiczna mowi, CO sie stalo; agent po przerwie potrzebuje
 * wiedziec, GDZIE ma odpisac. Test pilnuje, ze kolejnosc blokow niesie te
 * odpowiedz: rozmowa osobista przed kanalem ze wzmianka, ten przed reszta.
 */
test("talk_read grupuje po rozmowach i stawia na gorze to, co czeka na Ciebie", async () => {
  const s = await startTestServer();
  try {
    const { ala, bob, kanal, token } = seed(s);
    const cichy = createChannel(s.ctx, { slug: "cichy", kind: "public", createdBy: ala.id });
    join(s.ctx, cichy.id, bob.id);
    const dm = ensureDirect(s.ctx, [ala.id, bob.id]);

    // Kolejnosc wysylki jest ODWROTNA do oczekiwanej kolejnosci w wyniku, zeby
    // test nie przeszedl przypadkiem na samej chronologii.
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

    // Wzmianka jest oznaczona w linii, zeby dalo sie ja znalezc wzrokiem.
    assert.match(t, /^> \[\d+\].*zerknij prosze$/m);
    // Nazwa rozmowy jest w naglowku bloku, wiec nie powtarza sie w kazdej linii.
    assert.equal((t.match(/#general/g) ?? []).length, 1);
  } finally {
    await s.close();
  }
});

/**
 * `limit` musi obowiazywac TAKZE po przeczekaniu ciszy.
 *
 * Long-poll szedl wlasna sciezka do skrzynki i nie dostawal odcinka, wiec agent,
 * ktory poczekal na wiadomosci, mogl dostac domyslne 200 naraz. Bledu nie widac
 * w zwyklym uzyciu, bo przy waitSec=0 wszystko dziala.
 *
 * Zeby to w ogole DALO SIE sprawdzic, wiadomosci musza dojsc HURTEM: czekajacy
 * budzi sie na pierwszej, wiec przy zapisie po jednej w chwili przebudzenia
 * istnieje dokladnie jedna i limit nie ma czego przyciac. Jedna transakcja to
 * zalatwia - publikacje ida po commicie, wiec w chwili przebudzenia stoi juz
 * caly komplet. To nie jest sztuczka pod test: tak wyglada import i kazdy
 * zapis zbiorczy.
 *
 * Pierwsze dwie wersje tego testu przechodzily TAKZE bez naprawy (sprawdzone
 * przez cofniecie jej) - dlatego ta wersja jest zweryfikowana w obie strony.
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
    // Pauza: bez niej pierwszy, natychmiastowy odczyt zlapalby wiadomosci
    // i sciezka long-poll nie wykonalaby sie wcale.
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
 * Koszt jednego `talk_read` nie moze rosnac z liczba wiadomosci.
 *
 * Kazda linia rozwiazywala autora i nazwe rozmowy od nowa, a dla DM-a nazwa
 * rozmowy dokladala zapytanie o sklad plus jedno na kazdego czlonka. Do tego
 * lista formatowala sie DWA razy: raz w budzecie (zeby zmierzyc dlugosc), raz
 * przy grupowaniu. Zmierzone: 710 zapytan na 50 wiadomosci, czyli 14 na
 * wiadomosc przy odpowiedzi, ktora sie nie zmienia.
 *
 * To sie nie objawia bledem - tylko rachunkiem, ktory rosnie z wiekiem kanalu,
 * czyli dokladnie ta klasa, ktora nikt nie zglosi. Prog 60 jest luzny (dzis
 * jest 11), bo test ma lapac POWROT liniowego kosztu, a nie pilnowac liczby.
 */
test("talk_read nie odpytuje bazy raz na kazda linie", async () => {
  const s = await startTestServer();
  try {
    const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
    const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
    // DM, bo to najdrozszy przypadek: nazwa rozmowy wymaga skladu i handli.
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
 * Kazdy ZADEKLAROWANY parametr narzedzia musi byc CZYTANY przez jego obsluge.
 *
 * Parametr w schemacie, ktorego handler nie czyta, jest gorszy od braku
 * parametru: klient widzi go w opisie narzedzia, wysyla, dostaje `200 OK`
 * i nic sie nie dzieje. Zadnego bledu, zadnego sladu - tak samo, jak `workingOn`
 * w REST, ktory przez dlugi czas po cichu znikal, bo skill obiecywal jedna
 * nazwe, a serwer czytal druga.
 *
 * Lista narzedzi pochodzi z ZYWEGO serwera (tools/list), nie z odczytu stalej w
 * kodzie - inaczej test sprawdzalby zgodnosc kodu z samym soba. Ten sam powod,
 * dla ktorego test pokrycia narzedzi pyta serwer, a nie plik.
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
    // Bez tego test przechodzilby takze wtedy, gdyby wyciaganie parametrow
    // przestalo cokolwiek znajdowac - a wtedy "wszystko czytane" nic nie znaczy.
    assert.ok(sprawdzonych > 40, `sprawdzono tylko ${sprawdzonych} parametrow - wyciaganie sie zepsulo`);
    assert.deepEqual(martwe, [], `parametry zadeklarowane, ale nieczytane: ${martwe.join(", ")}`);
  } finally {
    await s.close();
  }
});
