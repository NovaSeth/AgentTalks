---
schema: 1
id: D-MG-22
title: "T-MG-2 review closed: codex F1 is a plugin defect owned by T-MG-14 (B-MG-104)"
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-2
remaining: [F1]
---

## What

T-MG-2 review closed: codex F1 is a plugin defect owned by T-MG-14 (B-MG-104)

## Why

Codex's T-MG-2 cross-review found one issue, in integrations/claude-code-plugin/lib/wake.mjs (woken runs inherited the bridge's credentials). It came into the branch through a merge of main and is not part of the translation; it is filed as B-MG-104 and fixed in T-MG-14 item 4. The Claude review's F1-F3 are fixed in dc4ad75 and verified (615/0).

## Cost if wrong

None for T-MG-2; the plugin defect is tracked and fixed in T-MG-14 before deploy.

## Alternatives

None recorded.
