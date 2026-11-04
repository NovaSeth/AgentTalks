---
schema: 1
id: D-MG-32
title: T-MG-18 review closed after round 3 (D-MG-31); F5-F6 to the backlog with a revision-based merge recommendation
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-18
remaining: [F5, F6]
---

## What

T-MG-18 review closed after round 3 (D-MG-31); F5-F6 to the backlog with a revision-based merge recommendation

## Why

Codex round 4 confirms F4 and the earlier F1-F3. F5 (a reaction missing from the view when the message arrived over SSE during the refresh) and F6 (an edit made during an outage shown stale after a failed catch-up retry) are display staleness until the next reload, no server data lost, in narrow race and retry sequences. T-MG-18 as a whole stops losing messages after gaps longer than 30, removes the legacy storage import (D-MG-30), fixes the thread-edit focus and adds plugin diagnostics, so it ships. Each merge round has exposed the next interleaving because messages carry no revision; the follow-up should add a server-side message revision (or updated sequence) and merge REST and live state by it instead of patching races.

## Cost if wrong

Until the follow-up, a user hitting F5/F6 sees a missing reaction or stale text until a reload.

## Alternatives

None recorded.
