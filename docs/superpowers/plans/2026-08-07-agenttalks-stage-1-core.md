# AgentTalks stage 1 (core) - implementation plan

> **For the implementer:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or
> `superpowers:executing-plans`. Steps have checkboxes to tick off.

**Goal:** A running daemon in which two authenticated actors exchange messages
in channels, DMs, and groups, receive them through SSE push, have correct unread
counts, and have the history from the `~/.talk` prototype imported.

**Architecture:** Three layers without leakage. `store/` knows SQL and nothing else. `core/`
knows domain rules and receives `Ctx = { db, bus, now }`, but knows no HTTP. `http/` translates
requests into `core/` calls and knows no SQL. Core tests run on an in-memory database.

**Stack:** Node >= 24 (here: 26), natively executed TypeScript, `node:sqlite`, `node:http`,
`node:crypto`, `node:test`. **Zero dependencies in stage 1**; the product's only dependency,
`@modelcontextprotocol/sdk`, arrives in stage 2 and concerns only `src/mcp/`.
Deployment: Docker image based on `node:26-alpine`.

## Global constraints

- Node >= 24. Checked in `src/version.ts`, called at CLI startup.
- **Zero `dependencies` and `devDependencies` in `package.json`** throughout stage 1.
  No module outside `src/mcp/` (stage 2) may import anything outside
  the Node standard library.
- No `core/` module imports from `http/` or `node:http`.
- No `http/` module contains SQL.
- A file exceeding ~300 lines signals that it is doing two things.
- Comments and user messages in Polish, **without Polish diacritics
  in source code** (consistent with the prototype); documentation with diacritics.
- No em-dash character in any file.
- Message identifiers are `INTEGER AUTOINCREMENT`. Never calculate them by scanning.
- The client never declares its `actor_id`. It always comes from the token or cookie.
- Every `core/*` accepts `ctx: Ctx` as its first argument.
- Time: Unix seconds as a `number` (consistent with the prototype's `ts`), through `ctx.now()`.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json` | package metadata, `bin`, `test`/`verify` scripts |
| `src/version.ts` | Node version check |
| `src/config.ts` | `Config` type, data directory, loading and initialization |
| `src/store/schema.ts` | DDL as a constant, versioned with `user_version` |
| `src/store/db.ts` | `openDb`, pragmas, migrations |
| `src/core/ctx.ts` | `Ctx` type, `createCtx` |
| `src/core/errors.ts` | `AppError` + `badRequest`/`notFound`/... constructors |
| `src/core/ids.ts` | validation of `handle`, `slug`, emoji |
| `src/core/events.ts` | `EventBus`: per-actor subscriptions |
| `src/core/actors.ts` | actors, passwords (scrypt) |
| `src/core/tokens.ts` | minting, verification (sha256), revocation |
| `src/core/conversations.ts` | channels, DMs, groups, membership, visibility |
| `src/core/mentions.ts` | parsing and resolving `@handle` |
| `src/core/messages.ts` | writing, listing, editing, deleting, threads |
| `src/core/unread.ts` | counts and read markers |
| `src/core/presence.ts` | sessions, heartbeat, `typing`/`busy`, presence list |
| `src/core/questions.ts` | `ask` / `answer` / open questions |
| `src/core/reactions.ts` | reactions (toggle) |
| `src/core/search.ts` | FTS5 restricted to visible conversations |
| `src/http/router.ts` | small router: method + pattern with `:param` |
| `src/http/auth.ts` | bearer + signed cookie, CSRF |
| `src/http/respond.ts` | `json`, `err`, reading the body with a limit |
| `src/http/routes/*.ts` | routes grouped by resource |
| `src/http/sse.ts` | event stream and long-poll |
| `src/http/server.ts` | router assembly, starting `node:http` |
| `src/importer/talk.ts` | import from the `~/.talk` directory |
| `src/cli/main.ts` | `init`, `serve`, `actor`, `token`, `import-talk` |
| `test/**/*.test.ts` | tests, `node --test` |

---

### Task 1: Skeleton, database, migrations

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/version.ts`, `src/store/schema.ts`,
  `src/store/db.ts`, `src/core/ctx.ts`, `src/core/errors.ts`
- Test: `test/store/db.test.ts`

**Interfaces - produces:**
```ts
// src/store/db.ts
export type Db = import("node:sqlite").DatabaseSync;
export function openDb(path: string): Db;      // pragmas + migrations
export function schemaVersion(db: Db): number;
// src/core/ctx.ts
export type Ctx = { db: Db; bus: EventBus; now: () => number };
export function createCtx(db: Db, bus?: EventBus, now?: () => number): Ctx;
// src/core/errors.ts
export class AppError extends Error { code: string; status: number }
export function badRequest(code: string, message: string): AppError;
export function unauthorized(code: string, message: string): AppError;
export function forbidden(code: string, message: string): AppError;
export function notFound(code: string, message: string): AppError;
export function conflict(code: string, message: string): AppError;
```

- [ ] **Step 1: Test database opening and schema version**

```ts
// test/store/db.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, schemaVersion } from "../../src/store/db.ts";

test("openDb tworzy schemat i ustawia wersje", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), 1);
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((r: any) => r.name);
  for (const t of ["actors", "tokens", "sessions", "conversations", "members",
                   "messages", "mentions", "reactions", "questions", "files",
                   "pins", "leases"]) {
    assert.ok(tables.includes(t), `brak tabeli ${t}`);
  }
});

test("openDb jest idempotentne", () => {
  const db = openDb(":memory:");
  assert.equal(schemaVersion(db), 1);
  assert.doesNotThrow(() => openDb(":memory:"));
});

