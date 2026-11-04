/** T-MG-11 item 4 (B-MG-89): an open SSE stream is closed by the ping re-validation. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bearer, startTestServer } from "../http-helpers.ts";
import { createActor, setDisabled } from "../../src/core/actors.ts";
import { listTokens, mintToken, revokeToken } from "../../src/core/tokens.ts";
import { setSsePingMsForTests } from "../../src/http/sse.ts";

/** Opens a stream and returns a promise that resolves when the server ends it. */
async function openStream(url: string, token: string) {
  const controller = new AbortController();
  const res = await fetch(url + "/api/events", { headers: bearer(token), signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  let ended = false;
  const done = (async () => {
    try { for (;;) { const r = await reader.read(); if (r.done) break; } } catch { /* reset = ended */ }
    ended = true;
  })();
  return { done, isEnded: () => ended, abort: () => controller.abort() };
}

async function scenario(kill: (s: Awaited<ReturnType<typeof startTestServer>>, actorId: number) => void) {
  setSsePingMsForTests(40);
  const s = await startTestServer();
  try {
    const ala = createActor(s.ctx, { kind: "agent", handle: "ala" });
    const { token } = mintToken(s.ctx, ala.id, "t");
    const st = await openStream(s.url, token);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(st.isEnded(), false, "a healthy stream must stay open across several pings");
    const t0 = Date.now();
    kill(s, ala.id);
    await Promise.race([st.done, new Promise((r) => setTimeout(r, 1500))]);
    const took = Date.now() - t0;
    const ended = st.isEnded();
    st.abort();
    return { ended, took, streams: s.ctx.bus.streamCount(ala.id) };
  } finally {
    setSsePingMsForTests(null);
    await s.close();
  }
}

test("an open SSE stream closes shortly after its token is revoked (B-MG-89)", async () => {
  const r = await scenario((s, id) => { revokeToken(s.ctx, listTokens(s.ctx, id)[0].id); });
  assert.equal(r.ended, true, "stream still open after revoke");
  assert.ok(r.took < 1500);
  assert.equal(r.streams, 0, "the stream slot is released");
});

test("an open SSE stream closes shortly after its actor is disabled (B-MG-89)", async () => {
  const r = await scenario((s, id) => { setDisabled(s.ctx, id, true); });
  assert.equal(r.ended, true, "stream still open after disable");
  assert.equal(r.streams, 0);
});
