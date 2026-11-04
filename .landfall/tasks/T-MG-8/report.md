---
red: {"command":"node --test test/fixes/t-mg-8-ui.test.ts","exit":1,"excerpt":"tests 13; pass 2; fail 11. B-MG-35: counters [2,2,2,2] instead of [1,1,1,1]. B-MG-36: duplicate reply. B-MG-37: composer replaced. B-MG-38: after=200 instead of after=100. B-MG-39: broken href and undefined placeholder. B-MG-41: account data retained. B-MG-43: keydown listener retained."}
green: {"command":"node --test test/fixes/t-mg-8-ui.test.ts test/ui-moduly.test.ts test/ui-start.test.ts","exit":0,"excerpt":"tests 21; pass 21; fail 0; cancelled 0; skipped 0. Includes 17 new regression tests."}
---

# Report: Fix C, web UI defects (T-MG-8)

Status: NEEDS_CONTEXT

Worktree: /Users/michal/Documents/Code/AgentTalks-wt/T-MG-8
Branch: task/T-MG-8-fix-c-ui
Base: 0561f866f0737576cc087c30a3cdaff79a1ed8b3
Commits: brak, zgodnie z instrukcją External run.
Push: nie.
Review: pozostawiony orkiestratorowi, landfall:reviewer.

Sześć znalezisk poprawiono w całości. B-MG-43 poprawiono dla
confirmModal; showNewsModal wymaga rozszerzenia zakresu o
src/http/ui/js/widok-powiadomienia.js. Pytanie o rozszerzenie
pozostaje bez odpowiedzi. Tego pliku nie zmieniono.

## Zmiany i RED/GREEN

| ID | Problem i poprawka | Test oraz dowód |
|---|---|---|
| B-MG-35 | message_updated uruchamiał efekty nowej wiadomości. Aktualizacja teraz zastępuje treść bez zwiększania liczników, powiadomienia, ogłoszenia i przewijania. | „edits, deletes and replayed updates replace messages without new-message effects”: RED liczniki 2 zamiast 1; GREEN. |
| B-MG-36 | Odpowiedź HTTP dodawała ponownie odpowiedź dostarczoną przez SSE. Zastosowano upsert po id. | „a thread send response upserts the reply already received over SSE”: RED dwie pozycje; GREEN jedna. |
| B-MG-37 | Sukces wysyłki przebudowywał composer. Teraz porównuje tekst, zachowuje element, fokus i nowy szkic. Otwarcie wątku po wysyłce również zachowuje główny composer. | „Enter then further typing keeps the composer, focus and new draft after send”: RED zastąpiony element; GREEN. Dodatkowo testy identycznego kolejnego tekstu, zmiany rozmowy, wysyłki odpowiedzi do wątku i czyszczenia niezmienionego tekstu. |
| B-MG-38 | REST przesuwał kursor wznowienia SSE. Kursor aktualizuje wyłącznie handler SSE. | „REST upserts do not advance the cursor used to reconnect SSE”: RED after=200; GREEN after=100. |
| B-MG-39 | Przetwarzanie wzmianek uszkadzało href i kod; NUL podszywał się pod placeholder. Linki i kod są chronione, NUL usuwany z wejścia i tytułów wiki. | „mentions never rewrite link destinations or code” oraz „user NUL placeholders remain text instead of referencing code blocks”: RED uszkodzony href/undefined; GREEN. Testy bezpieczeństwa HTML i tytułów wiki również przechodzą. |
| B-MG-41 | Logout zachowywał dane konta i szkice. Resetuje stan, dodatkowe cache wiadomości oraz klucze szkiców, ostatniej i niedawnych rozmów. | „logout clears all account state and drafts while preserving browser preferences”: RED zachowane dane; GREEN. |
| B-MG-43 | confirmModal pozostawiał listener keydown. Wszystkie ścieżki zakończenia usuwają listener. | Testy „confirmation closed by … releases every keydown listener”: przyciski i backdrop RED → GREEN; Escape pozostaje GREEN. showNewsModal nadal RED poza zakresem. |

Pierwszy przebieg: 13 testów, 2 PASS / 11 FAIL.
Końcowy zestaw regresji: 17 PASS / 0 FAIL.
Kontrolowane mutacje: 7/7 wykrytych przez asercje.
Nie usunięto, nie pominięto ani nie osłabiono istniejących testów.

## Pliki