test("FTS5 jest dostepny", () => {
  const db = openDb(":memory:");
  assert.doesNotThrow(() =>
    db.prepare("SELECT count(*) FROM messages_fts").get());
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `node --test test/store/db.test.ts`
Expected: FAIL, `Cannot find module .../src/store/db.ts`

- [ ] **Step 3: `package.json` without dependencies**

```json
{
  "name": "agenttalks",
  "version": "0.1.0",
  "description": "Slack dla agentow AI: kanaly, DM, grupy, watki - serwer, CLI i UI",
  "type": "module",
  "engines": { "node": ">=24" },
  "bin": { "agenttalks": "bin/agenttalks.js", "atalk": "bin/atalk.js" },
  "files": ["bin", "src", "ui"],
  "scripts": {
    "test": "node --test",
    "verify": "node --test && node scripts/lint-ui.mjs"
  }
}
```

- [ ] **Step 4: `src/store/schema.ts` - DDL as a constant**

Tables exactly as in specification 4.2. Important details:
`messages.id INTEGER PRIMARY KEY AUTOINCREMENT`; `UNIQUE(conversation_id, actor_id)`
in `members`; `UNIQUE(message_id, actor_id, emoji)` in `reactions`;
`conversations.slug` `UNIQUE` with `NULL` allowed; indexes
`messages(conversation_id, id)`, `messages(thread_id)`, `mentions(actor_id)`,
`members(actor_id)`; the `messages_fts` table as `fts5(body, content='messages',
content_rowid='id')` plus three synchronization triggers (`INSERT`, `UPDATE`, `DELETE`).

- [ ] **Step 5: `src/store/db.ts`**

```ts
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=5000");
  migrate(db);
  return db;
}
```
`migrate` reads `PRAGMA user_version`, runs missing migrations from the
`MIGRATIONS` array in a transaction, and increments `user_version`. Migration 1 is the entire `SCHEMA`.

- [ ] **Step 6: Tests pass**

Run: `node --test test/store/db.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json src/ test/ && \
git commit -m "feat(store): schemat SQLite z migracjami, zero zaleznosci"
```

---

### Task 2: Actors, passwords, tokens

**Files:**
- Create: `src/core/ids.ts`, `src/core/actors.ts`, `src/core/tokens.ts`
- Test: `test/core/actors.test.ts`, `test/core/tokens.test.ts`

**Interfaces - consumes:** `Ctx`, `AppError` from task 1.
**Interfaces - produces:**
```ts
export type ActorKind = "human" | "agent" | "system";
export type Actor = { id: number; kind: ActorKind; handle: string;
                      displayName: string; createdAt: number; disabledAt: number | null };
export function createActor(ctx: Ctx, input: { kind: ActorKind; handle: string;
                            displayName?: string }): Actor;
export function getActor(ctx: Ctx, id: number): Actor | null;
export function getActorByHandle(ctx: Ctx, handle: string): Actor | null;
export function listActors(ctx: Ctx): Actor[];
export function setPassword(ctx: Ctx, actorId: number, password: string): void;
export function verifyPassword(ctx: Ctx, handle: string, password: string): Actor | null;
export function normalizeHandle(raw: string): string;   // src/core/ids.ts

export type TokenInfo = { id: number; actorId: number; name: string; createdAt: number;
                          lastUsedAt: number | null; revokedAt: number | null };
export function mintToken(ctx: Ctx, actorId: number, name: string):
  { token: string; info: TokenInfo };                    // "atk_" + 43 base64url characters
export function verifyToken(ctx: Ctx, token: string): Actor | null;
export function revokeToken(ctx: Ctx, tokenId: number): void;
export function listTokens(ctx: Ctx, actorId: number): TokenInfo[];
```

- [ ] **Step 1: Actor tests**

```ts
test("handle jest normalizowany i walidowany", () => {
  assert.equal(normalizeHandle("  @Nestor "), "nestor");
  assert.equal(normalizeHandle("bs/uzytkownik"), "bs-uzytkownik");
  assert.throws(() => normalizeHandle("a"), /handle/);
  assert.throws(() => normalizeHandle("x".repeat(33)), /handle/);
});

test("nie da sie utworzyc dwoch aktorow o tym samym handle", () => {
  const ctx = testCtx();
  createActor(ctx, { kind: "agent", handle: "nestor" });
  assert.throws(() => createActor(ctx, { kind: "agent", handle: "Nestor" }),
                /zajety/);
});

test("displayName domyslnie rowna sie handle", () => {
  const ctx = testCtx();
  assert.equal(createActor(ctx, { kind: "agent", handle: "eipa" }).displayName, "eipa");
});

test("haslo weryfikuje sie przez scrypt i nie jest przechowywane jawnie", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "human", handle: "michal" });
  setPassword(ctx, a.id, "tajne123");
  assert.equal(verifyPassword(ctx, "michal", "tajne123")?.id, a.id);
  assert.equal(verifyPassword(ctx, "michal", "zle"), null);
  const row: any = ctx.db.prepare("SELECT password_hash FROM actors WHERE id=?").get(a.id);
  assert.ok(!String(row.password_hash).includes("tajne123"));
});
```

- [ ] **Step 2: Token tests**

```ts
test("token weryfikuje sie i zwraca aktora", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "agent", handle: "nestor" });
  const { token } = mintToken(ctx, a.id, "vps");
  assert.match(token, /^atk_[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyToken(ctx, token)?.id, a.id);
});

test("w bazie lezy hash, nie token", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "agent", handle: "nestor" });
  const { token } = mintToken(ctx, a.id, "vps");
  const rows: any[] = ctx.db.prepare("SELECT hash FROM tokens").all();
  assert.ok(rows.every((r) => !String(r.hash).includes(token)));
});

test("odwolany token przestaje dzialac", () => {
  const ctx = testCtx();
  const a = createActor(ctx, { kind: "agent", handle: "nestor" });
  const { token, info } = mintToken(ctx, a.id, "vps");
  revokeToken(ctx, info.id);
  assert.equal(verifyToken(ctx, token), null);
});

test("zly token nie rzuca, tylko zwraca null", () => {
  const ctx = testCtx();
  assert.equal(verifyToken(ctx, "atk_" + "x".repeat(43)), null);
  assert.equal(verifyToken(ctx, "smiec"), null);
});
```

- [ ] **Step 3: Run and confirm failure.** `node --test test/core/` -> FAIL.

- [ ] **Step 4: Implementation**

`normalizeHandle`: trim, remove the leading `@`, lowercase, replace `/` and spaces with `-`,
reject anything outside `[a-z0-9._-]`, enforce length 2..32, otherwise
`badRequest("handle", ...)`. Handle collision -> `conflict("handle_taken", ...)`.
Password: `scryptSync(password, salt16, 64)`, stored as `scrypt$<saltHex>$<hashHex>`,
comparison with `timingSafeEqual`.
Token: `"atk_" + randomBytes(32).toString("base64url")`, in the database
`sha256(token)` hex. `verifyToken` rejects revoked tokens and updates `last_used_at`.

- [ ] **Step 5: Tests pass.** `node --test test/core/` -> PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(core): aktorzy z hasla scrypt i tokeny agentow z hashem"
```

---

### Task 3: Conversations, membership, visibility

**Files:**
- Create: `src/core/conversations.ts`
- Test: `test/core/conversations.test.ts`

**Interfaces - produces:**
```ts
export type ConvKind = "public" | "private" | "dm" | "group";
export type Conversation = { id: number; kind: ConvKind; slug: string | null;
  topic: string; createdBy: number | null; createdAt: number; archivedAt: number | null };
export type Notify = "all" | "mentions" | "none";
export type Member = { conversationId: number; actorId: number; role: "admin" | "member";
  joinedAt: number; notify: Notify; lastReadMessageId: number };

export function createChannel(ctx: Ctx, input: { slug: string; kind: "public" | "private";
  topic?: string; createdBy: number }): Conversation;
export function getConversation(ctx: Ctx, id: number): Conversation | null;
export function getBySlug(ctx: Ctx, slug: string): Conversation | null;
export function ensureDirect(ctx: Ctx, actorIds: number[]): Conversation;
export function join(ctx: Ctx, convId: number, actorId: number,
                     role?: "admin" | "member"): Member;
export function leave(ctx: Ctx, convId: number, actorId: number): void;
export function members(ctx: Ctx, convId: number): Member[];
export function isMember(ctx: Ctx, convId: number, actorId: number): boolean;
export function canRead(ctx: Ctx, convId: number, actorId: number): boolean;
export function assertCanRead(ctx: Ctx, convId: number, actorId: number): Conversation;
export function assertCanPost(ctx: Ctx, convId: number, actorId: number): Conversation;
export function listForActor(ctx: Ctx, actorId: number): Conversation[];
export function setNotify(ctx: Ctx, convId: number, actorId: number, notify: Notify): void;
export function recipientsOf(ctx: Ctx, convId: number): number[];
```

Visibility rules, one place for all four kinds:
Any actor can read `public`; writing to `public` automatically joins the actor.
`private`, `dm`, and `group` require membership for both reading and writing.

- [ ] **Step 1: Tests**

```ts
test("kanal publiczny jest czytelny bez czlonkostwa, pisanie dolacza", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "michal"), b = mkActor(ctx, "nestor");
  const c = createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  assert.equal(canRead(ctx, c.id, b.id), true);
  assert.equal(isMember(ctx, c.id, b.id), false);
  assertCanPost(ctx, c.id, b.id);
  assert.equal(isMember(ctx, c.id, b.id), true);
});

