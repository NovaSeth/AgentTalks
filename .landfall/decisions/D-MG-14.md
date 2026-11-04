---
schema: 1
id: D-MG-14
title: "Logowanie haslem: limit per konto PRZED weryfikacja + zwolnienie dla znanego urzadzenia (OWASP device cookie)"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [src/http/routes/auth.ts, src/http/auth.ts]
allowsTestRemoval: []
---

## What

Logowanie haslem: limit per konto PRZED weryfikacja + zwolnienie dla znanego urzadzenia (OWASP device cookie)

## Why

Dwie sprzeczne recenzje T-MG-6: limit per konto przed weryfikacja pozwala zablokowac cudze konto; po weryfikacji pozwala na rozproszone zgadywanie (codex F6, High, odtworzone: 25. proba z poprawnym haslem -> 200). Device cookie (OWASP Authentication Cheat Sheet) godzi oba: po udanym logowaniu przegladarka dostaje podpisane cookie at_dev wiazane z aktorem; limit per konto obowiazuje przed weryfikacja dla wszystkich BEZ waznego at_dev tego aktora. Wlasciciel na znanym urzadzeniu nie jest blokowany; nowe urzadzenie ma passkey (osobny limiter) albo czeka okno 15 min. Wylogowanie bez CSRF czysci cookie tylko w tej przegladarce (SameSite=Lax, bez podbicia epoki) - akceptowane swiadomie.

## Cost if wrong

Atakujacy z wykradzionym at_dev ominie limit konta (ale nadal limit IP+handle i IP); at_dev nie daje sesji, tylko zwolnienie z limitu.

## Alternatives

None recorded.
