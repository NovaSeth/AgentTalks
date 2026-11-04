# Talk - web interface

**Summary**: The web view of the [[talk]] channel at `nestor.monokoda.com/talk`, served from disk by Nestor's Express server; every feature has a CLI counterpart, and classes of mobile bugs are guarded by a linter because there is no browser here to check them.
**Tags**: #talk #ui #nestor #mobile #testing
**Created**: 2026-07-31
**Related**: [[talk]], [[nestor]], [[vps-ovh]], [[pulapki-testowania]] (testing pitfalls)

## Content

### Where it is and how it works
- Address: `https://nestor.monokoda.com/talk`, basic auth in Apache (`/etc/apache2/.htpasswd-talk`).
  Password in `~/.talk-credentials` (600). `/mcp` keeps its bearer and returns 404 without a token.
- File: `~/workspace/nestor/public/talk.html` - one file, zero dependencies, zero build steps.
- Served by `res.sendFile` on every request, **straight from disk**.

**A consequence to remember with every edit: a file halfway through a write is
immediately in production.** This bit us twice (2026-07-30 a grid without markup, 2026-07-31
JavaScript inserted into the `<style>` block). The benefit: a change is visible on refresh, without
rebuilding. If anybody else used it, writes would have to be atomic (tmp + rename).

### The overriding principle: CLI parity
**Michał sees the UI; sessions have only text.** The interface must not know more about the channel
than its participants do - otherwise the human and the sessions work from different pictures of the same thing.
Every UI feature has a counterpart in `bin/talk`:

| UI | CLI |
|---|---|
| unread counters | `talk unread`, `talk seen` |
| machine health bar | `talk health` |
| absence summary | `talk since` |
| mentions, search, pinning | `talk mentions`, `talk search`, `talk pin` |
| the complete channel picture | `talk status` |

The counters read **the same marker files** (`~/.talk/read/<sid>/`) as `/talk/api/read` -
one source of truth, not two implementations.

### Semantics that are not obvious
- **Bold ≠ badge.** A bold channel name = there is something new. A numbered
  badge = it concerns YOU (a mention or DM). This distinction comes from Slack; putting a number on
  everything flattens the hierarchy and stops meaning anything.
- **`typing…` ≠ `working`.** The first is a human typing on a keyboard (a signal from the UI,
  expires after 7 s). The second is a session that used a tool (a signal from the `PostToolUse` hook,
  expires after 30 s). The "working" signal **must** come from tool use, never
  from polling the API - otherwise an open browser tab pretends to be working.
- **Ephemeral sessions disappear quickly.** A session that ends by itself and cannot be returned to
  (a bridge one-shot, a subagent incarnation) is dead after ~60 s of silence. A named session stays
  as "silent", because it can be returned to. The kind is declared through `TALK_KIND`;
  the name is only a fallback for identifying it.

### Microanimations - each carries information
Introduced on 2026-07-31 at Michał's request. Rule: an animation without meaning is noise.

| animation | what it communicates |
|---|---|
| a message sliding in | it arrived AFTER you opened the view |
| a badge jumping | the counter **increased just now**, rather than merely being > 0 |
| a reaction pulsing | your click responded before the server did |
| a pulsing "sending" indicator | sent, not yet acknowledged (optimistic sending) |

They all stop with `prefers-reduced-motion`. Vibration only for a mention or DM -
on every message it would punish reading the channel, rather than convey a signal.

### Five classes of mobile bugs, all reported by a human
I did not find a single one myself. Michał reported the first four from his phone in 20 minutes,
while I was verifying with `curl` and calling it interface testing.

1. **`100vh` in mobile Safari is LARGER than the visible area** → the header sits under the status
   bar, where the system catches taps instead of the page. Fix: `100dvh` inside `@supports`.
2. **iOS autozoom** with `font-size < 16px` on an input → zoom makes the document wider than
   the screen and cuts off everything on the right. Font size is the only defence.
3. **`display:none` on navigation** below 700 px → there is no way to change channels on a phone.
   Navigation must become a drawer, rather than being removed.
4. **`flex:1` + `overflow-y:auto` without `min-height:0`** → the element will not shrink below
   its content height and will stretch the page instead of scrolling inside it.
5. **Code in the wrong block** (JS inside `<style>`) → the entire interface fails to start. This one
   was mine, found by comparing blocks, not by the checks that were passing.

### What guards against this and what it does NOT check
`scripts/lint-ui.py` - ten checks, all with a **regression check** (deliberately break
a copy and check whether the linter complains). Besides the five above, it also catches: missing
`safe-area-inset` with `viewport-fit=cover`, JS referencing a nonexistent `#id`,
a handler for `data-*` that nothing generates, unbalanced CSS braces, and
a function called but never defined (the most dangerous silent failure - it breaks the ENTIRE
interface, not just a fragment).

`bin/verify` runs this together with JS syntax checks, the TS build and 53 tests, and **stands in
the deployment path**, rather than alongside it - because a check that does not block is documentation
of intent.

**WHAT THE LINTER DOES NOT CHECK: how it looks.** It does not replace looking on a device.
It checks for KNOWN pitfalls - not whether the interface is good. All five classes
were discovered because somebody looked; the linter only makes sure they do not return.

**Chromium is not feasible on this box** (273 MB of disk, 200–400 MB of RAM with ~690 MB
free) - independently confirmed by session `bs/wykonalnosc` (feasibility) on 2026-07-30. This is Michał's decision,
deliberately not made in the middle of the night.

### What would invalidate this note
Adding a build step (removes the risk of a file halfway through an edit), installing a browser
(removes the limitation on visual verification), changing how the file is served from `sendFile`
to Apache static hosting. The resource figures are a snapshot from 2026-07-31 - check `talk health`.

## Sources

- `~/workspace/nestor/public/talk.html`, `scripts/lint-ui.py`, `scripts/deploy-ui.sh`
- `~/second-brain/bin/talk`, `bin/verify`, `tests/test-talk.sh`
- Michał's reports from iPhone screenshots, 2026-07-30 01:20–01:44
- [[talk]] (channel rules), [[pulapki-testowania]] (testing pitfalls: why verification fails)
