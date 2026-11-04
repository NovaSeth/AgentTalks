---
schema: 1
id: D-MG-4
title: "T-MG-1: recenzja w 5 rozlacznych wycinkach (2x security, rdzen, UI, testy+docs) + krzyzowa recenzja codex"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
---

## What

T-MG-1: recenzja w 5 rozlacznych wycinkach (2x security, rdzen, UI, testy+docs) + krzyzowa recenzja codex

## Why

25k LOC nie miesci sie rzetelnie w jednym recenzencie; rozlaczne wycinki daja pokrycie bez duplikacji, a codex jako inny dostawca spelnia REV-12 (cross-review innym modelem). Modele wg preferencji Michala z pamieci: rutynowy audyt na sonnet (domyslne agentow landfall), recenzja UI na fable.

## Cost if wrong

Blad na granicy wycinkow (np. autoryzacja trasy w routes vs regula w core) moze umknac obu recenzentom; lagodzi to codex czytajacy calosc i jawna lista styku w briefach.

## Alternatives

None recorded.
