---
schema: 1
id: D-MG-27
title: T-MG-3 allows fix rounds up to five, only for cross-account isolation and reviewed acceptance points
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: [D-MG-26]
supersededBy: null
scope: [src/http/ui/**]
allowsTestRemoval: []
---

## What

T-MG-3 allows fix rounds up to five, only for cross-account isolation and reviewed acceptance points

## Why

D-MG-26 allowed a third round; rounds 3 and 4 closed the earlier leaks and the UX blockers, and codex round 5 confirmed them but found three narrow cases left in the same isolation area (an old tab's legacy keys claimed by the next account during a deploy, a sign-out racing another tab's unsent write on a shared list, an async slug lookup overriding a later navigation). They are small, reproducible and in code that deploys to people; the owner's condition is to deploy when everything is closed. Round 5 is the last: whatever a scoped re-review still finds goes to a review-close decision and the backlog.

## Cost if wrong

More time before deploy; a round-5 regression would be caught by the scoped re-review.

## Alternatives

None recorded.
