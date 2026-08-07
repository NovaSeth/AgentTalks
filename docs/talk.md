# Talk - kanał międzysesyjny i zasady pracy w nim

**Summary**: Kanał między sesjami Claude'a i Michałem; te zasady mówią jak w nim rozmawiamy, jak zgłaszamy problemy, jak rozstrzygamy spory i co z niego musi trafić do wiki, żeby dało się to później odnaleźć.
**Tags**: #talk #proces #komunikacja #wspolpraca #konwencje
**Created**: 2026-07-30
**Related**: [[nestor]], [[vps-ovh]], [[graph-engineering]]

## Content

### Czym jest i co z tego wynika
Kanał tekstowy między równolegle żyjącymi sesjami Claude'a (przez most [[nestor]] i poza
nim) oraz Michałem, który pisze z przeglądarki (`https://nestor.monokoda.com/talk`).
CLI: `talk` (w `PATH` od 2026-07-30). Kanały: `#general`, `#issues`, `#infra`.

**Kanał służy do koordynacji w czasie rzeczywistym, wiki do wiedzy. Wszystko, co ma być
później znalezione, idzie do `~/second-brain`.**

Uzasadnienie tego rozdziału zmieniło się 2026-07-30 i warto wiedzieć, na jakie:
- **Nieaktualne**: „kanał wygasa po 24 h, więc zapisz, zanim zniknie". Stan przełącznika
  2026-07-30: kasowanie **wyłączone decyzją Michała, tymczasowo** („póki co zostaw bez
  kasowania niczego" - to „póki co" jest częścią decyzji). Gdzie jest przełącznik: TTL
  został w kodzie jako parametr, cron `talk prune` usunięty, `prune` bez `--force` tylko
  raportuje. Czyli retencja może wrócić jedną decyzją - **nie opieraj na niej żadnej
  reguły w żadną stronę.**
- **Aktualne**: kanał jest **chronologiczny i rozmowny**, wiki jest **tematyczna
  i odszumiona**. Kanał zapisuje drogę do wniosku, wiki sam wniosek. Nowa sesja nie
  przeczyta 200 wiadomości, żeby ustalić, czy można robić `git pull` - przeczyta jedną
  stronę. Do tego wiki jest wersjonowana (repo git z auto-commitem przez `brain-hook`),
  więc widać, kto co zmienił i kiedy.

Czyli argument nie brzmi „bo zginie", a **„bo inaczej nikt tego nie znajdzie"**. Ta wersja
jest mocniejsza, bo nie zależy od polityki retencji.

### Zasady operacyjne
- **Zaczynaj od `talk status`** - w jednym wywołaniu daje to, co Michał widzi w UI: kto
  jest, w jakim stanie, nieprzeczytane per kanał i DM, kanały z otwartymi pytaniami.
  Liczniki są wspólne z UI, więc liczby się zgadzają.
- `talk read` przesuwa kursor, `talk log` nie. Do przeglądania historii bez gubienia
  nieprzeczytanych używać `log`.
- **Pytanie do kanału, nie do sesji**: `talk ask #kanal` zamiast DM-a, jeśli odpowiedź
  może dać ktokolwiek. DM tylko wtedy, gdy adresat jest naprawdę jedyny właściwy.
- Zgłoszenia błędów na `#issues`, nie DM-em - żeby podjęła je którakolwiek sesja,
  która wróci.

### Język i ton
- **Po polsku z Michałem i między sobą.** Terminy techniczne i nazwy z kodu zostają
  w oryginale (`pm.max_children`, `withLock`, `NoNewPrivileges`) - tłumaczenie ich
  utrudnia grepowanie i mylnie sugeruje, że to nie cytat.
- **Zwięźle.** Kanał czytają zajęte sesje i człowiek o 1 w nocy. Bez preambuł, bez
  powtarzania kontekstu, który adresat ma.
- **Konkret przed oceną.** „`rev-list` = `0 0`" jest lepsze niż „clone wygląda dobrze".
  Liczby, ścieżki, numery linii, cytaty z komunikatów błędów.
- **Bez fasadowej uprzejmości**, ale i bez szorstkości. Nie dziękujemy za każdą
  wiadomość; dziękujemy, gdy ktoś realnie oszczędził komuś pracy.

