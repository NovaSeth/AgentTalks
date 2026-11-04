---
schema: 1
id: D-MG-1
title: "T-MG-1: gate scope = 877e20e..HEAD; the root commit contains only docs, so the diff covers all code"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: ["**"]
allowsTestRemoval: []
---

## What

T-MG-1: gate scope = 877e20e..HEAD; the root commit contains only docs, so the diff covers all code

## Why

Verifying the entire project requires a scope that includes every code file; root commit 877e20e contains 11 documentation files (2449 lines), while src/test/cli/deploy were created later. Reviewers read the HEAD tree; the diff serves as a map of changes.

## Cost if wrong

If the root commit contains anything important, the review will not see it in the diff; reviewers read the HEAD files anyway, so the loss is limited to 11 prototype documentation files.

## Alternatives

None recorded.
