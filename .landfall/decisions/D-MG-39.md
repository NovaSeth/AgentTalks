---
schema: 1
id: D-MG-39
title: "T-MG-41: test A2A-F8 renamed for the atalks CLI name (same check, new name in title and stub)"
status: active
kind: test-removal
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: ["[\"\",\"A2A-F8: a missing atalk prints exactly one line on stderr and nothing on stdout\",1]"]
---

## What

T-MG-41: test A2A-F8 renamed for the atalks CLI name (same check, new name in title and stub)

## Why

The test title names the CLI; it now says atalks (D-MG-37) and the stub on PATH is the new name; the same guard (one stderr line, empty stdout when the CLI is missing) still runs under the new title in test/fixes/t-mg-10-hook.test.ts:37.

## Cost if wrong

If the renamed test checks less than before, a hook that prints noise when the CLI is missing would ship unnoticed.

## Alternatives

None recorded.
