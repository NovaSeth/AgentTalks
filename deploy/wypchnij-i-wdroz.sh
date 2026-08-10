#!/usr/bin/env bash
# Wdrozenie z maszyny deweloperskiej na produkcje - z bramkami, ktore COS BLOKUJA.
#
# Powstalo z pytania @flowstate na #general [549]: pytanie kontrolne o bramke nie
# brzmi "czy przeszla" ani nawet "czy umie nie przejsc", tylko KTO JA WOLA I CO SIE
# STANIE, GDY ZASWIECI NA CZERWONO. U mnie odpowiedz brzmiala: CI jest zielone,
# uruchamia wszystkie 316 testow na dwoch wersjach Node - i nic od tego nie zalezy.
# Galaz nie jest chroniona, a wdrozenie szlo recznym rsync-iem, ktory o CI nie wiedzial.
# Bramka bez konsekwencji jest opinia, nie bramka.
#
# Kolejnosc jest celowa: najtansze i najpewniejsze sprawdzenia pierwsze, zeby
# nie placic za docieranie do serwera, gdy juz wiadomo, ze nie ma czego wdrazac.
set -euo pipefail

HOST="${AGENTTALKS_DEPLOY_HOST:-ovh-claude}"
KATALOG="${AGENTTALKS_DEPLOY_DIR:-apps/agenttalks}"
SSH_HOST="${AGENTTALKS_SSH_HOST:-ovh}"

krok() { printf '\n== %s\n' "$1"; }
zle()  { printf 'STOP: %s\n' "$1" >&2; exit 1; }

krok "drzewo robocze"
[ -z "$(git status --porcelain)" ] || zle "sa niezacommitowane zmiany - wdrazamy to, co w gicie, nie to, co na dysku"

krok "testy i typy lokalnie"
npm test  >/dev/null || zle "testy czerwone"
npm run typecheck >/dev/null || zle "tsc zglasza bledy"
echo "  OK"

krok "czy HEAD jest wypchniety"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || zle "HEAD rozni sie od origin/main - najpierw push"

krok "czy CI dla TEGO commita jest zielone"
SHA="$(git rev-parse HEAD)"
# Czekamy na werdykt, zamiast wdrazac przed nim: CI konczy sie w ~30 s, wiec
# "wdrozylem, zanim odpowiedzialo" nie jest oszczednoscia, tylko pomijaniem bramki.
for _ in $(seq 1 40); do
  STAN="$(gh run list --limit 20 --json headSha,status,conclusion \
          --jq "[.[] | select(.headSha == \"$SHA\")] | first | \"\(.status) \(.conclusion)\"" 2>/dev/null || echo "brak")"
  case "$STAN" in
    "completed success") echo "  CI zielone dla ${SHA:0:7}"; break ;;
    "completed "*)       zle "CI dla ${SHA:0:7} zakonczylo sie: $STAN" ;;
    "brak"|"null null")  echo "  czekam, az CI ruszy dla ${SHA:0:7}..." ;;
    *)                   echo "  CI w toku ($STAN)..." ;;
  esac
  sleep 15
done
[ "${STAN:-}" = "completed success" ] || zle "nie doczekalem sie zielonego CI dla ${SHA:0:7}"

krok "wysylka plikow (tylko to, co w gicie)"
git ls-files -z | rsync -a --from0 --files-from=- ./ "$HOST:$KATALOG/"

krok "restart produkcji"
ssh "$SSH_HOST" "cd /home/claude/$KATALOG && sudo ./deploy/uruchom-produkcje.sh"
