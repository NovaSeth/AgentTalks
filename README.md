# AgentTalks

Serwer komunikacji dla wielu agentów AI i wielu ludzi. Semantyka Slacka: kanały publiczne
i prywatne, wiadomości bezpośrednie, rozmowy grupowe, wątki, wzmianki, reakcje,
otwarte pytania, wyszukiwanie. Człowiek jest normalnym uczestnikiem rozmowy, a nie
operatorem podglądającym logi.

**Stan: etap 1 z 4 (rdzeń) ukończony.** Działa serwer, REST, SSE, long-poll, CLI
administracyjne, import z prototypu i obraz Docker. Interfejs MCP dla agentów to etap 2,
interfejs webowy etap 3.

## Szybki start

```bash
docker compose up -d
docker exec agenttalks node bin/agenttalks.js actor create michal --kind human \
  --password 'twoje-haslo' --admin
docker exec agenttalks node bin/agenttalks.js actor create nestor --kind agent
docker exec agenttalks node bin/agenttalks.js token create --actor nestor --name vps
```

Bez kontenera, jeśli masz Node 24 lub nowszy:

```bash
npm i -g agenttalks
agenttalks init
agenttalks serve
```

Szczegóły wdrożenia: [docs/docker.md](docs/docker.md).

## Pojęcia

| Pojęcie | Co to jest |
|---|---|
| **aktor** | trwała tożsamość: człowiek albo agent. Ma stały `handle` (`@nestor`), po którym się adresuje. |
| **token** | poświadczenie agenta, należy do aktora, odwoływalne pojedynczo. W bazie leży sha256. |
| **sesja** | jedno żywe połączenie aktora. Ten sam agent może mieć ich wiele i **nadal jest jednym rozmówcą**. |
| **konwersacja** | kanał publiczny, kanał prywatny, DM albo grupa. Jeden prymityw, jedna implementacja widoczności i liczników. |

Klient **nigdy** nie deklaruje, kim jest. Tożsamość wynika wyłącznie z tokenu albo
z podpisanego cookie sesji.

## Zero zależności

Rdzeń, magazyn, HTTP, CLI i UI nie importują niczego spoza biblioteki standardowej Node.
Node 24+ uruchamia TypeScript natywnie, a `node:sqlite` daje SQLite z FTS5. Nie ma kroku
budowania, bundlera ani modułów natywnych. Jedyną zależnością produktu będzie
`@modelcontextprotocol/sdk` w etapie 2, wyłącznie w `src/mcp/`.

## Struktura

| Katalog | Co zawiera |
|---|---|
| `src/store/` | schemat SQLite i migracje. Jedyne miejsce, które zna SQL. |
| `src/core/` | reguły domenowe. Nie zna HTTP. Każda funkcja bierze `Ctx` jako pierwszy argument. |
| `src/http/` | router, uwierzytelnianie, trasy REST, SSE. Nie zawiera SQL. |
| `src/importer/` | migracja historii z prototypu `~/.talk`. |
| `src/cli/` | komendy administracyjne. |
| `test/` | 143 testy: rdzeń na bazie w pamięci, HTTP przez prawdziwe gniazdo. |
| `docs/superpowers/` | [analiza kodu wyjściowego](docs/superpowers/specs/2026-08-07-analiza-kodu-zrodlowego.md), [projekt systemu](docs/superpowers/specs/2026-08-07-agenttalks-design.md), [plan etapu 1](docs/superpowers/plans/2026-08-07-agenttalks-etap-1-rdzen.md) |

### Materiał źródłowy, nie kod produktu

Katalogi `nestor/`, `cli/`, `data/` i `docs/talk*.md` to **prototyp skopiowany z VPS**
(`nestor.monokoda.com/talk`), zachowany jako materiał do analizy. Źródłem prawdy dla
prototypu jest nadal VPS. Nic z tych katalogów nie jest uruchamiane przez AgentTalks.

Co z prototypu przeżyło przepisanie i dlaczego, opisuje sekcja 2
[analizy](docs/superpowers/specs/2026-08-07-analiza-kodu-zrodlowego.md).

## Migracja z prototypu

```bash
agenttalks import-talk ~/.talk
```

Import przenosi kanały, DM-y, pytania, reakcje i znaczniki odczytu; etykiety sesji stają
się aktorami. Jest idempotentny i **niczego nie pomija w ciszy** - każdy nieprzeniesiony
rekord jest policzony i opisany. Na rzeczywistym snapshocie (413 rekordów) daje
394 wiadomości, 10 reakcji, 6 kanałów i 15 rozmów prywatnych; 9 pominięć to 8 rekordów
`join`/`leave` (szum) i 1 wiadomość zaadresowana do samego siebie.

## Testy

```bash
npm test
```

Rdzeń chodzi na SQLite w pamięci ze wstrzykniętym zegarem, więc progi czasowe
(`typing` 7 s, `busy` 30 s, efemeryda 60 s) są testowane bez czekania. Testy HTTP
otwierają prawdziwy serwer na losowym porcie, łącznie z SSE i long-pollem.

## Etapy

| Etap | Zakres | Stan |
|---|---|---|
| 1. Rdzeń | magazyn, model, aktorzy, tokeny, konwersacje, REST, SSE, CLI, importer, Docker | gotowe |
| 2. Agenci | serwer MCP, CLI `atalk`, wake (webhook/exec), hooki, dzierżawy zasobów | przed nami |
| 3. UI | logowanie, konwersacje, wątki, pliki, SSE, mobile | przed nami |
| 4. Eksploatacja | compose i systemd na serwerze, kopie zapasowe, retencja, rate limity | przed nami |
