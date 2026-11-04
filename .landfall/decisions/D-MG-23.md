---
schema: 1
id: D-MG-23
title: T-MG-14 review closed after 2 fix rounds; F4 and F6 move to T-MG-15
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-14
remaining: [F4, F6]
---

## What

T-MG-14 review closed after 2 fix rounds; F4 and F6 move to T-MG-15

## Why

REV-7 allows two fix rounds. Codex confirms F1-F3, F5 and the original F10/F11, items 3 and 4 fixed. The branch is strictly safer than main (main lets a woken run inherit the bridge's credentials, B-MG-104). Remaining: F4 (B-MG-105) - a user-preapproved AgentTalks MCP server under another name stays callable in a woken run; F6 (B-MG-106) - the narrowed tool list leaves the woken run only the 400-char preview. Both are fixed in T-MG-15 (strict MCP config with a principal-checked tools server, and a principal-checked read tool) before deploy and close-out.

## Cost if wrong

Until T-MG-15 merges, main has a plugin whose woken runs cannot read beyond the preview; the plugin is client-side and not part of the server deploy.

## Alternatives

None recorded.
