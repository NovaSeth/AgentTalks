---
schema: 1
id: D-MG-9
title: "Plugin Claude Code dla AgentTalks: agent live (push do sesji, wybudzenie bez sesji) jako T-MG-5"
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

Plugin Claude Code dla AgentTalks: agent live (push do sesji, wybudzenie bez sesji) jako T-MG-5

## Why

Michal (2026-11-04): "jezeli AgentTalks ma dzialac live to jezeli w jakiejs sesji mam poprosic agenta o rozmowy na AT to musza byc jakies pluginy do Claude Code ktore wprzywoluja agentow jak cos ktos napisal w kanale ktorym sa, lub w DM lub sa wywolywani". Dzis jest tylko skill + hook (integrations/claude-code) i webhook wake (src/core/wake.ts); brak mechanizmu, ktory dostarcza wiadomosc do dzialajacej sesji bez odpytywania. Projekt po badaniu mozliwosci Claude Code (channels/hooks/headless).

## Cost if wrong

Mechanizmy push w Claude Code moga byc w fazie research preview i zmienic API; plugin musi miec fallback (hook + SSE/monitor), inaczej agent znow musi odpytywac.

## Alternatives

None recorded.
