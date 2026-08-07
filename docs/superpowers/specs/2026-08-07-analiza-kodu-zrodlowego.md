# Analiza kodu wyjsciowego pod AgentTalks (stan 2026-08-07)

Przedmiot: `cli/talk` (1095 l.), `nestor/src/server.ts` (639 l.), `nestor/public/talk.html`
(848 l.), `cli/talk-hook`, `cli/talk-file`, `cli/talk-lock.py`, `docs/`, snapshot `data/`
(413 wiadomosci, 6 kanalow, 12 rozmowcow, 32 pliki).

Cel: ustalic, co z tego przeniesc do **AgentTalks** - serwera/demona instalowanego na
dowolnej maszynie, obslugujacego wielu agentow i wielu ludzi.

Nazewnictwo: nazwy `talk` i `Nestor` wystepuja tu wylacznie jako odniesienia do
istniejacego kodu. Produkt nazywa sie **AgentTalks**; Nestor bedzie w nim co najwyzej
jednym z podlaczonych agentow, nie czescia architektury.

---

## 1. Czym to dzis jest

Dzialajacy prototyp Slacka dla agentow, ale **zbudowany jako osobisty hack na jedna maszyne
i jednego czlowieka**. Model domenowy jest w duzej mierze trafny; substrat (magazyn,
tozsamosc, transport, wdrozenie) nie nadaje sie na produkt.

```
Apache (basic auth /talk, bearer /mcp)
   \_ Express 127.0.0.1:8787 (nestor.service, User=claude)
        |- GET /talk       -> res.sendFile(public/talk.html)  [z dysku, przy kazdym zadaniu]
        |- /talk/api/*     -> ODCZYT: parsuje ~/.talk/* wprost
        |                     ZAPIS:  execFile("/home/claude/second-brain/bin/talk", ...)
        \_ /mcp            -> MCP Streamable HTTP -> Claude Agent SDK query()
~/.talk/
   channel.jsonl        wszystkie wiadomosci, wszystkich kanalow i DM-ow, jeden plik
   presence/<sid>       JSON: label, kind, cwd, seen, doing, watch
   cursor/<sid>         int: indeks w channel.jsonl
   read/<who>/<view>    int: ms ostatniego odczytu
   typing/<sid>         mtime = sygnal "czlowiek stuka" (TTL 7 s)
   busy/<sid>           mtime = sygnal "sesja uzyla narzedzia" (TTL 30 s)
   pins/<mid>, files/<fid>__<nazwa>, locks/<zasob>/meta.json
```

---

## 2. Co jest dobre i MUSI przetrwac przepisanie

Najwazniejsza czesc analizy. Te decyzje kosztowaly realne pomylki i sa zapisane
w komentarzach razem z geneza, lacznie z wycofanymi uzasadnieniami - rzadka rzecz.

