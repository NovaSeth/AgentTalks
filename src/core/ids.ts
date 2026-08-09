/**
 * Walidacja identyfikatorow widocznych dla czlowieka.
 *
 * Prototyp wyprowadzal nazwe uczestnika z `basename(cwd)` i bronil sie przed
 * bezuzytecznymi nazwami czarna lista ("claude", "home", "root", "tmp"...).
 * Tutaj tego problemu nie ma z zalozenia: `handle` jest nadawany przy zakladaniu
 * aktora przez czlowieka albo administratora, jest staly i jest kluczem adresowania.
 * Nazwa wyswietlana moze sie zmieniac dowolnie i nie rusza ani routingu, ani historii.
 */
import { badRequest } from "./errors.ts";

const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;

/**
 * Transliteracja przed odsianiem znakow. Bez tego "Michal" pisane z ogonkami dawaloby
 * "micha" (samo `ł` zniknelo, bo NFD go nie rozklada - to osobny znak, nie litera
 * z diakrytykiem). Handle ma byc rozpoznawalny dla czlowieka, a nie okaleczony.
 */
const POLSKIE: Record<string, string> = {
  "ą": "a", "ć": "c", "ę": "e", "ł": "l",
  "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z",
};

export function transliterate(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => POLSKIE[c])
    // Reszta alfabetow lacinskich: rozklad NFD zdejmuje znaki diakrytyczne.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * "@Nestor" -> "nestor", "bs/uzytkownik" -> "bs-uzytkownik".
 * Ukosnik i spacja staja sie mysnikiem, bo prototyp uzywal ich w etykietach
 * ("Nestor/motowolt", "bs/sceptyk") i import ma je odwzorowac bez utraty sensu.
 */
export function normalizeHandle(raw: string): string {
  const cleaned = transliterate(String(raw ?? "").trim().replace(/^@+/, ""))
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  if (!HANDLE_RE.test(cleaned)) {
    throw badRequest(
      "handle",
      `nieprawidlowy handle: "${raw}". Dozwolone [a-z0-9._-], dlugosc 2-32.`,
    );
  }
  return cleaned;
}

/** "#general" -> "general". Kanaly w prototypie mialy krzyzyk w nazwie; tutaj krzyzyk
 *  jest ozdoba interfejsu, a nie czescia identyfikatora. */
export function normalizeSlug(raw: string): string {
  const cleaned = transliterate(String(raw ?? "").trim().replace(/^#+/, ""))
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  if (!SLUG_RE.test(cleaned)) {
    throw badRequest("slug", `nieprawidlowa nazwa kanalu: "${raw}".`);
  }
  return cleaned;
}

/** Emoji reakcji: krotki, niepusty, bez bialych znakow. Nie sprawdzamy, czy to
 *  "prawdziwe" emoji - kazda proba takiej walidacji zestarzeje sie szybciej niz Unicode. */
export function normalizeEmoji(raw: string): string {
  const e = String(raw ?? "").trim();
  if (!e || e.length > 16 || /\s/.test(e)) {
    throw badRequest("emoji", "reakcja musi byc krotkim znakiem bez spacji");
  }
  return e;
}


/**
 * Zapytanie uzytkownika -> fraza FTS5 z przedrostkami. JEDNO miejsce, bo ta sama
 * regula obowiazuje wyszukiwarke wiadomosci i wyszukiwarke wiki - a dwie kopie
 * tego samego escapowania to dwie okazje, zeby jedna z nich zapomniec poprawic.
 * Cudzyslow jest usuwany, nie escapowany: w FTS5 sluzy do cytowania frazy, wiec
 * przepuszczony zmienialby znaczenie zapytania.
 */
export function ftsMatch(text: string): string | null {
  const slowa = String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 0);
  if (slowa.length === 0) return null;
  return slowa.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}
