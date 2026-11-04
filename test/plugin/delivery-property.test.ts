/**
 * Property: every message the agent should get is delivered AT LEAST ONCE and AT MOST ONCE
 * across channel <-> monitor handovers, whatever happens in between.
 *
 * A seeded random sequence of: DMs, chatter (not for the agent), mentions in a member
 * conversation, calls into a public conversation the agent is not in (mention list only),
 * replies in the agent's thread, the agent's own messages, a brand-new DM conversation,
 * lookup failures (membership list and thread lookup answer 503) and their recovery, and
 * SIGTERMs. A SIGTERM kills the current delivery process on the spot (whatever its rate limit
 * still holds is never written) and starts the next one from the cursors the dead one left -
 * what the channel's heartbeat or the monitor's state file carries. Processes alternate
 * between the channel's shape (a 1-push-per-interval pusher in front of the writes) and the
 * monitor's (one write per item).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { waitFor } from "../helpers.ts";
import { createFeed } from "../../integrations/claude-code-plugin/lib/feed.mjs";
import { createPusher } from "../../integrations/claude-code-plugin/lib/pusher.mjs";
import { convs, fakeAt, type FakeAt, type FakeMessage } from "./fake-at.ts";

const ME = 7;
const BOB = 8;
const ROOT = 1; // a thread the agent started before anything ran

/** mulberry32: a small seeded PRNG, so a failing seed can be replayed. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Proc = { feed: ReturnType<typeof createFeed>; kill: () => void; kind: "channel" | "monitor" };

async function scenario(seed: number, steps: number) {
  const rnd = prng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const fake: FakeAt = await fakeAt({ me: { id: ME, handle: "nestor" } });
  const list = [{ id: 3, kind: "public", slug: "general", notify: "mentions" }, { id: 9, kind: "dm", notify: "all" }];
  let failing = false;
  const rootOk = { status: 200, body: { messages: [{ id: ROOT, conversationId: 3, actorId: ME, body: "root", threadId: null }] } };
  const apply = () => {
    fake.conversations = failing ? { status: 503, body: { error: "unavailable" } } : convs(list);
    fake.threads.set(ROOT, failing ? { status: 503 } : rootOk);
  };
  apply();
  let nextId = 1;
  fake.emit({ id: nextId++, conversationId: 3, actorId: ME, body: "root", threadId: null }, { live: false });
  const status = () => { fake.status = { status: 200, body: { ok: true, lastMessageId: nextId - 1 } }; };
  status();

  const expected = new Set<number>();
  const delivered = new Map<number, number>();
  const trace: string[] = [];
  const record = (ids: number[]) => { for (const id of ids) delivered.set(id, (delivered.get(id) ?? 0) + 1); };

  let cursors: { lastEventId: number | null; mentionCursor: number | null; replayFloor: number | null } = { lastEventId: null, mentionCursor: null, replayFloor: null };
  let current: Proc | null = null;
  let generation = 0;

  async function startProc(kind: "channel" | "monitor") {
    let alive = true;
    const never = new Promise<void>(() => {});
    const write = (ids: number[]) => {
      if (!alive) return never; // a dead process writes nothing, and confirms nothing
      record(ids);
      return Promise.resolve();
    };
    let onItem: (it: any) => unknown;
    if (kind === "channel") {
      const pusher = createPusher<any>({ intervalMs: 40, send: (items) => write(items.map((i) => i.id)) });
      onItem = (it) => pusher.push(it);
    } else {
      onItem = (it) => write([it.id]);
    }
    const feed = createFeed({
      identity: { url: fake.url, token: "atk_test" },
      onItem: onItem as any,
      lastEventId: cursors.lastEventId,
      mentionCursor: cursors.mentionCursor,
      replayFloor: cursors.replayFloor,
      sse: { initialBackoffMs: 20, maxBackoffMs: 50 },
      retry: { initialMs: 20, maxMs: 60 },
    } as any);
    const proc: Proc = { feed, kind, kill: () => { alive = false; feed.stop(); } };
    current = proc;
    generation++;
    // The first contact retries like the real entry points; a server that keeps failing
    // recovers after a few tries (otherwise the sequence would wait on itself).
    for (let tries = 0; ; tries++) {
      try { await feed.start(); break; } catch {
        if (tries === 3 && failing) { failing = false; apply(); trace.push("lookups ok (start)"); }
        await new Promise((r) => setTimeout(r, 30));
      }
    }
    await waitFor(() => fake.streams() === 1, 3000);
  }

  function sigterm() {
    if (!current) return;
    // What the channel's heartbeat / the monitor's state file would carry at this instant.
    cursors = { lastEventId: current.feed.lastEventId, mentionCursor: current.feed.mentionCursor, replayFloor: current.feed.replayFloor };
    trace.push(`SIGTERM ${current.kind} @ ${JSON.stringify(cursors)}`);
    current.kill();
    current = null;
  }

  function post(m: Omit<FakeMessage, "id">, should: boolean, mention: boolean, streamed = true) {
    const msg = { ...m, id: nextId++ } as FakeMessage;
    status();
    if (streamed) fake.emit(msg); else fake.log.push(msg);
    if (mention) { fake.mentions.push(msg); fake.notify(); }
    if (should) expected.add(msg.id);
    trace.push(`${msg.id} conv=${m.conversationId} ${should ? "WANT" : "skip"}${mention ? " mention" : ""}`);
    return msg;
  }

  await startProc("monitor");
  let newDm = 20;
  for (let i = 0; i < steps; i++) {
    const action = pick(["dm", "dm", "chatter", "mention", "call", "thread", "own", "newdm", "fail", "fail", "sigterm", "sigterm", "pending", "wait"]);
    switch (action) {
      case "dm": post({ conversationId: 9, actorId: BOB, body: `dm ${i}`, threadId: null }, true, false); break;
      case "chatter": post({ conversationId: 3, actorId: BOB, body: `chatter ${i}`, threadId: null }, false, false); break;
      case "mention": post({ conversationId: 3, actorId: BOB, body: `@nestor look ${i}`, threadId: null }, true, true); break;
      // A public conversation nestor is not in: the stream does not carry it, only the list.
      case "call": post({ conversationId: 5, actorId: BOB, body: `@nestor over here ${i}`, threadId: null }, true, true, false); break;
      case "thread": post({ conversationId: 3, actorId: BOB, body: `reply ${i}`, threadId: ROOT }, true, false); break;
      case "own": post({ conversationId: 9, actorId: ME, body: `mine ${i}`, threadId: null }, false, false); break;
      case "newdm": {
        const id = newDm++;
        list.push({ id, kind: "dm", slug: `dm${id}`, notify: "all" });
        apply();
        post({ conversationId: id, actorId: BOB, body: `hello from a new DM ${i}`, threadId: null }, true, false);
        break;
      }
      case "fail": failing = !failing; apply(); trace.push(failing ? "lookups 503" : "lookups ok"); break;
      case "sigterm":
        sigterm();
        await startProc(generation % 2 === 0 ? "monitor" : "channel");
        break;
      case "pending": {
        // A restart while a mention is still undelivered (codex r4 F10): a mention (member or
        // a call from outside) lands, then the process dies a moment later - often while the
        // channel's rate limit still holds it or the mention list read is in flight - and
        // sometimes dies again right after the next one starts.
        if (rnd() < 0.6) post({ conversationId: 3, actorId: BOB, body: `@nestor quick ${i}`, threadId: null }, true, true);
        else post({ conversationId: 5, actorId: BOB, body: `@nestor out here ${i}`, threadId: null }, true, true, false);
        // ... often with a DM right behind it, held behind the mention (codex T-MG-14 r1 F2).
        if (rnd() < 0.6) post({ conversationId: 9, actorId: BOB, body: `dm behind ${i}`, threadId: null }, true, false);
        await new Promise((r) => setTimeout(r, Math.floor(rnd() * 15)));
        sigterm();
        await startProc(generation % 2 === 0 ? "monitor" : "channel");
        if (rnd() < 0.4) {
          await new Promise((r) => setTimeout(r, Math.floor(rnd() * 10)));
          sigterm();
          await startProc(generation % 2 === 0 ? "monitor" : "channel");
        }
        break;
      }
      case "wait": break;
    }
    await new Promise((r) => setTimeout(r, Math.floor(rnd() * 60)));
  }
  failing = false;
  apply();
  const done = () => [...expected].every((id) => delivered.has(id));
  await waitFor(done, 8000).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const proc = current as Proc | null;
  proc?.kill();
  await fake.close();
  const missing = [...expected].filter((id) => !delivered.has(id));
  const twice = [...delivered].filter(([, n]) => n > 1).map(([id]) => id);
  const unwanted = [...delivered.keys()].filter((id) => !expected.has(id));
  return { missing, twice, unwanted, trace };
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  test(`property (seed ${seed}): every message the agent should get is delivered exactly once across handovers, failures and restarts`, async () => {
    const r = await scenario(seed, 40);
    const why = `seed ${seed}\n${r.trace.join("\n")}`;
    assert.deepEqual(r.missing, [], `lost: ${r.missing}\n${why}`);
    assert.deepEqual(r.twice, [], `duplicated: ${r.twice}\n${why}`);
    assert.deepEqual(r.unwanted, [], `delivered but not for the agent: ${r.unwanted}\n${why}`);
  });
}
