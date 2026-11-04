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

## Fix round 1

Status: DONE

1. Budget and cursor: wake-tools.mjs now uses budgeted/frameItem/idAt, exported from lib/tools.mjs (one implementation). Results are at most 50 000 characters. read_conversation (latest/before) pages back with before=, (around/after) forward with after=; read_thread pages with after=. Added optional params: read_conversation.before, read_thread.after and limit. Tool names and set, bridge lists and principal checks are unchanged.
2. Framing unchanged: same PREAMBLE, plugin header, every body line quoted.
3. Tests: 4 new in test/plugin/wake-tools.test.ts (50 x 60 000 chars: backward walk, forward walk, thread walk, each within budget and reaching all 50 once; version check). Red first (commit 1), green after.
4. No test removed or weakened. test/plugin/full-api.test.ts version regexes moved 0.3.0 to 0.3.1 as the brief requires.
5. Version 0.3.1 in plugin.json, server/channel.mjs, scripts/wake-tools.mjs.

Follow-up/concern: a single message over 40 000 characters is now cut (as in the channel tools) with a note; before, the woken run got up to 64 KiB whole. The woken run has no way to read the rest.

## Fix round 1
- F1: read_conversation now passes more = (API page full) to the shared budgeted(), so a cursor is printed whenever the page was full or the budget cut it, never inferred from the trimmed page. Test: 90 mixed-size messages, default limit, follows before= to the end, every id once.
- F2: optional body_offset on read_conversation (with around) and read_thread (reads message_id only). Bodies are shown in parts of at most 30 000 characters (chunk from lib/tools.mjs, now exported); a cut ends with "[message cut: N more characters; continue with read_conversation conversation_id=C around=ID limit=1 body_offset=N]" (read_thread: "read_thread message_id=ID body_offset=N"). No new tools, names unchanged. Test walks a 60 000-char message to END-MARKER in both tools.
- Test change (not weakened): the earlier backward-walk test now stops on the "no messages in that range" answer, which a full last page legitimately yields once the cursor is printed there.
- Green: landfall heavy -- npm run test exit 0, 1109/1109; typecheck exit 0.

## Fix round 2

Status: DONE

1. Budget and cursor: wake-tools.mjs now uses budgeted/frameItem/idAt, exported from lib/tools.mjs (one implementation). Results are at most 50 000 characters. read_conversation (latest/before) pages back with before=, (around/after) forward with after=; read_thread pages with after=. Added optional params: read_conversation.before, read_thread.after and limit. Tool names and set, bridge lists and principal checks are unchanged.
2. Framing unchanged: same PREAMBLE, plugin header, every body line quoted.
3. Tests: 4 new in test/plugin/wake-tools.test.ts (50 x 60 000 chars: backward walk, forward walk, thread walk, each within budget and reaching all 50 once; version check). Red first (commit 1), green after.
4. No test removed or weakened. test/plugin/full-api.test.ts version regexes moved 0.3.0 to 0.3.1 as the brief requires.
5. Version 0.3.1 in plugin.json, server/channel.mjs, scripts/wake-tools.mjs.

Follow-up/concern: a single message over 40 000 characters is now cut (as in the channel tools) with a note; before, the woken run got up to 64 KiB whole. The woken run has no way to read the rest.

## Fix round 1
- F1: read_conversation now passes more = (API page full) to the shared budgeted(), so a cursor is printed whenever the page was full or the budget cut it, never inferred from the trimmed page. Test: 90 mixed-size messages, default limit, follows before= to the end, every id once.
- F2: optional body_offset on read_conversation (with around) and read_thread (reads message_id only). Bodies are shown in parts of at most 30 000 characters (chunk from lib/tools.mjs, now exported); a cut ends with "[message cut: N more characters; continue with read_conversation conversation_id=C around=ID limit=1 body_offset=N]" (read_thread: "read_thread message_id=ID body_offset=N"). No new tools, names unchanged. Test walks a 60 000-char message to END-MARKER in both tools.
- Test change (not weakened): the earlier backward-walk test now stops on the "no messages in that range" answer, which a full last page legitimately yields once the cursor is printed there.
- Green: landfall heavy -- npm run test exit 0, 1109/1109; typecheck exit 0.

## Fix round 2
- F3: three tests with newline-free 60 000-char bodies (read_conversation backwards and forwards, read_thread), each walking the cursor to all 50 ids within 50 000 characters. Existing assertions untouched; test-only.
- Mutation evidence: with the size check in budgeted() (lib/tools.mjs) bypassed (`if (false) break;`, not committed), the 3 new tests FAIL (pass 16 / fail 3); restored via git checkout, pass 19 / fail 0.
- Green: landfall heavy -- npm run test exit 0, 1112 tests.
