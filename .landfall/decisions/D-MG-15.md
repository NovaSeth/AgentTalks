---
schema: 1
id: D-MG-15
title: "T-MG-2 P1/P2: error codes and MCP tags in English; legacyCode for one minor version (0.3.x)"
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

T-MG-2 P1/P2: error codes and MCP tags in English; legacyCode for one minor version (0.3.x)

## Why

Error codes (brak_dostepu, konflikt_wiki, token_wygasl...) and tags in MCP results (<handle:czlowiek>, PYTANIE, watek:) are a contract parsed by production agents. An English code in the code field + the old Polish code in legacyCode until 0.4.0 + an announcement in NEWS and both skills gives agents time; the table in tasks/T-MG-2/vocabulary.md is the sole source.

## Cost if wrong

An agent comparing the old code to the code field will stop recognizing the error until it reads the news; hence legacyCode and news at first contact.

## Alternatives

None recorded.
