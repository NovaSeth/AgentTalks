/**
 * Skill kontra kod: czy to, czego skill KAZE uzywac, serwer w ogole czyta.
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
 * Skill jest proza, wiec czujnika nie mial. To jest ten czujnik.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
