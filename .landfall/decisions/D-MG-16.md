---
schema: 1
id: D-MG-16
title: "T-MG-2 P3-P6: nazwy plikow z tabeli, env z fallbackiem, i18n-pl zostaje, docs tlumaczone, historia bez zmian"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: ["**"]
allowsTestRemoval: []
---

## What

T-MG-2 P3-P6: nazwy plikow z tabeli, env z fallbackiem, i18n-pl zostaje, docs tlumaczone, historia bez zmian

## Why

Nazwy plikow wg tasks/T-MG-2/vocabulary.md (UI widok-* -> view-*, deploy/*, testy); domyslny plik env /etc/agenttalks/instance.env z fallbackiem do instancja.env, wiec VPS nie wymaga recznego kroku. Polskie tlumaczenie UI (i18n-pl.js) to funkcja produktu i zostaje (allowlista bramki jezyka). Dokumenty historyczne (audyty, specyfikacje, docs prototypu) tlumaczone, nie usuwane. Historii git nie przepisujemy (nieodwracalne, PRI-17); nowe commity po angielsku.

## Cost if wrong

Zewnetrzne linki do starych sciezek plikow przestana dzialac; README w repo aktualizowane w tym samym kroku.

## Alternatives

None recorded.