| Decyzja | Gdzie | Dlaczego zostaje |
|---|---|---|
| **Parytet CLI - UI** | `docs/talk-ui.md:21`, `talk status` vs `/talk/api/state` | Czlowiek nie moze widziec kanalu lepiej niz jego uczestnicy. Jedyna regula, ktora przez caly kod trzyma spojnosc. |
| **`typing` nie rowna sie `busy`** | `cli/talk:31-36`, `talk-hook:56-59` | Czlowiek stukajacy w klawiature i agent wykonujacy narzedzie to dwa rozne stany. Sygnal "pracuje" **musi** pochodzic z `PostToolUse`, nigdy z pollowania API - inaczej otwarta karta udaje prace. |
| **Efemeryda vs sesja trwala**, deklarowana (`TALK_KIND`), nie zgadywana | `cli/talk:118-148` | One-shot konczy sie sam; pokazywanie go jako zywego 10 min po smierci wprowadza w blad. Heurystyka po nazwie zostala jawnie zdegradowana do fallbacku. |
| **Pogrubienie nie rowna sie plakietka** | `talk.html:485-487` | Pogrubienie = "cos nowego", plakietka = "dotyczy CIEBIE" (wzmianka/DM). Numer na wszystkim splaszcza hierarchie. |
| **Pytanie do KANALU, nie do sesji** (`ask`/`answer`/`open`) | `cli/talk:317-329` | Wlasciwy prymityw dla agentow, ktorzy przychodza i odchodza. Podejmie ktokolwiek, kto wroci. |
| **Znaczniki odczytu po stronie serwera** | `cli/talk:448-467` i `server.ts:436-466` | Ten sam licznik na telefonie i na laptopie, przezywa zamknieta karte. Wspolne pliki, nie dwie implementacje. |
| **Digest / `since`** | `cli/talk:578-609`, `talk.html:369-401` | Odpowiada na "przegapilem cos waznego?", a nie wysypuje 241 wiadomosci. |
| **Jedno miejsce zapisu formatu rekordu** | `server.ts:499-505` | Intencja sluszna (jedna implementacja locka i formatu), mechanizm zly (patrz 3.6). |
| **Zero-build UI** | `public/talk.html` | Wdrozenie = skopiowanie pliku. Ma wade (3.9), ale wartosc jest realna. |
| **Animacja bez znaczenia to szum** | `talk.html:78-97` | Kazda z czterech animacji koduje inny fakt. |
| **Piec klas bledow mobilnych + linter wsteczny** | `docs/talk-ui.md:63-92`, `scripts/lint-ui.py` | `100dvh`, 16 px na inputach, szuflada zamiast `display:none`, `min-height:0`, kod w zlym bloku. Wszystkie zgloszone przez czlowieka z telefonu. Linter testuje sam siebie psujac kopie. |
| **Weryfikacja stoi NA DRODZE wdrozenia** | `scripts/deploy-ui.sh:3-6` | "Sprawdzenie, ktore nie blokuje, jest dokumentacja intencji". |

---

## 3. Co blokuje bycie produktem

### 3.1 Tozsamosc jest zgadywana, nie uwierzytelniana

`sid()` (`cli/talk:61-82`): `TALK_SID`, potem `CLAUDE_CODE_SESSION_ID`, potem **PID dziadka
plus starttime z `/proc`**. Etykieta wyprowadzana z `basename(cwd)` z czarna lista nazw
generycznych (`GENERIC`, linia 99) i auto-sufiksem `(2)`/`(3)` przy kolizji
(`unique_label`, 151-176).

Konsekwencje:
- **Kazdy proces majacy dostep do katalogu moze byc kimkolwiek.** `server.ts:500-505` robi
  to jawnie: `execFile(TALK_BIN, args, {env: {TALK_SID: asSid}})` - podszycie jako API.
  Linia 600 posyla odpowiedz **jako sesja docelowa**, nie jako nadawca.
- **`/proc` czyni CLI wylacznie linuksowym.**
- **DM-y adresowane po etykiecie** (`post(..., to=rest[0])`, `read_new` linia 634:
  `to not in (me, short(me), label_of(me), "all")`). Zmiana nazwy albo doklejony sufiks
  `(2)` **zrywa routing i rozjezdza historie**.
- Nie ma pojecia "ten sam agent, dwie rownolegle sesje" - jest albo kolizja, albo sufiks.

### 3.2 Brak autoryzacji w warstwie aplikacji

`server.ts:346-348` mowi to wprost: `/talk/api/*` **nie ma zadnego sprawdzenia**, bo
przegladarka nie wysle bearera; cale bezpieczenstwo to basic auth w Apache plus bind na
127.0.0.1. Do tego `MICHAL_SID = "michal"` (linia 353) jest **wpisany na sztywno** - kazde
zadanie z UI jest Michalem. Wielu ludzi jest strukturalnie niemozliwych.

### 3.3 "Wiadomosc do wielu" nie istnieje

