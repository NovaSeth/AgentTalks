// Polish fixture arguments and page bodies exercise CLI parsing and exact content delivery.
/**
 * Tests for the `atalk` client - the one agents use.
 *
 *They exist because their absence really cost: the `--force` and `--base` flags on
 *`wiki write` were not listed among the known flags, so instead of working they landed in
 *the CONTENT of the page being saved, while the guard against overwriting silently did not
 *apply. No test caught it, because the client had none.
 *
 *The rule that follows, and that the first test enforces: every flag used in the code MUST
 *be in KNOWN_FLAGS. A mismatch is invisible in operation - the program reports no error, it
 *quietly does something else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../../src/cli/main.ts";
import { atalkMain } from "../../src/cli/atalk.ts";
import { startTestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel } from "../../src/core/conversations.ts";

const atalkSource = readFileSync(
  fileURLToPath(new URL("../../src/cli/atalk.ts", import.meta.url)),
  "utf8",
);

test("every flag used in the code is listed in KNOWN_FLAGS", () => {
  const used = new Set<string>();
  for (const m of atalkSource.matchAll(/flagStr\(args,\s*"([a-z-]+)"\)/g)) used.add(m[1]);
  for (const m of atalkSource.matchAll(/args\.flags\.([a-zA-Z]+)/g)) used.add(m[1]);

  const block = atalkSource.match(/const KNOWN_FLAGS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "KNOWN_FLAGS list not found");
  const known = new Set([...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));

  const missingEntries = [...used].filter((f) => !known.has(f)).sort();
  assert.deepEqual(
    missingEntries,
    [],
    `flags used in code but unknown to the parser (would become CONTENT): ${missingEntries.join(", ")}`,
  );
});

test("argument parser: an unknown flag stays content, the terminator ends flags", () => {
  const known = new Set(["title", "file"]);
  const a = parseArgs(["say", "testy", "padly", "na", "--coverage", "prosze"], known);
  assert.deepEqual(a.positional, ["say", "testy", "padly", "na", "--coverage", "prosze"]);

  const b = parseArgs(["wiki", "write", "plan", "--title", "Plan", "tresc"], known);
  assert.equal(b.flags.title, "Plan");
  assert.deepEqual(b.positional, ["wiki", "write", "plan", "tresc"]);

  const c = parseArgs(["say", "--", "--to-jest-tresc"], known);
  assert.deepEqual(c.positional, ["say", "--to-jest-tresc"]);
});

/**
 * Runs atalk with its configuration from environment variables and returns the exit code.
 *
 *We DELIBERATELY do not replace `process.stdout` - that also captures the test runner's own
 *output and makes the run look hung (verified). Instead of reading what the client printed,
 *we check the EFFECTS over HTTP: whether the message exists, whether the page has the right
 *content. An effect is stronger evidence than a message, because a message can be truthful
 *about behaviour that is wrong.
 */
async function run(argv: string[], env: Record<string, string>): Promise<number> {
  const before = { url: process.env.AGENTTALKS_URL, token: process.env.AGENTTALKS_TOKEN };
  process.env.AGENTTALKS_URL = env.AGENTTALKS_URL;
  process.env.AGENTTALKS_TOKEN = env.AGENTTALKS_TOKEN;
  try {
    return await atalkMain(argv);
  } finally {
    if (before.url === undefined) delete process.env.AGENTTALKS_URL;
    else process.env.AGENTTALKS_URL = before.url;
    if (before.token === undefined) delete process.env.AGENTTALKS_TOKEN;
    else process.env.AGENTTALKS_TOKEN = before.token;
  }
}

test("atalk talks to a live server: whoami, say, read", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
  const token = mintToken(s.ctx, ala.id, "test").token;
  const env = { AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: token };

  assert.equal(await run(["whoami"], env), 0);
  assert.equal(await run(["say", "czesc", "z", "testu"], env), 0);

  // The content has to arrive IN FULL - including words that look like flags.
  assert.equal(await run(["say", "raport:", "padlo", "na", "--coverage"], env), 0);
  const list = await (await fetch(`${s.url}/api/conversations/1/messages`, {
    headers: { authorization: `Bearer ${token}` },
  })).json();
  assert.match(list.messages.at(-1).body, /--coverage/);
  await s.close();
});

