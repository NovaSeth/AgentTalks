---
red: {"command": "node --test test/fixes/t-mg-11-hardening.test.ts test/fixes/t-mg-7-data.test.ts (cap removed locally: cap 1e9 in src/core/digest.ts and unread.ts, count asserts bypassed; restored)", "exit": 1, "excerpt": "digestFor cost grew with history: median 300k/20k ratio 53.90 (20k min 17.75 ms, 300k min 830.36 ms); unreadFor cost grew with history: median 300k/20k ratio 29.42 (20k min 5.96 ms, 300k min 170.42 ms)"}
green: {"command": "landfall heavy -- npm run test; npm run typecheck", "exit": 0, "excerpt": "tests 1144, pass 1144, fail 0; typecheck exit 0"}
---
Status: DONE

Commit: 2d287d9 (branch task/T-MG-48-ratio-guards-load). Only the two test files changed.

Change: datasets built once each, 9 interleaved (small, large) pairs, verdict = median of per-pair ratios, threshold 10 (D-MG-36 comment in both tests).

Regression ratios (cap removed, median of 9 pairs, 3 runs): digestFor 28 to 70x; unreadFor 23 to 35x. Capped, unloaded: digestFor 0.9-1.15, unreadFor 1.3-2.2. Threshold 10 leaves 4.5x+ above capped and 2.3x+ below the lowest regression.

Load tolerance: 8 busy-loop node processes running (load average ~78), 10 runs each: digest 10/10, unread 10/10 (ratios 0.84-1.46 and 1.94-2.21).

Gate: full suite 1144/1144 pass, typecheck exit 0. No test removed or skipped.
