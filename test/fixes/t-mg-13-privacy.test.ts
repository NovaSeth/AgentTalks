/**
 * T-MG-13: gate T-MG-1 round 5. B-MG-99 (a removed uploader keeps file access) and
 * B-MG-100 (a non-member admin's PATCH response leaks the topic).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { startTestServer, bearer } from "../http-helpers.ts";
import { createActor } from "../../src/core/actors.ts";
import { mintToken } from "../../src/core/tokens.ts";
import { createChannel, join, removeMember } from "../../src/core/conversations.ts";
import { storeFile, storeWikiFile } from "../../src/core/files.ts";
import { pageId, savePage } from "../../src/core/wiki.ts";

async function scene() {
  const server = await startTestServer({ filesDir: mkdtempSync(joinPath(tmpdir(), "t-mg-13-")) });
  const { ctx } = server;
  const owner = createActor(ctx, { kind: "human", handle: "owner" });
  const uploader = createActor(ctx, { kind: "human", handle: "uploader" });
  const admin = createActor(ctx, { kind: "human", handle: "boss", isAdmin: true });
  const priv = createChannel(ctx, { slug: "secret", kind: "private", createdBy: owner.id });
  join(ctx, priv.id, uploader.id);
  const tok = (id: number) => mintToken(ctx, id, "t").token;
  return { server, ctx, owner, uploader, admin, priv, tok };
}

test("B-MG-99: a removed uploader gets 404 on download and info, a member gets 200", async () => {
  const s = await scene();
  try {
    const { file } = storeFile(s.ctx, s.server.config.filesDir, {
      actorId: s.uploader.id, conversationId: s.priv.id, name: "plan.txt",
      data: Buffer.from("secret plan"), maxBytes: 1024,
    });
    const tUp = s.tok(s.uploader.id), tOwner = s.tok(s.owner.id);
    for (const path of [`/api/files/${file.id}`, `/api/files/${file.id}/info`]) {
      assert.equal((await fetch(s.server.url + path, { headers: bearer(tUp) })).status, 200, `member ${path}`);
    }
    removeMember(s.ctx, { convId: s.priv.id, actorId: s.owner.id, targetActorId: s.uploader.id, isInstanceAdmin: false });
    assert.equal((await fetch(`${s.server.url}/api/conversations/${s.priv.id}`, { headers: bearer(tUp) })).status, 403);
    for (const path of [`/api/files/${file.id}`, `/api/files/${file.id}/info`]) {
      const res = await fetch(s.server.url + path, { headers: bearer(tUp) });
      assert.ok(res.status === 404 || res.status === 403, `removed uploader ${path}: ${res.status}`);
      assert.equal((await fetch(s.server.url + path, { headers: bearer(tOwner) })).status, 200, `owner ${path}`);
    }
  } finally { await s.server.close(); }
});

test("B-MG-99: the owner of a conversation-less, wiki-less file still reads it; wiki files stay public", async () => {
  const s = await scene();
  try {
    const page = savePage(s.ctx, { slug: "docs", title: "Docs", body: "x", actorId: s.owner.id });
    const wiki = storeWikiFile(s.ctx, s.server.config.filesDir, {
      actorId: s.uploader.id, wikiPageId: pageId(s.ctx, page.slug)!, name: "w.txt", data: Buffer.from("w"), maxBytes: 1024,
    });
    const tUp = s.tok(s.uploader.id), tOwner = s.tok(s.owner.id);
    assert.equal((await fetch(`${s.server.url}/api/files/${wiki.id}/info`, { headers: bearer(tOwner) })).status, 200);
    const { file } = storeFile(s.ctx, s.server.config.filesDir, {
      actorId: s.uploader.id, conversationId: s.priv.id, name: "n.txt", data: Buffer.from("n"), maxBytes: 1024,
    });
    s.ctx.db.prepare("UPDATE files SET conversation_id = NULL, message_id = NULL WHERE id = ?").run(file.id);
    assert.equal((await fetch(`${s.server.url}/api/files/${file.id}/info`, { headers: bearer(tUp) })).status, 200);
    assert.equal((await fetch(`${s.server.url}/api/files/${file.id}/info`, { headers: bearer(tOwner) })).status, 404);
  } finally { await s.server.close(); }
});

test("B-MG-100: a non-member admin PATCH response carries no topic, a channel admin gets the conversation", async () => {
  const s = await scene();
  try {
    s.ctx.db.prepare("UPDATE conversations SET topic = 'launch codes' WHERE id = ?").run(s.priv.id);
    const patch = (token: string) => fetch(`${s.server.url}/api/conversations/${s.priv.id}`, {
      method: "PATCH", headers: bearer(token), body: "{}",
    });
    const tAdmin = s.tok(s.admin.id);
    assert.equal((await fetch(`${s.server.url}/api/conversations/${s.priv.id}`, { headers: bearer(tAdmin) })).status, 403);
    const res = await patch(tAdmin);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes("launch codes"), text);
    assert.deepEqual(JSON.parse(text), { ok: true, id: s.priv.id });

    const own = await patch(s.tok(s.owner.id));
    assert.equal(own.status, 200);
    const body = await own.json() as any;
    assert.equal(body.conversation.topic, "launch codes");
  } finally { await s.server.close(); }
});
