---
schema: 1
id: D-MG-29
title: "T-MG-16 review closed: F1-F5 cannot occur in production, F6-F7 are narrow; deploy"
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-16
remaining: [F1, F2, F3, F4, F5, F6, F7]
---

## What

T-MG-16 review closed: F1-F5 cannot occur in production, F6-F7 are narrow; deploy

## Why

Codex round 2 found seven more cases. F1-F5 concern migrating LEGACY unsent-message lists (atalks_unsent_<conv>, atalks_unsent_<actor>_<conv>, atalks_owner). Production runs the pre-T-MG-3 code (Polish module names, checked read-only on the VPS: no atalks_unsent or atalks_owner anywhere) and main before T-MG-3 (31beaeb) has neither, so no production browser holds such lists and an old tab open during the deploy never writes them: the races exist only in development browsers that ran unreleased intermediate builds. F6 (REST catch-up after an SSE drop before the first event truncates beyond 30 messages for a loaded empty conversation) and F7 (focus after a thread edit when the SSE update precedes the PATCH answer) are narrow, lose no server data, and go to the backlog. Each storage round has produced new cross-tab interleavings because localStorage has no compare-and-set; the follow-up should remove the legacy-unsent migration code instead of hardening it further.

## Cost if wrong

A developer browser that ran intermediate builds may show or lose an unsent bubble once; a user hitting F6 sees a gap until scrolling up re-fetches; F7 costs one click.

## Alternatives

None recorded.
