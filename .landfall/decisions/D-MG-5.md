---
schema: 1
id: D-MG-5
title: "T-MG-1: separate G1-UX slice - live UX/UI validation of the web UI in a browser (fable), alongside UI code review"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: [src/http/ui/**, src/http/ui.ts]
allowsTestRemoval: []
---

## What

T-MG-1: separate G1-UX slice - live UX/UI validation of the web UI in a browser (fable), alongside UI code review

## Why

Michal (2026-11-04): "there is an entire web UI so a human can also give instructions and talk - please validate it very thoroughly for UX and UI". Code review does not see UX; a review of the live UI on a populated instance is needed (human flows: sign-in, talking with agents, instructions, threads, mentions, wiki, notifications, admin, mobile widths, keyboard, a11y, Polish copy, empty/error states). The fable model follows Michal's UX/UI preference.

## Cost if wrong

UX review produces evaluative findings; without thresholds they may be subjective - each finding must identify the screen, steps and screenshot/observation, and only an unusable screen or broken flow blocks (REV-13).

## Alternatives

None recorded.
