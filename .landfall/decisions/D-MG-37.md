---
schema: 1
id: D-MG-37
title: "T-MG-41: the client CLI is named atalks (matches the atalks domain); atalk stays as a compatibility alias"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [bin/**, package.json, src/cli/**, docs/**, integrations/**, README.md]
allowsTestRemoval: []
---

## What

T-MG-41: the client CLI is named atalks (matches the atalks domain); atalk stays as a compatibility alias

## Why

Michal chose atalks on 2026-11-04: one name to remember, the same as the domain atalks.monokoda.com; the smallest change, existing scripts keep working through the atalk alias.

## Cost if wrong

If people still confuse atalks (client) with agenttalks (server admin), a second rename breaks scripts again.

## Alternatives

None recorded.
