---
schema: 1
id: D-MG-30
title: Legacy browser storage is deleted at sign-in, never imported
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [src/http/ui/js/state.js]
allowsTestRemoval: []
---

## What

Legacy browser storage is deleted at sign-in, never imported

## Why

Owner asked me to decide D-MG-29's leftovers. Production never wrote unsent lists or the owner marker (checked read-only on the VPS); the instance was wiped on 2026-11-04, so any legacy draft, last conversation, recent list or threads-seen map in a browser points at conversation ids that no longer mean the same thing. Every hardening round of the import produced new cross-tab interleavings (localStorage has no compare-and-set). Deleting every un-namespaced legacy key at sign-in, with no claiming, import, tombstones or 7-day collection, is correct by construction and closes B-MG-111..115; per-actor, per-message keys stay for live data.

## Cost if wrong

A developer browser that ran unreleased builds loses its leftover unsent bubbles once; nothing in production is lost.

## Alternatives

None recorded.
