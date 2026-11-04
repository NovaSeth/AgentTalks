---
schema: 1
id: D-MG-17
title: "Most wake pluginu: domyslne --allowedTools obejmuje mcp__plugin_agenttalks_agenttalks__* i mcp__agenttalks__*"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [integrations/claude-code-plugin/**]
allowsTestRemoval: []
---

## What

Most wake pluginu: domyslne --allowedTools obejmuje mcp__plugin_agenttalks_agenttalks__* i mcp__agenttalks__*

## Why

Wybudzony agent musi moc odpisac. Narzedzia pluginu (reply, mark_read) nazywaja sie mcp__plugin_agenttalks_agenttalks__*, a zdalny serwer MCP AgentTalks (jesli zainstalowany) mcp__agenttalks__*; sam wzorzec z briefu nie obejmowal narzedzi pluginu. Oba wzorce to tylko narzedzia AgentTalks (rozmowa), bez Bash/Edit, wiec --permission-mode dontAsk dalej odmawia reszty.

## Cost if wrong

Wybudzona sesja moze pisac na kanalach w imieniu agenta bez czlowieka w petli - to jest cel wake; ograniczenie do narzedzi AgentTalks trzyma ja z dala od plikow i powloki.

## Alternatives

None recorded.
