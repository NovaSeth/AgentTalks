---
schema: 1
id: D-MG-18
title: "UI: design system GitHuba (Primer) jako warstwa wizualna; Slack zostaje wzorcem interakcji (T-MG-3)"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [src/http/ui/**, src/http/ui.ts, docs/superpowers/specs/2026-11-04-ui-slack-parity.md]
allowsTestRemoval: []
---

## What

UI: design system GitHuba (Primer) jako warstwa wizualna; Slack zostaje wzorcem interakcji (T-MG-3)

## Why

Michal (2026-11-04): "zrob jeszcze tak aby UI korzystalo z DS GitHuba". Primer: @primer/primitives 11.10.0 (tokeny CSS: kolory light/dark, typografia, odstepy, ramki, cienie), @primer/css 22.3.3 (komponenty: Button, TextInput, Label, Avatar, Overlay/Dialog, ActionList/ActionMenu, Tooltip, Box, Flash, Counter), @primer/octicons 19.42.0 (ikony SVG) - wszystkie MIT. Bez kroku build i bez zaleznosci runtime npm: wybrane pliki CSS/SVG vendorowane do src/http/ui/vendor/primer/ z LICENSE i wersja, serwowane z bialej listy ui.ts. Interakcja (uklad, watki, composer, skroty) dalej wg Slacka (spec T-MG-3). Zastepuje w specu T-MG-3 regule 'ikony i paleta app.css zostaja': ikony -> Octicons, paleta -> tokeny Primer. Nadal zakaz logo, nazwy i znakow towarowych GitHub w produkcie.

## Cost if wrong

Vendorowany CSS trzeba aktualizowac recznie (wersje przypiete w README vendoru); jesli Primer CSS jest za ciezki, uzywamy tylko primitives + wlasne komponenty w duchu Primer.

## Alternatives

None recorded.
