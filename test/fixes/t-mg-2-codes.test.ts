import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LEGACY, legacyOf } from "../../src/core/error-codes.ts";
import { forbidden, conflict, unauthorized } from "../../src/core/errors.ts";
import { fail, json } from "../../src/http/respond.ts";
import type { Res } from "../../src/http/router.ts";
import { bearer, startTestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { createChannel } from "../../src/core/conversations.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { savePage } from "../../src/core/wiki.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|js|sh|md)$/.test(path) ? [path] : [];
  });
}

// Grep code positions, not arbitrary Polish fixture data, internal result strings,
// or the Polish UI translations. The compatibility dictionaries are the only exclusions.
function polishCodeLiterals(source: string): string[] {
  const names = [...new Set(Object.values(LEGACY))].join("|");
  const literal = new RegExp('["\'`](' + names + ')["\'`]', "g");
  const matches = new Map<number, string>();
  const contexts = /\b(?:badRequest|unauthorized|forbidden|notFound|conflict|tooLarge|tooMany|AppError)\s*\(\s*["'`][a-z_]+["'`]|(?:\bcode\s*:|\.code\b)[^\n;]*/g;
  for (const context of source.matchAll(contexts)) {
    for (const hit of context[0].matchAll(literal)) {
      matches.set(context.index + hit.index, hit[1]);
    }
  }
  const keys = new RegExp("^\\s*(" + names + ")\\s*:\\s*msg\\(", "gm");
  for (const hit of source.matchAll(keys)) matches.set(hit.index, hit[1]);
  // MCP assertions can match a code in the rendered error text using a regex.
  const regexCodes = new RegExp("\\b(" + Object.values(LEGACY).filter((code) => code.includes("_")).join("|") + ")\\b", "g");
  for (const context of source.matchAll(/\bassert\.match\([^\n]+/g)) {
    for (const hit of context[0].matchAll(regexCodes)) matches.set(context.index + hit.index, hit[1]);
  }
  return [...matches.values()];
}

// Required migration tables document old codes; all other uses remain checked.
function withoutMigrationRows(path: string, source: string): string {
  if (!["integrations/claude-code-plugin/skills/agenttalks/SKILL.md", "integrations/claude-code/skills/agenttalks/SKILL.md"]
    .includes(path)) return source;
  const rows = new Set(Object.entries(LEGACY).map(([code, oldCode]) => `| \`${oldCode}\` | \`${code}\` |`));
  return source.split("\n").filter((line) => !rows.has(line.trim())).join("\n");
}

test("migration row exceptions retain checks on incorrect mappings and old code usage", () => {
  const path = "integrations/claude-code-plugin/skills/agenttalks/SKILL.md";
  const row = `| \`${LEGACY.token_expired}\` | \`token_expired\` |`;
  const use = `Match code: "${LEGACY.token_expired}"`;
  const incorrect = `| \`${LEGACY.token_expired}\` | \`token_revoked\` |`;
  assert.equal(withoutMigrationRows(path, row), "");
  assert.equal(withoutMigrationRows(path, `${row}\n${use}\n${incorrect}`), `${use}\n${incorrect}`);
  assert.equal(withoutMigrationRows("integrations/other.md", row), row);
  assert.deepEqual(polishCodeLiterals(withoutMigrationRows(path, use)), [LEGACY.token_expired]);
});

test("Polish error code literals have no remaining producers or consumers", (t) => {
  const remaining: string[] = [];
  for (const dir of ["src", "bin", "integrations", "test"]) {
    for (const path of sourceFiles(join(ROOT, dir))) {
      if (path === join(ROOT, "src/core/error-codes.ts")) continue;
      let source = withoutMigrationRows(path.slice(ROOT.length), readFileSync(path, "utf8"));
      if (path === join(ROOT, "src/http/ui/js/api.js")) {
        source = source.replace(/export const LEGACY = \{[\s\S]*?\n\};/, "");
      }
      for (const code of polishCodeLiterals(source)) remaining.push(`${path.slice(ROOT.length)}: ${code}`);
      if (path.endsWith(".md")) {
        for (const code of new Set(Object.values(LEGACY).filter((value) => value.includes("_")))) {
          if (source.includes(code)) remaining.push(`${path.slice(ROOT.length)}: ${code}`);
        }
      }
    }
  }
  t.diagnostic(`${remaining.length} Polish error code literals`);
  assert.equal(remaining.length, 0, remaining.join("\n"));
});

test("legacyOf returns only registered compatibility aliases", () => {
  assert.ok(Object.keys(LEGACY).length >= 80);
  for (const [code, oldCode] of Object.entries(LEGACY)) assert.equal(legacyOf(code), oldCode);
  for (const code of ["csrf", "token", "unknown", "toString", "constructor", "__proto__"]) {
    assert.equal(legacyOf(code), undefined);
  }
});

function captureResponse(send: (res: Res) => void) {
  let status = 0;
  let body: Record<string, unknown> = {};
  const res = {
    writeHead(value: number) { status = value; },
    end(value: string) { body = JSON.parse(value); },
  } as unknown as Res;
  send(res);
  return { status, body };
}

test("error serialization includes aliases for AppError and direct JSON errors only", () => {
  for (const error of [forbidden("no_access", "Denied"), conflict("wiki_conflict", "Read first"), unauthorized("token_expired", "Renew")]) {
    const result = captureResponse((res) => fail(res, error));
    assert.equal(result.status, error.status);
    assert.deepEqual(result.body, { error: error.message, code: error.code, legacyCode: LEGACY[error.code] });
  }
  const direct = captureResponse((res) => json(res, 405, { error: "Use POST", code: "post_only" }));
  assert.equal(direct.body.legacyCode, LEGACY.post_only);
  for (const code of ["csrf", "custom_error", "constructor"]) {
    const result = captureResponse((res) => json(res, 400, { error: "Error", code }));
    assert.deepEqual(result.body, { error: "Error", code });
  }
  const success = { code: "no_access", value: "not an error" };
  assert.deepEqual(captureResponse((res) => json(res, 200, success)).body, success);
});

test("UI compatibility map equals LEGACY and stale server codes retain behavior", async (t) => {
  let status = 409;
  let serverCode = LEGACY.wiki_conflict;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    error: "Read first", code: serverCode,
  }), { status, headers: { "content-type": "application/json" } }));
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => null } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  const ui = await import("../../src/http/ui/js/api.js");
  const reverse = Object.fromEntries(Object.entries(LEGACY).map(([code, oldCode]) => [oldCode, code]));
  assert.deepEqual(ui.LEGACY, reverse);
  for (const code of Object.keys(LEGACY)) {
    assert.equal(ui.describeError({ code: LEGACY[code] }, undefined), ui.describeError({ code }, undefined));
  }
  assert.equal(ui.describeError({ code: LEGACY.wiki_conflict }, { wiki_conflict: "Keep your draft" }), "Keep your draft");
  for (const [raw, expected, httpStatus] of [
    [LEGACY.wiki_conflict, "wiki_conflict", 409],
    ["wiki_conflict", "wiki_conflict", 409],
    [LEGACY.session_not_found, "session_not_found", 404],
    [LEGACY.session_invalid, "session_invalid", 401],
    ["csrf", "csrf", 403],
    ["custom_error", "custom_error", 400],
  ] as const) {
    serverCode = raw;
    status = httpStatus;
    await assert.rejects(() => ui.api("GET", "/api/wiki/example"), { code: expected, status });
  }
});

