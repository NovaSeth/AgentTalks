---
schema: 1
id: D-MG-8
title: "T-MG-1: trafienia landfall secrets (10 w drzewie, 15 w historii) to falszywe alarmy - sciezki, placeholdery, testy"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: [deploy/**, docs/docker.md, integrations/claude-skill/SKILL.md, src/http/ui/install.html, test/**]
allowsTestRemoval: []
---

## What

T-MG-1: trafienia landfall secrets (10 w drzewie, 15 w historii) to falszywe alarmy - sciezki, placeholdery, testy

## Why

Sprawdzone linia po linii 2026-11-04: *_PASSWORD_FILE=/run/agenttalks/site-password i SECRETS_DIR=/etc/agenttalks to sciezki; atk_YOUR_TOKEN to placeholder w przykladach; tajne-haslo-bramki/nie-to-haslo/sekret-testowy-0123456789abcdef/atk_zly-token-ktory-ma-przegrac to syntetyczne wartosci testow. Testy dostaja znacznik SYNTH w rundzie poprawek; linii env/docs nie da sie oznaczyc bez psucia przykladu, wiec bramka sekretow dla zadan to brak NOWYCH trafien poza ta lista.

## Cost if wrong

Jesli ktos kiedys wpisze prawdziwe haslo w te same linie, lista wyjatkow je zamaskuje; lagodzi to skan --staged na kazdym commicie (nowe linie sa zawsze skanowane).

## Alternatives

None recorded.
