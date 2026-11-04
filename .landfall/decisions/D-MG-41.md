---
schema: 1
id: D-MG-41
title: "T-MG-40: plugin tool tests may use the real in-process test server instead of fake-at.ts"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [test/plugin/full-api.test.ts]
allowsTestRemoval: []
---

## What

T-MG-40: plugin tool tests may use the real in-process test server instead of fake-at.ts

## Why

fake-at.ts (shared) lacks the wiki and lease routes the new tools call; the real test server exercises the actual server contract, which is stronger than extending a fake, and avoids editing the shared helper. Amends T-MG-40 acceptance 5.

## Cost if wrong

Slower tests; a server bug could mask a plugin bug in the same direction.

## Alternatives

None recorded.
