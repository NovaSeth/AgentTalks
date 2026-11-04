# T-MG-1 - spec i plan bramki: weryfikacja calego projektu AgentTalks

Data: 2026-11-04. Zlecil: Michal ("landfall init + odpal caly pipeline Landfall aby zweryfikowac caly ten projekt").
Klasa: critical (route T-MG-1). Decyzje: D-MG-1 (zakres), D-MG-4 (podzial recenzji), D-MG-2 (runda poprawek, bez push/deploy), D-MG-3 (E2E).

## Spec - co i dlaczego

AgentTalks (v0.2.0, schemat DB v14+, ~25k LOC TS/JS, Node >= 24 strip-only) to serwer komunikacji agentow i ludzi:
HTTP API + SSE + UI (moduly ES) + MCP (`src/mcp/server.ts`) + CLI (`src/cli/atalk.ts`, `src/cli/main.ts`).
Dziala na produkcji (atalks.monokoda.com). Ostatni pelny audyt: 2026-08-09 (`docs/audyt-2026-08-09.md`, 116 potwierdzonych
znalezisk, naprawione). Od tamtej pory doszly commity do 2026-09-01 (HEAD 945674f). Bramki nigdy nie byly sprawdzane
metoda Landfall.

Stan wejsciowy (zmierzony 2026-11-04 na swiezym worktree, Node v26.0.0):
- `npm run typecheck` exit 0; `npm test` 322 pass / 0 fail / 0 skip (4.3 s).
- Zaleznosci runtime: tylko `@modelcontextprotocol/sdk` (`package.json:28`).
- CI: `.github/workflows/ci.yml` - test na Node 24/26, typecheck jako twarda bramka, build obrazu + smoke `/api/health`.

Kryteria sukcesu (metryki z progami):
1. Bramki profilu przechodza ponownie: typecheck exit 0, testy fail = 0, liczba testow >= 322 (baseline nie maleje).
2. Recenzja: kazdy wycinek kodu (lista nizej) ma recenzje z werdyktem; 100% znalezisk blocking ma reprodukcje (test lub skrypt z wynikiem).
3. Security: zero otwartych Critical/High po rundzie poprawek; OWA-1..10 sprawdzone na calym HTTP, LLM-1..10 i AGT-1..10 na MCP/wake/skill.
4. Sekrety: `landfall secrets` exit 0 na drzewie i `landfall secrets --range 877e20e..HEAD` bez trafien (lub kazde trafienie wyjasnione).
5. Zaleznosci: `npm audit --omit=dev` zero High/Critical.
6. E2E na swiezym checkoucie: serwer wstaje na pustej bazie, health 200, przeplyw admin -> token agenta -> wiadomosc -> odczyt
   przez drugiego aktora -> SSE push -> MCP tool call -> CLI `atalk` - kazdy krok z asercja zachowania i danych.
7. Raport dla PO (REV-14) po polsku.

Podejscia (SPC-4):
- A. Jeden recenzent na caly zakres - tanio, ale 25k LOC przekracza rzetelny kontekst; odrzucone.
- B. Rozlaczne wycinki + krzyzowa recenzja innego dostawcy na calosci (wybrane, D-MG-4): pokrycie bez duplikacji, styk lapie codex.
- C. Workflow 12 perspektyw jak w audycie 2026-08-09 - najglebsze, ale ~150 agentow i 8 mln tokenow; nieproporcjonalne
  do weryfikacji po audycie; bierzemy z niego zasade "czy ta kontrola potrafi odpowiedziec INACZEJ?" i liste stanu wejsciowego.
Koszt pomylki B: blad na styku wycinkow - lagodzi codex + lista styku.

Niewiadome (SPC-5):
- U1 Docker (colima wylaczona): wykrycie `docker info`; fallback E2E przez node na swiezym checkoucie (D-MG-3), obraz pokrywa CI.
- U2 Brak semgrep/gitleaks/osv-scanner: fallback `landfall secrets --range` + `npm audit` + recenzja reczna; luka w raporcie PO.

## Plan

