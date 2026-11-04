---
schema: 1
id: D-MG-44
title: "T-MG-40: two skill-table tests renamed because the skill moved into the plugin"
status: active
kind: test-removal
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: ["[\"\",\"A2A-F8: a missing atalk prints exactly one line on stderr and nothing on stdout\",1]", "[\"\",\"integrations/claude-skill/SKILL.md documents every legacy error code with its English replacement\",1]", "[\"\",\"integrations/claude-skill/SKILL.md explains the tag, JSON field and compatibility migration\",1]"]
---

## What

T-MG-40: two skill-table tests renamed because the skill moved into the plugin

## Why

The tests are parameterized by the skill's path (test/fixes/t-mg-2-skill-tables.test.ts:12,22); T-MG-40 moved integrations/claude-skill/SKILL.md to integrations/claude-code-plugin/skills/agenttalks/SKILL.md, so the same checks now run under titles with the new path.

## Cost if wrong

If the moved skill were not checked, a legacy error-code table could go missing unnoticed.

## Alternatives

None recorded.
