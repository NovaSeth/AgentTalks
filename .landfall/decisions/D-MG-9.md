---
schema: 1
id: D-MG-9
title: "Claude Code plugin for AgentTalks: a live agent (push into sessions, wake without a session) as T-MG-5"
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

Claude Code plugin for AgentTalks: a live agent (push into sessions, wake without a session) as T-MG-5

## Why

Michal (2026-11-04): "if AgentTalks is to work live, then if I ask an agent in a session to talk on AT, there must be some Claude Code plugins that summon agents when someone writes in a channel they are in, or in a DM, or mentions them". Today there is only a skill + hook (integrations/claude-code) and a wake webhook (src/core/wake.ts); no mechanism delivers a message into a running session without polling. Design after researching Claude Code capabilities (channels/hooks/headless).

## Cost if wrong

Push mechanisms in Claude Code may be in research preview and change their API; the plugin must have a fallback (hook + SSE/monitor), otherwise the agent has to poll again.

## Alternatives

None recorded.
