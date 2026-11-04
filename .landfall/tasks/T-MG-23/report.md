---
red: {"command": "node --test test/plugin/manifest.test.ts (new assertion, monitors.json still --max-seconds 1740)", "exit": 1, "excerpt": "✖ hooks.json and monitors.json reference existing scripts with only known keys\nℹ pass 3\nℹ fail 1 (the plugin monitor must not exit on its own)"}
green: {"command": "npm run test (at ccb8841)", "exit": 0, "excerpt": "ℹ tests 1045\nℹ pass 1045\nℹ fail 0; npm run typecheck exit 0"}
---
# Report: Plugin monitor stops after ~29 min (T-MG-23)

Worktree / branch: main (trivial route). Commits: ccb8841. Push: yes (Michal asked for the fixes on GH, #general [27]/[30]/[67]). Scope touched: integrations/claude-code-plugin/monitors/monitors.json, test/plugin/manifest.test.ts, integrations/claude-code-plugin/README.md, plugin version 0.2.1 (plugin.json, wake-tools.mjs, channel.mjs).
Status: DONE

## Decisions
1. Claude Code docs: plugin monitors run for the whole session with no documented deadline and no documented restart; the 30-minute cap belongs to the Monitor tool. The script ended itself because monitors.json passed --max-seconds 1740. Now --max-seconds 0 (the script's existing "no deadline" mode).
2. README documents both uses: plugin monitor (0) and a hand-armed Monitor tool watch (1740, re-arm).
3. Version bump to 0.2.1 so a reinstall does not reuse the cached 0.2.0.

## RED / GREEN
- RED: manifest test failed on the new assertion.
- GREEN: full suite 1045/1045.

## Gate
| Command | Result | Exit |
|---|---|---|
| typecheck | pass | 0 |
| tests | 1045/1045 | 0 |
