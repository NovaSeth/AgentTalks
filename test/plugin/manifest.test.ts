/**
 * The plugin's packaging: the marketplace entry, plugin.json, hooks and monitors point at
 * files that exist, the channel binds to a declared MCP server, the token option is
 * sensitive, and the plugin has ZERO runtime dependencies (it must run from a git checkout
 * without npm install: only node: built-ins and relative imports).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PLUGIN = join(ROOT, "integrations", "claude-code-plugin");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const resolveRoot = (s: string) => s.replace("${CLAUDE_PLUGIN_ROOT}", PLUGIN);

test("marketplace.json lists the plugin by a ./ path that holds a plugin manifest", () => {
  const m = json(join(ROOT, ".claude-plugin", "marketplace.json"));
  assert.equal(m.name, "agenttalks");
  assert.ok(m.owner?.name);
  const entry = m.plugins.find((p: any) => p.name === "agenttalks");
  assert.ok(entry);
  assert.match(entry.source, /^\.\//);
  assert.ok(!entry.source.includes(".."));
  assert.ok(existsSync(join(ROOT, entry.source, ".claude-plugin", "plugin.json")));
});

test("plugin.json: the channel binds to its MCP server, the token is sensitive, paths exist", () => {
  const p = json(join(PLUGIN, ".claude-plugin", "plugin.json"));
  assert.equal(p.name, "agenttalks");
  const servers = Object.keys(p.mcpServers);
  assert.deepEqual(servers, ["agenttalks"]);
  const srv = p.mcpServers.agenttalks;
  assert.equal(srv.command, "node");
  assert.ok(existsSync(resolveRoot(srv.args[0])), srv.args[0]);
  assert.equal(p.channels.length, 1);
  assert.equal(p.channels[0].server, "agenttalks");
  const cfg = p.channels[0].userConfig;
  assert.equal(cfg.token.sensitive, true);
  for (const opt of Object.values(cfg) as any[]) {
    for (const k of Object.keys(opt)) {
      assert.ok(["type", "title", "description", "required", "default", "sensitive"].includes(k), `unknown userConfig key ${k}`);
    }
  }
  assert.equal(srv.env.AGENTTALKS_TOKEN, "${user_config.token}");
});

test("hooks.json and monitors.json reference existing scripts with only known keys", () => {
  const h = json(join(PLUGIN, "hooks", "hooks.json"));
  const events = Object.keys(h.hooks).sort();
  assert.deepEqual(events, ["SessionEnd", "SessionStart"]);
  for (const ev of events) {
    for (const group of h.hooks[ev]) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, "command");
        assert.ok(existsSync(resolveRoot(hook.args[0])), hook.args[0]);
      }
    }
  }
  const mons = json(join(PLUGIN, "monitors", "monitors.json"));
  assert.equal(mons.length, 1);
  for (const m of mons) {
    for (const k of Object.keys(m)) assert.ok(["name", "command", "description", "when"].includes(k), k);
    assert.ok(!m.command.includes("user_config"), "monitors cannot use user_config");
    const script = /"\$\{CLAUDE_PLUGIN_ROOT\}([^"]+)"/.exec(m.command)?.[1];
    assert.ok(script && existsSync(join(PLUGIN, script)), m.command);
  }
});

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map((f) => join(dir, f))
    .filter((f) => /\.(mjs|json)$/.test(f));
}

test("zero runtime dependencies: only node: built-ins and relative imports; ASCII-only sources", () => {
  const list = files(PLUGIN);
  assert.ok(list.length >= 15, `only ${list.length} files found`);
  for (const f of list) {
    const src = readFileSync(f, "utf8");
    // No invisible or bidi characters can hide in the code the agent runs.
    assert.ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(src), `${f} has a non-ASCII character`);
    if (!f.endsWith(".mjs")) continue;
    for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"|^\s*import\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/gm)) {
      const spec = m[1] ?? m[2] ?? m[3];
      assert.ok(spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"), `${f} imports ${spec}`);
    }
  }
});