test("HTTP routes return English code and legacyCode for 403, 409 and 401", async () => {
  const s = await startTestServer();
  try {
    const owner = createActor(s.ctx, { kind: "agent", handle: "owner" });
    const other = createActor(s.ctx, { kind: "agent", handle: "other" });
    const token = mintToken(s.ctx, other.id, "contract").token;
    const channel = createChannel(s.ctx, { slug: "private", kind: "private", createdBy: owner.id });
    savePage(s.ctx, { slug: "contract", title: "Contract", body: "Original", actorId: owner.id });
    const expired = mintToken(s.ctx, other.id, "expired", 1);
    s.ctx.db.prepare("UPDATE tokens SET expires_at = ? WHERE id = ?").run(s.ctx.now() - 1, expired.info.id);

    const cases: Array<[number, string, Response]> = [
      [403, "no_access", await fetch(`${s.url}/api/conversations/${channel.id}/messages`, { headers: bearer(token) })],
      [409, "wiki_conflict", await fetch(`${s.url}/api/wiki/contract`, {
        method: "PUT", headers: bearer(token), body: JSON.stringify({ title: "Contract", body: "Overwrite" }),
      })],
      [401, "token_expired", await fetch(`${s.url}/api/me`, { headers: bearer(expired.token) })],
    ];
    for (const [status, code, response] of cases) {
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, status);
      assert.equal(body.code, code);
      assert.equal(body.legacyCode, LEGACY[code]);
    }
  } finally {
    await s.close();
    s.ctx.db.close();
  }
});
