// Polish fixture records exercise import, search and read markers without changing historical input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "../helpers.ts";
import { importTalkHome } from "../../src/importer/talk.ts";
import { getActorByHandle } from "../../src/core/actors.ts";
import { getBySlug, listForActor } from "../../src/core/conversations.ts";
import { listMessages } from "../../src/core/messages.ts";

function fixtureRaw(channelJsonl: string, presence: Record<string, unknown> = {}): string {
  const home = mkdtempSync(join(tmpdir(), "talk-fixture-"));
  writeFileSync(join(home, "channel.jsonl"), channelJsonl);
  mkdirSync(join(home, "presence"), { recursive: true });
  for (const [sid, data] of Object.entries(presence)) {
    writeFileSync(join(home, "presence", sid), JSON.stringify(data));
  }
  return home;
}

const fixture = (records: Array<Record<string, unknown>>, presence?: Record<string, unknown>) =>
  fixtureRaw(records.map((r) => JSON.stringify(r)).join("\n") + "\n", presence);

test("import restores channels, actors and message order", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "Nestor/chat-vps", kind: "say", chan: "#general",
      text: "pierwsza", mid: "m1" },
    { ts: 200, sid: "michal", label: "Michal", kind: "say", chan: "#infra",
      text: "druga", mid: "m2" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 2);
  assert.ok(getBySlug(ctx, "general"));
  assert.ok(getBySlug(ctx, "infra"));
  assert.equal(getActorByHandle(ctx, "michal")?.kind, "human");
  assert.equal(getActorByHandle(ctx, "nestor-chat-vps")?.kind, "agent");
  assert.equal(getActorByHandle(ctx, "nestor-chat-vps")?.displayName, "Nestor/chat-vps");
});

test("import is idempotent; a second pass does not duplicate records", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "say", chan: "#general", text: "x", mid: "m1" },
  ]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  const second = importTalkHome(ctx, home);
  assert.equal(second.messages, 0);
  assert.equal(second.skipped, 1);
});

test("a message with to becomes a DM rather than a channel message", () => {
  const home = fixture([
    { ts: 90, sid: "michal", label: "Michal", kind: "say", chan: "#general",
      text: "obecnosc", mid: "m0" },
    { ts: 100, sid: "s1", label: "nestor", kind: "say", chan: "#general", to: "Michal",
      text: "prywatnie", mid: "m1" },
  ]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  const michal = getActorByHandle(ctx, "michal")!;
  const dm = listForActor(ctx, michal.id).find((c) => c.kind === "dm");
  assert.ok(dm, "DM missing after import");
  assert.equal(listMessages(ctx, { conversationId: dm!.id })[0].body, "prywatnie");
});

test("a recipient known only from the presence directory can be resolved", () => {
  const home = fixture(
    [{ ts: 100, sid: "s1", label: "nestor", kind: "say", chan: "#general", to: "eipa-ceny",
       text: "hej", mid: "m1" }],
    { "sid-eipa": { label: "eipa-ceny" } },
  );
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 1);
  assert.equal(rep.skipped, 0);
});

test("reactions do not become messages", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "say", chan: "#general", text: "tresc", mid: "m1" },
    { ts: 110, sid: "s2", label: "beta", kind: "react", chan: "#general", text: "",
      ref: "m1", emoji: "OK", mid: "m2" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 1);
  assert.equal(rep.reactions, 1);
});

test("ask and answer restore the question and its thread", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "ask", chan: "#issues", text: "czy dziala?",
      mid: "m1", id: "q1" },
    { ts: 200, sid: "s2", label: "beta", kind: "answer", chan: "#issues", text: "dziala",
      mid: "m2", ref: "q1" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.questions, 1);
  const q = ctx.db.prepare("SELECT closed_at FROM questions").get() as { closed_at: number | null };
  assert.ok(q.closed_at, "the answer must close the question");
  const msgs = listMessages(ctx, { conversationId: getBySlug(ctx, "issues")!.id });
  assert.equal(msgs[1].threadId, msgs[0].id);
});

test("join and leave are skipped as noise", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "join", chan: "#general", text: "", mid: "m1" },
    { ts: 110, sid: "s1", label: "alfa", kind: "leave", chan: "#general", text: "", mid: "m2" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 0);
  assert.equal(rep.skipped, 2);
});

test("an unresolvable recipient is reported rather than lost", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "say", chan: "#general", to: "ktos-kogo-nie-ma",
      text: "x", mid: "m1" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.skipped, 1);
  assert.match(rep.problems.join(" "), /could not resolve recipient/);
});

test("a malformed JSON line does not stop the import and is counted", () => {
  const home = fixtureRaw(
    '{"ts":1,"sid":"s","label":"alfa","kind":"say","chan":"#general","text":"ok","mid":"m1"}\n'
      + "{ urwana\n",
  );
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 1);
  assert.equal(rep.skipped, 1);
  assert.match(rep.problems.join(" "), /invalid JSON line/);
});

