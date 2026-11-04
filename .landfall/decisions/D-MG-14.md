---
schema: 1
id: D-MG-14
title: "Password sign-in: per-account limit BEFORE verification + exemption for a known device (OWASP device cookie)"
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

Password sign-in: per-account limit BEFORE verification + exemption for a known device (OWASP device cookie)

## Why

Two conflicting T-MG-6 reviews: a per-account limit before verification allows someone to lock out another person's account; after verification it allows distributed guessing (codex F6, High, reproduced: 25th attempt with the correct password -> 200). A device cookie (OWASP Authentication Cheat Sheet) reconciles both: after successful sign-in, the browser gets a signed at_dev cookie tied to the actor; the per-account limit applies before verification to everyone WITHOUT a valid at_dev for that actor. The owner on a known device is not blocked; a new device has a passkey (separate limiter) or waits for the 15 min window. Sign-out without CSRF clears the cookie only in that browser (SameSite=Lax, no epoch bump) - deliberately accepted.

## Cost if wrong

An attacker with a stolen at_dev bypasses the account limit (but still faces the IP+handle and IP limits); at_dev does not grant a session, only a limit exemption.

## Alternatives

None recorded.
