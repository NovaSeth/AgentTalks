# Nestor (most MCP na VPS)

**Summary**: Persystentny agent na VPS, wywoływany przez `ask_nestor` z lokalnego Claude Code; ciągłość pamięci ma per label sesji, a nie globalnie.
**Tags**: #nestor #mcp #claude-code #architektura #vps
**Created**: 2026-07-29
**Related**: [[vps-ovh]], [[graph-engineering]], [[motowolt]]

## Content

### Czym jest
Most MCP owijający Claude Agent SDK, dzięki któremu lokalny Claude Code (laptop, telefon)
może delegować zadania do agenta żyjącego na VPS. Nazwę "Nestor" wybrał sobie sam agent,
który go zbudował.

- Endpoint: `https://nestor.monokoda.com/mcp` (MCP Streamable HTTP, stateless), Bearer token.
- Stack: TypeScript, `@anthropic-ai/claude-agent-sdk` + `@modelcontextprotocol/sdk`,
  Express na `127.0.0.1:8787`, za istniejącym reverse proxy Apache, cert Let's Encrypt.
- systemd unit `nestor`, user `claude`. Kod i pełne docs: `~/workspace/nestor/`.
- Auth do Anthropic: subskrypcja Claude Max (CLI na VPS jest zalogowany), nie API key.
- Bez ważnego tokenu **każda** ścieżka zwraca 404 (odporność na discovery); `/health` tylko localhost.
- Narzędzia: `ask_nestor(prompt, context?, session?, reset?)` i `nestor_sessions`.
- Nestor jest kuratorem tego wiki - trwała wiedza między wywołaniami żyje w `~/second-brain`.

### Jak działa ciągłość (kluczowe, sprawdzone empirycznie 2026-07-29)
Nestor **nie jest demonem z jednym wspólnym streamem**. Claude Code to proces na sesję,
każda z własnym ID i własnym transkryptem. Ciągłość powstaje tak:

- `session: <label>` → SDK `resume` istniejącej sesji. Mapa label→sessionId w
  `~/workspace/nestor/sessions.json`. Brak labela = one-shot, kontekst ginie.
- Snippet klienta (`~/workspace/nestor/client/`, wstrzykiwany w `~/.claude/CLAUDE.md`
  między markerami `<!-- NESTOR:START/END -->`) każe lokalnemu Claude'owi **automatycznie**
  podawać `session` = basename katalogu projektu. Dlatego każdy projekt ma własny ciągły wątek.

Wniosek praktyczny: **jest jeden stream, ale należy do projektu, nie do maszyny.** Wejście
z tym samym labelem = ten sam wątek. Wejście inaczej (np. sesja Claude Code odpalona na VPS
bezpośrednio, przez czat/mobile) = wątek obok, niewidoczny dla Nestora i vice versa.
Potwierdzone: 2026-07-29 sesja czatowa nie widziała diagnostyki zasobów zleconej równolegle
przez `ask_nestor` do labela `motowolt`, mimo tej samej maszyny i tych samych 20 minut.

### Co jest współdzielone, a co nie
- **Nie**: konteksty. Izolacja jest własnością bezstanowego API, nie harnessa - żaden trik
  po stronie Claude Code jej nie zniesie.
- **Tak**: system plików. To jedyny realny kanał między sesjami. Transkrypty leżą jako
  `.jsonl` w `~/.claude/projects/<projekt>/`, a trwała wiedza w `~/second-brain`.
  Konsolidacja wiedzy między sesjami musi iść tą drogą (patrz [[graph-engineering]]).

### Uprawnienia: zdalny Nestor NIE ma roota (zweryfikowane 2026-07-29)
Kluczowe ograniczenie operacyjne, łatwe do przeoczenia, bo user `claude` **jest** w grupie
`sudo`. Unit `nestor.service` ma:

```
User=claude
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true
```

Skutki dla agenta zrodzonego przez `ask_nestor`:
- `NoNewPrivs: 1` w `/proc/self/status` → bit setuid na `/usr/bin/sudo` jest ignorowany.
  `sudo` zwraca `The "no new privileges" flag is set`. **Flag jest z założenia kernela
  nieodwracalny w obrębie procesu** - nie da się go zdjąć ani sobie, ani dzieciom, nawet
  mając roota.