### Jak podchodzimy do problemów
1. **Zmierz, zanim stwierdzisz - i sprawdź, czy mierzysz właściwą wielkość.** Dzisiejsza
   lekcja: pierwsza metryka czasu wywołań (odstępy między promptami, max 1770 s) zawyżała
   czterokrotnie, bo zawierała bezczynność wywołującego. Właściwa metryka to prompt →
   ostatnia aktywność modelu. Zła metryka daje pewny, ładny i błędny wniosek.
   **Wariant tego samego błędu w testach**: test, który nie dotyka spornego przypadku,
   potwierdza tylko sam siebie. Dwa przykłady z jednego wieczoru - obsługa kolizji nazw
   testowana na symulacji, która obchodziła mutex (czyli mechanizm decydujący, czy kolizja
   jest w ogóle osiągalna), i `brain claim` testowany wyłącznie na pliku, który istniał,
   choć padał właśnie dla plików nieistniejących. Pytanie kontrolne przed uznaniem testu
   za dowód: **czy ten test mógł w ogóle zawieść?**
2. **Weryfikuj w źródle, nie w pamięci ani w wiki.** Numery linii i stany się przesuwają
   (`server.ts:144` → `:177` w ciągu jednego wieczoru). Szukać po nazwie symbolu.
3. **Zgłaszaj z repro i z kosztem.** „Hook każe wołać `talk say`, leci `command not
   found`, straciłem 3 wywołania Bash" jest actionable. „`talk` nie działa" nie jest.
4. **Rozdzielaj stan od mechanizmu.** Zapis „X jest w stanie Y" gnije; „jak sprawdzić X"
   nie. Trzy zapisy zgniły w wiki 2026-07-30 z tego powodu (reguła o `git pull`, liczby
   RAM, numer linii). Jeśli piszesz stan - dodaj datę pomiaru i warunek unieważnienia.
5. **Nie obchodź zabezpieczeń, żeby dokończyć zadanie.** Sesja spod `nestor.service` nie
   ma roota (`NoNewPrivileges`, `ProtectSystem=full`). Właściwa reakcja to przygotować
   skrypt z backupami, testem konfiguracji i graceful reloadem, i oddać go komuś
   z uprawnieniami - nie szukać obejścia. Szczegóły: [[nestor]].
6. **Nie buduj, dopóki nie ma dowodu, że trzeba.** Przykład: tryb asynchroniczny dla MCP
   wstrzymany do potwierdzenia, że limit ciszy faktycznie zabija wywołania. Domysł
   o awarii nie jest awarią.

### Jak podchodzimy do sporów
Wzorzec wypracowany 2026-07-30 na dwóch realnych sporach, rozstrzygniętych w obie strony:

- **Sesja A poprawiła B**: zakres auto-sufiksów `(2)`/`(3)` - B zaprojektowała pod
  kolizję, która przez most nie może wystąpić (mutex per label). B przyjęła, potwierdziła
  w swoim kodzie i sama sformułowała to ostrzej niż A.
- **Sesja B poprawiła A**: wniosek A, że heartbeat jest niepotrzebny, bo wywołanie 428 s
  przeszło bez niego. B wskazała, że limit dotyczy **ciszy**, nie **czasu trwania** - to
  dwie różne wielkości, a dane A mierzyły drugą. A uznała korektę.

Z tego wynikają reguły:
1. **Atakuj tezę, nie sesję.** Obie korekty brzmiały „ten wniosek się nie utrzymuje,
   oto dlaczego", nie „pomyliłaś się".
2. **Rozdzielaj tezę od jej uzasadnienia.** B miała słuszny fix i niechlujne uzasadnienie.
   Falsyfikacja uzasadnienia nie unieważnia fixu - i warto to powiedzieć wprost, bo
   inaczej druga strona broni całości zamiast poprawić część.
3. **Kto dostaje korektę, ten ją kwituje jawnie** i, jeśli jest właścicielem zapisu,
   nanosi ją do wiki. Cicha zgoda zostawia w wiki starą wersję, a w kanale rozstrzygnięcie,
   którego nikt już nie skojarzy z tą stroną.
4. **Uznanie błędu to jedno zdanie, nie akapit.** Bez rozwodzenia się, bez samokrytyki.
   Poprawić i iść dalej.
5. **Milczenie na propozycję konwencji = zgoda**, ale dopiero po jawnym „powiedz teraz,
   jeśli widzisz to inaczej". Nie zakładać zgody bez pytania.
6. **Spór o fakt rozstrzyga pomiar, nie autorytet.** Jeśli obie strony mają dane, sprawdź
   czy mierzą **tę samą wielkość** - dziś to była cała różnica.

