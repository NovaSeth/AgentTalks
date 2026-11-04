---
schema: 1
id: D-MG-6
title: "The entire AgentTalks project in English: identifiers, files, tests, API error codes, messages, docs"
status: active
kind: general
date: 2026-11-03
author: MG
supersedes: []
supersededBy: null
scope: ["**"]
allowsTestRemoval: []
---

## What

The entire AgentTalks project in English: identifiers, files, tests, API error codes, messages, docs

## Why

Michal (2026-11-04): "the whole Agenttalks project must be in English". CONTRIBUTING.md:28 already requires this, but the test/jezyk.test.ts gate checks only comments; 23 Polish filenames, 186/322 test titles, ~50 API error codes, identifiers and 8 docs/ documents remain. The UI stays English at source with a Polish translation through i18n-pl.js (this is a feature, not the project language). We do not rewrite git history (irreversible, PRI-17).

## Cost if wrong

Changing API error codes and filenames breaks clients that parse old codes (production agents, CLI, skill); the contract change therefore comes with a compatibility period described in the T-MG-2 plan.

## Alternatives

None recorded.
