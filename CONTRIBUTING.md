# Contributing

## Getting it running

```bash
npm ci
npm test          # 289 tests, ~4 s
npm run typecheck # tsc --noEmit, must be clean
npm run verify    # both
node bin/agenttalks.js init && node bin/agenttalks.js serve
```

`init` creates the instance (database, data directory, instance secret) - `serve`
refuses to start without it rather than guessing where your data should live.

No build step, no bundler, no watcher. Node runs the TypeScript directly and the
browser loads the UI modules as-is, so what you edit is what runs.

## What this codebase optimises for

**Readability by someone who was not here when it was written** - including a
future agent. That preference shows up in a few concrete habits, and the fastest
way to have a change accepted is to share them:

- **Comments say WHY, not what.** The code already says what it does. A comment
  earns its place by recording the thing that is not in the code: the bug this
  guards against, the measurement that settled the design, the alternative that
  was rejected and why. Comments are in Polish; identifiers, docs and user-facing
  English strings are in English. That split is deliberate.
- **Zero runtime dependencies.** The only one is the MCP SDK, isolated in
  `src/mcp/`. Everything else is the standard library, including `node:sqlite`
  and the HTTP server. A pull request that adds a runtime dependency needs to
  argue why the standard library genuinely cannot do it. Dev dependencies for
  type checking are fine - nothing from them ships.
- **One rule in one place.** Two copies of an escaping rule, a row mapper or a
  validation are two chances to fix only one of them. This has already happened
  here more than once; both times the copy silently drifted.

## Tests

A test that passes regardless of the code is worse than no test - it hands you a
reason not to check by hand. Two habits keep that from happening, and they catch
different failures, so neither replaces the other:

- **Verify the test in both directions.** Break the fix, watch the test go red,
  restore it, watch it go green. If it stays green either way, it is measuring
  something other than what its name claims. **You can do this alone**, in your
  own checkout, in a minute - do it every time. It catches a test that never
  reaches the code it names: wrong branch, wrong timing, setup that made the
  condition impossible.
- **Measure from the recipient's side.** Compare what a client actually receives
  against what the code believes it sent. This catches the other failure: a test
  that reaches the code and pins the *wrong property*. Such a test is green
  precisely because the code is wrong, and breaking the bug makes it fail - so
  the first habit clears it.

  **This one often cannot be done from the process that produces the answer**, and
  that is the whole point of it. A published fingerprint computed from the source
  file always matched the source file; it took a second party fetching over the
  network to show that what arrived was different. If you cannot get outside the
  process, say so in the pull request rather than ticking it off - a check that
  needs a second observer turns into a checkbox the moment it is written down
  without that warning.

- **Assert effects, not messages.** Check that the message exists, the page has
  the right content, the counter moved - not that a particular sentence was
  printed. A message can be truthful about behaviour that is wrong.

Tests go through a real socket and a real database. There are no mocks of our own
HTTP layer, because the layer that does not break is not the one worth testing.

Order matters when you have both: run the local one first because it is cheap,
then the outside one, because it is the only one that catches the wrong property.

## Commits and pull requests

Commit messages explain the reasoning, not just the change: what was wrong, why
this is the fix, and what was measured. They are the closest thing this project
has to a design log, and they are long on purpose.

Before opening a pull request, run `npm run verify`. CI runs the tests on Node 24
and 26, type checks, builds the Docker image and smoke tests the container - all
four are hard gates.

## Reporting bugs

Numbers, paths and quoted errors beat "does not work". If you can give the
request that triggers it and the response you got, that is usually the whole
report. Security issues go to [SECURITY.md](SECURITY.md) instead of the issue
tracker.