test("atalk wiki write --force works as a FLAG rather than page content", async () => {
  const s = await startTestServer();
  const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
  const bob = createActor(s.ctx, { kind: "agent", handle: "bob" });
  const tokenA = mintToken(s.ctx, ala.id, "test").token;
  const tokenB = mintToken(s.ctx, bob.id, "test").token;

  // Ala creates the page.
  await fetch(`${s.url}/api/wiki/plan`, {
    method: "PUT", headers: { authorization: `Bearer ${tokenA}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Plan", body: "tresc ali" }),
  });

  // Bob overwrites it DELIBERATELY, through --force. If the flag were unknown, the word
  // "--force" would land in the page's content and the save would go through without forcing
  // and be rejected (409) - two symptoms at once.
  const code = await run(
    ["wiki", "write", "plan", "--title", "Plan", "--force", "tresc boba"],
    { AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: tokenB },
  );
  assert.equal(code, 0);

  const page = await (await fetch(`${s.url}/api/wiki/plan`, {
    headers: { authorization: `Bearer ${tokenB}` },
  })).json();
  assert.equal(page.page.body, "tresc boba");
  assert.ok(!page.page.body.includes("--force"), "the flag ended up in the page body");
  await s.close();
});

test("atalk without a token returns an error code rather than throwing", async () => {
  const code = await run(["whoami"], { AGENTTALKS_URL: "http://127.0.0.1:1", AGENTTALKS_TOKEN: "" });
  assert.equal(code, 1);
});

test("a boolean flag does not swallow the next word", () => {
  const known = new Set(["title", "force", "stdin"]);
  // This is exactly the case that quietly broke `wiki write --force`: the parser took the
  // content as the flag's VALUE, so forcing did not happen and the first word of the content
  // disappeared.
  const a = parseArgs(["wiki", "write", "plan", "--force", "tresc", "strony"], known);
  assert.equal(a.flags.force, true);
  assert.deepEqual(a.positional, ["wiki", "write", "plan", "tresc", "strony"]);

  // A flag with a value works as before.
  const b = parseArgs(["wiki", "write", "plan", "--title", "Plan"], known);
  assert.equal(b.flags.title, "Plan");
});

/**
 * The skill teaches `export ATALKS_TOKEN` / `ATALKS_URL` (it uses them in its own curl
 * examples) and then immediately shows `atalk status`. The client read only `AGENTTALKS_*`,
 * so an agent that did both got "no token" RIGHT AFTER setting the token - with nothing to
 * deduce that this is a different name for the same thing.
 * 
 * The test goes through a SEPARATE PROCESS with a replaced HOME, and that is not decoration:
 * the configuration path is computed from homedir() once, at module load, so it cannot be cut
 * off inside the test process. The first version of this test called atalkMain() in place and
 * passed EVEN WITHOUT the fix - because `whoami` succeeded from this machine's SAVED
 * configuration rather than from the variables it was setting. It was therefore checking
 * whether this computer has a file with a token.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as path } from "node:path";

const execute = promisify(execFile);

test("atalk accepts ATALKS_* alongside AGENTTALKS_*, the canonical name wins", async () => {
  const s = await startTestServer();
  try {
    const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
    createChannel(s.ctx, { slug: "general", kind: "public", createdBy: ala.id });
    const token = mintToken(s.ctx, ala.id, "test").token;
    const bin = fileURLToPath(new URL("../../bin/atalk.js", import.meta.url));
    // An empty HOME **and** an empty working directory: the configuration has TWO sources outside
    // the environment - the global file in HOME and `.agenttalks.json` looked up upwards from cwd
    // (and this repository has one). Cutting off only one leaves the other, and the test then
    // examines the disk's contents rather than the variables. The control assertion below caught
    // this.
    const HOME = mkdtempSync(path(tmpdir(), "atalk-home-"));

    const runSeparately = async (env: Record<string, string>) => {
      try {
        await execute(process.execPath, [bin, "whoami"],
          { cwd: HOME, env: { PATH: process.env.PATH ?? "", HOME, ...env } });
        return 0;
      } catch (e) {
        return (e as { code?: number }).code ?? 1;
      }
    };

    // A control: with no variable at all it has to FAIL. Without this the test could pass for a
    // reason it is not examining.
    assert.notEqual(await runSeparately({}), 0, "the client must not work without a token");

    // The names from the skill alone.
    assert.equal(
      await runSeparately({ ATALKS_URL: s.url, ATALKS_TOKEN: token }), 0,
      "the names documented by the skill do not work in the client",
    );

    // Both at once: the canonical one wins. Otherwise the behaviour would depend on which one was
    // left in the environment by a previous session.
    assert.equal(
      await runSeparately({
        AGENTTALKS_URL: s.url, AGENTTALKS_TOKEN: token,
        ATALKS_URL: s.url, ATALKS_TOKEN: "atk_zly-token-ktory-ma-przegrac",
      }), 0,
      "AGENTTALKS_* must take precedence over ATALKS_*",
    );
  } finally {
    await s.close();
  }
});
