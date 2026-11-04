---
schema: 1
id: D-MG-35
title: "T-MG-24 review closed after round 2: F3 (additive edit of shared test/plugin/fake-at.ts) left to the merge"
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-24
remaining: [F3]
---

## What

T-MG-24 review closed after round 2: F3 (additive edit of shared test/plugin/fake-at.ts) left to the merge

## Why

F1 and F2 are fixed and not re-raised; F3 is a scope breach, not a defect: an optional sessionsStatus field (default unchanged) in a test helper that T-MG-21 also extends additively. The orchestrator merges T-MG-21 first and resolves the two-field overlap at merge, verified by the full suite.

## Cost if wrong

If the merge resolution is wrong, plugin tests fail at verify after merge (caught by the gate, not shipped).

## Alternatives

None recorded.
