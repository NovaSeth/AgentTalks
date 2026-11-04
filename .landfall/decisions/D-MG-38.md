---
schema: 1
id: D-MG-38
title: Drop 1 backlog findings
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
---

## What

Drop 1 backlog findings

## Why

Scope-coordination finding of T-MG-24 r2 (shared fake-at.ts reserved for T-MG-21 while both ran). Both tasks are merged on main and the full suite is green, so the conflict it guarded against cannot happen any more; the 6 added lines are a test helper, not product code.

## Cost if wrong

These findings will remain recorded as dropped.

## Alternatives

None recorded.
