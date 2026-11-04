---
schema: 1
id: D-MG-34
title: "Trust-list lock: never evict automatically; acquire only by wx create, release only own lock"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [integrations/claude-code-plugin/lib/trust.mjs, src/cli/atalk.ts]
allowsTestRemoval: []
task: T-MG-21
remaining: []
---

## What

Trust-list lock: never evict automatically; acquire only by wx create, release only own lock

## Why

Every automatic eviction of a stale lock (by age or by dead pid) races with a second writer and loses a trust entry (codex T-MG-21 r2 F2, r3 F2). A stale lock appears only if a login crashed inside its sub-second critical section, the failure is fail-closed, and the timeout message names the file to delete.

## Cost if wrong

A crashed login leaves a lock that blocks later logins until a human deletes one file; if crashes become common, add OS-level locking (flock) instead of eviction.

## Alternatives

None recorded.
