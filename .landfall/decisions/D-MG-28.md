---
schema: 1
id: D-MG-28
title: T-MG-3 review closed after fix round 5; F7-F9 move to T-MG-16 before deploy
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-3
remaining: [F7, F8, F9]
---

## What

T-MG-3 review closed after fix round 5; F7-F9 move to T-MG-16 before deploy

## Why

D-MG-27 made round 5 the last. Codex round 7 confirms F4-F6 fixed and the UX review round 3 approved the UI (U1-U43 addressed). Remaining: F7 and F8 lose an account's OWN unsent message in an upgrade race (an old unreloaded tab or two concurrent migrations in one browser), no cross-account exposure; F9 hides the error toast when the user left the chat view during a failed send (the failed row still waits). All three go to a separate task T-MG-16, fixed and reviewed before the single deploy.

## Cost if wrong

T-MG-3 merges with three known narrow defects that T-MG-16 fixes before production; if T-MG-16 slipped, production would carry them.

## Alternatives

None recorded.
