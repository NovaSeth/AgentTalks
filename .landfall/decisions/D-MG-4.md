---
schema: 1
id: D-MG-4
title: "T-MG-1: review in 5 disjoint slices (2x security, core, UI, tests+docs) + cross-review by codex"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
---

## What

T-MG-1: review in 5 disjoint slices (2x security, core, UI, tests+docs) + cross-review by codex

## Why

25k LOC cannot be reviewed reliably by one reviewer; disjoint slices provide coverage without duplication, and codex as a different provider satisfies REV-12 (cross-review with another model). Models follow Michal's preferences from memory: routine audit on sonnet (the landfall agents' default), UI review on fable.

## Cost if wrong

A defect at a slice boundary (e.g. route authorization in routes vs a rule in core) may escape both reviewers; mitigated by codex reading everything and an explicit interface list in the briefs.

## Alternatives

None recorded.
