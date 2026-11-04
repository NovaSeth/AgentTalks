---
schema: 1
id: D-MG-25
title: "T-MG-15: four wake-bridge argv tests renamed to the strict-mode tool set, assertions tightened"
status: active
kind: test-removal
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: ["[\"\",\"wake bridge: a woken run may use ONLY the plugin channel's principal-checked tools; a remote AgentTalks MCP server (configured as another actor) is denied (codex T-MG-14 r2 F4)\",1]", "[\"\",\"wake bridge: every allowed tool belongs to the principal-checked plugin channel; a wider --allowed-tools is a startup error (r2 F4)\",1]", "[\"\",\"wake bridge: the default allowed tools are this plugin's own reply and mark_read, nothing else (D-MG-17, narrowed by codex T-MG-14 r2 F4)\",1]"]
---

## What

T-MG-15: four wake-bridge argv tests renamed to the strict-mode tool set, assertions tightened

## Why

The tests asserted the T-MG-14 tool names (plugin channel reply/mark_read). T-MG-15 replaces them with the four principal-checked atwake tools under --strict-mcp-config. The designer updated the 4 tests to the new argv shape and made them stricter: the channel tools must now be DENIED and mcp__other_at__* must not be allowed; codex's T-MG-15 review approved the change.

## Cost if wrong

If a renamed test lost a check, a wider tool set could slip into woken runs; the new wake-tools.test.ts (10 tests, alias scenario) is the second guard.

## Alternatives

None recorded.
