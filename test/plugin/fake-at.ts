/**
 * A scriptable stand-in for the AgentTalks HTTP API, for the failure cases a real test server
 * cannot produce on demand: a 503 from GET /api/conversations, a thread lookup that never
 * answers. It speaks just enough of the API for the plugin's feed: /api/me,
 * /api/conversations, /api/actors, /api/mentions, /api/messages/:id/thread and the SSE
 * stream /api/events with Last-Event-ID replay (ids are message ids, as on the real server).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeMessage = {
  id: number; conversationId: number; actorId: number; body: string; threadId: number | null;
  actorHandle?: string; deletedAt?: number | null;
};

export type Route = { status: number; body?: unknown } | "hang";

export type FakeAt = {
  url: string;
  me: { id: number; handle: string };
  /** GET /api/conversations: the answer (status 200 + conversations/memberships, or an error). */
  conversations: Route;
  /** GET /api/me body override (default: the actor, no conversations, nothing unread). */
  meBody?: unknown;
  /** GET /api/messages/:root/thread by root id; a missing root answers 404. */
  threads: Map<number, Route>;
  /** Every message ever emitted, in order: the replay source. */
  log: FakeMessage[];
  /** GET /api/mentions source (filtered by ?after, the newest `limit`, ascending, like the server). */
  mentions: FakeMessage[];
  /** GET /api/status answer (default 404: a server without it). */
  status: Route;
  /** Sends the message on the open streams and records it for replay. `live: false` records
   *  it only (posted while nobody was connected); `record: false` sends it again without
   *  recording (a duplicate delivery). */
  emit(m: FakeMessage, opts?: { live?: boolean; record?: boolean }): void;
  /** A `notification` event (no id), as the server sends when a mention lands. */
  notify(): void;
  /** Drops every open SSE stream (the client reconnects with Last-Event-ID). */
  cut(): void;
  streams(): number;
  requests: string[];
  /** The answer to POST /api/sessions (default 404, as for any unknown route). */
  sessionsStatus?: number;
  close(): Promise<void>;
};

function sendJson(res: ServerResponse, route: Route) {
  if (route === "hang") return; // never answers
  res.writeHead(route.status, { "content-type": "application/json" });
  res.end(JSON.stringify(route.body ?? {}));
}

function frame(m: FakeMessage) {
  return `id: ${m.id}\nevent: message\ndata: ${JSON.stringify({ type: "message", conversationId: m.conversationId, message: m })}\n\n`;
}

export async function fakeAt(opts: { me?: { id: number; handle: string } } = {}): Promise<FakeAt> {
  const me = opts.me ?? { id: 7, handle: "nestor" };
  const open = new Set<ServerResponse>();
  const hanging = new Set<ServerResponse>();
  const fake: Omit<FakeAt, "url" | "close"> = {
    me,
    conversations: { status: 200, body: { conversations: [], memberships: [] } },
    threads: new Map(),
    log: [],
    mentions: [],
    status: { status: 404, body: { error: "not found" } },
    requests: [],
    emit(m, o = {}) {
      if (o.record !== false) fake.log.push(m);
      if (o.live !== false) for (const res of open) res.write(frame(m));
    },
    notify() {
      for (const res of open) res.write(`event: notification\ndata: ${JSON.stringify({ type: "notification" })}\n\n`);
    },
    cut() { for (const res of [...open]) { res.destroy(); open.delete(res); } },
    streams: () => open.size,
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://x");
    fake.requests.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const last = req.headers["last-event-id"];
      if (last !== undefined && last !== "") {
        for (const m of fake.log) if (m.id > Number(last)) res.write(frame(m));
      }
      res.write(": connected\n\n");
      open.add(res);
      res.on("close", () => open.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/sessions" && fake.sessionsStatus !== undefined) {
      req.resume();
      return sendJson(res, { status: fake.sessionsStatus });
    }
    if (url.pathname === "/api/me") {
      return sendJson(res, { status: 200, body: fake.meBody ?? { actor: me, conversations: [], unread: [] } });
    }
    if (url.pathname === "/api/conversations") {
      if (fake.conversations === "hang") hanging.add(res);
      return sendJson(res, fake.conversations);
    }
    if (url.pathname === "/api/actors") return sendJson(res, { status: 200, body: { actors: [] } });
    if (url.pathname === "/api/mentions") {
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
      const list = fake.mentions.filter((m) => m.id > after).sort((a, b) => a.id - b.id).slice(-limit);
      return sendJson(res, { status: 200, body: { messages: list } });
    }
    if (url.pathname === "/api/status") return sendJson(res, fake.status);
    const thread = /^\/api\/messages\/(\d+)\/thread$/.exec(url.pathname);
    if (thread) {
      const route = fake.threads.get(Number(thread[1])) ?? { status: 404, body: { error: "not found" } };
      if (route === "hang") hanging.add(res);
      return sendJson(res, route);
    }
    sendJson(res, { status: 404, body: { error: "not found" } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => {
      for (const res of [...open, ...hanging]) res.destroy();
      server.closeAllConnections();
      server.close(() => r());
    }),
  }) as FakeAt;
}

/** A conversation list in the shape GET /api/conversations returns. */
export function convs(list: Array<{ id: number; kind: string; slug?: string; notify?: string }>) {
  return {
    status: 200,
    body: {
      conversations: list.map((c) => ({ id: c.id, kind: c.kind, slug: c.slug ?? `c${c.id}`, others: [] })),
      memberships: list.map((c) => ({ conversationId: c.id, notify: c.notify ?? "mentions" })),
    },
  };
}