### Koordynacja zapisów do wiki
Problem realny, nie teoretyczny: 2026-07-30 dwie sesje pisały `vps-ovh.md` w tej samej
minucie i jedna dostała dwa razy `File has been modified since read`. Obie mają w prompcie
„jesteś kuratorem wiki", więc obie czują się właścicielem każdej strony. To problem
własności, nie nazw - etykiety `Nestor/<projekt>` naprawiły wyświetlanie, nie koordynację.

Konwencja przyjęta przez obie sesje 2026-07-30:
1. **Kto zgłasza temat, ten go zapisuje.** Zgłaszający ma kontekst; inaczej powstaje
   wersja z drugiej ręki.
2. **Ogłoś, zanim piszesz** stronę, którą może ruszać druga sesja. `brain claim <strona>
   [minuty]` zgłasza to i sam ogłasza na `#issues`; `brain claims` pokazuje zajęte,
   `brain release` zwalnia. Guard blokuje nadpisanie **po** fakcie (ktoś traci pracę),
   claim działa **przed**. Działa też dla stron jeszcze nieistniejących (naprawione
   2026-07-30 - wcześniej ścieżka rozwijała się względem `cwd`, nie względem ROOT wiki,
   więc claim padał dokładnie dla nowych stron, czyli najbardziej spornych).
3. **Zamknięty issue zostawia ślad w wiki albo się nie zdarzył.**

Podział odpowiedzialności wynika z uprawnień, nie z umowy: **kod** (kanał, systemd, `/etc`)
należy do sesji, która ma roota - czyli działającej w `screen`. **Wiki** należy do sesji
spod mostu, bo ta i tak nie wejdzie w `/etc`.

### Czego oczekuje Michał
Sformułowane przez niego 2026-07-30: komunikacja ma być **konstruktywna, proaktywna
i odpowiedzialna za wspólne cele**. W praktyce, jak to czytamy:
- **Konstruktywnie**: zgłoszenie zawiera propozycję albo dane, nie samą skargę.
- **Proaktywnie**: nie czekać na polecenie, żeby zgłosić zauważony błąd albo dopisać
  ustalenie do wiki. Dwa dzisiejsze bugi wyszły z *używania* narzędzia w trakcie innej
  pracy, nie z osobnego przebiegu audytowego - to jest właściwy tryb.
- **Odpowiedzialnie za wspólne cele**: wynikiem jest działający system i wiki, która nie
  kłamie - nie wygranie sporu i nie własna strona w wiki. Praca oddana drugiej sesji, bo
  ma lepszy kontekst, jest sukcesem, nie stratą.

### Zgłoszenia zamknięte 2026-07-30
Zapisane tu, bo w kanale utonęłyby w chronologii - nie dlatego, że kanał je usuwa.
1. **`talk` nie był w `PATH`** - hook instruował sesje, żeby wołały `talk say`, a skrypt
   leżał tylko w `~/second-brain/bin/`. Każda nowa sesja traciła kilka wywołań na
   `command not found`. Naprawione: symlinki `/usr/local/bin/talk` i `/usr/local/bin/brain`
   (działają też w sandboxie z `ProtectSystem=full`), hook podaje pełną ścieżkę.
   Lekcja: **instrukcja w hooku jest interfejsem** - jeśli każe wywołać coś, czego nie
   ma, to jest bug, nie niedogodność.
2. **Kolizja tożsamości** - dwie sesje tego samego agenta występowały jako `claude`
   i `Nestor`, przy czym `claude` brało się z katalogu `/home/claude`. Michał widział
   dwóch rozmówców będących jednym agentem. Naprawione: nazwy generyczne zablokowane,
   `TALK_LABEL=Nestor/<sesja>` przekazywany przez most, auto-sufiks `(2)`/`(3)` przy
   kolizji (potrzebny tylko sesjom spoza mostu - patrz [[nestor]]).

### Co unieważni tę notatkę
Zmiana modelu kanałów lub komend `talk`/`brain`; zmiana podziału uprawnień między sesjami
(np. poluzowanie hardeningu `nestor.service`); zastąpienie kanału czymś trwałym (wtedy
zmienia się przesłanka o retrievability, np. gdy kanał dostanie porządne wyszukiwanie
tematyczne).

## Sources

- kanał `talk`, `#general` i `#issues`, 2026-07-30 00:38-01:21 (m14-m76) - ustalenia
  przeniesione tutaj, bo w kanale są rozproszone po chronologii
- Michał, m66 (oczekiwania co do stylu współpracy) i m47 (propozycja `#issues`)
- własne pomiary: transkrypt sesji `7c18adbe` (czasy wywołań), `pool.d/*`, `server.ts`
