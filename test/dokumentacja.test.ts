/**
 * Dokument kontra kod: czy to, czego dokumentacja KAZE uzywac, w ogole istnieje.
 *
 * Powod istnienia tego pliku ma nazwe nadana przez @motowolta na #bugs [180]:
 * "obie strony poprawne, para zepsuta". Skill dokumentowal pole `workingOn`,
 * trasa czytala `doing`. Kod byl poprawny. Dokument byl spojny. Zepsuta byla
 * RELACJA miedzy nimi - a relacji nie widac z zadnego z dwoch koncow osobno,
 * wiec ani przeglad kodu, ani korekta tekstu nie mialy szans.
 *
 * Skutek dla agenta: `200 OK` i pole, ktore znika bez sladu. Zadnego bledu,
 * zadnego ostrzezenia - czyli awaria, ktora nie wyglada jak awaria.
 *
 * MCP ma na to czujnik z natury: deklaruje parametry maszynowo (tools/list),
 * wiec pare da sie sprawdzic automatycznie - i sprawdza ja test w mcp.test.ts.
 * Proza czujnika nie miala. To jest ten czujnik - dla obu par, w ktorych proza
 * stoi po jednej stronie: cial JSON w skillu i flag CLI w calej dokumentacji.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const plik = (wzgledna: string) =>
  readFileSync(fileURLToPath(new URL(wzgledna, import.meta.url)), "utf8");

/** Sciezka i cialo bywaja w roznych liniach tego samego polecenia (kontynuacja
 *  odwrotnym ukosnikiem), wiec idziemy po liniach, pamietajac ostatnia sciezke. */
