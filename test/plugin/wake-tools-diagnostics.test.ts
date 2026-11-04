/**
 * T-MG-18 item 4 (B-MG-107): when GET /api/me fails with an HTTP error the wake tools returned
 * errors but printed nothing. They now say why on stderr, once per kind of failure, from the status
 * code and a fixed sentence (never the token or the server's text). A refused token (401/403) is
 * final; a 5xx or a network failure is asked again on the next call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWakeTools } from "../../integrations/claude-code-plugin/scripts/wake-tools.mjs";
import { ApiError } from "../../integrations/claude-code-plugin/lib/api.mjs";

const TOKEN = "atk_diag_" + "SYNTH"; // SYNTH: a synthetic test value, not a credential
const URL_ = "https://a.example";
const env = { AGENTTALKS_EXPECT_SERVER_URL: URL_, AGENTTALKS_EXPECT_ACTOR: "nestor", AGENTTALKS_EXPECT_ACTOR_ID: "7" };
const identity = { url: URL_, token: TOKEN, source: "global" as const };

/** `answers` is consumed per GET /api/me: an Error is thrown, anything else is returned. */
function setup(answers: Array<Error | { actor: { handle: string; id: number } }>) {
  const lines: string[] = [];
  const calls: string[] = [];
  const tools = createWakeTools({
    identity, env, log: (l: string) => lines.push(l),
    apiFor: () => ({
      get: async (path: string) => {
        calls.push(path);
        if (path !== "/api/me") return { messages: [] };
        const a = answers.shift();
        if (a instanceof Error) throw a;
        return a;
      },
      post: async () => ({}),
    }) as any,
  }).tools;
  return { tools, lines, calls };
}
const ARGS: Record<string, any> = {
  read_conversation: { conversation_id: 3 }, read_thread: { message_id: 4 },
  reply: { conversation_id: 3, body: "hi" }, mark_read: { conversation_id: 3, message_id: 4 },
};
const NAMES = ["read_conversation", "read_thread", "reply", "mark_read"];

test("B-MG-107: a 401 from /api/me prints ONE sanitized stderr line across all four handlers, and stays final", async () => {
  const { tools, lines, calls } = setup([new ApiError(`GET /api/me: HTTP 401 ${TOKEN}`, 401)]);
  for (const name of NAMES) {
    const r = await tools[name].handler(ARGS[name]);
    assert.equal(r.isError, true, name);
  }
  assert.equal(lines.length, 1, lines.join(" | "));
  assert.match(lines[0], /HTTP 401/);
  assert.ok(!lines[0].includes(TOKEN), "the token is never printed");
  assert.equal(calls.filter((p) => p === "/api/me").length, 1, "401 is final: /api/me is not asked again");
});

test("B-MG-107: a 403 is final too, with its own status in the line", async () => {
  const { tools, lines, calls } = setup([new ApiError("GET /api/me: HTTP 403", 403)]);
  await tools.read_thread.handler(ARGS.read_thread);
  await tools.mark_read.handler(ARGS.mark_read);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /HTTP 403/);
  assert.equal(calls.length, 1);
});

test("B-MG-107: a 503 then a success is retried: one notice, then the tool works", async () => {
  const { tools, lines, calls } = setup([new ApiError("GET /api/me: HTTP 503", 503), { actor: { handle: "nestor", id: 7 } }]);
  const first = await tools.read_conversation.handler(ARGS.read_conversation);
  assert.equal(first.isError, true);
  const second = await tools.read_conversation.handler(ARGS.read_conversation);
  assert.notEqual(second.isError, true, String(second.text));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /HTTP 503/);
  assert.equal(calls.filter((p) => p === "/api/me").length, 2, "the transient failure was asked again");
});

test("B-MG-107: repeated 503s print once; a network failure is its own kind with its own line", async () => {
  const { tools, lines } = setup([
    new ApiError("GET /api/me: HTTP 502", 502), new ApiError("GET /api/me: HTTP 503", 503),
    new ApiError("GET /api/me: network error", 0),
  ]);
  for (const name of ["read_conversation", "read_thread", "reply"]) await tools[name].handler(ARGS[name]);
  assert.equal(lines.length, 2, lines.join(" | "));
  assert.match(lines[0], /HTTP 502/);
  assert.doesNotMatch(lines[1], /HTTP/);
});
