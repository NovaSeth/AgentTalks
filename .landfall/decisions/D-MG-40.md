---
schema: 1
id: D-MG-40
title: "SSE catch-up: inserts missing messages and refreshes held ones unless a live event changed them during the request"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: [D-MG-31]
supersededBy: null
scope: [src/http/ui/js/sse-events.js, src/http/ui/js/data.js]
allowsTestRemoval: []
---

## What

SSE catch-up: inserts missing messages and refreshes held ones unless a live event changed them during the request

## Why

D-MG-31's never-overwrite rule protected newer live events (F4) but dropped REST reactions (B-MG-118) and newer revisions of held gap messages (B-MG-119); T-MG-43 keeps F4 by skipping only rows a live event touched during the request and merges reactions separately.

## Cost if wrong

If the touched-during-request tracking misses a path, an older REST row could overwrite a newer live edit in the open list until the next refresh.

## Alternatives

None recorded.
