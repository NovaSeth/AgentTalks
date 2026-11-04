---
red: {"command": "node --test test/plugin/wake-tools.test.ts", "exit": 1, "excerpt": "fail 4: result of 3002647 characters exceeds 50000 (50 x 60000-char messages, read_conversation)"}
green: {"command": "landfall heavy -- npm run test", "exit": 0, "excerpt": "tests 1107, pass 1107, fail 0; npm run typecheck exit 0"}
---
Status: DONE

1. Budget and cursor: wake-tools.mjs now uses budgeted/frameItem/idAt, exported from lib/tools.mjs (one implementation). Results are at most 50 000 characters. read_conversation (latest/before) pages back with before=, (around/after) forward with after=; read_thread pages with after=. Added optional params: read_conversation.before, read_thread.after and limit. Tool names and set, bridge lists and principal checks are unchanged.
2. Framing unchanged: same PREAMBLE, plugin header, every body line quoted.
3. Tests: 4 new in test/plugin/wake-tools.test.ts (50 x 60 000 chars: backward walk, forward walk, thread walk, each within budget and reaching all 50 once; version check). Red first (commit 1), green after.
4. No test removed or weakened. test/plugin/full-api.test.ts version regexes moved 0.3.0 to 0.3.1 as the brief requires.
5. Version 0.3.1 in plugin.json, server/channel.mjs, scripts/wake-tools.mjs.

Follow-up/concern: a single message over 40 000 characters is now cut (as in the channel tools) with a note; before, the woken run got up to 64 KiB whole. The woken run has no way to read the rest.
