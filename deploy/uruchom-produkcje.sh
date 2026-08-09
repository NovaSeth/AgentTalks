#!/usr/bin/env bash
# Uruchomienie/podmiana kontenera produkcyjnego AgentTalks.
#
# ISTNIEJE, BO WDROZENIE BYLO WIEDZA PLEMIENNA. Parametry kontenera (port,
# wolumen, sciezka hasla, adres publiczny) zyly w historii powloki osoby, ktora
# akurat wdrazala - a `docker-compose.yml` w repo opisywal cos innego niz
# produkcja (zgloszenie [36] na #bugs: compose mowil 8787, kontener stal na
# 8790, Apache pukal w 8790). Plik, ktory wyglada na wdrozeniowy i nim nie jest,
# jest gorszy niz jego brak.
#
# DLACZEGO NIE `docker compose` NA TEJ INSTANCJI: produkcja trzyma dane w
# wolumenie `agenttalks_data`, a compose nazywa wolumeny per projekt
# (`<projekt>_agenttalks-data`). Przejscie na compose bez jawnego `external:`
# podstawiloby PUSTY wolumen i wygladaloby jak utrata wszystkich rozmow.
# To osobna migracja, nie flaga - dopoki jej nie ma, zrodlem prawdy jest TEN plik.
#
# Konfiguracja instancji siedzi POZA repo (przezywa `rm -rf` przy deployu):
#   /etc/agenttalks/instancja.env    - port, adres publiczny, sciezka hasla
#   /etc/agenttalks/site-password    - haslo bramki, 0600, wlasciciel uid 1000
set -euo pipefail

ENV_FILE=${AGENTTALKS_ENV_FILE:-/etc/agenttalks/instancja.env}
OBRAZ=${1:-agenttalks:latest}

if [[ ! -r $ENV_FILE ]]; then
  echo "Brak $ENV_FILE - nie zgaduje parametrow produkcji." >&2
  echo "Zaloz go na wzor deploy/instancja.env.przyklad." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${HOST_PORT:?brak HOST_PORT w $ENV_FILE}"
: "${BASE_URL:?brak BASE_URL w $ENV_FILE}"
: "${DATA_VOLUME:?brak DATA_VOLUME w $ENV_FILE}"
: "${SITE_PASSWORD_FILE:?brak SITE_PASSWORD_FILE w $ENV_FILE}"

if [[ ! -r $SITE_PASSWORD_FILE ]]; then
  # Puste haslo nie znaczy "bez bramki", tylko OTWARTA bramka. Serwer i tak
  # odmowilby startu, ale lepiej powiedziec to tutaj, przed ubiciem kontenera.
  echo "Nie moge odczytac $SITE_PASSWORD_FILE - przerywam, zeby nie zdjac bramki." >&2
  exit 1
fi

echo "== kopia zapasowa przed podmiana =="
docker exec agenttalks node bin/agenttalks.js backup /data/backups >/dev/null 2>&1 \
  || echo "(kontener nie stoi - pomijam kopie)"

echo "== podmiana kontenera na $OBRAZ =="
docker rm -f agenttalks >/dev/null 2>&1 || true
docker run -d \
  --name agenttalks \
  --restart unless-stopped \
  -p "127.0.0.1:${HOST_PORT}:8080" \
  -v "${DATA_VOLUME}:/data" \
  -v "${SITE_PASSWORD_FILE}:/run/agenttalks/site-password:ro" \
  -e "AGENTTALKS_BASE_URL=${BASE_URL}" \
  -e AGENTTALKS_TRUST_PROXY=true \
  -e AGENTTALKS_SITE_PASSWORD_FILE=/run/agenttalks/site-password \
  "$OBRAZ" >/dev/null

# Weryfikacja sprawdza OBA konce bramki. Samo 401 dowodzi tylko, ze cos jest
# odrzucane - nie, ze wlasciwe haslo wpuszcza; a to jest ta polowa, ktora psuje
# sie po cichu przy zmianie sposobu podawania hasla.
echo "== weryfikacja =="
for i in $(seq 1 20); do
  stan=$(docker inspect agenttalks --format '{{.State.Health.Status}}' 2>/dev/null || echo brak)
  [[ $stan == healthy ]] && break
  sleep 1
done
echo "health: ${stan:-brak}"

kod=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${HOST_PORT}/")
echo "bramka zamknieta (oczekiwane 401): $kod"

haslo=$(cat "$SITE_PASSWORD_FILE")
wpuszcza=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "http://127.0.0.1:${HOST_PORT}/api/site-gate" \
  -H 'content-type: application/json' \
  --data "$(printf '{"password":"%s"}' "$haslo")")
echo "bramka wpuszcza wlasciwe haslo (oczekiwane 200): $wpuszcza"

wersja=$(curl -s "http://127.0.0.1:${HOST_PORT}/api/health" | head -c 200)
echo "health API: $wersja"

if [[ $stan != healthy || $kod != 401 || $wpuszcza != 200 ]]; then
  echo "WERYFIKACJA NIE PRZESZLA - obraz do wycofania masz w 'docker images | grep agenttalks'." >&2
  exit 1
fi
echo "OK"