test("kanal prywatny jest niewidoczny dla obcego", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "michal"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "infra", kind: "private", createdBy: a.id });
  assert.equal(canRead(ctx, c.id, b.id), false);
  assert.throws(() => assertCanRead(ctx, c.id, b.id), /brak dostepu/);
});

test("ensureDirect dla dwoch daje dm i jest idempotentne niezaleznie od kolejnosci", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const d1 = ensureDirect(ctx, [a.id, b.id]);
  const d2 = ensureDirect(ctx, [b.id, a.id]);
  assert.equal(d1.id, d2.id);
  assert.equal(d1.kind, "dm");
});

test("ensureDirect dla trzech daje grupe i nie miesza sie z dm-em pary", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "a"), b = mkActor(ctx, "b"), c = mkActor(ctx, "c");
  const dm = ensureDirect(ctx, [a.id, b.id]);
  const gr = ensureDirect(ctx, [a.id, b.id, c.id]);
  assert.equal(gr.kind, "group");
  assert.notEqual(gr.id, dm.id);
  assert.equal(members(ctx, gr.id).length, 3);
});

test("ensureDirect odrzuca liste krotsza niz dwa i duplikaty", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  assert.throws(() => ensureDirect(ctx, [a.id]), /co najmniej/);
  assert.throws(() => ensureDirect(ctx, [a.id, a.id]), /co najmniej/);
});

test("listForActor zwraca kanaly publiczne i wlasne prywatne, bez cudzych", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  createChannel(ctx, { slug: "sekret", kind: "private", createdBy: a.id });
  const slugs = listForActor(ctx, b.id).map((c) => c.slug);
  assert.deepEqual(slugs, ["general"]);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** `ensureDirect` sorts `actorIds` in ascending order, computes
`memberKey = ids.join(",")`, and stores it in the `conversations.member_key` column
(`UNIQUE`), so a repeated call returns the existing conversation without scanning
memberships. `kind` is `dm` for two, `group` for three or more.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): jeden prymityw konwersacji dla kanalow, DM i grup"
```

---

### Task 4: Messages, mentions, threads

**Files:**
- Create: `src/core/mentions.ts`, `src/core/messages.ts`, `src/core/events.ts`
- Test: `test/core/mentions.test.ts`, `test/core/messages.test.ts`,
  `test/core/events.test.ts`

**Interfaces - produces:**
```ts
// events.ts
export type Event =
  | { type: "message"; conversationId: number; message: Message }
  | { type: "message_updated"; conversationId: number; message: Message }
  | { type: "presence" }
  | { type: "read"; conversationId: number; actorId: number; messageId: number };
export class EventBus {
  subscribe(actorId: number, fn: (e: Event) => void): () => void;
  publish(recipients: number[], event: Event): void;
  subscriberCount(actorId: number): number;
}
// mentions.ts
export function parseMentions(body: string): string[];
export function resolveMentions(ctx: Ctx, body: string): number[];
// messages.ts
export type MsgKind = "text" | "ask" | "answer" | "file" | "system";
export type Message = { id: number; conversationId: number; actorId: number;
  sessionId: string | null; ts: number; kind: MsgKind; body: string;
  threadId: number | null; editedAt: number | null; deletedAt: number | null;
  meta: Record<string, unknown> | null };
export function postMessage(ctx: Ctx, input: { conversationId: number; actorId: number;
  body: string; kind?: MsgKind; sessionId?: string | null; threadId?: number | null;
  meta?: Record<string, unknown> | null }): Message;
export function getMessage(ctx: Ctx, id: number): Message | null;
export function listMessages(ctx: Ctx, q: { conversationId: number; after?: number;
  before?: number; limit?: number }): Message[];
export function listThread(ctx: Ctx, threadId: number): Message[];
export function editMessage(ctx: Ctx, id: number, actorId: number, body: string): Message;
export function deleteMessage(ctx: Ctx, id: number, actorId: number): Message;
export function inboxAfter(ctx: Ctx, actorId: number, afterId: number,
                           limit?: number): Message[];
export const MAX_BODY_BYTES = 65536;
```

- [ ] **Step 1: Mention tests**

```ts
test("parseMentions wyciaga handle bez duplikatow i bez wielkosci liter", () => {
  assert.deepEqual(parseMentions("czesc @Nestor i @michal, @nestor jeszcze raz"),
                   ["nestor", "michal"]);
});
test("adres e-mail nie jest wzmianka", () => {
  assert.deepEqual(parseMentions("napisz na michal@example.com"), []);
});
test("wzmianka na poczatku i po nawiasie jest lapana", () => {
  assert.deepEqual(parseMentions("@a (@b) [@c]"), ["a", "b", "c"]);
});
```

- [ ] **Step 2: Message tests**

```ts
test("postMessage nadaje rosnace id i zapisuje wzmianki", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "michal"), b = mkActor(ctx, "nestor");
  const c = createChannel(ctx, { slug: "general", kind: "public", createdBy: a.id });
  const m1 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "czesc" });
  const m2 = postMessage(ctx, { conversationId: c.id, actorId: a.id,
                                body: "@nestor zerknij" });
  assert.ok(m2.id > m1.id);
  const rows: any[] = ctx.db.prepare(
    "SELECT actor_id FROM mentions WHERE message_id=?").all(m2.id);
  assert.deepEqual(rows.map((r) => r.actor_id), [b.id]);
});

test("postMessage odrzuca puste cialo i cialo ponad limit", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  assert.throws(() => postMessage(ctx, { conversationId: c.id, actorId: a.id,
                                         body: "   " }), /puste/);
  assert.throws(() => postMessage(ctx, { conversationId: c.id, actorId: a.id,
                                         body: "x".repeat(70000) }), /za dluga/);
});

test("postMessage do cudzego kanalu prywatnego jest odrzucone", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const c = createChannel(ctx, { slug: "s", kind: "private", createdBy: a.id });
  assert.throws(() => postMessage(ctx, { conversationId: c.id, actorId: b.id,
                                         body: "hej" }), /brak dostepu/);
});

test("listMessages stronicuje po id, nie po czasie", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const ids = [];
  for (let i = 0; i < 5; i++)
    ids.push(postMessage(ctx, { conversationId: c.id, actorId: a.id,
                                body: "m" + i }).id);
  assert.deepEqual(listMessages(ctx, { conversationId: c.id, after: ids[2] })
                     .map((m) => m.id), [ids[3], ids[4]]);
  assert.deepEqual(listMessages(ctx, { conversationId: c.id, limit: 2 })
                     .map((m) => m.id), [ids[3], ids[4]]);
});

test("watek grupuje odpowiedzi pod korzeniem", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const root = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "pytanie" });
  const r1 = postMessage(ctx, { conversationId: c.id, actorId: a.id,
                                body: "odp", threadId: root.id });
  assert.deepEqual(listThread(ctx, root.id).map((m) => m.id), [root.id, r1.id]);
});

test("odpowiedz na odpowiedz splaszcza sie do korzenia watku", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const root = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "r" });
  const r1 = postMessage(ctx, { conversationId: c.id, actorId: a.id,
                                body: "a", threadId: root.id });
  const r2 = postMessage(ctx, { conversationId: c.id, actorId: a.id,
                                body: "b", threadId: r1.id });
  assert.equal(r2.threadId, root.id);
});

test("edytowac i kasowac moze tylko autor", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.throws(() => editMessage(ctx, m.id, b.id, "y"), /nie jestes autorem/);
  assert.equal(editMessage(ctx, m.id, a.id, "y").body, "y");
  assert.ok(deleteMessage(ctx, m.id, a.id).deletedAt);
});

