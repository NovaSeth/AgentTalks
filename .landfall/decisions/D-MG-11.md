---
schema: 1
id: D-MG-11
title: Limit kosztowy petli Landfall to szacunek po cenach API - Michal jest na subskrypcji Claude i codex; limit podniesiony
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

Limit kosztowy petli Landfall to szacunek po cenach API - Michal jest na subskrypcji Claude i codex; limit podniesiony

## Why

Michal (2026-11-04, po zatrzymaniu petli na $25): "Claude o jaki budzet chodzi? Claude jest na subskrypcji, codex tez - jezeli gdzies sa limity to daj znac". Szacunek $ nie odpowiada realnemu kosztowi; realnym ograniczeniem sa limity uzycia subskrypcji, ktore zglaszam Michalowi, gdy wystapia. Petla wznowiona z usd=1000 i wallMin=1440, zeby limit nie zatrzymywal pracy, ktorej Michal oczekuje (fixy, EN, UI Slack, plugin, deploy).

## Cost if wrong

Jesli subskrypcja ma twarde limity okien, praca zatrzyma sie na nich, a nie na szacunku - wtedy zglaszam stan i wznawiam po resecie okna.

## Alternatives

None recorded.
