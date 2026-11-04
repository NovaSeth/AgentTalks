---
schema: 1
id: D-MG-16
title: "T-MG-2 P3-P6: filenames from the table, env with fallback, i18n-pl stays, docs translated, history unchanged"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: ["**"]
allowsTestRemoval: []
---

## What

T-MG-2 P3-P6: filenames from the table, env with fallback, i18n-pl stays, docs translated, history unchanged

## Why

Filenames follow tasks/T-MG-2/vocabulary.md (UI widok-* -> view-*, deploy/*, tests); the default env file is /etc/agenttalks/instance.env with fallback to instancja.env, so the VPS requires no manual step. The Polish UI translation (i18n-pl.js) is a product feature and stays (language gate allowlist). Historical documents (audits, specifications, prototype docs) are translated, not deleted. We do not rewrite git history (irreversible, PRI-17); new commits are in English.

## Cost if wrong

External links to old file paths will break; README files in the repository are updated in the same step.

## Alternatives

None recorded.
