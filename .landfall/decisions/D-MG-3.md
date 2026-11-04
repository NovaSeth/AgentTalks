---
schema: 1
id: D-MG-3
title: "T-MG-1: E2E na swiezym checkoucie przez node (serwer + HTTP + SSE + MCP + CLI); Docker tylko jesli colima wstanie"
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

T-MG-1: E2E na swiezym checkoucie przez node (serwer + HTTP + SSE + MCP + CLI); Docker tylko jesli colima wstanie

## Why

Projekt nie ma kroku build (Node 24+ strip-only TS), wiec swiezy build = czysty worktree z npm ci. Demon Dockera (colima) jest wylaczony; obraz i smoke sprawdza tez job docker w CI.

## Cost if wrong

Bez Dockera nie sprawdzimy roznic obrazu (Dockerfile, uzytkownik, wolumen /data) - mozliwy defekt tylko w kontenerze przejdzie bramke; wtedy wychodzi w CI albo przy deployu.

## Alternatives

None recorded.
