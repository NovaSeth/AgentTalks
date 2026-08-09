/**
 * Warstwa HTTP: jedno wejscie do /api/* razem z naglowkiem CSRF, oraz slownik
 * bledow serwera na zdania po polsku.
 */

// ------------------------------------------------------------------- api
export const CSRF_KEY = "atalks_csrf", ACTOR_KEY = "atalks_actor", SID_KEY = "atalks_sid";

export let csrf = sessionStorage.getItem(CSRF_KEY) || null;

/** Token CSRF zmienia sie przy logowaniu i wylogowaniu, a modul, ktory go czyta,
 *  nie moze przypisywac cudzej zmiennej - stad jawny setter. */
export function setCsrf(v) { csrf = v; }

export async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-at-csrf"] = csrf;
  const res = await fetch(path, {
    method, headers, credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* np. 204 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------ slownik bledow
// Serwer mowi do AGENTA: podaje kody, nazwy tras i wprost sugeruje curl-a. To sa
// dobre komunikaty - dla programu. Czlowiek dostawal je surowe w toascie, ktory
// znikal po czterech sekundach ("nie ma konwersacji 12"). Tlumaczymy je tutaj,
// w JEDNYM miejscu: zdanie po polsku i, gdzie to ma sens, wskazanie nastepnego
// ruchu. Nieznany kod spada na tekst serwera - lepszy niz nic.
const BLEDY = {
  // dostep i tozsamosc
  csrf: "Sesja wygasła w tej karcie. Odśwież stronę i zaloguj się jeszcze raz.",
  sesja: "Twoja sesja już nie działa. Zaloguj się jeszcze raz.",
  token: "Token dostępu jest nieważny albo został odwołany.",
  brak_dostepu: "Nie masz dostępu do tej rozmowy. Poproś kogoś z uczestników, żeby Cię dodał.",
  brak_uprawnien: "Nie masz uprawnień do tej czynności. Poproś admina kanału albo admina instancji.",
  nie_admin: "To potrafi tylko admin instancji.",
  tylko_admin_czlowiek: "Panel „Konta i dostęp” jest dostępny tylko dla admina, który jest człowiekiem.",
  tylko_ludzie: "To działa tylko dla kont ludzi.",
  nie_autor: "Zmienić może tylko autor wpisu, admin kanału albo admin instancji.",
  nie_twoja_strona: "Skasować stronę może tylko jej autor albo admin instancji. Chcesz usunąć samą treść? Zapisz stronę pustą - historia zostanie.",
  nie_twoja_sesja: "Ta sesja należy do kogoś innego.",
  aktor_wylaczony: "To konto jest wyłączone. Admin może je włączyć z powrotem.",
  zle_haslo: "Nieprawidłowa nazwa albo hasło.",
  haslo_za_krotkie: "Hasło jest za krótkie. Wpisz dłuższe.",
  zle_zaproszenie: "Ten kod zaproszenia jest nieprawidłowy, zużyty albo wygasł. Poproś admina o nowy.",
  zaproszenie: "Nie ma takiego zaproszenia - mogło już zostać odwołane.",
  poswiadczenie: "Nie udało się użyć klucza z tego urządzenia. Wejdź hasłem.",
  // czego nie ma
  konwersacja: "Ta rozmowa już nie istnieje - mogła zostać zarchiwizowana.",
  wiadomosc: "Tej wiadomości już nie ma.",
  strona: "Nie ma takiej strony wiki.",
  rewizja: "Nie ma takiej wersji strony.",
  aktor: "Nie ma takiego konta.",
  pytanie: "Nie ma już takiego pytania.",
  plik: "Nie ma takiego pliku - mógł wygasnąć albo zostać spalony po odczycie.",
  nie_znaleziono: "Nie ma czegoś takiego.",
  skasowana: "Ta wiadomość została usunięta.",
  zarchiwizowana: "Ten kanał jest zarchiwizowany - nie przyjmuje już wiadomości.",
  // konflikty i reguly
  konflikt_wiki: "Ktoś zapisał tę stronę, zanim zdążyłeś zapisać swoją wersję.",
  cykl_wiki: "Nie da się umieścić strony pod jej własną podstroną - wybierz inne miejsce w drzewie.",
  kanal_istnieje: "Kanał o tej nazwie już istnieje. Wybierz inną nazwę.",
  handle_zajety: "Ta nazwa jest już zajęta. Wybierz inną.",
  slug_zarezerwowany: "Ta nazwa jest zarezerwowana przez system. Wybierz inną.",
  slug: "Nieprawidłowa nazwa. Użyj małych liter, cyfr, myślnika i kropki - bez spacji i polskich znaków.",
  juz_zamkniete: "To pytanie zostało już domknięte.",
  obcy_watek: "Ta odpowiedź należy do wątku z innej rozmowy.",
  dm_staly: "Rozmowy prywatnej nie da się zmienić w kanał.",
  dm_nie_znika: "Rozmowy prywatnej nie da się zarchiwizować.",
  nie_mozna_wyjsc: "Z rozmowy prywatnej nie da się wyjść.",
  nie_siebie: "Tego nie można zrobić samemu sobie.",
  za_malo_uczestnikow: "Wskaż przynajmniej jedną osobę do rozmowy.",
  brak_czlonkow: "Wskaż przynajmniej jedną osobę do rozmowy.",
  publiczny_sam: "Do otwartego kanału każdy dołącza sam - nie trzeba nikogo dopisywać.",
  nie_dla_rozmow: "Ta czynność nie dotyczy rozmów prywatnych.",
  // wejscie uzytkownika
  tresc_za_dluga: "Ta treść jest za długa. Skróć ją albo załącz jako plik.",
  tytul_za_dlugi: "Tytuł jest za długi - skróć go.",
  brak_tytulu: "Wpisz tytuł.",
  brak_nazwy: "Podaj nazwę.",
  puste_cialo: "Nie ma czego wysłać - wpisz treść.",
  pusty_plik: "Ten plik jest pusty.",
  brak_pliku: "Nie wybrano pliku.",
  emoji: "To nie jest poprawna reakcja.",
  zly_notify: "Nieznane ustawienie powiadomień.",
  zly_zasob: "Podaj nazwę zasobu, który chcesz zająć.",
  zly_rodzaj: "Nieznany rodzaj konta.",
};

// Zasoby zajete przez kogos innego (409 z /api/leases) nios w ciele kto i do kiedy -
// dlatego ten jeden przypadek sklada zdanie z danych, a nie z gotowego tekstu.
const STATUSY = {
  401: "Nie jesteś zalogowany. Odśwież stronę i zaloguj się jeszcze raz.",
  403: "Nie masz uprawnień do tej czynności.",
  404: "Tego już nie ma.",
  409: "Ktoś Cię wyprzedził - odśwież i spróbuj jeszcze raz.",
  413: "To jest za duże, żeby wysłać.",
  429: "Za dużo prób naraz. Odczekaj chwilę i spróbuj ponownie.",
  500: "Serwer się potknął. Spróbuj jeszcze raz, a jeśli wróci - powiedz adminowi.",
  502: "Serwer chwilowo nie odpowiada (pewnie trwa wdrożenie). Spróbuj za chwilę.",
  503: "Serwer chwilowo nie odpowiada (pewnie trwa wdrożenie). Spróbuj za chwilę.",
  504: "Serwer chwilowo nie odpowiada (pewnie trwa wdrożenie). Spróbuj za chwilę.",
};

/** Zdanie po polsku dla bledu z /api/*.
 *  @param e blad z api()
 *  @param kontekst nadpisania per miejsce wywolania, np. { slug: "Nieprawidłowy
 *         adres strony..." } - ten sam kod znaczy co innego przy kanale i przy wiki. */
export function opiszBlad(e, kontekst) {
  if (!e) return "Coś poszło nie tak.";
  if (kontekst && e.code && kontekst[e.code]) return kontekst[e.code];
  if (e.code && BLEDY[e.code]) return BLEDY[e.code];
  if (e.status && STATUSY[e.status]) return STATUSY[e.status];
  // Brak sieci: fetch rzuca TypeError bez statusu - to nie jest blad serwera.
  if (!e.status && !e.code) return "Brak połączenia z serwerem. Sprawdź sieć i spróbuj ponownie.";
  return e.message || "Coś poszło nie tak.";
}
