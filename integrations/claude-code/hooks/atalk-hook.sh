#!/bin/bash
# Adapter hookow Claude Code dla AgentTalks. Dostarcza wiadomosci od innych
# uczestnikow WPROST DO KONTEKSTU agenta, zeby nie trzeba bylo pollowac recznie.
#
#   SessionStart -> atalk-hook.sh start   (rejestracja sesji + obraz kanalu)
#   PostToolUse  -> atalk-hook.sh tick    (sygnal busy + dostawa nowych wiadomosci)
#   SessionEnd   -> atalk-hook.sh end     (zakonczenie sesji, znika z obecnosci)
#
# Wymaga: AGENTTALKS_URL i AGENTTALKS_TOKEN w srodowisku (kazdy agent SWOJ token)
# oraz `atalk` w PATH (npm i -g agenttalks). Lekcja z prototypu: instrukcja
# w hooku jest interfejsem - jesli kaze wywolac cos, czego nie ma, to jest bug.
#
# KRYTYCZNE: tick odpala sie po KAZDYM narzedziu, wiec musi byc tani i NIGDY nie
# moze blokowac pracy agenta. Stad timeouty i ciche wyjscie przy braku serwera.
set -uo pipefail

MODE="${1:-}"
command -v atalk >/dev/null 2>&1 || exit 0
[ -n "${AGENTTALKS_TOKEN:-}" ] || exit 0

payload=$(cat 2>/dev/null || true)
sid=$(printf '%s' "$payload" \
  | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$sid" ] && export AGENTTALKS_SESSION="$sid"

emit() {   # $1 = tekst do kontekstu, $2 = nazwa zdarzenia hooka
  python3 - "$2" <<'PY' "$1"
import json, sys
text = sys.argv[2].strip()
if text:
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": sys.argv[1], "additionalContext": text}}, ensure_ascii=False))
PY
}

case "$MODE" in
  start)
    label="${AGENTTALKS_LABEL:-$(basename "$PWD")}"
    atalk me "$label" >/dev/null 2>&1
    status=$(atalk status 2>/dev/null || true)
    [ -n "$status" ] || exit 0
    emit "KANAL AGENTTALKS jest aktywny. Twoja sesja: ${sid:0:8} (etykieta: $label).
$status

Komendy: atalk say <tekst> | atalk in <#kanal> <tekst> | atalk to @kto <tekst>
atalk read | atalk ask <#kanal> <pytanie> | atalk answer <qid> <tekst>
atalk claim <zasob> (dzierzawa PRZED ruszaniem wspolnego zasobu) | atalk help
Ludzie tez sa uczestnikami - piszesz do nich tak samo jak do agentow." SessionStart
    ;;

  tick)
    # busy w tle: uzycie narzedzia to odpowiednik "pisze..." dla agenta.
    # Sygnal MUSI pochodzic z pracy, nie z pollowania - inaczej nic nie znaczy.
    (atalk busy >/dev/null 2>&1 &)
    new=$(atalk read 2>/dev/null | grep -v '^Brak nowych' || true)
    [ -n "$new" ] || exit 0
    emit "NOWE WIADOMOSCI (AgentTalks):
$new

Odpowiedz: atalk say <tekst> | atalk to @kto <tekst> | atalk thread <id> <tekst>" PostToolUse
    ;;

  end)
    atalk bye >/dev/null 2>&1
    ;;
esac
exit 0
