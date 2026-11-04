---
schema: 1
id: D-MG-1
title: "T-MG-1: zakres bramki = 877e20e..HEAD; root commit zawiera tylko docs, wiec diff obejmuje caly kod"
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

T-MG-1: zakres bramki = 877e20e..HEAD; root commit zawiera tylko docs, wiec diff obejmuje caly kod

## Why

Weryfikacja calego projektu potrzebuje zakresu, ktory zawiera kazdy plik kodu; root commit 877e20e to 11 plikow docs (2449 linii), a src/test/cli/deploy powstaly pozniej. Recenzenci czytaja drzewo HEAD, diff sluzy za mape zmian.

## Cost if wrong

Jesli root commit niesie cos istotnego, recenzja tego nie zobaczy w diffie; recenzenci i tak czytaja pliki z HEAD, wiec strata ogranicza sie do 11 plikow docs prototypu.

## Alternatives

None recorded.
