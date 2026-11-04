/**
 * T-MG-40 fix round 1 (review-r1.json F1-F3):
 *  F1 wiki_read authorizes a write only for a revision it delivered whole (the complete framed
 *     result within the budget), never for a truncated read or a page that grew between GETs;
 *  F2 base_revision is forwarded only when this process delivered that revision whole;
 *  F3 every read tool keeps its complete result within one budget and hands back a cursor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join as joinConv } from "../../src/core/conversations.ts";
import { postMessage } from "../../src/core/messages.ts";
import { savePage, getPage } from "../../src/core/wiki.ts";
import { acquire } from "../../src/core/leases.ts";
import { registerSession, setDoing } from "../../src/core/presence.ts";
import { ask } from "../../src/core/questions.ts";
import { createApi } from "../../integrations/claude-code-plugin/lib/api.mjs";
import * as toolsModule from "../../integrations/claude-code-plugin/lib/tools.mjs";

const { createApiTools } = toolsModule;
/** The one result budget every tool keeps (the spec's number). */
const BUDGET = 50_000;
const BIG = "x".repeat(60_000);

type Call = (name: string, args?: unknown) => Promise<{ text: string; isError?: boolean }>;

async function setup(wrap?: (api: any, ctx: any) => any) {
  const s = await startTestServer();
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const bob = createActor(s.ctx, { kind: "human", handle: "bob" });
  const general = createChannel(s.ctx, { slug: "general", kind: "public", createdBy: bob.id });
  joinConv(s.ctx, general.id, nestor.id);
  const token = mintToken(s.ctx, nestor.id, "t").token;
  const base = createApi({ url: s.url, token });
  const api = wrap ? wrap(base, s.ctx) : base;
  const tools = createApiTools({ api, principalOk: () => Promise.resolve(true), sessionId: undefined });
  const call: Call = async (name, args = {}) => (tools as any)[name].handler(args);
  return { s, nestor, bob, general, call, close: () => s.close() };
}

const rev = (text: string) => Number(/revision (\d+)/.exec(text)?.[1] ?? NaN);

test("the budget is exported and is the spec's 50 000 characters", () => {
  assert.equal((toolsModule as any).MAX_RESULT_CHARS, BUDGET);
});

test("F1: a page whose framed result exceeds the budget is not delivered, and cannot be written", async (t) => {
  const e = await setup();
  t.after(e.close);
  // 60 000 body characters + a 200-character title: the codex repro.
  savePage(e.s.ctx, { slug: "edge", title: "T".repeat(200), body: `${"a".repeat(59_990)}\nTAILMARK`, actorId: e.bob.id });
  const r = await e.call("wiki_read", { slug: "edge" });
  assert.ok(r.text.length <= BUDGET, `result within budget: ${r.text.length}`);
  assert.ok(!r.text.includes("TAILMARK"), "the tail was not delivered");
  const w1 = await e.call("wiki_write", { slug: "edge", title: "x", body: "clobber" });
  assert.equal(w1.isError, true, w1.text);
  const w2 = await e.call("wiki_write", { slug: "edge", title: "x", body: "clobber", base_revision: getPage(e.s.ctx, "edge")!.lastRevisionId });
  assert.equal(w2.isError, true, w2.text);
  assert.match(getPage(e.s.ctx, "edge")!.body, /TAILMARK$/, "the page is unchanged");
});

test("F1: a page that fits is delivered whole (its last line included) and then writable", async (t) => {
  const e = await setup();
  t.after(e.close);
  savePage(e.s.ctx, { slug: "fits", title: "Fits", body: `${"b".repeat(40_000)}\nTAILMARK`, actorId: e.bob.id });
  const r = await e.call("wiki_read", { slug: "fits" });
  assert.equal(r.isError, undefined, r.text);
  assert.ok(r.text.length <= BUDGET);
  assert.ok(r.text.includes("> TAILMARK"), "the tail was delivered");
  const w = await e.call("wiki_write", { slug: "fits", title: "Fits", body: "new" });
  assert.equal(w.isError, undefined, w.text);
  assert.equal(getPage(e.s.ctx, "fits")!.body, "new");
  // The write itself counts as knowing the page: a second write of our own revision is fine.
  const w2 = await e.call("wiki_write", { slug: "fits", title: "Fits", body: "newer" });
  assert.equal(w2.isError, undefined, w2.text);
});

