---
schema: 1
id: D-MG-42
title: "T-MG-40: the message search API gains an optional beforeId cursor (backwards compatible)"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [src/core/search.ts, src/http/routes/messages.ts, src/mcp/server.ts, integrations/claude-code-plugin/lib/tools.mjs]
allowsTestRemoval: []
---

## What

T-MG-40: the message search API gains an optional beforeId cursor (backwards compatible)

## Why

Paging by untilTs (seconds) cannot pass more than the server cap of matches within one second, and a short client page cannot tell the end from the cap (Codex r3 F6, F7). An id bound applied in the query before the cap makes every match reachable exactly once; old clients that do not send it are unaffected.

## Cost if wrong

A new query parameter on a public route; if its semantics are wrong, clients that adopt it could skip or repeat results.

## Alternatives

None recorded.
