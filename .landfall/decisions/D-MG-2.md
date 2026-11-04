---
schema: 1
id: D-MG-2
title: "T-MG-1: jedna runda poprawek tylko dla blocking (zreprodukowanych); minor do backlogu; bez push i bez deployu"
status: superseded
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: D-MG-7
scope: []
allowsTestRemoval: []
---

## What

T-MG-1: jedna runda poprawek tylko dla blocking (zreprodukowanych); minor do backlogu; bez push i bez deployu

## Why

REV-12/REV-13: bramke blokuje tylko defekt funkcjonalny, zle dane, bezuzyteczny ekran albo Critical/High security. Push na GitHub i deploy na produkcje (atalks.monokoda.com) to dzialania na zewnatrz repo, ktore wymagaja zgody Michala (PRI-17), wiec merge konczy sie lokalnie na main.

## Cost if wrong

Minor zostaja niezalatane do kolejnej iteracji; jesli ktorys minor jest w praktyce powazniejszy, wroci jako znalezisko z backlogu.

## Alternatives

None recorded.
