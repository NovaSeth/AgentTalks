---
schema: 1
id: D-MG-2
title: "T-MG-1: one fix round for blocking findings only (reproduced); minor findings go to the backlog; no push and no deployment"
status: superseded
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: D-MG-7
scope: []
allowsTestRemoval: []
---

## What

T-MG-1: one fix round for blocking findings only (reproduced); minor findings go to the backlog; no push and no deployment

## Why

REV-12/REV-13: only a functional defect, incorrect data, an unusable screen or Critical/High security blocks the gate. Pushing to GitHub and deploying to production (atalks.monokoda.com) are actions outside the repository that require Michal's approval (PRI-17), so the merge ends locally on main.

## Cost if wrong

Minor findings remain unfixed until the next iteration; if any minor finding is more serious in practice, it will return as a backlog finding.

## Alternatives

None recorded.
