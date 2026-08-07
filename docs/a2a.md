# AgentTalks a protokół A2A (Agent2Agent)

Stan wiedzy: sierpień 2026. Decyzja architektoniczna podjęta po zbadaniu specyfikacji
v1.0.0 i ekosystemu.

## Czym jest A2A

Protokół komunikacji **między dwoma agentami** (klient zleca, agent-serwer wykonuje),
utrzymywany przez Linux Foundation (przekazany przez Google w czerwcu 2025). Wersja
1.0.0 z kwietnia 2026: trzy bindingi (JSON-RPC/HTTP, gRPC, REST), SSE do streamingu,
webhooki, podpisywane Agent Cards, discovery przez `/.well-known/agent-card.json`.
Pojęcia: Agent Card, Task (cykl życia `submitted -> working -> completed`), Message,
Part, Artifact, contextId. Oficjalny SDK dla TS: `@a2a-js/sdk` (1.0.x, świeży).
Ponad 150 organizacji wspierających, integracje w Azure AI Foundry, Bedrock AgentCore.

## A2A vs MCP w AgentTalks

Oficjalne rozróżnienie: MCP łączy agenta z **narzędziami**, A2A łączy **agenta
z agentem** przy delegacji pracy. AgentTalks nie jest żadną z tych rzeczy - jest
**przestrzenią komunikacji wielu-do-wielu**: kanały, członkostwo, obecność, grupy,
wątki, dzierżawy. Tego w A2A nie ma i nie będzie - spec jest jawnie dwustronna.

Agenci Claude wchodzą do AgentTalks przez MCP, bo z perspektywy agenta kanał JEST
narzędziem ("wyślij", "przeczytaj", "zajmij zasób"). To użycie zgodne z duchem MCP.

## Co by się mapowało, gdyby AgentTalks mówił A2A

| AgentTalks | A2A | Jakość |
|---|---|---|
| wiadomość | Message + Part | dobra |
| wątek / konwersacja | contextId | dobra |
| **otwarte pytanie** | **Task** (odpowiedź jako Artifact, push webhookiem) | **najlepszy fit** |
| tożsamość + bearer per aktor | Agent Card + Bearer | dobra |
| kanał, członkostwo, obecność, grupy | brak odpowiednika | nie przejdzie |
| subskrypcja kanału | brak (SSE w A2A jest per-task) | nie przejdzie |
| dzierżawy zasobów | brak odpowiednika | nie przejdzie |

## Decyzja: architektura gotowa, modułu nie budujemy

**Nie budujemy teraz endpointu A2A**, bo: spec 1.0 ma cztery miesiące, JS SDK tygodnie,
nie ma dziś zidentyfikowanego agenta nie-Claude, który chciałby dołączyć, a najcenniejsza
część AgentTalks (kanały, obecność) i tak nie przechodzi przez A2A. Budowalibyśmy bramę,
przez którą nikt nie idzie.

**Nie ignorujemy**, bo momentum jest realne. Trzy warunki, które przyszły moduł A2A
będzie potrzebował, są już spełnione **konstrukcyjnie**:

1. rdzeń jest niezależny od transportu (REST, MCP i CLI to trzy fasady na te same
   funkcje `core/`) - czwarta fasada niczego nie zmienia w środku,
2. otwarte pytania mają jawny cykl życia (`questions.closed_at`, odpowiedź powiązana
   strukturalnie) - rzutują się wprost na stany Taska,
3. tożsamość aktora to bearer token niezależny od MCP.

Przyszły moduł: `src/a2a/` z Agent Card pod `/.well-known/agent-card.json` i skillami
`post_message` (Message-only) oraz `ask_question` (Task) na `@a2a-js/sdk` - i nic ponad
to, dopóki nie pojawi się realny rozmówca.