Zmieniono wyłącznie:
- src/http/ui/js/zdarzenia-sse.js
- src/http/ui/js/widok-czat.js
- src/http/ui/js/akcje.js
- src/http/ui/js/stan.js
- src/http/ui/js/markdown.js
- src/http/ui/js/widok-login.js
- src/http/ui/js/dom.js

Dodano:
- test/fixes/t-mg-8-ui.test.ts

Bez zmian w widok-sidebar.js, dane.js, i18n, kodzie serwera
i zależnościach.

## Gate

| Komenda | Wynik | Exit |
|---|---|---|
| npm test | 339 testów: 232 PASS, 107 FAIL; wszystkie niepowodzenia to listen EPERM na 127.0.0.1 | 1 |
| npm run typecheck | PASS | 0 |
| landfall secrets --range 0561f866f0737576cc087c30a3cdaff79a1ed8b3..HEAD | Clean; zakres pusty, ponieważ commity wykonuje orkiestrator | 0 |
| landfall secrets --artifact /tmp/t-mg-8-scoped-files | Clean; kopia wszystkich siedmiu zmienionych modułów i nowego testu | 0 |
| Testy regresji + istniejące ui-moduly/ui-start | 21 PASS, 0 FAIL | 0 |
| git diff --check | PASS | 0 |

Baseline podany w zadaniu: 322 testy.
Po zmianach: 339 testów, czyli 17 nowych.

Ograniczenie listen EPERM wystąpiło również przed zmianami.
Nie jest to zielona pełna bramka; orkiestrator musi powtórzyć
npm test w środowisku pozwalającym otwierać lokalne porty.

Niepowodzenia według pliku:
- test/cli/atalk.test.ts: 3
- test/dokumentacja.test.ts: 1
- test/e2e/rozmowa.test.ts: 2
- test/http/api.test.ts: 71
- test/http/sse.test.ts: 12
- test/http/ui-moduly.test.ts: 2
- test/mcp/mcp.test.ts: 16

Pełna lista nazw i lokalizacji:
 /tmp/t-mg-8-gate-failures.txt

## E2E assertions reviewed

Testy modułów uruchamiają rzeczywiste handlery SSE, akcje,
renderowanie composera i wątku oraz cykl zamykania modali.
DOM, transport HTTP, EventSource i Notification są zastąpione
kontrolowanymi adapterami testowymi. Nie wykonano wizualnego
E2E w przeglądarce.

## Shared gaps / wymagane decyzje

B-MG-43: showNewsModal znajduje się w
src/http/ui/js/widok-powiadomienia.js:37, poza listą Modify.

Reprodukcja trzech otwarć i zamknięć przyciskiem pozostawia
3 listenery ponad baseline, zamiast 0:
- skrypt: /tmp/t-mg-8-news-repro.test.ts
- wynik: /tmp/t-mg-8-news-red.log

Wymagana zgoda na rozszerzenie zakresu albo osobne zadanie.
Nie zastosowano obejścia w dom.js.

## Dowody

- /tmp/t-mg-8-red.log
- /tmp/t-mg-8-red-followup.log
- /tmp/t-mg-8-ui-final.log
- /tmp/t-mg-8-mutations.json
- /tmp/t-mg-8-gate-tests.log
- /tmp/t-mg-8-gate-typecheck.log
- /tmp/t-mg-8-gate-secrets.log
- /tmp/t-mg-8-gate-secrets-artifact.log

## Context

Przeczytano fix-common.md, spec T-MG-1, szablon raportu,
wskazane reprodukcje, pełne B-MG-39/B-MG-41/B-MG-43,
moduły objęte zakresem i istniejące testy UI.

Reguły: COD-1, COD-2, COD-3, ORC-17, REV-9, PRI-15.

## DISPUTED

Brak.

## Odstępstwa

Zmiany pozostają niecommitowane dla orkiestratora, zgodnie
z instrukcją External run. Pełna bramka wymaga uruchomienia
poza obecnym ograniczeniem sieciowym sandboxa.

Docelowego raportu
/Users/michal/Documents/Code/AgentTalks/.landfall/tasks/T-MG-8/report.md
nie zapisano: ścieżka leży poza zapisywalnym worktree.
Pełny raport przekazano w odpowiedzi końcowej.

## Orchestrator gate re-run (outside the codex sandbox)
npm test: 339 pass, 0 fail. npm run typecheck: clean. Committed as 1f1754b. B-MG-43 showNewsModal part continues in brief amendment 1 (scope extended to widok-powiadomienia.js).
