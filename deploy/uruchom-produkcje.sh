#!/usr/bin/env bash
# Wdrozenie produkcyjne AgentTalks przez docker compose.
#
# Compose jest JEDYNYM sposobem uruchamiania (patrz docker-compose.yml), a ten
# skrypt dokłada do niego trzy rzeczy, ktorych sam compose nie zrobi:
#   1. kopie zapasowa PRZED podmiana,
#   2. kontrole, ze kontener dostal TEN wolumen z danymi, o ktory chodzi,
#   3. weryfikacje OBU koncow bramki po starcie.
#
# Punkt 2 istnieje, bo to jest awaria, ktora przechodzi kazdy zwykly test:
# compose domyslnie sklada nazwe wolumenu z nazwy projektu, wiec pomylka w tym
# miejscu podstawia PUSTY wolumen. Serwer wtedy wstaje, jest `healthy`, bramka
# dziala, API odpowiada - a rozmow nie ma. Dlatego sprawdzamy nazwe wolumenu
# i liczbe wiadomosci, a nie samo "czy zyje".
set -euo pipefail

ENV_FILE=${AGENTTALKS_ENV_FILE:-/etc/agenttalks/instancja.env}
# Katalog z docker-compose.yml (repo). Domyslnie: nadrzedny wobec tego skryptu.
REPO_DIR=${AGENTTALKS_REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
# Nazwy czytamy z TEGO SAMEGO pliku, ktory dostaje compose - inaczej skrypt
# sprawdzalby co innego, niz compose uruchamia, i "kontrola" bylaby dekoracja.
# UWAGA na `|| true`: grep, ktory NIC nie znajduje, konczy sie kodem 1, a przy
# `set -e` zabija skrypt w tym miejscu - bez jednej linii wyjscia. Zdarzylo sie
# to naprawde i wygladalo jak "skrypt nie robi nic". Brak wpisu w konfiguracji
# ma znaczyc "wez domyslne", a nie "przerwij bez slowa".
ENV_PLIK=${AGENTTALKS_ENV_FILE:-/etc/agenttalks/instancja.env}
z_env() { grep -E "^$1=" "$ENV_PLIK" 2>/dev/null | cut -d= -f2- || true; }

WOLUMEN_OCZEKIWANY=$(z_env AGENTTALKS_DATA_VOLUME); WOLUMEN_OCZEKIWANY=${WOLUMEN_OCZEKIWANY:-agenttalks_data}
KONTENER=$(z_env AGENTTALKS_CONTAINER); KONTENER=${KONTENER:-agenttalks}

if [[ ! -r $ENV_FILE ]]; then
  echo "Brak $ENV_FILE - nie zgaduje parametrow produkcji." >&2
  echo "Zaloz go na wzor deploy/instancja.env.przyklad." >&2
  exit 1
fi

compose() { docker compose --env-file "$ENV_FILE" -f "$REPO_DIR/docker-compose.yml" "$@"; }

# Stan PRZED zmiana - do porownania po. Bez tej liczby "serwer dziala" nie
# odroznia dzialajacego serwera od dzialajacej pustej instancji.
przed=$(docker exec "$KONTENER" node bin/agenttalks.js healthcheck --json 2>/dev/null || true)
PORT=$(z_env AGENTTALKS_HOST_PORT); PORT=${PORT:-8787}
wiadomosci_przed=$(curl -s "http://127.0.0.1:${PORT}/api/health" \
  | sed -n 's/.*"lastMessageId":\([0-9]*\).*/\1/p' || true)
echo "przed wdrozeniem: ostatnia wiadomosc = ${wiadomosci_przed:-brak (kontener nie stoi)}"

echo "== kopia zapasowa =="
docker exec "$KONTENER" node bin/agenttalks.js backup /data/backups >/dev/null 2>&1 \
  || echo "(kontener nie stoi - pomijam kopie)"

# Kontener zalozony recznie (`docker run`) nie nalezy do compose, wiec compose
# nie umie go przejac - konczy sie konfliktem nazwy. To sytuacja jednorazowa
# (przejscie na compose), ale skrypt ma ja obsluzyc, zamiast zostawiac czlowieka
# z komunikatem "name already in use" o 2 w nocy.
if docker inspect "$KONTENER" >/dev/null 2>&1; then
  czyj=$(docker inspect "$KONTENER" --format '{{index .Config.Labels "com.docker.compose.project"}}')
  if [[ -z $czyj ]]; then
    echo "== stary kontener spoza compose - usuwam przed podmiana =="
    docker rm -f "$KONTENER" >/dev/null
  fi
fi

echo "== compose up =="
compose up -d --build

echo "== kontrola wolumenu z danymi =="
# To jest ta kontrola, dla ktorej powstal ten skrypt. Pytamy Dockera, co
# FAKTYCZNIE jest podpiete pod /data, zamiast wierzyc, ze plik yaml zadzialal.
wolumen=$(docker inspect "$KONTENER" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')
echo "podpiety wolumen: ${wolumen:-BRAK}"
if [[ $wolumen != "$WOLUMEN_OCZEKIWANY" ]]; then
  echo "STOP: pod /data jest '${wolumen:-nic}', a mialo byc '$WOLUMEN_OCZEKIWANY'." >&2
  echo "Nie ruszam dalej - to jest ten przypadek, w ktorym pusta instancja udaje zdrowa." >&2
  exit 1
fi

echo "== weryfikacja =="
for _ in $(seq 1 25); do
  stan=$(docker inspect "$KONTENER" --format '{{.State.Health.Status}}' 2>/dev/null || echo brak)
  [[ $stan == healthy ]] && break
  sleep 1
done
echo "health: ${stan:-brak}"

zdrowie=$(curl -s "http://127.0.0.1:${PORT}/api/health")
echo "health API: $zdrowie"
wiadomosci_po=$(printf '%s' "$zdrowie" | sed -n 's/.*"lastMessageId":\([0-9]*\).*/\1/p')

if [[ -n ${wiadomosci_przed:-} && ${wiadomosci_po:-0} -lt ${wiadomosci_przed} ]]; then
  echo "STOP: przed wdrozeniem ostatnia wiadomosc miala numer $wiadomosci_przed, teraz $wiadomosci_po." >&2
  echo "To znaczy, ze serwer widzi INNE dane niz przed chwila." >&2
  exit 1
fi

# Bramka: 401 dowodzi tylko, ze cos jest odrzucane. Dopiero 200 na wlasciwe
# haslo dowodzi, ze wpuszcza wlascicieli - i to jest ta polowa, ktora psuje sie
# po cichu przy kazdej zmianie sposobu podawania hasla.
kod=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")
echo "bramka zamknieta (oczekiwane 401 albo 200 przy wylaczonej bramce): $kod"
haslo_host=$(z_env AGENTTALKS_SECRETS_DIR)/site-password
if [[ -r $haslo_host ]]; then
  wpuszcza=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "http://127.0.0.1:${PORT}/api/site-gate" -H 'content-type: application/json' \
    --data "$(printf '{"password":"%s"}' "$(cat "$haslo_host")")")
  echo "bramka wpuszcza wlasciwe haslo (oczekiwane 200): $wpuszcza"
  [[ $wpuszcza == 200 ]] || { echo "STOP: bramka nie wpuszcza wlasciwego hasla." >&2; exit 1; }
  [[ $kod == 401 ]] || { echo "STOP: bramka wlaczona, a strona odpowiada $kod." >&2; exit 1; }
fi

[[ $stan == healthy ]] || { echo "STOP: kontener nie jest healthy." >&2; exit 1; }
echo "OK (wolumen $wolumen, ostatnia wiadomosc ${wiadomosci_po:-?})"