Global Constraints (wiaza kazda poprawke):
- GC1 Zero nowych zaleznosci runtime poza `@modelcontextprotocol/sdk` (straz: diff `package.json`, recenzja).
- GC2 Node strip-only TS: zakaz `enum`, parameter properties, namespace (straz: `npm test` laduje pliki przez node; typecheck).
- GC3 Tozsamosc nigdy z deklaracji klienta - zawsze z tokenu/sesji (straz: testy `test/http/api.test.ts` 401/403).
- GC4 Zdarzenia (SSE/powiadomienia) emitowane po commicie transakcji (onCommitted) (straz: testy core).
- GC5 Kazdy odczyt tresci rozmowy przechodzi kontrole canRead (straz: testy prywatnych kanalow).
- GC6 Komentarze po polsku bez diakrytykow, bez em-dash (straz: hook repo, `test/jezyk.test.ts`).
- GC7 Testu nie usuwa sie ani nie oslabia bez decyzji (COD-3; straz: `landfall verify` baseline).
- GC8 Migracje schematu idempotentne i tylko w przod (straz: `test/store/db.test.ts`).

Review Focus (3-5 scenariuszy ryzyka):
- RF1 Nie-czlonek kanalu prywatnego nie widzi tresci zadna sciezka: GET wiadomosci, wyszukiwarka FTS, powiadomienia, digest,
  SSE, MCP talk_log/talk_search, pliki, wiki - oczekiwane 403/404/brak pozycji. Dowod: testy canRead + recenzja S1/S2.
- RF2 Odwolany token / wylaczone konto / zmiana hasla traci dostep natychmiast: HTTP 401, SSE zamkniete w cyklu ping, MCP 401.
- RF3 Tresc od agentow (wiadomosci, wiki, nazwy) wyswietlana w UI nie wykonuje skryptu (XSS) i nie wstrzykuje polecen agentom
  przez MCP/skill (prompt injection: instrukcje w tresci traktowane jako dane). Dowod: recenzja UI + S2.
- RF4 Zapisy wspolbiezne (dwie edycje wiki, dwa POST wiadomosci, migracja przy starcie) nie gubia ani nie psuja danych:
  409 konflikt_wiki, BEGIN IMMEDIATE, savepointy. Dowod: recenzja rdzenia.
- RF5 Upload pliku i pobranie: limit rozmiaru, typ, nazwa (path traversal, %-kodowanie), SSRF przy pobieraniu po URL.

Zadania bramki (wycinki rozlaczne; pliki wspolne: `src/core/ctx.ts`, `src/core/errors.ts`, `src/http/respond.ts`, `src/config.ts`
- zmieniane tylko przez runde poprawek, jedna na raz):

| ID | Kto | Pliki (czyta) | Wynik |
|----|-----|---------------|-------|
| G1-S1 | landfall:security-reviewer | src/http/auth.ts, src/http/server.ts, src/http/router.ts, src/http/respond.ts, src/http/sse.ts, src/http/routes/**, src/core/{tokens,invites,actors,webauthn,files}.ts, src/config.ts | review-s1.json |
| G1-S2 | landfall:security-reviewer | src/mcp/server.ts, src/core/{wake,guidelines,leases}.ts, src/cli/**, bin/**, cli/**, integrations/**, AgentTalks.md, deploy/**, Dockerfile, docker-compose.yml, .github/workflows/** | review-s2.json |
| G1-C | landfall:reviewer | src/core/** (bez plikow S1/S2), src/store/**, src/importer/** | review-core.json |
| G1-U | landfall:reviewer (fable) | src/http/ui/**, src/http/ui.ts | review-ui.json |
| G1-T | landfall:reviewer | test/**, README.md, docs/docker.md, SECURITY.md, CONTRIBUTING.md, NEWS.md vs kod | review-tests-docs.json |
| G1-X | landfall:external (codex) | caly zakres 877e20e..HEAD | review-codex |
| G2 | orkiestrator | npm audit, landfall secrets (drzewo + zakres) | audit.txt |
| G3 | orkiestrator | E2E swiezy checkout | e2e.log |
| G4 | landfall:implementer | tylko pliki z blocking findings, TDD | report.md |
| G5 | reviewer (swiezy) | scoped re-review rundy G4 | review-r2 |
| G6 | orkiestrator | verify, task done, merge lokalny, raport PO | po-report.md |

Acceptance G1: kazdy recenzent zwraca JSON wg `templates/review.schema.json`, blocking z reprodukcja, `file:line`.
Acceptance G4: kazdy blocking ma test RED przed poprawka i GREEN po; bramki profilu zielone; baseline >= 322.
Kontrola sprzecznosci (SPC-8): wycinki G1 sa rozlaczne (sprawdzone wyzej); G4 moze dotknac plikow wspolnych - tylko jeden
implementer na raz, wiec brak konfliktu; GC1..GC8 nie koliduja ze soba.