- `ProtectSystem=full` montuje `/etc` i `/usr` jako `ro,nosuid` w namespace procesu →
  zapis do `/etc/**` zwraca `Read-only file system` **nawet dla roota**. `nosuid` na `/usr`
  to zresztą druga, niezależna przyczyna porażki `sudo`.
- `systemctl reload <cokolwiek>` → `Interactive authentication required` (polkit).

To trzy **niezależne** blokady. Potwierdzenie "masz uprawnienia admina" od Michała nic nie
zmienia, bo problem nie jest w polityce sudoers.

**Wzorzec pracy**: zdalny Nestor diagnozuje i przygotowuje gotowy skrypt z backupami,
testem konfiguracji i graceful reloadem; wykonuje Michał po SSH (user `debian`, NOPASSWD
sudo) albo sesja Claude Code odpalona lokalnie na boxie. Sprawdziło się przy tuningu
php-fpm 2026-07-29 (patrz [[vps-ovh]]) - z jedną poprawką, bo Nestor nie mógł
przetestować `php-fpm -t` u siebie.

Poluzowanie tego hardeningu jest możliwe (`ReadWritePaths=/etc/php`, `sudoers.d`
z `NOPASSWD` na białą listę komend), ale **nie warto dawać szerokiego roota**: serwis jest
wystawiony na publiczny HTTPS i wykonuje instrukcje przychodzące przez sieć.

### Pamięć: `~/second-brain` to jedyny pewny kanał
Katalog pamięci Claude Code zależy od **cwd w momencie startu sesji**. Nestor startuje
agenta z `NESTOR_HOME=/home/claude`, więc ładuje `~/.claude/projects/-home-claude/memory/`
- a ten katalog jest **pusty** (stan 2026-07-30). Notatka pamięciowa o Nestorze została
kiedyś zapisana z cwd `~/workspace`, więc wylądowała w
`~/.claude/projects/-home-claude-workspace/memory/` i jest dla zdalnego Nestora
**nieczytelna przy starcie** - osierocona, nie utracona.

**Dlatego trwałą wiedzę zapisywać do `~/second-brain`, nie do katalogu pamięci.** Wiki jest
wskazana w system prompcie Nestora, więc jest niezależna od cwd. Jeśli katalog pamięci ma
działać, trzeba go zsymlinkować albo zmienić `NESTOR_HOME` - do decyzji Michała.

### Koszt zasobowy i współbieżność
- Każde wywołanie `ask_nestor` startuje osobny proces `claude` (SDK). Procesy są
  **transientne** - kończą się po wywołaniu, potwierdzone obserwacją.
- Persystentny `node dist/server.js` to ~35 MB. Tani, ma zostać.
- **Zweryfikowane w źródle**: `src/server.ts:177` woła `withLock('sess:' + session)` (helper
  w linii 79) - klucz blokady zawiera label, więc wywołania z **różnymi** labelami idą
  równolegle i nie ma żadnego globalnego limitu współbieżności.
  Numery linii sprawdzone 2026-07-30; wcześniej było `:144` / `:76-90`, kod się przesunął
  przy dodaniu `TALK_LABEL`. Szukać po nazwie `withLock`, nie po numerze.

### Semantyka labeli: jeden label = jeden wątek, szeregowo
Konsekwencja dwóch mechanizmów razem, warta zapisania bo nieoczywista:
- `sessions.json` mapuje label na **jeden** `sessionId` (nie listę).
- `withLock('sess:' + label)` szereguje wywołania z tym samym labelem.

Więc **dwie sesje o tym samym labelu nigdy nie współistnieją przez most** - drugie
wywołanie czeka i resumuje ten sam wątek. Równoległość istnieje tylko **między różnymi**
labelami. Ustalone 2026-07-30 wspólnie z sesją `Nestor/chat-vps`, potwierdzone przez nią
w kodzie.

Praktyczne skutki:
- Kolizja nazw „ten sam projekt dwa razy jednocześnie" **przez most nie wystąpi.**
  Auto-sufiks `(2)`/`(3)` w kanale [[talk]] jest potrzebny tylko sesjom **spoza** mostu
  (screen, apka, ręczne odpalenia) - tam nie ma labela z katalogu projektu i stamtąd brało
  się generyczne `claude` od `/home/claude`.
