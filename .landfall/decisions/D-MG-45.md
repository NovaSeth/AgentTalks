---
schema: 1
id: D-MG-45
title: "T-MG-44: ship after 3 fix rounds; the hidden-tab path still ignores a higher server read watermark (follow-up)"
status: active
kind: review-close
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: []
task: T-MG-44
remaining: [F7]
---

## What

T-MG-44: ship after 3 fix rounds; the hidden-tab path still ignores a higher server read watermark (follow-up)

## Why

Rounds 1-3 fixed every other Codex finding and the browser check passes; the remaining case needs a read made elsewhere (another device) plus a hidden tab, and only over-highlights already-read messages briefly; a one-line follow-up initializes h.read from the server watermark on every path.

## Cost if wrong

Until the follow-up lands, messages read on another device can be tinted after a hidden-tab return, then fade on the next read.

## Alternatives

None recorded.
