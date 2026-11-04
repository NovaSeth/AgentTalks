---
schema: 1
id: D-MG-33
title: "T-MG-18: tests of the removed legacy storage import go with the code (D-MG-30)"
status: active
kind: test-removal
date: 2026-11-04
author: MG
supersedes: []
supersededBy: null
scope: []
allowsTestRemoval: ["[\"\",\"(a) A and B entries in one key: each account restores only its own\",1]", "[\"\",\"(b) B persists after A wrote: A's entry stays, is not re-owned, is not shown to B\",1]", "[\"\",\"(c) a legacy entry without ownerId goes to the marker's account once, never to another\",1]", "[\"\",\"9: a pre-r4 browser-wide seen map migrates to the old marker's actor and sign-out clears only that actor's\",1]", "[\"\",\"F2: legacy un-namespaced keys go once to the actor the old marker names, and the marker goes\",1]", "[\"\",\"F4: on the first run the marker's actor gets the legacy data once, and only that actor\",1]", "[\"\",\"F5: a shared pre-r5 list is split once into the per-actor keys by each entry's ownerId\",1]", "[\"\",\"F7 (codex repro): an old tab's attributable unsent write after the upgrade survives A's sign-out\",1]", "[\"\",\"F7: every sweep moves tagged entries to their owners and still drops the unattributed ones\",1]", "[\"\",\"F8 (codex repro): A paused after reading B's unsent storage cannot overwrite B's newer b2\",1]", "[\"\",\"F8: a message B sent while A's migration was paused is not written back by A\",1]", "[\"\",\"F8: an r5 per-conversation list (atalks_unsent_<actor>_<conv>) is split into message keys on any sweep\",1]", "[\"\",\"F8: at EVERY storage call of A's migration, B's concurrent migration and write keep [b1, b2]\",1]", "[\"\",\"R1 F1 (codex repro): an old tab's write while A's sign-out sweep reads the shared list keeps [b1, b2]\",1]", "[\"\",\"R1 F1: an old tab's write after EVERY storage call of A's sign-out sweep keeps [b1, b2]\",1]", "[\"\",\"R1 F2 (codex repro): a paused migration cannot resurrect a message B already sent\",1]", "[\"\",\"R1 F2: B's claim and send after EVERY storage call of A's migration never resurrect b1\",1]", "[\"\",\"R1 sign-out: a shared list holding only A's entries is deleted\",1]", "[\"\",\"R1 sign-out: an old tab of B writing the shared list at any point of A's sign-out is lost only inside A's read-to-write-back step\",1]", "[\"\",\"R1 sign-out: no storage value holds A's text afterwards; B's entries in the same shared list survive\",1]", "[\"\",\"R1: a sent or discarded message leaves a tombstone, bounded to the 500 newest ids\",1]", "[\"\",\"R1: a sign-out does not let the kept legacy lists hand the account's entries back\",1]", "[\"\",\"R1: a tombstone write that fails (quota) leaves nothing restorable: the copies in the old lists go\",1]", "[\"\",\"R1: an old tab's list is imported for each entry's owner only; unattributed entries are never shown\",1]", "[\"\",\"R1: legacy lists are collected 7 days after the new layout was first seen, after a last copy\",1]", "[\"\",\"R1: the legacy lists are only read: a sweep neither deletes nor rewrites them\",1]"]
---

## What

T-MG-18: tests of the removed legacy storage import go with the code (D-MG-30)

## Why

D-MG-30 removed the legacy storage import, claim, move, tombstone and 7-day collection code. The tests that asserted that behaviour (F7, R1, 7-day, paused-migration and tombstone cases in ui-t16-storage and the import/claim assertions elsewhere) test code that no longer exists; the new rule is covered by test/ui-d-mg-30-legacy-delete.test.ts (legacy keys deleted at sign-in and sign-out, never shown) and the isolation assertions are kept.

## Cost if wrong

If a removed test guarded something beyond the import, the isolation tests and the new D-MG-30 test are the remaining guard.

## Alternatives

None recorded.
