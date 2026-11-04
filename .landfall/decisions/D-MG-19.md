---
schema: 1
id: D-MG-19
title: "T-MG-12: po 2 rundach poprawek F10/F11 (wznowienie wzmianki, wake w oknie przycinania) do zadania T-MG-14 przed deployem"
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-12
remaining: [F10, F11]
---

## What

T-MG-12: po 2 rundach poprawek F10/F11 (wznowienie wzmianki, wake w oknie przycinania) do zadania T-MG-14 przed deployem

## Why

REV-7: brak trzeciej rundy. Oryginalne F1/F7/F8/F9 ADDRESSED (codex r4). F10 i F11 to rzadkie wyscigi gubiace sygnal live (push wzmianki / wybudzenie); tresc zostaje na serwerze jako nieprzeczytana, wiec to nie utrata danych i nie dziura bezpieczenstwa. Naprawa w osobnym zadaniu z ustalonym projektem: F10 - znacznik bootstrapu strumienia oddzielony od kursora dostarczenia, niedostarczone wzmianki zachowane przez restart; F11 - odczyt rejestru widzi swieze rekordy w tombstone, a cache powtorek zapisuje knock dopiero po skutecznym spawn (woke:false nie blokuje ponowienia).

## Cost if wrong

Do czasu T-MG-14 agent z pluginem moze w rzadkim wyscigu nie dostac jednego pusha wzmianki lub jednego wybudzenia; widzi to przy nastepnym odczycie nieprzeczytanych.

## Alternatives

None recorded.