function przykladyZeSkilla(): Array<{ sciezka: string; klucze: string[] }> {
  const out: Array<{ sciezka: string; klucze: string[] }> = [];
  let sciezka: string | null = null;
  for (const l of plik("../integrations/claude-skill/SKILL.md").split("\n")) {
    const s = l.match(/\/api\/[A-Za-z0-9_<>/\-.]+/);
    if (s) sciezka = s[0];
    const d = l.match(/-d '(\{.*)/);
    if (!d || !sciezka) continue;
    // Ciala z osadzonymi cudzyslowami powloki nie sa poprawnym JSON-em
    // (np. clientMsgId sklejany z $RANDOM), wiec bierzemy same nazwy pol.
    const klucze = [...d[1].matchAll(/"([a-zA-Z]+)"\s*:/g)].map((x) => x[1]);
    if (klucze.length) out.push({ sciezka, klucze });
  }
  return out;
}

test("kazde pole, ktore skill kaze wyslac, jest czytane przez trase", () => {
  const przyklady = przykladyZeSkilla();
  const kod = [
    "../src/http/routes/messages.ts", "../src/http/routes/conversations.ts",
    "../src/http/routes/wiki.ts", "../src/http/routes/extras.ts", "../src/http/routes/auth.ts",
  ].map(plik).join("\n");

  let sprawdzonych = 0;
  const martwe: string[] = [];
  for (const p of przyklady) {
    for (const k of p.klucze) {
      sprawdzonych++;
      // Celowo WASKI wzorzec: samo `k:` gdziekolwiek w kodzie tras dawaloby
      // trafienie na dowolnym literale obiektu i uznawaloby pole za czytane,
      // choc nikt go z zadania nie wyjmuje.
      if (!new RegExp(`body\\.${k}\\b|body\\["${k}"\\]`).test(kod)) {
        martwe.push(`${p.sciezka} -> "${k}"`);
      }
    }
  }

  // Bez tej asercji test przechodzilby TAKZE wtedy, gdyby wyciaganie przykladow
  // przestalo cokolwiek znajdowac - a "wszystkie czytane" z pustego zbioru to
  // zdanie prawdziwe i bezuzyteczne. Pierwsza wersja tego wyciagania gubila
  // polowe blokow i wlasnie dlatego meldowala sukces.
  assert.ok(przyklady.length >= 6, `znaleziono tylko ${przyklady.length} przykladow z cialem JSON`);
  assert.ok(sprawdzonych >= 14, `sprawdzono tylko ${sprawdzonych} pol - wyciaganie sie zepsulo`);
  assert.deepEqual(
    martwe, [],
    `skill kaze wyslac pola, ktorych zadna trasa nie czyta (200 OK i cisza): ${martwe.join("; ")}`,
  );
});

/**
 * Kazda flaga CLI pokazana w dokumentacji musi istniec w parserze.
 *
 * Dla `atalk` skutek bledu jest CICHY i juz raz wystapil: flagi `--force`
 * i `--base` nie byly wymienione w KNOWN_FLAGS, wiec zamiast dzialac, ladowaly
 * w TRESCI zapisywanej strony wiki. Zaden blad, zaden komunikat - nieznana
 * flaga jest dla parsera zwyklym slowem.
 *
 * Istniejacy test w atalk.test.ts pilnuje kierunku KOD -> parser (kazda flaga
 * uzyta w kodzie jest znana). To jest drugi kierunek, ktorego tamten nie widzi:
 * DOKUMENT -> parser. Uczymy kogos flagi, ktorej nie ma.
 */
test("kazda flaga CLI z dokumentacji istnieje w parserze", () => {
  // Katalogi CZYTANE, nie wypisane recznie: lista na sztywno starzeje sie przy
  // pierwszym nowym dokumencie i cicho zmniejsza zasieg. Zlapala to asercja na
  // liczbe znalezionych flag, kiedy ta lista byla wpisana z palca.
  const katalog = (wzgledna: string): string[] => {
    const dir = fileURLToPath(new URL(wzgledna, import.meta.url));
    try {
      return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".md")).map((f) => wzgledna + f);
    } catch { return []; }
  };
  const doks = [
    "../README.md", "../AgentTalks.md", "../NEWS.md", "../CONTRIBUTING.md", "../SECURITY.md",
    ...katalog("../docs/"), ...katalog("../integrations/"),
  ];

  /** Tylko to, co autor oznaczyl jako polecenie: bloki ``` i wstawki `...`.
   *  Bez tego proza o fladze (np. opis bledu w audycie) liczy sie jak jej uzycie. */
  const fragmentyKodu = (t: string): string[] => [
    ...[...t.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]),
    ...[...t.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]),
  ];

  const uzyte = new Map<string, Set<string>>();
  for (const d of doks) {
    let tekst: string;
    try { tekst = plik(d); } catch { continue; }
    for (const frag of fragmentyKodu(tekst)) {
      for (const l of frag.split("\n")) {
        // Nazwa CLI musi byc uzyta JAKO POLECENIE - po niej podkomenda, nie od
        // razu flaga. Inaczej `docker inspect agenttalks --format` liczyloby
        // flage dockera jako nasza (agenttalks jest tam nazwa kontenera).
        for (const m of l.matchAll(/(?:^|\s|\/)(atalk|agenttalks)(?:\.js)?\s+(?=[a-z])/g)) {
          let ogon = l.slice(m.index! + m[0].length);
          const koniec = ogon.search(/\||&&|;/);
          if (koniec >= 0) ogon = ogon.slice(0, koniec);
          for (const f of ogon.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
            if (!uzyte.has(m[1])) uzyte.set(m[1], new Set());
            uzyte.get(m[1])!.add(f[1]);
          }
        }
      }
    }
  }

  const zbior = (src: string, nazwa: string): Set<string> => {
    const m = src.match(new RegExp(`${nazwa} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
    return new Set(m ? [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]) : []);
  };
  const znane = (src: string, nazwa: string) => new Set([
    ...zbior(src, nazwa),
    ...[...src.matchAll(/flagStr\(args,\s*"([a-z-]+)"\)/g)].map((x) => x[1]),
    ...[...src.matchAll(/args\.flags\.([a-zA-Z]+)/g)].map((x) => x[1]),
  ]);
  const parser = {
    atalk: znane(plik("../src/cli/atalk.ts"), "const KNOWN_FLAGS"),
    agenttalks: znane(plik("../src/cli/main.ts"), "const FLAGI_LOGICZNE"),
  };

  const nieznane: string[] = [];
  let ile = 0;
  for (const [cli, flagi] of uzyte) {
    for (const f of flagi) {
      ile++;
      if (!parser[cli as "atalk" | "agenttalks"].has(f)) nieznane.push(`${cli} --${f}`);
    }
  }

  // Ta sama ochrona co wyzej: wyciaganie, ktore przestalo cokolwiek znajdowac,
  // melduje sukces. Dzis jest 18 flag w blokach kodu.
  assert.ok(ile >= 15, `znaleziono tylko ${ile} flag w dokumentacji - wyciaganie sie zepsulo`);
  assert.deepEqual(
    nieznane, [],
    `dokumentacja uczy flag, ktorych parser nie zna (w atalk ladują w TRESCI): ${nieznane.join(", ")}`,
  );
});
