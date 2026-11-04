---
schema: 1
id: D-MG-13
title: "Plugin live (T-MG-12, dawne T-MG-5) rownolegle z poprawkami: nowy katalog, angielski od startu"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
---

## What

Plugin live (T-MG-12, dawne T-MG-5) rownolegle z poprawkami: nowy katalog, angielski od startu

## Why

Plugin nie dotyka plikow pakietow poprawek ani tlumaczenia: to nowy katalog z serwerem kanalu (stdio MCP), monitorem i odbiornikiem wake. Uzywa stabilnych powierzchni: GET /api/events (SSE, nazwy zdarzen juz angielskie), POST /api/conversations/:id/messages, GET /api/me. Czekanie na T-MG-2 serializowaloby prace bez powodu.

## Cost if wrong

Jesli T-MG-2 zmieni ksztalt odpowiedzi (np. kody bledow), plugin trzeba dopasowac; dlatego plugin nie parsuje kodow bledow, tylko statusy HTTP.

## Alternatives

None recorded.