Model wiadomosci ma `chan` **albo** `to` (jedna etykieta). Nie ma:
- grupowego DM-u (3+ uczestnikow poza kanalem publicznym),
- watkow (odpowiedz na wiadomosc),
- edycji i kasowania wiadomosci,
- kanalow prywatnych - kazdy kanal widza wszyscy (`channels()` zwraca sume z historii
  i z `watch` wszystkich sesji, `cli/talk:340-355`).

To jest wprost jeden z wymaganych punktow i dzis go nie ma.

### 3.4 `watch` nie wplywa na dostarczanie

`read_new()` (`cli/talk:616-638`) filtruje cudze DM-y, ale **nie filtruje po kanalach** -
hook dostarcza do kontekstu ruch ze WSZYSTKICH kanalow. `watch` steruje tylko
wyswietlaniem (`talk who`, lista kanalow). Deklaracja zainteresowania jest dekoracyjna.

### 3.5 Zlozonosc: kwadratowa na odczycie, liniowa pod globalnym lockiem na zapisie

- `load_all()` parsuje **caly** `channel.jsonl` przy kazdym wywolaniu.
- `fmt()` (linia 434) wola `reactions(mid)`, a `reactions()` wola `load_all()` ->
  **`talk log 20` = 20 pelnych parsowan pliku**. Dla `kind=react` dochodzi kolejne
  `load_all()` w linii 424.
- `post()` (276-305) bierze globalny `flock`, po czym **parsuje caly plik**, zeby wyliczyc
  `max(mid)` i `max(qid)`. Zapis jest O(n) pod blokada globalna dla calego systemu.
- `unread_counts()` (469-487): kanaly razy wiadomosci plus sesje razy wiadomosci.
- `search()`, `mentions_of()`: skan podlancuchowy po calej historii.
- `channels()`: skan historii plus wszystkie pliki obecnosci.
- `talk status` wola kilka z nich pod rzad.

Przy 413 wiadomosciach to niewidoczne. Przy 50 000 kanal przestaje dzialac.

### 3.6 Zapisy z serwera przez `execFile` na Pythona

`talkPost()` (`server.ts:500-505`) startuje proces Pythona na **kazda** wiadomosc, reakcje,
`ping`, `typing`. Przy `/talk/api/state` wolanym co 2,5 s to proces Pythona co 2,5 s tylko
po to, zeby dotknac jednego pliku (linia 515). Intencja (jedna implementacja locka
i formatu) jest sluszna - mechanizm nie.

### 3.7 Transport: polling pelnej historii

`talk.html:677`: `fetch("/talk/api/state?since=0")`. **`since` jest zaimplementowane na
serwerze** (`server.ts:512`, `all.slice(since)`), ale klient zawsze wysyla 0. Co 2,5 s leci
cala historia (dzis 380 KB), po czym:
- `talkPresence()` jest wolane **trzy razy w jednym zadaniu** (`server.ts:527, 531, 538`),
  a kazde robi `readdir` plus `statSync` po `presence/`, `typing/` i `busy/`;
- klient robi pelny re-render, `reactMap()` (438-449) skanuje wszystkie wiadomosci,
  wyszukiwanie filtruje cala historie po stronie klienta (`talk.html:591-594`).

Dla agentow jedyny mechanizm push to hook `PostToolUse`, czyli **agent bezczynny nie
dostaje nic**. Jedyne realne obudzenie to `mode=task` (`server.ts:594-606`), ale dziala
wylacznie dla sesji mostu i odpowiada podszywajac sie pod cel.

### 3.8 Przywiazanie do jednej instalacji

Sciezki na sztywno: `TALK_BIN = "/home/claude/second-brain/bin/talk"` (`server.ts:351`),
`WORKDIR` domyslnie `/home/claude`, `SAMPLE_LOG = ~/lowmem-sample.log`. Pasek zdrowia
maszyny (`talkHealth`, 473-497 plus `talk.html:407-427`) pokazuje **workery php-fpm i RAM
tego konkretnego VPS-a**. Blokada nazw generycznych zawiera `"claude"`, bo katalog nazywa
sie `/home/claude`. UI jest po polsku, z `meLabel ?? "Michal"`.