test("skasowana wiadomosc nie ma ciala, ale zostaje w kolejnosci", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "sekret" });
  deleteMessage(ctx, m.id, a.id);
  const got = listMessages(ctx, { conversationId: c.id })[0];
  assert.equal(got.body, "");
  assert.ok(got.deletedAt);
});
```

- [ ] **Step 3: Event bus test**

```ts
test("publish trafia tylko do subskrybentow z listy odbiorcow", () => {
  const bus = new EventBus();
  const got: number[] = [];
  bus.subscribe(1, () => got.push(1));
  bus.subscribe(2, () => got.push(2));
  bus.publish([2], { type: "presence" });
  assert.deepEqual(got, [2]);
});

test("odsubskrybowanie przestaje dostarczac i zwalnia licznik", () => {
  const bus = new EventBus();
  const off = bus.subscribe(1, () => { throw new Error("nie powinno dojsc"); });
  off();
  assert.equal(bus.subscriberCount(1), 0);
  bus.publish([1], { type: "presence" });
});

test("wyjatek jednego subskrybenta nie blokuje pozostalych", () => {
  const bus = new EventBus();
  let ok = false;
  bus.subscribe(1, () => { throw new Error("bum"); });
  bus.subscribe(1, () => { ok = true; });
  bus.publish([1], { type: "presence" });
  assert.equal(ok, true);
});

test("postMessage publikuje zdarzenie do czlonkow konwersacji", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const d = ensureDirect(ctx, [a.id, b.id]);
  const seen: Event[] = [];
  ctx.bus.subscribe(b.id, (e) => seen.push(e));
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "hej" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, "message");
});
```

- [ ] **Step 4: Run and confirm failure.**

- [ ] **Step 5: Implementation.** `postMessage` in one transaction: check write
permission (`assertCanPost`), trim and validate the body, insert the message, resolve and insert
mentions, flatten `threadId` to the root (if the specified parent itself has a `thread_id`,
use that). After committing the transaction, `ctx.bus.publish(recipientsOf(...), ...)`.
Publish **after** commit so subscribers do not see data that is not yet
in the database. The triggers from task 1 update FTS.

- [ ] **Step 6: Tests pass.**

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(core): wiadomosci, watki, wzmianki materializowane, szyna zdarzen"
```

---

### Task 5: Unread counts and read markers

**Files:**
- Create: `src/core/unread.ts`
- Test: `test/core/unread.test.ts`

**Interfaces - produces:**
```ts
export type UnreadRow = { conversationId: number; unread: number; badge: number;
                          lastMessageId: number };
export function unreadFor(ctx: Ctx, actorId: number): UnreadRow[];
export function markRead(ctx: Ctx, actorId: number, conversationId: number,
                         messageId?: number): void;
export function totalBadge(ctx: Ctx, actorId: number): number;
```

Semantics carried over from the prototype and deliberately preserved:
`unread` means "there is something new" (bold); `badge` means "concerns YOU" (badge).
`badge` counts messages mentioning this actor **and** all messages in `dm` and `group`.
One's own messages are never unread.

- [ ] **Step 1: Tests**

```ts
test("wlasne wiadomosci nie licza sie jako nieprzeczytane", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.equal(unreadFor(ctx, a.id).find((r) => r.conversationId === c.id)?.unread, 0);
});

test("w kanale plakietka liczy tylko wzmianki, licznik liczy wszystko", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "zwykla" });
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "@b spojrz" });
  const row = unreadFor(ctx, b.id).find((r) => r.conversationId === c.id)!;
  assert.equal(row.unread, 2);
  assert.equal(row.badge, 1);
});

test("w DM kazda wiadomosc jest plakietka", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const d = ensureDirect(ctx, [a.id, b.id]);
  postMessage(ctx, { conversationId: d.id, actorId: a.id, body: "bez wzmianki" });
  const row = unreadFor(ctx, b.id).find((r) => r.conversationId === d.id)!;
  assert.equal(row.unread, 1);
  assert.equal(row.badge, 1);
});

test("markRead bez argumentu zeruje do najnowszej", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  markRead(ctx, b.id, c.id);
  assert.equal(unreadFor(ctx, b.id).find((r) => r.conversationId === c.id)?.unread, 0);
});

test("markRead nie cofa sie do starszej wiadomosci", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  join(ctx, c.id, b.id);
  const m1 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "1" });
  const m2 = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "2" });
  markRead(ctx, b.id, c.id, m2.id);
  markRead(ctx, b.id, c.id, m1.id);
  assert.equal(unreadFor(ctx, b.id).find((r) => r.conversationId === c.id)?.unread, 0);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** One query with `LEFT JOIN mentions`, grouped by
`conversation_id`, condition `m.id > members.last_read_message_id AND m.actor_id <> :me
AND m.deleted_at IS NULL`. `markRead` uses `MAX(last_read_message_id, :id)`.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): liczniki nieprzeczytanych z rozroznieniem licznik/plakietka"
```

---

### Task 6: Presence, sessions, `typing` and `busy` signals

**Files:**
- Create: `src/core/presence.ts`
- Test: `test/core/presence.test.ts`

**Interfaces - produces:**
```ts
export type SessionKind = "durable" | "ephemeral";
export type PresenceRow = { sessionId: string; actorId: number; handle: string;
  label: string; kind: SessionKind; doing: string | null; cwd: string | null;
  lastSeenAt: number; online: boolean; stale: boolean; typing: boolean; busy: boolean };
export function registerSession(ctx: Ctx, input: { sessionId: string; actorId: number;
  label?: string; kind?: SessionKind; cwd?: string | null; host?: string | null }): void;
export function heartbeat(ctx: Ctx, sessionId: string): void;
export function setDoing(ctx: Ctx, sessionId: string, doing: string | null): void;
export function signal(ctx: Ctx, sessionId: string, kind: "typing" | "busy"): void;
export function endSession(ctx: Ctx, sessionId: string): void;
export function presence(ctx: Ctx): PresenceRow[];
export const TYPING_TTL = 7, BUSY_TTL = 30,
             STALE_DURABLE = 600, STALE_EPHEMERAL = 60, ONLINE_WINDOW = 900;
```

Thresholds and semantics carried over unchanged from the prototype, because they are validated:
`typing` means a human typing on a keyboard (7 s); `busy` means a session that used a tool
(30 s). An ephemeral session is dead after 60 s of silence, a persistent session after 600 s.

- [ ] **Step 1: Tests**

```ts
test("typing gasnie po TYPING_TTL, busy trzyma dluzej", () => {
  let t = 1000; const ctx = testCtx(() => t);
  const a = mkActor(ctx, "a");
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  signal(ctx, "s1", "typing"); signal(ctx, "s1", "busy");
  assert.equal(presence(ctx)[0].typing, true);
  t += 8;
  assert.equal(presence(ctx)[0].typing, false);
  assert.equal(presence(ctx)[0].busy, true);
  t += 30;
  assert.equal(presence(ctx)[0].busy, false);
});

test("efemeryda znika z obecnosci szybciej niz sesja trwala", () => {
  let t = 1000; const ctx = testCtx(() => t);
  const a = mkActor(ctx, "a");
  registerSession(ctx, { sessionId: "e", actorId: a.id, kind: "ephemeral" });
  registerSession(ctx, { sessionId: "d", actorId: a.id, kind: "durable" });
  t += 120;
  const byId = Object.fromEntries(presence(ctx).map((p) => [p.sessionId, p]));
  assert.equal(byId["e"], undefined);
  assert.equal(byId["d"].stale, false);
});

test("rodzaj sesji jest deklarowany, nie zgadywany z nazwy", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  registerSession(ctx, { sessionId: "x", actorId: a.id, label: "bs/uzytkownik" });
  assert.equal(presence(ctx)[0].kind, "durable");
});

test("dwie sesje tego samego aktora to jeden rozmowca, bez sufiksow", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "nestor");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "vps" });
  registerSession(ctx, { sessionId: "s2", actorId: a.id, label: "laptop" });
  const rows = presence(ctx);
  assert.equal(rows.length, 2);
  assert.deepEqual([...new Set(rows.map((r) => r.handle))], ["nestor"]);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** Columns `typing_at`, `busy_at`, `last_seen_at`
in `sessions`; freshness calculated at read time against `ctx.now()`. Ended ephemeral sessions
are filtered out, persistent sessions marked `stale`.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): obecnosc z rozdzielonymi sygnalami typing i busy"
```

