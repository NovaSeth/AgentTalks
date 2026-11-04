---
schema: 1
id: D-MG-31
title: "T-MG-18 gets a third fix round for F4 only: catch-up inserts missing messages, never overwrites"
status: superseded
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: D-MG-40
scope: [src/http/ui/js/sse-events.js]
allowsTestRemoval: []
---

## What

T-MG-18 gets a third fix round for F4 only: catch-up inserts missing messages, never overwrites

## Why

Codex round 3 confirms F2-F3 and finds one regression introduced by the paged catch-up: a delayed REST page overwrites a newer live edit with stale text, which the base code did not do. Shipping a known regression contradicts the owner's 'everything closed'; the fix is a one-rule merge policy (the catch-up only inserts ids not already held; live events own existing messages) with codex's delayed-response regression, then a scoped re-review.

## Cost if wrong

If round 3 still finds something, it goes to the backlog by a review-close decision.

## Alternatives

None recorded.
