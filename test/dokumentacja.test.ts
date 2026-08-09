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
import { startTestServer } from "./http-helpers.ts";
import { bearer } from "./http-helpers.ts";
import { createActor } from "../src/core/actors.ts";
import { mintToken } from "../src/core/tokens.ts";
import { createChannel } from "../src/core/conversations.ts";
import { postMessage } from "../src/core/messages.ts";
import { savePage } from "../src/core/wiki.ts";

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

/**
 * Zaden atrybut zdarzenia w UI nie moze byc SKLEJANY z danych.
 *
 * Znalezione przez przeglad bezpieczenstwa w moim wlasnym, swiezym kodzie:
 * awatar mial `onerror="...${escapeHtml(initials(handle))}..."`. HTML-escape
 * w tym miejscu NIE chroni - przegladarka najpierw odkodowuje encje atrybutu,
 * a dopiero potem czyta jego tresc jako kod, wiec `&#39;` wraca jako apostrof
 * i zamyka literal.
 *
 * Wtedy nie bylo to wykonalne, bo handle jest walidowany do [a-z0-9._-] przez
 * INNY plik. Dokladnie dlatego jest tu test: zabezpieczenie oparte na walidacji
 * gdzie indziej znika w chwili, gdy ktos wywola te funkcje z innym argumentem,
 * i nikt tego nie zauwazy, bo nic sie nie psuje.
 */
test("UI nie sklada atrybutow zdarzen z danych", () => {
  const dir = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
  const pliki = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(pliki.length >= 10, `znaleziono tylko ${pliki.length} modulow UI - sciezka sie zmienila`);

  const zle: string[] = [];
  for (const f of pliki) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/\bon[a-z]+\s*=\s*"[^"]*\$\{/g)) {
      zle.push(`${f}: ${m[0].slice(0, 40)}`);
    }
  }
  assert.deepEqual(
    zle, [],
    "atrybut zdarzenia sklejany z danych - escapeHtml tam nie chroni, uzyj data-* " +
      `i addEventListener: ${zle.join("; ")}`,
  );
});

/**
 * Ksztalty odpowiedzi w skillu musza zgadzac sie z ZYWYM serwerem.
 *
 * Trzy potkniecia jednej nocy - `hits` zamiast `results`, `doing` zamiast
 * `workingOn`, `section.body` zamiast `page.body` - nie byly trzema literowkami,
 * tylko jednym brakiem: skill mowil, DOKAD wyslac, i milczal o tym, CO wroci
 * (@zelda, #bugs [194]). Sekcja "What comes back" to zamyka.
 *
 * Sama sekcja bylaby jednak zwykla proza, czyli nastepna rzecza do rozjechania
 * sie z kodem - a to dokladnie ta klasa, ktora naprawiamy. Dlatego ten test
 * wola KAZDA udokumentowana trase na prawdziwym serwerze i porownuje klucze
 * najwyzszego poziomu z tym, co obiecuje dokument.
 */