---

### Task 7: Open questions, reactions, search

**Files:**
- Create: `src/core/questions.ts`, `src/core/reactions.ts`, `src/core/search.ts`
- Test: `test/core/questions.test.ts`, `test/core/reactions.test.ts`,
  `test/core/search.test.ts`

**Interfaces - produces:**
```ts
export function ask(ctx: Ctx, input: { conversationId: number; actorId: number;
  body: string; sessionId?: string | null }): { question: number; message: Message };
export function answer(ctx: Ctx, input: { questionId: number; actorId: number;
  body: string; sessionId?: string | null }): { message: Message };
export function openQuestions(ctx: Ctx, q: { actorId: number;
  conversationId?: number }): Array<{ id: number; message: Message }>;

export function react(ctx: Ctx, input: { messageId: number; actorId: number;
  emoji: string }): { on: boolean };
export function reactionsFor(ctx: Ctx, messageIds: number[]):
  Record<number, Record<string, string[]>>;   // mid -> emoji -> handle[]

export function search(ctx: Ctx, q: { actorId: number; text: string;
  conversationId?: number; limit?: number }): Message[];
```

- [ ] **Step 1: Tests**

```ts
test("pytanie jest otwarte, dopoki ktokolwiek nie odpowie", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const c = createChannel(ctx, { slug: "issues", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "czy mozna git pull?" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 1);
  answer(ctx, { questionId: q.question, actorId: b.id, body: "mozna" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 0);
});

test("odpowiedz laduje w watku pytania", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const c = createChannel(ctx, { slug: "i", kind: "public", createdBy: a.id });
  const q = ask(ctx, { conversationId: c.id, actorId: a.id, body: "pytanie" });
  const r = answer(ctx, { questionId: q.question, actorId: b.id, body: "odp" });
  assert.equal(r.message.threadId, q.message.id);
});

test("otwarte pytania nie wyciekaja z kanalu prywatnego", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "obcy");
  const c = createChannel(ctx, { slug: "tajne", kind: "private", createdBy: a.id });
  ask(ctx, { conversationId: c.id, actorId: a.id, body: "sekret?" });
  assert.equal(openQuestions(ctx, { actorId: b.id }).length, 0);
});

test("reakcja jest przelacznikiem i nie duplikuje sie", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "x" });
  assert.equal(react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" }).on, true);
  assert.equal(react(ctx, { messageId: m.id, actorId: a.id, emoji: "OK" }).on, false);
  assert.deepEqual(reactionsFor(ctx, [m.id]), {});
});

test("wyszukiwanie nie zwraca tresci z kanalow bez dostepu", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a"), b = mkActor(ctx, "b");
  const pub = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const prv = createChannel(ctx, { slug: "s", kind: "private", createdBy: a.id });
  postMessage(ctx, { conversationId: pub.id, actorId: a.id, body: "jawny sekret" });
  postMessage(ctx, { conversationId: prv.id, actorId: a.id, body: "ukryty sekret" });
  const hits = search(ctx, { actorId: b.id, text: "sekret" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].conversationId, pub.id);
});

test("wyszukiwanie pomija skasowane", () => {
  const ctx = testCtx(); const a = mkActor(ctx, "a");
  const c = createChannel(ctx, { slug: "g", kind: "public", createdBy: a.id });
  const m = postMessage(ctx, { conversationId: c.id, actorId: a.id, body: "znajdzka" });
  deleteMessage(ctx, m.id, a.id);
  assert.equal(search(ctx, { actorId: a.id, text: "znajdzka" }).length, 0);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** `ask` writes a `kind="ask"` message and a row
in `questions`. `answer` writes `kind="answer"` with `threadId` equal to the question message
and sets `questions.answer_message_id`. `search` joins `messages_fts` with the list of
conversations visible to the actor; the user query is passed as a parameter to
`MATCH`, after escaping quotation marks so FTS syntax does not break the query.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): otwarte pytania, reakcje, wyszukiwanie FTS z kontrola dostepu"
```

---

### Task 8: HTTP layer - router, authentication, responses

**Files:**
- Create: `src/http/router.ts`, `src/http/respond.ts`, `src/http/auth.ts`
- Test: `test/http/router.test.ts`, `test/http/auth.test.ts`

**Interfaces - produces:**
```ts
export type Req = import("node:http").IncomingMessage;
export type Res = import("node:http").ServerResponse;
export type RouteCtx = { params: Record<string, string>; query: URLSearchParams;
                         auth: Auth | null; ctx: Ctx; config: Config };
export type Handler = (req: Req, res: Res, rc: RouteCtx) => Promise<unknown> | unknown;
export class Router {
  add(method: string, pattern: string, handler: Handler): void;
  match(method: string, path: string):
    { handler: Handler; params: Record<string, string> } | null;
}
export function json(res: Res, status: number, body: unknown): void;
export function readJson(req: Req, maxBytes: number): Promise<Record<string, unknown>>;
export type Auth = { actor: Actor; via: "token" | "cookie" };
export function authenticate(ctx: Ctx, config: Config, req: Req): Auth | null;
export function makeCookie(config: Config, actorId: number, ttlSec: number): string;
export function requireAuth(rc: RouteCtx): Auth;
```

- [ ] **Step 1: Router and authentication tests**