test("F1 race: the page grows between the outline and the full read: not delivered, not writable", async (t) => {
  let grown = false;
  const e = await setup((api, ctx) => ({
    ...api,
    async get(p: string) {
      const r = await api.get(p);
      if (p.includes("outline=1") && !grown) {
        grown = true;
        savePage(ctx, { slug: "race", title: "Race", body: `${"c".repeat(70_000)}\nTAILMARK`, actorId: 2, force: true } as any);
      }
      return r;
    },
  }));
  t.after(e.close);
  savePage(e.s.ctx, { slug: "race", title: "Race", body: "small", actorId: e.bob.id });
  const r = await e.call("wiki_read", { slug: "race" });
  assert.ok(grown, "the race was staged");
  assert.ok(r.text.length <= BUDGET, `within budget: ${r.text.length}`);
  assert.ok(!r.text.includes("TAILMARK"));
  for (const args of [{}, { base_revision: getPage(e.s.ctx, "race")!.lastRevisionId }]) {
    const w = await e.call("wiki_write", { slug: "race", title: "Race", body: "clobber", ...args });
    assert.equal(w.isError, true, w.text);
  }
  assert.match(getPage(e.s.ctx, "race")!.body, /TAILMARK$/);
});

test("F1 race: the page changes after a whole read: the write is refused by the delivered revision", async (t) => {
  const e = await setup();
  t.after(e.close);
  savePage(e.s.ctx, { slug: "moved", title: "M", body: "one", actorId: e.bob.id });
  assert.equal((await e.call("wiki_read", { slug: "moved" })).isError, undefined);
  savePage(e.s.ctx, { slug: "moved", title: "M", body: "two by bob", actorId: e.bob.id, force: true } as any);
  const w = await e.call("wiki_write", { slug: "moved", title: "M", body: "mine" });
  assert.equal(w.isError, true, w.text);
  assert.equal(getPage(e.s.ctx, "moved")!.body, "two by bob");
});

test("F2: an outline-only or section-only read never unlocks a write, with or without base_revision", async (t) => {
  const e = await setup();
  t.after(e.close);
  savePage(e.s.ctx, { slug: "big", title: "Big", body: `# A\n${"a".repeat(40_000)}\n# B\n${"b".repeat(30_000)}`, actorId: e.bob.id });
  const o = await e.call("wiki_read", { slug: "big" });
  const r = rev(o.text);
  assert.ok(r > 0, o.text);
  const w1 = await e.call("wiki_write", { slug: "big", title: "Big", body: "clobber", base_revision: r });
  assert.equal(w1.isError, true, w1.text);
  const sec = await e.call("wiki_read", { slug: "big", section: "B" });
  assert.equal(sec.isError, undefined, sec.text);
  const w2 = await e.call("wiki_write", { slug: "big", title: "Big", body: "clobber", base_revision: rev(sec.text) || r });
  assert.equal(w2.isError, true, w2.text);
  assert.match(getPage(e.s.ctx, "big")!.body, /^# A\n/);
  // Never read at all, with the right revision guessed: refused too.
  savePage(e.s.ctx, { slug: "unread", title: "U", body: "secret", actorId: e.bob.id });
  const w3 = await e.call("wiki_write", { slug: "unread", title: "U", body: "x", base_revision: getPage(e.s.ctx, "unread")!.lastRevisionId });
  assert.equal(w3.isError, true, w3.text);
  assert.equal(getPage(e.s.ctx, "unread")!.body, "secret");
  // base_revision 0 still creates a new page.
  const c = await e.call("wiki_write", { slug: "fresh", title: "F", body: "hello", base_revision: 0 });
  assert.equal(c.isError, undefined, c.text);
});

test("F1/F3: a large page or section is readable in parts with offset, each part within the budget", async (t) => {
  const e = await setup();
  t.after(e.close);
  const lines = Array.from({ length: 3000 }, (_, i) => `line ${i} ${"z".repeat(30)}`);
  savePage(e.s.ctx, { slug: "long", title: "Long", body: `# S\n${lines.join("\n")}`, actorId: e.bob.id });
  const seen = new Set<string>();
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const r = await e.call("wiki_read", { slug: "long", section: "S", offset });
    assert.equal(r.isError, undefined, r.text);
    assert.ok(r.text.length <= BUDGET, `part ${i}: ${r.text.length}`);
    for (const m of r.text.matchAll(/> line (\d+) /g)) seen.add(m[1]);
    const next = /offset=(\d+)/.exec(r.text);
    if (!next) break;
    assert.ok(Number(next[1]) > offset, "the cursor moves forward");
    offset = Number(next[1]);
  }
  assert.equal(seen.size, 3000, "every line was reachable through the cursor");
  assert.equal((await e.call("wiki_read", { slug: "long", offset: -1 })).isError, true);
});

