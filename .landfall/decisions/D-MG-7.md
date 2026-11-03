---
schema: 1
id: D-MG-7
title: Praca przez GitHub (galaz + PR na zadanie, CI jako bramka) i codex na wycinki; zastepuje 'bez push' z D-MG-2
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: [D-MG-2]
supersededBy: null
scope: []
allowsTestRemoval: []
---

## What

Praca przez GitHub (galaz + PR na zadanie, CI jako bramka) i codex na wycinki; zastepuje 'bez push' z D-MG-2

## Why

Michal (2026-11-04): "i uzywaj GH" oraz "i pamietja ze masz codexa ;P". PRI-4: jedno zadanie = jedna galaz = jeden PR; CI (.github/workflows/ci.yml: testy Node 24/26, typecheck, build obrazu) jest dodatkowa bramka. Codex (auth ok) dostaje recenzje krzyzowa calosci (T-MG-1) i wycinki implementacji tlumaczenia (T-MG-2) przez landfall exec (ORC-21, ORC-26). Deploy na produkcje nadal wymaga zgody Michala.

## Cost if wrong

PR-y sa publiczne (repo PUBLIC) - opis PR i diff widzi kazdy; nie wolno w nich umieszczac sekretow ani prywatnej tresci kanalow. Codex jako implementer moze dac nizsza jakosc - kazdy wycinek przechodzi recenzje Claude.

## Alternatives

None recorded.
