---
schema: 1
id: D-MG-3
title: "T-MG-1: E2E on a fresh checkout through node (server + HTTP + SSE + MCP + CLI); Docker only if colima starts"
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

T-MG-1: E2E on a fresh checkout through node (server + HTTP + SSE + MCP + CLI); Docker only if colima starts

## Why

The project has no build step (Node 24+ strip-only TS), so a fresh build = a clean worktree with npm ci. The Docker daemon (colima) is off; the docker job in CI also checks the image and smoke test.

## Cost if wrong

Without Docker we cannot check image differences (Dockerfile, user, /data volume) - a possible container-only defect will pass the gate; it will then surface in CI or during deployment.

## Alternatives

None recorded.