test("F3: read_thread of 50 messages of 60 000 characters stays in budget and pages with after", async (t) => {
  const e = await setup();
  t.after(e.close);
  const root = postMessage(e.s.ctx, { conversationId: e.general.id, actorId: e.bob.id, body: BIG });
  const ids = [root.id];
  for (let i = 0; i < 49; i++) ids.push(postMessage(e.s.ctx, { conversationId: e.general.id, actorId: e.bob.id, body: BIG, threadId: root.id }).id);
  const seen = new Set<number>();
  let after: number | undefined;
  for (let i = 0; i < 60; i++) {
    const r = await e.call("read_thread", { message_id: root.id, ...(after ? { after } : {}) });
    assert.equal(r.isError, undefined, r.text);
    assert.ok(r.text.length <= BUDGET, `page ${i}: ${r.text.length}`);
    for (const m of r.text.matchAll(/^\[(\d+)\] /gm)) seen.add(Number(m[1]));
    const next = /after=(\d+)/.exec(r.text);
    if (!next) break;
    after = Number(next[1]);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), ids, "every message reachable");
  assert.equal((await e.call("read_thread", { message_id: root.id, after: 0 })).isError, true);
});

test("F3: read_conversation stays in budget, latest pages back with before, after pages forward", async (t) => {
  const e = await setup();
  t.after(e.close);
  const ids: number[] = [];
  for (let i = 0; i < 10; i++) ids.push(postMessage(e.s.ctx, { conversationId: e.general.id, actorId: e.bob.id, body: BIG }).id);
  const latest = await e.call("read_conversation", { conversation_id: e.general.id, limit: 10 });
  assert.ok(latest.text.length <= BUDGET, `${latest.text.length}`);
  assert.ok(latest.text.includes(`[${ids.at(-1)}] `), "the newest message is shown");
  const before = Number(/before=(\d+)/.exec(latest.text)?.[1]);
  assert.ok(before > 0, latest.text.slice(-300));
  const older = await e.call("read_conversation", { conversation_id: e.general.id, before, limit: 10 });
  assert.equal(older.isError, undefined, older.text);
  assert.ok(older.text.includes(`[${before - 1}] `) || older.text.includes(`[${ids[ids.indexOf(before) - 1]}] `));
  const fwd = await e.call("read_conversation", { conversation_id: e.general.id, after: ids[0] - 1, limit: 10 });
  assert.ok(fwd.text.length <= BUDGET);
  assert.match(fwd.text, /after=\d+/);
  // A single message of many short lines is capped within the budget too.
  postMessage(e.s.ctx, { conversationId: e.general.id, actorId: e.bob.id, body: "y\n".repeat(30_000) });
  const lines = await e.call("read_conversation", { conversation_id: e.general.id, limit: 1 });
  assert.ok(lines.text.length <= BUDGET, `${lines.text.length}`);
  assert.equal((await e.call("read_conversation", { conversation_id: e.general.id, before: 5, after: 1 })).isError, true);
});

test("F3: search, mentions, open_questions, channels, who and leases stay within the budget with a cursor", async (t) => {
  const e = await setup();
  t.after(e.close);
  for (let i = 0; i < 6; i++) postMessage(e.s.ctx, { conversationId: e.general.id, actorId: e.bob.id, body: `needle @nestor ${BIG}` });
  for (let i = 0; i < 6; i++) ask(e.s.ctx, { conversationId: e.general.id, actorId: e.bob.id, body: `q ${BIG}` });
  for (let i = 0; i < 250; i++) {
    const c = createChannel(e.s.ctx, { slug: `ch${i}`, kind: "public", topic: "t".repeat(300), createdBy: e.bob.id });
    void c;
    registerSession(e.s.ctx, { sessionId: `s${i}`, actorId: e.bob.id, label: `l${i}` });
    setDoing(e.s.ctx, `s${i}`, "d".repeat(300));
    acquire(e.s.ctx, { resource: `r${i}/${"p".repeat(100)}`, actorId: e.bob.id, ttlSec: 600, note: "n".repeat(500) });
  }
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ["search", { q: "needle", limit: 6 }, /skip=\d+/],
    ["mentions", { limit: 6 }, /after=\d+/],
    ["open_questions", {}, /after=\d+/],
    ["channels", {}, /after=\d+/],
    ["who", {}, /skip=\d+/],
    ["leases", {}, /skip=\d+/],
  ];
  for (const [name, args, cursor] of cases) {
    const r = await e.call(name, args);
    assert.equal(r.isError, undefined, `${name}: ${r.text.slice(0, 200)}`);
    assert.ok(r.text.length <= BUDGET, `${name}: ${r.text.length}`);
    const m = cursor.exec(r.text);
    assert.ok(m, `${name} hands back a cursor`);
    const [k, v] = m![0].split("=");
    const next = await e.call(name, { ...args, [k]: Number(v) });
    assert.equal(next.isError, undefined, `${name} next: ${next.text.slice(0, 200)}`);
    assert.ok(next.text.length <= BUDGET);
    assert.notEqual(next.text, r.text, `${name}: the cursor moves`);
  }
  assert.equal((await e.call("search", { q: "needle", skip: -1 })).isError, true);
  assert.equal((await e.call("who", { skip: "x" })).isError, true);
});
