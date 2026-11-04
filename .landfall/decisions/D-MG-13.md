---
schema: 1
id: D-MG-13
title: "Live plugin (T-MG-12, formerly T-MG-5) alongside fixes: new directory, English from the start"
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

Live plugin (T-MG-12, formerly T-MG-5) alongside fixes: new directory, English from the start

## Why

The plugin does not touch files in the fix packages or translation: it is a new directory with a channel server (stdio MCP), monitor and wake receiver. It uses stable surfaces: GET /api/events (SSE, event names already English), POST /api/conversations/:id/messages, GET /api/me. Waiting for T-MG-2 would serialize work for no reason.

## Cost if wrong

If T-MG-2 changes response shapes (e.g. error codes), the plugin will need adapting; this is why the plugin parses only HTTP statuses, not error codes.

## Alternatives

None recorded.
