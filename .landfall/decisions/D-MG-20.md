---
schema: 1
id: D-MG-20
title: "Language gate skips the Landfall state directory: process records stay as written; new records are English"
status: active
kind: general
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: [test/language.test.ts, test/language-allowlist.txt]
allowsTestRemoval: []
---

## What

Language gate skips the Landfall state directory: process records stay as written; new records are English

## Why

Decision records are immutable (MEM-2) and the state directory is written only by the landfall CLI; records from before the English migration (2026-11-04) are Polish and stay so. The gate covers product code, tests, docs, deploy and integrations. From now on decisions, briefs and reports are written in English.

## Cost if wrong

Older process records stay in Polish in a public repository; readers of the history rely on the code and docs (English) rather than the records.

## Alternatives

None recorded.