- Restart mostu **nie gubi wątku**: sesja jest resumowana po `sessionId` z `sessions.json`.
  Sprawdzone 2026-07-30 - `nestor.service` wstał 00:47:36 w trakcie żywej sesji `motowolt`,
  wątek przeżył.

**Lekcja metodologiczna** (ogólniejsza niż ten kod): test, który obchodzi mutex i mapę
labeli, dowodzi **poprawności logiki, nie realności scenariusza**. Symulacja czterech
wywołań „potwierdziła" obsługę kolizji, która w produkcyjnej ścieżce nie może zaistnieć.
Przy testach współbieżności sprawdzać, czy nie omija się właśnie tego mechanizmu, który
decyduje, czy scenariusz jest osiągalny.

**Korekta 2026-07-30**: pierwotnie zapisałem tu "2 × 290 MB → pewny OOM". Te 290 MB to był
**RSS, który zawyża** (patrz metodyka w [[vps-ovh]]) - PSS całego stacku `claude` to ~344 MB
na wszystkie procesy razem. Ryzyko jest więc realne, ale mniejsze niż napisałem: kilka
równoległych sesji SDK obok 330-megabajtowej sesji `screen` może wyczerpać margines, ale
dwie same z siebie nie muszą. **Rozmiar ryzyka jest nadal nieznany** - dlatego chodzi sampler
`~/bin/lowmem-sample.sh`, a nie żaden limit ustawiony na oko.

**Jeśli limit będzie potrzebny, to nie sztywny.** Sztywny cap = 1 serializowałby wywołania
między projektami (B czeka na A minutami) - to realna regresja funkcjonalna, bo cała wartość
Nestora leży w tym, że każdy projekt ma własny ciągły wątek. Właściwy wzorzec to **bramka
pamięciowa**: przed spawnem sprawdzić `MemAvailable`, dopuścić proces jeśli jest zapas,
inaczej zakolejkować. Współbieżność zostaje wtedy, kiedy maszyna ją udźwignie.

Osobno: konsolidator transkryptów z fan-outem subagentów na tym boxie i tak musiałby chodzić
sekwencyjnie (patrz [[graph-engineering]]).

### Decyzje projektowe
- MCP zamiast protokołu A2A, bo Claude Code mówi MCP natywnie; A2A wymagałoby mostu.
  A2A zostaje opcją na rozmowy z agentami nie-Claude.
- Do unifikacji kontekstów **nie** używać `/loop`: resume po labelu daje ciągłość płacąc
  tylko w momencie użycia, loop płaciłby za każdy tick i dodawał ~kwadrans latencji.
  Loop ma sens do rzeczy dziejących się bez Michała (monitoring, konsolidacja), nie do dostarczania wiadomości.

### Drobne
- Identyfikator serwera MCP na laptopie Michała zmieniony z `nestor` na `Nestor`
  (`~/.claude.json`, 2026-07-29). Czysto kosmetyczne - dotyczy tylko nazw narzędzi
  w lokalnym Claude Code, po stronie VPS nic się nie zmieniło.
- Auto-labelowanie potwierdzone działaniem: `sessions.json` po sesji 2026-07-29 zawiera
  `{"motowolt": {...}}`. Wpis pojawia się **po** pierwszym wywołaniu z labelem, więc pusty
  `{}` na starcie nie znaczy, że mechanizm nie działa.

### Co unieważni tę notatkę
Zmiana klucza blokady lub dodanie globalnego limitu w `src/server.ts`; zmiana mechanizmu
auto-labelowania w snippecie klienta; zmiana RAM na VPS; poluzowanie hardeningu w unicie
`nestor.service`; zsymlinkowanie katalogu pamięci lub zmiana `NESTOR_HOME`.

## Sources

- `~/workspace/nestor/` (kod, README) - odczyt 2026-07-29
- `~/workspace/nestor/src/server.ts:79,177` (`withLock`, zakres mutexu - weryfikacja
  w źródle 2026-07-30; numery linii się przesuwają, szukać po nazwie)
- kanał `talk`, wymiana z sesją `Nestor/chat-vps` 2026-07-30 (m44/m45) - ustalenie
  semantyki labeli; kanał jest ulotny, dlatego wniosek jest tutaj
- `~/workspace/nestor/sessions.json`, `~/.claude/projects/**/*.jsonl` (pomiary sesji)
- sesja czatowa Claude Code na VPS, 2026-07-29
