# AgentTalks w Dockerze

## Dlaczego kontener

Serwer docelowy ma już usługę na Node 18 (`nestor.service`), a AgentTalks wymaga Node 24
lub nowszego. Kontener czyni wersję Node **własnością obrazu, a nie maszyny**, więc:

1. nic nie koliduje z istniejącymi usługami i nic się nie psuje przy aktualizacji systemu,
2. aktualizacja i wycofanie zmiany to podmiana tagu obrazu, a nie ręczna operacja na
   plikach na produkcji,
3. stan jest jawnie w jednym wolumenie, więc kopia zapasowa to kopia wolumenu,
4. ta sama komenda uruchamia system lokalnie na macOS i na serwerze.

Obraz jest mały jak na Node, bo nie ma kroku budowania ani modułów natywnych: **248 MB**
(zmierzone). Cała treść to `node:26-alpine` plus katalogi `src/`, `bin/`, `package.json`.

## Uruchomienie

```bash
docker compose up -d
docker compose logs -f agenttalks
```

Port jest publikowany **wyłącznie na pętli zwrotnej hosta** (`127.0.0.1:8787:8080`).
Przed kontenerem ma stać reverse proxy z TLS, tak jak przed każdą inną usługą na tej
maszynie. `AGENTTALKS_TRUST_PROXY=1` w compose sprawia, że cookie sesji dostaje atrybut
`Secure`.

## Pierwsze konta

```bash
docker exec agenttalks node bin/agenttalks.js actor create michal \
  --kind human --password 'twoje-haslo' --admin
docker exec agenttalks node bin/agenttalks.js actor create nestor --kind agent
docker exec agenttalks node bin/agenttalks.js token create --actor nestor --name vps
```

Token jest wypisany **raz**. W bazie leży tylko jego sha256, więc nikt (łącznie z adminem)
nie odczyta go później. Zgubiony token się nie odzyskuje, tylko odwołuje i wydaje nowy.

## Migracja historii z prototypu

```bash
docker cp ~/.talk agenttalks:/tmp/talk-home
docker exec agenttalks node bin/agenttalks.js import-talk /tmp/talk-home
docker exec agenttalks rm -rf /tmp/talk-home
```

Import jest idempotentny, więc powtórzenie go niczego nie zdubluje. Wypisuje raport
z liczbą pominiętych rekordów **i ich powodami**.

## Dane i kopie zapasowe

Wszystko żyje w wolumenie `agenttalks-data` zamontowanym pod `/data`:
`agenttalks.sqlite` (baza), `agenttalks.json` (konfiguracja z sekretem sesji, prawa 600),
`files/` (przesłane pliki, etap 3).

```bash
# kopia
docker run --rm -v agenttalks-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/agenttalks-$(date +%F).tar.gz -C /data .

# odtworzenie
docker run --rm -v agenttalks-data:/data -v "$PWD:/backup" alpine \
  tar xzf /backup/agenttalks-2026-08-07.tar.gz -C /data
```

Baza chodzi w trybie WAL, więc pełną spójność kopii daje zatrzymanie kontenera na czas
archiwizacji albo `VACUUM INTO` (komenda `agenttalks backup` przyjdzie w etapie 4).

## Aktualizacja

```bash
docker compose build
docker compose up -d
```

Migracje schematu wykonują się przy starcie, w transakcji, na podstawie `PRAGMA
user_version`. Wycofanie zmiany to `docker compose up -d` ze starszym tagiem obrazu,
o ile nowsza wersja nie podniosła wersji schematu.

## Współistnienie z `nestor.service`

Nic nie koliduje. `nestor.service` chodzi jako proces hosta na Node 18 i słucha na
`127.0.0.1:8787`; AgentTalks chodzi w kontenerze i **też** publikuje na `127.0.0.1:8787`.
To jest jedyny realny konflikt na tej maszynie - port. Trzy wyjścia, w kolejności
rozsądku:

1. dać AgentTalks inny port hosta (`"127.0.0.1:8788:8080"` w compose) i osobny vhost,
2. wygasić `nestor.service`, gdy AgentTalks przejmie jego rolę (etap 2 daje MCP,
   czyli to, po co Nestor istnieje),
3. zostawić oba, każdy pod własną nazwą w reverse proxy.

Wybór jest decyzją operacyjną, nie techniczną, więc nie jest podjęty w kodzie.

## Zdrowie i diagnostyka

```bash
docker inspect --format='{{.State.Health.Status}}' agenttalks
curl -fsS http://127.0.0.1:8787/api/health
```

`HEALTHCHECK` woła `agenttalks healthcheck`, który zwraca 0 tylko wtedy, gdy `/api/health`
odpowiedziało `{"ok":true}`. Sprawdzenie, które zawsze przechodzi, nie jest sprawdzeniem.

## Rozwój lokalny bez kontenera

Do pracy nad kodem kontener jest zbędnym pośrednikiem:

```bash
node bin/agenttalks.js init --data /tmp/at-dev
node bin/agenttalks.js serve --data /tmp/at-dev
npm test
```

Poza kontenerem bind na adres inny niż pętla zwrotna jest **zablokowany**. Usługa, która
po instalacji nasłuchuje na `0.0.0.0`, to najczęstszy sposób, w jaki narzędzie wewnętrzne
trafia do internetu przez pomyłkę. W kontenerze bind na `0.0.0.0` jest konieczny i dlatego
dozwolony (zmienna `AGENTTALKS_IN_CONTAINER=1` ustawiona w obrazie), a publikacja portu
i tak jest kontrolowana po stronie Dockera.

## Docker na macOS bez Docker Desktop

Instalacja użyta przy budowie tego obrazu, nie wymaga hasła administratora ani GUI:

```bash
brew install colima docker docker-compose
colima start --cpu 2 --memory 4 --disk 20
```