### 3.9 Serwowanie z dysku bez zapisu atomowego

`server.ts:507-509` robi `res.sendFile` przy kazdym zadaniu - **plik w polowie zapisu jest
natychmiast na produkcji**. Ugryzlo dwa razy (`docs/talk-ui.md:16-19`). Obejscie
(`deploy-ui.sh`) istnieje, ale ryzyko jest wpisane w architekture.

### 3.10 Pliki: dwa niezalezne, niekompletne mechanizmy

- `talk send-file` / `talk files` / `talk get-file` (`cli/talk:396-413, 1030-1086`) -
  magazyn `~/.talk/files/`, dostepny **tylko z CLI na serwerze**. **UI nie ma ani
  wysylania, ani pobierania**; wiadomosc `kind=file` renderuje sie jako zwykly tekst
  "nazwa (rozmiar)", bez linku.
- `cli/talk-file` - zupelnie inna usluga: `szkolenia.monokoda.com/drop`, token
  `/opt/talkdrop/token`. Nie ma wspolnego z kanalem nic poza nazwa.

### 3.11 Drobniejsze, ale realne

- **Czytelnicy nie biora locka.** `talkMessages()` (`server.ts:360-369`) i `load_all()`
  lapia wyjatek parsowania i **po cichu pomijaja linie**. Urwana linia to wiadomosc, ktora
  znika bez sladu w logu.
- **`prune --force`** (`cli/talk:696-725`) przycina kursory, ale znaczniki odczytu i piny
  wskazuja dalej na skasowane `mid`.
- **Reakcje sa wiadomosciami** w tym samym logu, wiec filtr `NOISE` powtarza sie w trzech
  miejscach (`cli/talk:472`, `server.ts` posrednio, `talk.html:332`).
- **Optymistyczne wysylanie** deduplikuje po tresci (`talk.html:585`), wiec dwie identyczne
  wiadomosci z rzedu chwilowo sie zlewaja.
- **Brak limitu rozmiaru wiadomosci w CLI**; serwer ma `express.json({limit:"4mb"})`.
  Brak rate limitu gdziekolwiek.
- **`mode=task`** ucina odpowiedz na 1500 znakach (`server.ts:599`).
- **`talk-lock.py`** (dzierzawa zasobu z TTL, atomowa przez `os.mkdir`) to dobry,
  samodzielny prymityw, dzis zupelnie poza serwerem i poza UI. Nadaje sie do wciagniecia
  jako funkcja produktu ("zajmij zasob"), bo koordynacja agentow to dokladnie ten problem.

---

## 4. Wniosek

**Model domenowy zostaje, substrat wymienic w calosci.**

Do przeniesienia bez zmian: parytet CLI-UI, `typing`/`busy`, efemeryda/trwala,
pogrubienie/plakietka, `ask`/`answer` do kanalu, serwerowe znaczniki odczytu, digest,
regula o animacjach, piec klas bledow mobilnych plus linter, weryfikacja blokujaca
wdrozenie.

Do wymiany: tozsamosc (zgadywana -> uwierzytelniana tokenem), autoryzacja (obwodowa ->
per-aktor), magazyn (JSONL plus katalogi znacznikow -> SQLite z indeksami), transport
(polling calej historii -> SSE plus long-poll), zapisy (`execFile` na Pythona -> wywolanie
w procesie), dostarczanie do agentow (hook `PostToolUse` -> subskrypcje plus wake),
instalacja (sciezki `/home/claude` -> konfiguracja plus `npm i -g` plus unit systemd).

Do dodania, bo wymagane a nie istnieje: grupowe DM-y, watki, kanaly prywatne, pliki w UI,
wielu ludzi.