test("mentions are restored by handle", () => {
  const home = fixture([
    { ts: 90, sid: "michal", label: "Michal", kind: "say", chan: "#general", text: "jestem",
      mid: "m0" },
    { ts: 100, sid: "s1", label: "alfa", kind: "say", chan: "#general", text: "@michal zerknij",
      mid: "m1" },
  ]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  const n = ctx.db.prepare("SELECT count(*) AS n FROM mentions").get() as { n: number };
  assert.equal(n.n, 1);
});

test("a read marker is converted from a timestamp to a message id", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "say", chan: "#general", text: "raz", mid: "m1" },
    { ts: 300, sid: "s1", label: "alfa", kind: "say", chan: "#general", text: "dwa", mid: "m2" },
    { ts: 50, sid: "michal", label: "michal", kind: "say", chan: "#general", text: "jestem",
      mid: "m0" },
  ]);
  mkdirSync(join(home, "read", "michal"), { recursive: true });
  writeFileSync(join(home, "read", "michal", "#general"), String(200 * 1000));
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.reads, 1);
  const michal = getActorByHandle(ctx, "michal")!;
  const row = ctx.db
    .prepare("SELECT last_read_message_id AS id FROM members WHERE actor_id = ?")
    .get(michal.id) as { id: number };
  const msgs = listMessages(ctx, { conversationId: getBySlug(ctx, "general")!.id });
  const firstMessage = msgs.find((m) => m.body === "raz")!;
  assert.equal(row.id, firstMessage.id, "the marker must point to the last message before ts=200");
});

test("a second pass does not duplicate reactions, questions or markers", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "ask", chan: "#issues", text: "q?",
      mid: "m1", id: "q1" },
    { ts: 110, sid: "s2", label: "beta", kind: "answer", chan: "#issues", text: "odp",
      mid: "m2", ref: "q1" },
    { ts: 120, sid: "s2", label: "beta", kind: "react", chan: "#issues", text: "",
      ref: "m1", emoji: "OK", mid: "m3" },
  ]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  importTalkHome(ctx, home);
  const q = ctx.db.prepare("SELECT count(*) AS n FROM questions").get() as { n: number };
  const r = ctx.db.prepare("SELECT count(*) AS n FROM reactions").get() as { n: number };
  const m = ctx.db.prepare("SELECT count(*) AS n FROM messages").get() as { n: number };
  assert.equal(q.n, 1);
  assert.equal(r.n, 1);
  assert.equal(m.n, 2);
});

test("incremental import: a reaction in the second file targets a message from the first", () => {
  const ctx = testCtx();
  importTalkHome(ctx, fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "say", chan: "#general", text: "baza", mid: "m1" },
  ]));
  const rep = importTalkHome(ctx, fixture([
    { ts: 110, sid: "s2", label: "beta", kind: "react", chan: "#general", text: "",
      ref: "m1", emoji: "OK", mid: "m2" },
  ]));
  assert.equal(rep.reactions, 1, "the reaction to a previous pass's message was lost");
});

test("two DISTINCT labels colliding on one handle are not merged into one actor", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "mac/general", kind: "say", chan: "#g", text: "a", mid: "m1" },
    { ts: 110, sid: "s2", label: "mac general", kind: "say", chan: "#g", text: "b", mid: "m2" },
  ]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  const authors = ctx.db.prepare(
    "SELECT DISTINCT actor_id FROM messages",
  ).all() as Array<{ actor_id: number }>;
  assert.equal(authors.length, 2, "two participants were merged into one");
});

test("an invalid channel in one record does not crash the entire import", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "alfa", kind: "say", chan: "#!!!", text: "zly", mid: "m1" },
    { ts: 110, sid: "s1", label: "alfa", kind: "say", chan: "#general", text: "dobry", mid: "m2" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 1);
  assert.equal(rep.skipped, 1);
});

test("DM read markers are transferred", () => {
  const home = fixture([
    { ts: 100, sid: "sid-nestor", label: "nestor", kind: "say", chan: "#general",
      to: "Michal", text: "prywatna", mid: "m1" },
    { ts: 50, sid: "michal", label: "Michal", kind: "say", chan: "#general",
      text: "jestem", mid: "m0" },
  ]);
  mkdirSync(join(home, "read", "michal"), { recursive: true });
  writeFileSync(join(home, "read", "michal", "dm_sid-nestor"), String(200 * 1000));
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.reads, 1, "the DM read marker was lost");
});

test("(N) suffixes are merged into one actor", () => {
  const home = fixture([
    { ts: 100, sid: "s1", label: "Nestor/myday", kind: "say", chan: "#myday", text: "a", mid: "m1" },
    { ts: 110, sid: "s2", label: "Nestor/myday (2)", kind: "say", chan: "#myday", text: "b", mid: "m2" },
    { ts: 120, sid: "s3", label: "Nestor/myday (3)", kind: "say", chan: "#myday", text: "c", mid: "m3" },
  ]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  const authors = ctx.db.prepare("SELECT DISTINCT actor_id FROM messages").all() as
    Array<{ actor_id: number }>;
  assert.equal(authors.length, 1, "(N) suffixes were not merged");
  assert.ok(getActorByHandle(ctx, "nestor-myday"));
  assert.equal(getActorByHandle(ctx, "nestor-myday-2"), null, "a separate actor was created for (2)");
});