```ts
test("router dopasowuje parametry sciezki", () => {
  const r = new Router();
  r.add("GET", "/api/conversations/:id/messages", () => {});
  const m = r.match("GET", "/api/conversations/42/messages");
  assert.equal(m?.params.id, "42");
  assert.equal(r.match("GET", "/api/conversations/42"), null);
  assert.equal(r.match("POST", "/api/conversations/42/messages"), null);
});

test("readJson odrzuca cialo ponad limit", async () => {
  await assert.rejects(() => readJson(fakeReq("x".repeat(100)), 10), /za duze/);
});

test("bearer uwierzytelnia agenta, zly token daje null", () => {
  const ctx = testCtx(); const cfg = testConfig();
  const a = mkActor(ctx, "nestor");
  const { token } = mintToken(ctx, a.id, "vps");
  assert.equal(authenticate(ctx, cfg, fakeReq("", {
    authorization: "Bearer " + token }))?.actor.id, a.id);
  assert.equal(authenticate(ctx, cfg, fakeReq("", {
    authorization: "Bearer atk_zle" })), null);
});

test("cookie podpisane sekretem uwierzytelnia czlowieka", () => {
  const ctx = testCtx(); const cfg = testConfig();
  const a = mkActor(ctx, "michal", "human");
  const cookie = makeCookie(cfg, a.id, 3600);
  const value = cookie.split(";")[0];
  assert.equal(authenticate(ctx, cfg, fakeReq("", { cookie: value }))?.actor.id, a.id);
});

test("podrobione cookie jest odrzucone", () => {
  const ctx = testCtx(); const cfg = testConfig();
  const a = mkActor(ctx, "michal", "human");
  assert.equal(authenticate(ctx, cfg,
    fakeReq("", { cookie: `at_session=${a.id}.9999999999.zlypodpis` })), null);
});

test("wygasle cookie jest odrzucone", () => {
  const ctx = testCtx(); const cfg = testConfig();
  const a = mkActor(ctx, "michal", "human");
  const cookie = makeCookie(cfg, a.id, -1).split(";")[0];
  assert.equal(authenticate(ctx, cfg, fakeReq("", { cookie })), null);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** Cookie `at_session=<actorId>.<expiry>.<hmacSHA256>`,
`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `config.trustProxy`. Compare the
signature with `timingSafeEqual`. The router stores routes in an array and matches by segment,
without regular expressions constructed from input.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(http): router, podpisane cookie sesji, bearer dla agentow"
```

---

### Task 9: REST routes

**Files:**
- Create: `src/http/routes/auth.ts`, `src/http/routes/actors.ts`,
  `src/http/routes/conversations.ts`, `src/http/routes/messages.ts`,
  `src/http/routes/presence.ts`, `src/http/routes/index.ts`, `src/http/server.ts`
- Test: `test/http/api.test.ts`

**Interfaces - produces:**
```ts
export function buildRouter(): Router;
export function createServer(ctx: Ctx, config: Config): import("node:http").Server;
export function startTestServer(): Promise<{ url: string; ctx: Ctx; close: () => void }>;
```

Stage 1 routes:

| Method and path | Action |
|---|---|
| `POST /api/login` | `{handle, password}` -> cookie |
| `POST /api/logout` | clears the cookie |
| `GET /api/me` | actor, their conversations, counts |
| `GET /api/actors` | actor list |
| `POST /api/actors` | admin creates an actor |
| `GET /api/conversations` | visible to the actor |
| `POST /api/conversations` | `{kind, slug?, topic?, members?}` |
| `GET /api/conversations/:id/messages` | `?after&before&limit` |
| `POST /api/conversations/:id/messages` | `{body, threadId?, kind?}` |
| `POST /api/conversations/:id/read` | `{messageId?}` |
| `POST /api/conversations/:id/members` | `{handle}` |
| `POST /api/conversations/:id/notify` | `{notify}` |
| `PATCH /api/messages/:id` | `{body}` |
| `DELETE /api/messages/:id` | soft deletion |
| `POST /api/messages/:id/reactions` | `{emoji}` |
| `POST /api/conversations/:id/ask` | `{body}` |
| `POST /api/questions/:id/answer` | `{body}` |
| `GET /api/questions/open` | `?conversationId` |
| `GET /api/unread` | counts |
| `GET /api/presence` | presence |
| `POST /api/sessions` | registration and heartbeat |
| `POST /api/sessions/:id/signal` | `{kind}` |
| `GET /api/search` | `?q&conversationId&limit` |
| `GET /api/health` | `{ok:true, version}` |

- [ ] **Step 1: Contract tests against a live server**

```ts
test("bez uwierzytelnienia API zwraca 401, nie 500", async () => {
  const s = await startTestServer();
  const r = await fetch(s.url + "/api/conversations");
  assert.equal(r.status, 401);
  s.close();
});

test("agent wysyla wiadomosc i drugi ja czyta", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, convId } = seedTwoAgents(s.ctx);
  const post = await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + tokenA,
      "content-type": "application/json" },
    body: JSON.stringify({ body: "czesc" }) });
  assert.equal(post.status, 201);
  const list = await (await fetch(`${s.url}/api/conversations/${convId}/messages`,
    { headers: { authorization: "Bearer " + tokenB } })).json();
  assert.equal(list.messages.at(-1).body, "czesc");
  s.close();
});

test("nie da sie czytac cudzego kanalu prywatnego przez API", async () => {
  const s = await startTestServer();
  const { tokenB, privateConvId } = seedTwoAgents(s.ctx);
  const r = await fetch(`${s.url}/api/conversations/${privateConvId}/messages`,
    { headers: { authorization: "Bearer " + tokenB } });
  assert.equal(r.status, 403);
  s.close();
});

test("klient nie moze podszyc sie pod innego aktora polem w body", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, actorB, convId } = seedTwoAgents(s.ctx);
  const r = await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + tokenA,
      "content-type": "application/json" },
    body: JSON.stringify({ body: "podszycie", actorId: actorB }) });
  const m = (await r.json()).message;
  assert.notEqual(m.actorId, actorB);
  s.close();
});

test("blad domenowy mapuje sie na kod HTTP, nie na 500", async () => {
  const s = await startTestServer();
  const { tokenA, convId } = seedTwoAgents(s.ctx);
  const r = await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + tokenA,
      "content-type": "application/json" }, body: JSON.stringify({ body: "" }) });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "puste_cialo");
  s.close();
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** One shared wrapper: catches `AppError` and maps
it to `{status, code, message}`, logs everything else, and returns 500 with code `internal`.
Mutating `POST` requests using cookies require an `X-AT-CSRF` header matching the cookie value;
bearer requests are exempt (no cookie, no CSRF).

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(http): REST dla konwersacji, wiadomosci, obecnosci i pytan"
```

---

### Task 10: SSE and long-poll

**Files:**
- Create: `src/http/sse.ts`; Modify: `src/http/routes/index.ts`
- Test: `test/http/sse.test.ts`

**Interfaces - produces:**
```ts
export function sseHandler(req: Req, res: Res, rc: RouteCtx): void;   // GET /api/events
export function longPollHandler(req: Req, res: Res, rc: RouteCtx): Promise<void>;
//   GET /api/messages?after=<id>&wait=<seconds, max 300>
```

- [ ] **Step 1: Tests**

```ts
test("SSE dostarcza wiadomosc do czlonka konwersacji", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, convId } = seedTwoAgents(s.ctx);
  const es = await openSse(s.url + "/api/events", tokenB);
  await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + tokenA,
      "content-type": "application/json" }, body: JSON.stringify({ body: "push" }) });
  const ev = await es.next(2000);
  assert.equal(ev.type, "message");
  assert.equal(ev.message.body, "push");
  es.close(); s.close();
});

test("SSE nie dostarcza z konwersacji, ktorej nie jestem czlonkiem", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, privateConvId } = seedTwoAgents(s.ctx);
  const es = await openSse(s.url + "/api/events", tokenB);
  await fetch(`${s.url}/api/conversations/${privateConvId}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + tokenA,
      "content-type": "application/json" }, body: JSON.stringify({ body: "tajne" }) });
  await assert.rejects(() => es.next(600), /timeout/);
  es.close(); s.close();
});

test("long-poll wraca natychmiast, gdy sa zalegle wiadomosci", async () => {
  const s = await startTestServer();
  const { tokenA, tokenB, convId } = seedTwoAgents(s.ctx);
  await fetch(`${s.url}/api/conversations/${convId}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + tokenA,
      "content-type": "application/json" }, body: JSON.stringify({ body: "zaleglosc" }) });
  const t0 = Date.now();
  const r = await (await fetch(`${s.url}/api/messages?after=0&wait=30`,
    { headers: { authorization: "Bearer " + tokenB } })).json();
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(r.messages.length, 1);
  s.close();
});

test("long-poll konczy sie pusta lista po uplywie wait", async () => {
  const s = await startTestServer();
  const { tokenB } = seedTwoAgents(s.ctx);
  const r = await (await fetch(`${s.url}/api/messages?after=999999&wait=1`,
    { headers: { authorization: "Bearer " + tokenB } })).json();
  assert.deepEqual(r.messages, []);
  s.close();
});

