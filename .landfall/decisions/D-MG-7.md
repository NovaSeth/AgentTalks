---
schema: 1
id: D-MG-7
title: Work through GitHub (branch + PR per task, CI as a gate) and codex for slices; replaces 'no push' from D-MG-2
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: [D-MG-2]
supersededBy: null
scope: []
allowsTestRemoval: []
---

## What

Work through GitHub (branch + PR per task, CI as a gate) and codex for slices; replaces 'no push' from D-MG-2

## Why

Michal (2026-11-04): "and use GH" and "and remember you have codex ;P". PRI-4: one task = one branch = one PR; CI (.github/workflows/ci.yml: Node 24/26 tests, typecheck, image build) is an additional gate. Codex (auth ok) receives the whole-project cross-review (T-MG-1) and translation implementation slices (T-MG-2) through landfall exec (ORC-21, ORC-26). Production deployment still requires Michal's approval.

## Cost if wrong

PRs are public (PUBLIC repository) - anyone can see the PR description and diff; they must not contain secrets or private channel content. Codex as an implementer may deliver lower quality - every slice goes through Claude review.

## Alternatives

None recorded.
