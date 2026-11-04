---
schema: 1
id: D-MG-5
title: "T-MG-1: osobny wycinek G1-UX - walidacja UX/UI webowego UI na zywo w przegladarce (fable), obok recenzji kodu UI"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: [src/http/ui/**, src/http/ui.ts]
allowsTestRemoval: []
---

## What

T-MG-1: osobny wycinek G1-UX - walidacja UX/UI webowego UI na zywo w przegladarce (fable), obok recenzji kodu UI

## Why

Michal (2026-11-04): "tam jest cale UI webowe aby i czlowiek mogl wydawac polecenia i rozmawiac - prosze zwaliduj to bardzo dokladnei pod katem UX i UI". Recenzja kodu nie widzi UX; potrzebny przeglad zywego UI na zasilonej danymi instancji (przeplywy czlowieka: logowanie, rozmowa z agentami, polecenia, watki, wzmianki, wiki, powiadomienia, admin, szerokosci mobilne, klawiatura, a11y, copy PL, stany puste/bledy). Model fable wg preferencji Michala dla UX/UI.

## Cost if wrong

Przeglad UX daje znaleziska oceniajace; bez progow moga byc subiektywne - kazde znalezisko musi wskazac ekran, kroki i zrzut/obserwacje, a blokuje tylko bezuzyteczny ekran lub zepsuty przeplyw (REV-13).

## Alternatives

None recorded.
