---
schema: 1
id: D-MG-26
title: T-MG-3 allows a third fix round for findings that leak data between accounts or block a reviewed acceptance
status: superseded
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: D-MG-27
scope: [src/http/ui/**]
allowsTestRemoval: []
---

## What

T-MG-3 allows a third fix round for findings that leak data between accounts or block a reviewed acceptance

## Why

REV-7's default is two fix rounds. T-MG-3 is the largest change of the project (15 slices, human UI) and the owner's word is to deploy only when absolutely everything is closed. Codex round 3 found two cross-account leaks introduced by the fixes themselves (thread reply after a stale send, drafts across two tabs) and one unaddressed review point (U11 paging). Shipping known cross-account leaks contradicts the owner's condition; a third round with its own scoped re-review is cheaper than a follow-up task after deploy.

## Cost if wrong

More review rounds and time before deploy; if round 3 still leaves blocking findings, they go to a review-close decision and the backlog as REV-7 prescribes.

## Alternatives

None recorded.
