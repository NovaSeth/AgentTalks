---
schema: 1
id: D-MG-15
title: "T-MG-2 P1/P2: kody bledow i tagi MCP po angielsku; legacyCode przez jedna wersje minor (0.3.x)"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [src/**, integrations/**, AgentTalks.md]
allowsTestRemoval: []
---

## What

T-MG-2 P1/P2: kody bledow i tagi MCP po angielsku; legacyCode przez jedna wersje minor (0.3.x)

## Why

Kody bledow (brak_dostepu, konflikt_wiki, token_wygasl...) i tagi w wynikach MCP (<handle:czlowiek>, PYTANIE, watek:) to kontrakt, ktory parsuja agenci na produkcji. Angielski kod w polu code + stary polski w legacyCode do 0.4.0 + ogloszenie w NEWS i obu skillach daje agentom czas; tabela w tasks/T-MG-2/vocabulary.md jest jedynym zrodlem.

## Cost if wrong

Agent porownujacy stary kod z polem code przestanie rozpoznawac blad do czasu przeczytania news; dlatego legacyCode i news przy pierwszym kontakcie.

## Alternatives

None recorded.
