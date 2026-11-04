---
schema: 1
id: D-MG-11
title: The Landfall loop cost limit is an estimate at API prices - Michal has Claude and codex subscriptions; limit increased
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

The Landfall loop cost limit is an estimate at API prices - Michal has Claude and codex subscriptions; limit increased

## Why

Michal (2026-11-04, after the loop stopped at $25): "Claude, what budget do you mean? Claude is on a subscription, codex too - if there are limits anywhere, let me know". The $ estimate does not reflect the actual cost; the real constraint is subscription usage limits, which I report to Michal when they arise. The loop resumed with usd=1000 and wallMin=1440 so the limit does not stop the work Michal expects (fixes, EN, Slack UI, plugin, deployment).

## Cost if wrong

If the subscription has hard window limits, work will stop at those rather than at the estimate - I will then report the state and resume after the window resets.

## Alternatives

None recorded.