test("kazdy udokumentowany ksztalt odpowiedzi zgadza sie z serwerem", async () => {
  const skill = plik("../integrations/claude-skill/SKILL.md");
  const blok = skill.match(/## What comes back[\s\S]*?```\n([\s\S]*?)```/);
  assert.ok(blok, "nie ma bloku z ksztaltami odpowiedzi");

  const obietnice = [...blok[1].matchAll(/^GET\s+(\S+)\s*->\s*\{([^}]*)\}/gm)]
    .map((m) => ({ sciezka: m[1], klucze: m[2].split(",").map((k) => k.trim()).filter(Boolean) }));
  assert.ok(obietnice.length >= 12, `udokumentowano tylko ${obietnice.length} tras`);

  const s = await startTestServer();
  try {
    const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
    createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
    const token = mintToken(s.ctx, ala.id, "t").token;
    postMessage(s.ctx, { conversationId: 1, actorId: ala.id, body: "deploy poszedl" });
    savePage(s.ctx, {
      slug: "strona", title: "Strona", actorId: ala.id,
      body: "Zdanie opisujace strone.\n\n# Rozdzial\ntresc rozdzialu",
    });

    const rozjazdy: string[] = [];
    for (const o of obietnice) {
      // Placeholdery zamieniamy na to, co naprawde istnieje w tej bazie.
      const url = o.sciezka
        .replace("<ID>", "1").replace("<slug>", "strona").replace("<h>", "Rozdzial")
        .replace("?q=", "?q=deploy");
      const res = await fetch(s.url + url, { headers: bearer(token) });
      if (res.status !== 200) { rozjazdy.push(`${o.sciezka}: HTTP ${res.status}`); continue; }
      const realne = Object.keys(await res.json()).sort();
      // Klucz z "?" bywa nieobecny (np. `news` przychodzi tylko raz), wiec nie
      // wymagamy go - ale klucz opisany BEZ "?" musi byc, a klucz oddany przez
      // serwer i nieopisany jest bledem dokumentacji tak samo jak brakujacy.
      const opcjonalne = new Set(o.klucze.filter((k) => k.endsWith("?")).map((k) => k.slice(0, -1)));
      const wymagane = o.klucze.filter((k) => !k.endsWith("?")).sort();
      const brakuje = wymagane.filter((k) => !realne.includes(k));
      const nadmiar = realne.filter((k) => !wymagane.includes(k) && !opcjonalne.has(k));
      if (brakuje.length || nadmiar.length) {
        rozjazdy.push(
          `${o.sciezka}: brakuje w odpowiedzi [${brakuje}], nieopisane w skillu [${nadmiar}]`,
        );
      }
    }
    // Wysylka pliku jest jedyna trasa NIE-GET w tym bloku, a blok obiecuje, ze
    // cala jest sprawdzana - wiec musi byc sprawdzona, inaczej dokument o
    // nieprawdach zawiera nieprawde. Ciala nie da sie wyprowadzic z opisu tak
    // jak sciezki GET, stad jawny przypadek.
    const plikowa = blok[1].match(/^POST\s+(\S+)\s*->\s*\{([^}]*)\}/m);
    assert.ok(plikowa, "znikl opis wysylki pliku - albo zmienil ksztalt zapisu");
    const res = await fetch(`${s.url}/api/conversations/1/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain",
                 "x-file-name": encodeURIComponent("z testu.txt") },
      body: "tresc",
    });
    assert.equal(res.status, 201, "trasa wysylki pliku z dokumentacji nie odpowiada 201");
    const realneP = Object.keys(await res.json()).sort();
    const opisaneP = plikowa[2].split(",").map((k) => k.trim()).filter(Boolean).sort();
    if (JSON.stringify(realneP) !== JSON.stringify(opisaneP)) {
      rozjazdy.push(`${plikowa[1]}: skill mowi [${opisaneP}], serwer oddaje [${realneP}]`);
    }

    assert.deepEqual(rozjazdy, [], `ksztalty rozjechaly sie z serwerem:\n  ${rozjazdy.join("\n  ")}`);
  } finally {
    await s.close();
  }
});

/**
 * Kazdy import miedzy modulami UI musi wskazywac na istniejacy eksport.
 *
 * Moduly ES nie sa laskawe: import nazwy, ktorej modul nie eksportuje, wywala
 * CALY graf przy ladowaniu - uzytkownik dostaje pusta strone, a nie zepsuty
 * kawalek. Ta warstwa nie ma zadnych testow przegladarkowych, wiec jedyna
 * kontrola bylo otwarcie strony recznie. Dzis zmienilem importy w czterech
 * modulach i sprawdzilem to dopiero na koncu, przegladarka.
 *
 * Test robi to samo, tylko przy kazdym przebiegu i bez przegladarki.
 */
test("moduly UI: kazdy import ma odpowiadajacy eksport", () => {
  const dir = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));
  const pliki = readdirSync(dir).filter((f) => f.endsWith(".js"));

  const eksporty = new Map<string, Set<string>>();
  for (const f of pliki) {
    const src = readFileSync(dir + f, "utf8");
    const n = new Set<string>();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([\w$]+)/gm)) n.add(m[1]);
    for (const m of src.matchAll(/^export\s+class\s+([\w$]+)/gm)) n.add(m[1]);
    // `export const A = 1, B = 2` deklaruje WIELE nazw jednym slowem kluczowym.
    // Branie tylko pierwszej dawalo trzy falszywe alarmy przy pierwszym przebiegu
    // (i czwarty, bo `$` jest legalnym znakiem w nazwie, a nie bylo go we wzorcu).
    for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(.+)$/gm)) {
      for (const czesc of m[1].split(/,(?![^(]*\))/)) {
        const r = czesc.match(/^\s*([\w$]+)\s*=/);
        if (r) n.add(r[1]);
      }
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const x of m[1].split(",")) {
        const nazwa = x.trim().split(" as ").pop()?.trim();
        if (nazwa) n.add(nazwa);
      }
    }
    eksporty.set(f, n);
  }

  const bledy: string[] = [];
  let sprawdzonych = 0;
  for (const f of pliki) {
    const src = readFileSync(dir + f, "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)"/gs)) {
      const cel = m[2];
      if (!eksporty.has(cel)) { bledy.push(`${f} -> nie ma modulu ${cel}`); continue; }
      for (const x of m[1].split(",")) {
        const nazwa = x.trim().split(" as ")[0].trim();
        if (!nazwa) continue;
        sprawdzonych++;
        if (!eksporty.get(cel)!.has(nazwa)) {
          bledy.push(`${f} importuje "${nazwa}" z ${cel}, ktory tego nie eksportuje`);
        }
      }
    }
  }

  // Bez tego progu zepsute wyciaganie meldowaloby "wszystko dobrze" - i wlasnie
  // tak zachowala sie pierwsza wersja tego sprawdzenia.
  assert.ok(sprawdzonych > 250, `sprawdzono tylko ${sprawdzonych} powiazan - wyciaganie sie zepsulo`);
  assert.deepEqual(bledy, [], `zepsute importy - strona nie wstanie w ogole:\n  ${bledy.join("\n  ")}`);
});