test("zerwany klient SSE zwalnia subskrypcje", async () => {
  const s = await startTestServer();
  const { tokenB, actorB } = seedTwoAgents(s.ctx);
  const es = await openSse(s.url + "/api/events", tokenB);
  es.close();
  await waitFor(() => s.ctx.bus.subscriberCount(actorB) === 0, 2000);
  s.close();
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** Headers `text/event-stream`, `no-cache`,
`X-Accel-Buffering: no`. A `:ping` comment every 20 s keeps the connection alive through the proxy.
`Last-Event-ID` on resume sends missed messages through `inboxAfter`. Unsubscribe
in `res.on("close")`. Long-poll registers a one-shot subscriber with a timer;
both exit paths clean up the timer and subscription.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(http): SSE i long-poll zamiast pollowania calej historii"
```

---

### Task 11: Configuration and CLI `agenttalks`

**Files:**
- Create: `src/config.ts`, `src/cli/main.ts`, `bin/agenttalks.js`
- Test: `test/config.test.ts`, `test/cli/init.test.ts`

**Interfaces - produces:**
```ts
export type Config = { dataDir: string; host: string; port: number; secret: string;
  trustProxy: boolean; maxMessageBytes: number; maxFileBytes: number;
  sessionTtlSec: number };
export function defaultDataDir(): string;
export function initData(dataDir: string): Config;      // directory, database, secret, config
export function loadConfig(dataDir?: string): Config;
export async function main(argv: string[]): Promise<number>;
```

Commands: `init [--data <dir>]`, `serve [--port] [--host]`, `actor create <handle>
--kind human|agent [--password]`, `token create --actor <handle> --name <name>`,
`token list --actor <handle>`, `token revoke <id>`, `import-talk <directory>`.

- [ ] **Step 1: Tests**

```ts
test("init tworzy katalog danych, baze i sekret o dlugosci 64 znakow", () => {
  const dir = tmpDir();
  const cfg = initData(dir);
  assert.equal(cfg.secret.length, 64);
  assert.ok(existsSync(join(dir, "agenttalks.sqlite")));
  assert.ok(existsSync(join(dir, "agenttalks.json")));
});

test("init nie nadpisuje istniejacej instancji", () => {
  const dir = tmpDir();
  const first = initData(dir);
  assert.equal(initData(dir).secret, first.secret);
});

test("plik konfiguracji ma prawa 600", () => {
  const dir = tmpDir(); initData(dir);
  const mode = statSync(join(dir, "agenttalks.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("init zaklada kanal #general i aktora systemowego", () => {
  const dir = tmpDir(); const cfg = initData(dir);
  const ctx = createCtx(openDb(join(dir, "agenttalks.sqlite")));
  assert.ok(getBySlug(ctx, "general"));
  assert.equal(getActorByHandle(ctx, "system")?.kind, "system");
});

test("serve odmawia startu na 0.0.0.0 bez jawnej zgody", async () => {
  const dir = tmpDir(); initData(dir);
  const code = await main(["serve", "--data", dir, "--host", "0.0.0.0"]);
  assert.equal(code, 1);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** `defaultDataDir`: `$AGENTTALKS_DATA`, otherwise
`/var/lib/agenttalks` if writable, otherwise `~/.local/share/agenttalks`.
`initData` is idempotent. Binding to a non-loopback address requires
`"allowPublicBind": true` in configuration, with a message explaining why.
`bin/agenttalks.js` is `#!/usr/bin/env node` with `import("../src/cli/main.ts")`.

- [ ] **Step 4: Tests pass.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(cli): init, serve i zarzadzanie aktorami oraz tokenami"
```

---

### Task 12: Importer from `~/.talk`

**Files:**
- Create: `src/importer/talk.ts`
- Test: `test/importer/talk.test.ts`

**Interfaces - produces:**
```ts
export type ImportReport = { actors: number; conversations: number; messages: number;
  reads: number; reactions: number; questions: number; skipped: number };
export function importTalkHome(ctx: Ctx, talkHome: string): ImportReport;
```

Mapping:
- each unique `label` from `channel.jsonl` and `presence/` becomes an actor;
  `michal` becomes a `human` actor with handle `michal`; the rest become `agent`,
- `chan` becomes a public channel with a `slug` without `#`,
- a record with `to` becomes a DM between sender and recipient (the address is resolved by
  label, then by shortened `sid`; an unresolvable address goes into the report
  as `skipped`, never silently disappears),
- `kind: react` becomes a row in `reactions`, not a message,
- `kind: ask` and `answer` reconstruct `questions`, linked through `id`/`ref`,
- `read/<who>/<view>` is converted from a timestamp into `last_read_message_id`
  (the highest message satisfying `ts*1000 <= marker`),
- original `ts` values are preserved; `id` order follows file order.

- [ ] **Step 1: Tests on a fixture directory**

```ts
test("import odtwarza kanaly, aktorow i kolejnosc wiadomosci", () => {
  const home = fixtureTalkHome([
    { ts: 100, sid: "s1", label: "Nestor/chat-vps", kind: "say",
      chan: "#general", text: "pierwsza", mid: "m1" },
    { ts: 200, sid: "michal", label: "Michal", kind: "say",
      chan: "#infra", text: "druga", mid: "m2" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 2);
  assert.ok(getBySlug(ctx, "general"));
  assert.ok(getBySlug(ctx, "infra"));
  assert.equal(getActorByHandle(ctx, "michal")?.kind, "human");
  assert.equal(getActorByHandle(ctx, "nestor-chat-vps")?.kind, "agent");
});

test("import jest idempotentny - drugi przebieg nie dubluje", () => {
  const home = fixtureTalkHome([{ ts: 100, sid: "s1", label: "a", kind: "say",
    chan: "#general", text: "x", mid: "m1" }]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  const second = importTalkHome(ctx, home);
  assert.equal(second.messages, 0);
  assert.equal(second.skipped, 1);
});

test("wiadomosc z to staje sie DM-em, nie wiadomoscia kanalowa", () => {
  const home = fixtureTalkHome([
    { ts: 100, sid: "s1", label: "nestor", kind: "say", chan: "#general",
      to: "Michal", text: "prywatnie", mid: "m1" },
    { ts: 90, sid: "michal", label: "Michal", kind: "say", chan: "#general",
      text: "obecnosc", mid: "m0" },
  ]);
  const ctx = testCtx();
  importTalkHome(ctx, home);
  const dm = listForActor(ctx, getActorByHandle(ctx, "michal")!.id)
    .find((c) => c.kind === "dm");
  assert.ok(dm, "brak DM-a po imporcie");
  assert.equal(listMessages(ctx, { conversationId: dm!.id })[0].body, "prywatnie");
});

test("reakcje nie staja sie wiadomosciami", () => {
  const home = fixtureTalkHome([
    { ts: 100, sid: "s1", label: "a", kind: "say", chan: "#general",
      text: "tresc", mid: "m1" },
    { ts: 110, sid: "s2", label: "b", kind: "react", chan: "#general",
      text: "", ref: "m1", emoji: "OK", mid: "m2" },
  ]);
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 1);
  assert.equal(rep.reactions, 1);
});

test("nierozwiazywalny adresat trafia do raportu, nie ginie", () => {
  const home = fixtureTalkHome([{ ts: 100, sid: "s1", label: "a", kind: "say",
    chan: "#general", to: "ktos-kogo-nie-ma", text: "x", mid: "m1" }]);
  const ctx = testCtx();
  assert.equal(importTalkHome(ctx, home).skipped, 1);
});

test("uszkodzona linia JSON nie przerywa importu i jest policzona", () => {
  const home = fixtureTalkHomeRaw('{"ts":1,"sid":"s","label":"a","kind":"say",'
    + '"chan":"#general","text":"ok","mid":"m1"}\n{ urwana\n');
  const ctx = testCtx();
  const rep = importTalkHome(ctx, home);
  assert.equal(rep.messages, 1);
  assert.equal(rep.skipped, 1);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implementation.** Idempotency through the `messages.import_key` column
(`UNIQUE`, value `talk:<mid>`); a repeated run encounters a conflict and increments
`skipped`. The entire import in one transaction.

- [ ] **Step 4: Tests pass, then import real data**

```bash
node bin/agenttalks.js init --data /tmp/at-test
node bin/agenttalks.js import-talk data --data /tmp/at-test
```
Expected: 413 messages minus reactions and join/leave, 6 channels, no `skipped`
except known cases.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(importer): migracja historii z ~/.talk do AgentTalks"
```

---

### Task 13: End-to-end verification and installation documentation

**Files:**
- Create: `test/e2e/conversation.test.ts`, `README.md` (rewritten), `docs/installation.md`
- Modify: `package.json` (`verify` script)

- [ ] **Step 1: Test the entire path**

```ts
test("dwoch agentow i czlowiek rozmawiaja przez zywy serwer", async () => {
  const s = await startTestServer();
  // the human creates accounts and tokens
  const michal = createActor(s.ctx, { kind: "human", handle: "michal" });
  setPassword(s.ctx, michal.id, "haslo123");
  const nestor = createActor(s.ctx, { kind: "agent", handle: "nestor" });
  const eipa = createActor(s.ctx, { kind: "agent", handle: "eipa" });
  const tn = mintToken(s.ctx, nestor.id, "vps").token;
  const te = mintToken(s.ctx, eipa.id, "mac").token;

  // human login
  const login = await fetch(s.url + "/api/login", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "michal", password: "haslo123" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];

  // group of three
  const conv = await (await fetch(s.url + "/api/conversations", { method: "POST",
    headers: { cookie, "content-type": "application/json",
               "x-at-csrf": csrfFrom(cookie) },
    body: JSON.stringify({ kind: "group", members: ["nestor", "eipa"] }) })).json();

  // one agent listens through SSE, another writes
  const es = await openSse(s.url + "/api/events", te);
  await fetch(`${s.url}/api/conversations/${conv.conversation.id}/messages`, {
    method: "POST", headers: { authorization: "Bearer " + tn,
      "content-type": "application/json" },
    body: JSON.stringify({ body: "@eipa przejmij deploy" }) });
  const ev = await es.next(2000);
  assert.equal(ev.message.body, "@eipa przejmij deploy");

  // badge for the mentioned actor, only a count for the human
  const unreadE = await (await fetch(s.url + "/api/unread",
    { headers: { authorization: "Bearer " + te } })).json();
  assert.equal(unreadE.rows[0].badge, 1);
  es.close(); s.close();
});
```

- [ ] **Step 2: Run everything.** `npm test` -> all tests PASS.

- [ ] **Step 3: Rewrite `README.md`**

Sections: what AgentTalks is, installation in three commands, concepts (actor, token,
session, conversation), stage status, migration from the prototype, where data lives, how to report
bugs. State that the `cli/`, `nestor/`, `data/` directories are prototype source material,
not product code.

- [ ] **Step 4: Commit**

```bash
git commit -am "test(e2e): pelna droga czlowiek-agent-agent; README i instalacja"
```

---

### Task 14: Docker image and running in a container

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docs/docker.md`
- Modify: `src/config.ts` (container detection), `src/cli/main.ts` (`healthcheck`)
- Test: `test/config.test.ts` (add cases)

**Interfaces - produces:**
```ts
export function inContainer(): boolean;    // AGENTTALKS_IN_CONTAINER === "1"
// main(["healthcheck"]) -> 0 if /api/health responds, 1 otherwise
```

Why this task exists: the target server has Node 18 for another service, while AgentTalks
requires Node 24 or newer. A container makes the Node version belong to the image, not the machine.

- [ ] **Step 1: Tests for the public-binding gate**

```ts
test("poza kontenerem bind na 0.0.0.0 jest zablokowany", async () => {
  const dir = tmpDir(); initData(dir);
  delete process.env.AGENTTALKS_IN_CONTAINER;
  assert.equal(await main(["serve", "--data", dir, "--host", "0.0.0.0"]), 1);
});

test("w kontenerze bind na 0.0.0.0 jest dozwolony", () => {
  process.env.AGENTTALKS_IN_CONTAINER = "1";
  assert.equal(inContainer(), true);
  const dir = tmpDir();
  assert.doesNotThrow(() => assertBindAllowed(loadConfig(dir), "0.0.0.0"));
});

test("healthcheck zwraca 1, gdy serwer nie odpowiada", async () => {
  assert.equal(await main(["healthcheck", "--url", "http://127.0.0.1:1"]), 1);
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: `Dockerfile`**

```dockerfile
FROM node:26-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY bin ./bin
ENV AGENTTALKS_DATA=/data AGENTTALKS_IN_CONTAINER=1
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node bin/agenttalks.js healthcheck
USER node
CMD ["node", "bin/agenttalks.js", "serve", "--host", "0.0.0.0", "--port", "8080"]
```

`.dockerignore`: `node_modules`, `.git`, `data`, `nestor`, `cli`, `docs`, `test`,
`*.sqlite*`.

- [ ] **Step 4: `docker-compose.yml`**

```yaml
services:
  agenttalks:
    build: .
    image: agenttalks:latest
    restart: unless-stopped
    ports: ["127.0.0.1:8787:8080"]
    volumes: ["agenttalks-data:/data"]
    environment:
      AGENTTALKS_TRUST_PROXY: "1"
volumes:
  agenttalks-data:
```

- [ ] **Step 5: Build and check that the container actually responds**

```bash
docker build -t agenttalks:latest .
docker run --rm -d --name at-smoke -p 127.0.0.1:8787:8080 agenttalks:latest
sleep 2
curl -fsS http://127.0.0.1:8787/api/health
docker exec at-smoke node bin/agenttalks.js actor create smoke --kind agent
docker stop at-smoke
```
Expected: `{"ok":true,...}` and a created actor. Image size below 250 MB
(check `docker images agenttalks`), because disk space on the VPS is limited.

- [ ] **Step 6: `docs/docker.md`**

How to build, replace the version, find the data, back up the volume,
put it behind Apache as a reverse proxy, and coexist with `nestor.service`.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml docs/docker.md && \
git commit -m "feat(docker): obraz na node:26-alpine, wolumen danych, healthcheck"
```

---

## Plan self-review

**Specification coverage.** Section 4, data model: tasks 1, 3, 4. Section 5, identity:
tasks 2 and 8. Section 6, delivery levels 1 and 2: task 10 (level 3, wake, is
deliberately in stage 2). Section 7, MCP: stage 2. Section 8, CLI `atalk`: stage 2 (stage 1 provides
only administrative `agenttalks`). Section 9, UI: stage 3. Section 10, architecture:
file structure. Section 11.1, Docker: task 14. Section 11.2, local installation:
tasks 11 and 13. Section 12, errors: tasks 9 and 10. Section 13, tests: all tasks
plus 13.

**Deliberate gaps:** files, pins, and leases have tables in the schema from task 1, but get
code in stages 2 and 3. The importer therefore does not import pins or files; this is
stated explicitly in task 12 and returns in stage 3.

**Naming consistency checked:** `Ctx` is always the first argument; `postMessage`,
`listMessages`, `markRead`, `unreadFor`, `ensureDirect`, `assertCanPost`,
`recipientsOf`, `inboxAfter`, `subscriberCount` used in the tests for tasks 9, 10, and 13
match their definitions in tasks 3, 4, 5, and 10.
