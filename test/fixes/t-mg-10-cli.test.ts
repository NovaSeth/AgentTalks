import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atalkMain } from "../../src/cli/atalk.ts";
import { startTestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel } from "../../src/core/conversations.ts";

const CFG_DIR = mkdtempSync(join(tmpdir(), "atalk-cfg-"));
const KEYS = ["AGENTTALKS_URL", "ATALKS_URL", "AGENTTALKS_TOKEN", "ATALKS_TOKEN", "AGENTTALKS_CONFIG_DIR"];

async function run(argv: string[], env: Record<string, string>, cwd?: string):
  Promise<{ code: number; err: string }> {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const oldCwd = process.cwd();
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { AGENTTALKS_CONFIG_DIR: CFG_DIR }, env);
  if (cwd) process.chdir(cwd);
  const realErr = process.stderr.write.bind(process.stderr);
  let err = "";
  (process.stderr as { write: unknown }).write = (c: string | Uint8Array) => { err += String(c); return true; };
  try {
    return { code: await atalkMain(argv), err };
  } finally {
    (process.stderr as { write: unknown }).write = realErr;
    process.chdir(oldCwd);
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

async function setup() {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  return { s, token: mintToken(s.ctx, ala.id, "t").token };
}

test("B-MG-20c: an EMPTY AGENTTALKS_URL / AGENTTALKS_TOKEN does not shadow the other names", async () => {
  const { s, token } = await setup();
  const r = await run(["whoami"], {
    AGENTTALKS_URL: "", ATALKS_URL: s.url, AGENTTALKS_TOKEN: "", ATALKS_TOKEN: token,
  });
  assert.equal(r.code, 0, r.err);
  await s.close();
});

test("B-MG-20a: a token over plain http to a non-loopback host warns on stderr; loopback does not", async () => {
  const r = await run(["whoami"], { AGENTTALKS_URL: "http://atalk-host.invalid:8787", AGENTTALKS_TOKEN: "atk_x" });
  assert.match(r.err, /plain http/);
  const { s, token } = await setup();
  const ok = await run(["whoami"], { AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: token });
  assert.doesNotMatch(ok.err, /plain http/);
  await s.close();
});

test("B-MG-20b: a project .agenttalks.json not written by atalk warns; login writes the marker", async () => {
  const { s, token } = await setup();
  const dir = mkdtempSync(join(tmpdir(), "atalk-proj-"));
  writeFileSync(join(dir, ".agenttalks.json"), JSON.stringify({ url: s.url, token }));
  const r = await run(["whoami"], {}, dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /not written by atalks login/);
  const dir2 = mkdtempSync(join(tmpdir(), "atalk-proj-"));
  const login = await run(["login", "--url", s.url, "--token", token, "--local"], {}, dir2);
  assert.equal(login.code, 0, login.err);
  assert.equal(JSON.parse(readFileSync(join(dir2, ".agenttalks.json"), "utf8")).writtenBy, "atalk");
  const again = await run(["whoami"], {}, dir2);
  assert.doesNotMatch(again.err, /not written by atalks login/);
  await s.close();
});
