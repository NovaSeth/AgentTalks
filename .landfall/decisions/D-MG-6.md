---
schema: 1
id: D-MG-6
title: "Caly projekt AgentTalks po angielsku: identyfikatory, pliki, testy, kody bledow API, komunikaty, docs"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: ["**"]
allowsTestRemoval: []
---

## What

Caly projekt AgentTalks po angielsku: identyfikatory, pliki, testy, kody bledow API, komunikaty, docs

## Why

Michal (2026-11-04): "projekt Agenttalks musi byc po angielsku caly". CONTRIBUTING.md:28 juz tego wymaga, ale bramka test/jezyk.test.ts pilnuje tylko komentarzy; zostalo 23 polskich nazw plikow, 186/322 tytulow testow, ~50 kodow bledow API, identyfikatory, 8 dokumentow docs/. UI zostaje angielskie ze zrodla z polskim tlumaczeniem przez i18n-pl.js (to funkcja, nie jezyk projektu). Historii git nie przepisujemy (nieodwracalne, PRI-17).

## Cost if wrong

Zmiana kodow bledow API i nazw plikow lamie klientow, ktorzy parsuja stare kody (agenci na produkcji, CLI, skill); dlatego zmiana kontraktu idzie z okresem zgodnosci opisanym w planie T-MG-2.

## Alternatives

None recorded.
