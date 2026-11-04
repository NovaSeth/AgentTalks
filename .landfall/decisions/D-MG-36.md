---
schema: 1
id: D-MG-36
title: "T-MG-36: a wall-clock bound in a test may become a load-independent check that still catches the regression"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [test/**, deploy/push-and-deploy.sh]
allowsTestRemoval: []
---

## What

T-MG-36: a wall-clock bound in a test may become a load-independent check that still catches the regression

## Why

An absolute ms bound (e.g. B-MG-94 digestFor < 50 ms) fails under parallel test load, which stops push-and-deploy.sh while the code is fine; the guard must keep failing when the capped query regresses to scanning every unread row, but not depend on machine load.

## Cost if wrong

If the new check misses the regression, a slow digest on a large instance ships unnoticed.

## Alternatives

None recorded.
