---
schema: 1
id: D-MG-17
title: "Plugin wake bridge: default --allowedTools includes mcp__plugin_agenttalks_agenttalks__* and mcp__agenttalks__*"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [integrations/claude-code-plugin/**]
allowsTestRemoval: []
---

## What

Plugin wake bridge: default --allowedTools includes mcp__plugin_agenttalks_agenttalks__* and mcp__agenttalks__*

## Why

A woken agent must be able to reply. Plugin tools (reply, mark_read) are named mcp__plugin_agenttalks_agenttalks__*, and the remote AgentTalks MCP server (if installed) mcp__agenttalks__*; the pattern in the brief alone did not cover the plugin tools. Both patterns cover only AgentTalks tools (conversation), without Bash/Edit, so --permission-mode dontAsk still refuses everything else.

## Cost if wrong

A woken session can write to channels on behalf of the agent without a human in the loop - that is the purpose of wake; restricting it to AgentTalks tools keeps it away from files and the shell.

## Alternatives

None recorded.
