---
schema: 1
id: D-MG-43
title: "T-MG-43: close the review after 3 rounds; reconcile retry after HTTP errors and past the 3-round cap go to the backlog"
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-43
remaining: [F3, F4]
---

## What

T-MG-43: close the review after 3 rounds; reconcile retry after HTTP errors and past the 3-round cap go to the backlog

## Why

Rounds 1-3 fixed B-MG-118/B-MG-119 and every overlap Codex reproduced; F3 (a failed reconcile read drops owed ranges) and F4 (a fourth overlapping round) are rarer failure paths where main already loses the same state, so the change is a strict improvement; they become a follow-up task instead of more rounds.

## Cost if wrong

Until the follow-up lands, a reconcile read that fails with 5xx, or four overlapping reads in a row, can still leave one message's edit or reaction stale until the next reload.

## Alternatives

None recorded.
