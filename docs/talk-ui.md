# Talk - interfejs webowy

**Summary**: Webowy widok kanału [[talk]] pod `nestor.monokoda.com/talk`, serwowany z dysku przez Express Nestora; każda funkcja ma odpowiednik w CLI, a klasy błędów mobilnych są pilnowane linterem, bo nie ma tu przeglądarki do sprawdzenia.
**Tags**: #talk #ui #nestor #mobile #testowanie
**Created**: 2026-07-31
**Related**: [[talk]], [[nestor]], [[vps-ovh]], [[pulapki-testowania]]

## Content

### Gdzie to jest i jak działa
- Adres: `https://nestor.monokoda.com/talk`, basic auth w Apache (`/etc/apache2/.htpasswd-talk`).
  Hasło w `~/.talk-credentials` (600). `/mcp` zachowuje swój bearer i 404 bez tokenu.
- Plik: `~/workspace/nestor/public/talk.html` - jeden plik, zero zależności, zero build stepu.
- Serwowany przez `res.sendFile` przy każdym żądaniu, **wprost z dysku**.

**Konsekwencja, o której trzeba pamiętać przy każdej edycji: plik w połowie zapisu jest
natychmiast na produkcji.** Dwa razy to ugryzło (2026-07-30 grid bez markupu, 2026-07-31
JavaScript wstawiony do bloku `<style>`). Zysk: zmiana widoczna po odświeżeniu, bez
przebudowy. Gdyby korzystał z tego ktoś jeszcze, trzeba by zapisu atomowego (tmp + rename).

### Zasada nadrzędna: parytet z CLI
**Michał widzi UI, sesje mają tylko tekst.** Interfejs nie może wiedzieć o kanale więcej
niż jego uczestnicy - inaczej człowiek i sesje pracują na różnym obrazie tej samej rzeczy.
Każda funkcja UI ma odpowiednik w `bin/talk`:

| UI | CLI |
|---|---|
| liczniki nieprzeczytanych | `talk unread`, `talk seen` |
| pasek zdrowia maszyny | `talk health` |
| podsumowanie nieobecności | `talk since` |
| wzmianki, szukanie, przypinanie | `talk mentions`, `talk search`, `talk pin` |
| cały obraz kanału | `talk status` |

Liczniki czytają **te same pliki znaczników** (`~/.talk/read/<sid>/`), co `/talk/api/read` -
jedno źródło prawdy, nie dwie implementacje.

### Semantyka, która nie jest oczywista
- **Pogrubienie ≠ plakietka.** Pogrubiona nazwa kanału = jest coś nowego. Numerowana
  plakietka = dotyczy CIEBIE (wzmianka albo DM). To rozróżnienie ze Slacka; numer na
  wszystkim spłaszcza hierarchię i przestaje cokolwiek znaczyć.
- **`pisze…` ≠ `pracuje`.** Pierwsze to człowiek stukający w klawiaturę (sygnał z UI,
  gaśnie po 7 s). Drugie to sesja, która użyła narzędzia (sygnał z hooka `PostToolUse`,
  gaśnie po 30 s). Sygnał „pracuje" **musi** pochodzić z użycia narzędzia, nigdy
  z pollowania API - inaczej otwarta karta przeglądarki udaje pracę.
- **Efemerydy znikają szybko.** Sesja, która kończy się sama i do której nie da się wrócić
  (one-shot mostu, wcielenie subagenta), jest martwa po ~60 s ciszy. Sesja nazwana zostaje
  jako „cisza", bo do niej można wrócić. Rodzaj deklaruje się przez `TALK_KIND`,
  nazwa jest tylko awaryjnym rozpoznaniem.

### Mikro animacje - każda niesie informację
Wprowadzone 2026-07-31 na prośbę Michała. Reguła: animacja bez znaczenia to szum.

| animacja | co komunikuje |
|---|---|
| wsunięcie wiadomości | przyszła PO tym, jak otworzyłeś widok |
| skok plakietki | licznik **wzrósł teraz**, nie tylko jest > 0 |
| puls reakcji | Twoje kliknięcie odpowiedziało przed serwerem |
| pulsowanie „wysyłam" | wysłane, jeszcze niepotwierdzone (wysyłanie optymistyczne) |

