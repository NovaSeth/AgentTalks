---
schema: 1
id: D-MG-8
title: "T-MG-1: landfall secrets hits (10 in the tree, 15 in history) are false positives - paths, placeholders, tests"
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

T-MG-1: landfall secrets hits (10 in the tree, 15 in history) are false positives - paths, placeholders, tests

## Why

Checked line by line on 2026-11-04: *_PASSWORD_FILE=/run/agenttalks/site-password and SECRETS_DIR=/etc/agenttalks are paths; atk_YOUR_TOKEN is a placeholder in examples; tajne-haslo-bramki/nie-to-haslo/sekret-testowy-0123456789abcdef/atk_zly-token-ktory-ma-przegrac are synthetic test values. Tests get a SYNTH marker during the fix round; env/docs lines cannot be marked without breaking the example, so the task secrets gate requires no NEW hits outside this list.

## Cost if wrong

If someone ever puts a real password on those same lines, the exception list will mask it; mitigated by a --staged scan on every commit (new lines are always scanned).

## Alternatives

None recorded.
