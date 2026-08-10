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

# Numer ostatniej wiadomosci czytamy PROSTO Z BAZY w kontenerze, a nie z HTTP.
# Dwa powody, oba wyszly w praniu: (1) /api/health celowo nie wystawia liczb
# swiatu, a zadanie z hosta trafia do kontenera z adresem bramy Dockera, nie
# z petli zwrotnej - wiec "lokalny" wyjatek i tak by nie zadzialal; (2) kontrola
# przed utrata danych ma pytac ZRODLA, a nie warstwy, ktora akurat je pokazuje.
licznik_wiadomosci() {
  docker exec "$KONTENER" node -e '
    const {DatabaseSync}=require("node:sqlite");
    const db=new DatabaseSync("/data/agenttalks.sqlite",{readOnly:true});
    process.stdout.write(String(db.prepare("SELECT COALESCE(MAX(id),0) x FROM messages").get().x));
  ' 2>/dev/null || true
}
wiadomosci_przed=$(licznik_wiadomosci)
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
# Czekamy na USTALONY werdykt, a nie na uplyw czasu. `starting` znaczy "jeszcze nie
# wiem" i nie jest porazka - `unhealthy` jest, i wtedy nie ma po co czekac dalej.
# Okno 90 s bierze sie z ustawien sondy w Dockerfile (start-period 20 s + interval 15 s
# x retries 3): musi byc dluzsze niz czas, w ktorym Docker moze jeszcze zmienic zdanie,
# inaczej skrypt melduje STOP przy serwerze, ktory dawno odpowiada. Zdarzylo sie raz.
for _ in $(seq 1 90); do
  stan=$(docker inspect "$KONTENER" --format '{{.State.Health.Status}}' 2>/dev/null || echo brak)
  [[ $stan == healthy || $stan == unhealthy ]] && break
  sleep 1
done
echo "health: ${stan:-brak}"

zdrowie=$(curl -s "http://127.0.0.1:${PORT}/api/health")
echo "health API: $zdrowie"
wiadomosci_po=$(licznik_wiadomosci)
echo "ostatnia wiadomosc: przed ${wiadomosci_przed:-?} -> po ${wiadomosci_po:-?}"

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
  # Haslo idzie do curl-a przez STDIN (--data @-), NIE jako argument w linii
  # polecen. Argumenty procesu (w tym `curl ... --data "haslo-w-tekscie"`) sa
  # widoczne w `ps aux` / `/proc/<pid>/cmdline` dla kazdego na maszynie przez
  # caly czas trwania zadania - STDIN nie zostawia takiego sladu.
  wpuszcza=$(printf '{"password":"%s"}' "$(cat "$haslo_host")" | curl -s -o /dev/null \
    -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/api/site-gate" \
    -H 'content-type: application/json' --data @-)
  echo "bramka wpuszcza wlasciwe haslo (oczekiwane 200): $wpuszcza"
  [[ $wpuszcza == 200 ]] || { echo "STOP: bramka nie wpuszcza wlasciwego hasla." >&2; exit 1; }
  [[ $kod == 401 ]] || { echo "STOP: bramka wlaczona, a strona odpowiada $kod." >&2; exit 1; }
fi

# Czy INTERFEJS sie zaladuje. Dotad ten skrypt sprawdzal, ze serwer zyje, baza
# odpowiada i bramka dziala - i wszystko to bylo prawda, gdy strona byla BIALA:
# do listy serwowanych modulow nie dopisano i18n.js, wiec przegladarka dostawala
# 404 i caly graf modulow padal przy ladowaniu. Zaden test, tsc, CI ani ten skrypt
# tego nie widzialy, bo zaden z nich nie pobiera modulow UI.
#
# Pobieramy dokladnie te pliki, ktore wymienia shell aplikacji, i sprawdzamy, ze
# kazdy z nich wraca. Kontrola idzie po pojedynczych plikach, a nie po samym "/",
# bo "/" oddaje szkielet HTML takze wtedy, gdy nie da sie zaladowac ani jednego
# modulu - czyli odpowiada 200 na pytanie, ktorego nikt nie zadal.
naglowek_bramki=()
if [[ -r $haslo_host ]]; then
  ciasteczko=$(printf '{"password":"%s"}' "$(cat "$haslo_host")" | curl -s -i -X POST \
    "http://127.0.0.1:${PORT}/api/site-gate" -H 'content-type: application/json' --data @- \
    | tr -d '\r' | grep -i '^set-cookie:' | sed 's/set-cookie: *//; s/;.*//')
  [[ -n $ciasteczko ]] && naglowek_bramki=(-H "cookie: ${ciasteczko}")
fi
# Zrodlem listy jest KATALOG, nie HTML. Pierwsza wersja tego sprawdzenia brala
# nazwy z atrybutow src="" w shellu - a shell wymienia TYLKO app.js, bo reszta
# wchodzi przez `import` w srodku modulow. Sprawdzalo wiec jeden plik z dziewietnastu
# i przeszlo na zielono takze wtedy, gdy celowo usunalem i18n.js z bialej listy.
# Zlapalem to jedynie dlatego, ze puscilem probe negatywna; sam wynik "OK" wygladal
# identycznie w obu przypadkach.
zle_moduly=0; sprawdzonych=0
for plik in src/http/ui/js/*.js; do
  nazwa=$(basename "$plik"); sprawdzonych=$((sprawdzonych+1))
  kod_modulu=$(curl -s -o /dev/null -w '%{http_code}' "${naglowek_bramki[@]}" \
    "http://127.0.0.1:${PORT}/js/${nazwa}")
  [[ $kod_modulu == 200 ]] || { echo "  BRAK: /js/${nazwa} -> ${kod_modulu}"; zle_moduly=$((zle_moduly+1)); }
done
echo "moduly UI (${sprawdzonych} plikow): $([[ $zle_moduly == 0 ]] && echo OK || echo "${zle_moduly} nie do pobrania")"
[[ $sprawdzonych -ge 15 ]] || { echo "STOP: sprawdzono tylko ${sprawdzonych} modulow - katalog sie przeniosl?" >&2; exit 1; }
[[ $zle_moduly == 0 ]] || { echo "STOP: interfejs sie nie zaladuje - biala strona." >&2; exit 1; }

[[ $stan == healthy ]] || { echo "STOP: kontener nie jest healthy." >&2; exit 1; }
echo "OK (wolumen $wolumen, ostatnia wiadomosc ${wiadomosci_po:-?})"