Wszystkie gasną przy `prefers-reduced-motion`. Wibracja tylko przy wzmiance lub DM -
przy każdej wiadomości byłaby karą za czytanie kanału, nie sygnałem.

### Pięć klas błędów mobilnych, wszystkie zgłoszone przez człowieka
Ani jednej nie znalazłem sam. Cztery pierwsze zgłosił Michał z telefonu w 20 minut,
gdy ja w tym czasie weryfikowałem `curl`-em i nazywałem to testowaniem interfejsu.

1. **`100vh` na Safari mobilnym jest WIĘKSZE niż widoczny obszar** → nagłówek pod status
   barem, gdzie tapnięcia łapie system, nie strona. Naprawa: `100dvh` w `@supports`.
2. **Autozoom iOS** przy `font-size < 16px` na polu → zoom czyni dokument szerszym od
   ekranu i ucina wszystko po prawej. Jedyna obrona to rozmiar czcionki.
3. **`display:none` na nawigacji** poniżej 700 px → na telefonie nie da się zmienić kanału.
   Nawigacja ma być szufladą, nie usunięta.
4. **`flex:1` + `overflow-y:auto` bez `min-height:0`** → element nie zejdzie poniżej
   wysokości treści i rozepcha stronę zamiast przewijać się w środku.
5. **Kod w niewłaściwym bloku** (JS w `<style>`) → cały interfejs nie startuje. Ten jeden
   był mój, znaleziony przez porównanie bloków, nie przez sprawdzenia, które przechodziły.

### Czym to jest pilnowane i czego NIE sprawdza
`scripts/lint-ui.py` - dziesięć sprawdzeń, wszystkie z **testem wstecznym** (celowo psuje
się kopię i sprawdza, czy linter krzyknie). Poza pięcioma powyżej łapie też: brak
`safe-area-inset` przy `viewport-fit=cover`, JS odwołujący się do nieistniejącego `#id`,
handler na `data-*`, którego nic nie generuje, niezbalansowane nawiasy w CSS, oraz
funkcję wołaną, a nigdzie niezdefiniowaną (to najgroźniejsza cicha awaria - wywala CAŁY
interfejs, nie fragment).

`bin/verify` uruchamia to razem ze składnią JS, buildem TS i 53 testami, i **stoi na
drodze wdrożenia**, a nie obok - bo sprawdzenie, które nie blokuje, jest dokumentacją
intencji.

**CZEGO LINTER NIE SPRAWDZA: jak to wygląda.** Nie zastąpi spojrzenia na urządzeniu.
Sprawdza, czy nie ma ZNANYCH pułapek - nie czy interfejs jest dobry. Wszystkie pięć klas
powstało dlatego, że ktoś patrzył; linter tylko pilnuje, żeby nie wróciły.

**Chromium jest niewykonalny na tym boxie** (273 MB dysku, 200–400 MB RAM przy ~690 MB
wolnego) - potwierdzone niezależnie przez sesję `bs/wykonalnosc` 2026-07-30. To decyzja
Michała, świadomie nie podjęta w nocy.

### Co unieważni tę notatkę
Dodanie build stepu (znika ryzyko pliku w połowie edycji), instalacja przeglądarki
(znika ograniczenie o weryfikacji wizualnej), zmiana sposobu serwowania z `sendFile`
na statyk Apache'a. Liczby o zasobach to snapshot z 2026-07-31 - sprawdzaj `talk health`.

## Sources

- `~/workspace/nestor/public/talk.html`, `scripts/lint-ui.py`, `scripts/deploy-ui.sh`
- `~/second-brain/bin/talk`, `bin/verify`, `tests/test-talk.sh`
- zgłoszenia Michała ze zrzutów z iPhone'a, 2026-07-30 01:20–01:44
- [[talk]] (zasady kanału), [[pulapki-testowania]] (dlaczego weryfikacja zawodzi)
