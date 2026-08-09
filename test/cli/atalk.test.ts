/**
 * Testy klienta `atalk` - tego, ktorego uzywaja agenci.
 *
 * Powstaly, bo ich brak realnie kosztowal: flagi `--force` i `--base` przy
 * `wiki write` nie byly wymienione w liscie znanych flag, wiec zamiast dzialac,
 * ladowaly w TRESCI zapisywanej strony, a zabezpieczenie przed nadpisaniem
 * cicho nie dzialalo. Zaden test tego nie zlapal, bo klient nie mial zadnego.
 *
 * Zasada, ktora z tego wynika i ktorej pilnuje pierwszy test: kazda flaga uzyta
 * w kodzie MUSI byc w KNOWN_FLAGS. Rozjazd jest niewidoczny w dzialaniu -
 * program nie zglasza bledu, tylko po cichu robi co innego.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../../src/cli/main.ts";
import { atalkMain } from "../../src/cli/atalk.ts";
import { startTestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel } from "../../src/core/conversations.ts";

const zrodloAtalk = readFileSync(
  fileURLToPath(new URL("../../src/cli/atalk.ts", import.meta.url)),
  "utf8",
);

test("kazda flaga uzywana w kodzie jest wymieniona w KNOWN_FLAGS", () => {
  const uzyte = new Set<string>();
  for (const m of zrodloAtalk.matchAll(/flagStr\(args,\s*"([a-z-]+)"\)/g)) uzyte.add(m[1]);
  for (const m of zrodloAtalk.matchAll(/args\.flags\.([a-zA-Z]+)/g)) uzyte.add(m[1]);

  const blok = zrodloAtalk.match(/const KNOWN_FLAGS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(blok, "nie znalazlem listy KNOWN_FLAGS");
  const znane = new Set([...blok[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));

  const brakujace = [...uzyte].filter((f) => !znane.has(f)).sort();
  assert.deepEqual(
    brakujace,
    [],
    `flagi uzyte w kodzie, ale nieznane parserowi (ladowalyby w TRESCI): ${brakujace.join(", ")}`,
  );
});

test("parser argumentow: nieznana flaga zostaje trescia, terminator konczy flagi", () => {
  const znane = new Set(["title", "file"]);
  const a = parseArgs(["say", "testy", "padly", "na", "--coverage", "prosze"], znane);
  assert.deepEqual(a.positional, ["say", "testy", "padly", "na", "--coverage", "prosze"]);

  const b = parseArgs(["wiki", "write", "plan", "--title", "Plan", "tresc"], znane);
  assert.equal(b.flags.title, "Plan");
  assert.deepEqual(b.positional, ["wiki", "write", "plan", "tresc"]);

  const c = parseArgs(["say", "--", "--to-jest-tresc"], znane);
  assert.deepEqual(c.positional, ["say", "--to-jest-tresc"]);
});

/**
 * Uruchamia atalk z konfiguracja ze zmiennych srodowiskowych i zwraca kod wyjscia.
 *
 * CELOWO nie podmieniamy `process.stdout` - to przechwytuje takze wyjscie samego
 * runnera testow i sprawia, ze przebieg wyglada na zawieszony (sprawdzone).
 * Zamiast czytac to, co klient wypisal, sprawdzamy SKUTKI przez HTTP: czy
 * wiadomosc powstala, czy strona ma wlasciwa tresc. Skutek jest mocniejszym
 * dowodem niz komunikat, bo komunikat moze byc prawdziwy przy zlym dzialaniu.
 */
async function uruchom(argv: string[], env: Record<string, string>): Promise<number> {
  const przed = { url: process.env.AGENTTALKS_URL, token: process.env.AGENTTALKS_TOKEN };
  process.env.AGENTTALKS_URL = env.AGENTTALKS_URL;
  process.env.AGENTTALKS_TOKEN = env.AGENTTALKS_TOKEN;
  try {
    return await atalkMain(argv);
  } finally {
    if (przed.url === undefined) delete process.env.AGENTTALKS_URL;
    else process.env.AGENTTALKS_URL = przed.url;
    if (przed.token === undefined) delete process.env.AGENTTALKS_TOKEN;
    else process.env.AGENTTALKS_TOKEN = przed.token;
  }
}

test("atalk mowi do zywego serwera: whoami, say, read", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  const token = mintToken(s.ctx, ala.id, "test").token;
  const env = { AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: token };

  assert.equal(await uruchom(["whoami"], env), 0);
  assert.equal(await uruchom(["say", "czesc", "z", "testu"], env), 0);

  // Tresc ma dojsc W CALOSCI - w tym slowa, ktore wygladaja jak flagi.
  assert.equal(await uruchom(["say", "raport:", "padlo", "na", "--coverage"], env), 0);
  const lista = await (await fetch(`${s.url}/api/conversations/1/messages`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  assert.match(lista.messages.at(-1).body, /--coverage/);
  await s.close();
});

test("atalk wiki write --force dziala jako FLAGA, a nie jako tresc strony", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const tokenA = mintToken(s.ctx, ala.id, "test").token;
  const tokenB = mintToken(s.ctx, bob.id, "test").token;

  // Ala zaklada strone.
  await fetch(`${s.url}/api/wiki/plan`, {
    method: "PUT", headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Plan", body: "tresc ali" }),
  });

  // Bob nadpisuje ja SWIADOMIE, przez --force. Gdyby flaga byla nieznana,
  // slowo "--force" wyladowaloby w tresci strony, a zapis poszedlby bez
  // wymuszenia i zostalby odrzucony (409) - czyli objaw byly dwa naraz.
  const kod = await uruchom(
    ["wiki", "write", "plan", "--title", "Plan", "--force", "tresc boba"],
    { AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: tokenB },
  );
  assert.equal(kod, 0);

  const strona = await (await fetch(`${s.url}/api/wiki/plan`, {
    headers: { authorization: `Bearer ${tokenB}` },
  })).json();
  assert.equal(strona.page.body, "tresc boba");
  assert.ok(!strona.page.body.includes("--force"), "flaga wylądowala w tresci strony");
  await s.close();
});

test("atalk bez tokenu konczy sie kodem bledu, a nie wyjatkiem", async () => {
  const kod = await uruchom(["whoami"], { AGENTTALKS_URL: "http://127.0.0.1:1", AGENTTALKS_TOKEN: "" });
  assert.equal(kod, 1);
});

test("flaga logiczna nie polyka nastepnego slowa", () => {
  const znane = new Set(["title", "force", "stdin"]);
  // To jest dokladnie ten przypadek, ktory cicho psul `wiki write --force`:
  // parser brał "tresc" za WARTOSC flagi, wiec wymuszenie nie dzialalo,
  // a pierwsze slowo tresci znikalo.
  const a = parseArgs(["wiki", "write", "plan", "--force", "tresc", "strony"], znane);
  assert.equal(a.flags.force, true);
  assert.deepEqual(a.positional, ["wiki", "write", "plan", "tresc", "strony"]);

  // Flaga z wartoscia dziala jak dotad.
  const b = parseArgs(["wiki", "write", "plan", "--title", "Plan"], znane);
  assert.equal(b.flags.title, "Plan");
});
