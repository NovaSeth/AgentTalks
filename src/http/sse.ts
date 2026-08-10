/**
 * Push to the client: SSE for long-lived connections, long-poll for those that do not want
 * to hold a stream.
 * 
 * The prototype polled `/talk/api/state?since=0` every 2.5 s and got the WHOLE history
 * every time (the `since` parameter was implemented on the server, but the client always
 * sent zero). Here a client receives only what arrived after its cursor, and only from the
 * conversations it is a member of.
 */
import type { Event } from "../core/events.ts";
import { inboxAfter, updatedBefore } from "../core/messages.ts";
import { authenticate, requireAuth } from "./auth.ts";
import { json } from "./respond.ts";
import { tooMany } from "../core/errors.ts";
import type { Req, Res, RouteCtx } from "./router.ts";

const PING_MS = 20_000;
const MAX_WAIT_SEC = 300;
const RESUME_PAGE = 200;
// The replay window for edits/deletions on resumption. An id cursor carries no changes to
// old messages, so after a break we send message_updated for everything that changed within
// this window. Real disconnections are measured in minutes; 24 h is slack for a laptop shut
// for the night.
const RESUME_EDIT_WINDOW_SEC = 24 * 3600;
// A limit on concurrent streams per actor: SSE holds resources on the server side, and a
// client in a reconnect loop can open hundreds of connections in a minute.
const MAX_STREAMS_PER_ACTOR = 8;
// The cut-off threshold for a clogged client: when the write buffer grows beyond this, the
// client is not receiving - writing further only consumes the server's memory. Dropping it
// is safe, because the client resumes from Last-Event-ID.
const MAX_BUFFERED_BYTES = 1024 * 1024;

export function sseHandler(req: Req, res: Res, rc: RouteCtx): void {
  const { actor } = requireAuth(rc);
  // A HEAD on a GET route must not open a stream: the client does not receive the body, so
  // the connection would hang until a timeout, holding a slot from the limit. Monitoring
  // probing with HEAD should get a confirmation and a disconnect.
  if (req.method === "HEAD") {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end();
    return;
  }
  if (rc.ctx.bus.streamCount(actor.id) >= MAX_STREAMS_PER_ACTOR) {
    throw tooMany("za_duzo_strumieni",
      `masz juz ${MAX_STREAMS_PER_ACTOR} otwartych strumieni - zamknij ktorys`);
  }
  const releaseStream = rc.ctx.bus.openStream(actor.id);

  // We register the cleanup IMMEDIATELY after taking a slot, not at the end of the function.
  // The reason is concrete: the backlog replay below has two exits through `return` (when the
  // socket dies mid-way), and each of them skipped registering `cleanup` - the slot stayed
  // taken until the process restarted, and after eight such breaks the actor got a 429 on
  // its own stream with no way to recover it.
  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let posprzatane = false;
  const cleanup = () => {
    if (posprzatane) return;
    posprzatane = true;
    if (ping) clearInterval(ping);
    if (unsubscribe) unsubscribe();
    releaseStream();
  };
  res.on("close", cleanup);
  res.on("error", cleanup);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Nginx buffers text/event-stream by default and events arrive in batches, or not at all.
    // This is the header that tells it not to.
    "x-accel-buffering": "no",
  });

  const send = (event: Event, id?: number) => {
    if (res.writableEnded || res.destroyed) return;
    if (id !== undefined) res.write(`id: ${id}\n`);
    res.write(`event: ${event.type}\n`);
    const ok = res.write(`data: ${JSON.stringify(event)}\n\n`);
    // Backpressure: the client is not keeping up. Past the threshold we drop it - that is not a
    // punishment but a move onto the resumption path, which exists anyway.
    if (!ok && res.writableLength > MAX_BUFFERED_BYTES) res.destroy();
  };

  /**
   * Attaches `actorHandle` to events carrying a message.
   * 
   * On the stream an agent gets NO `actors` map at all - it would have to fetch the roster
   * separately and keep it current. That is the same trap as in REST (#bugs [386]), only
   * more painful, because there the map is at least in the response.
   */
  const zAutorem = (event: Event): Event => {
    if (event.type !== "message" && event.type !== "message_updated") return event;
    const a = rc.ctx.db.prepare("SELECT handle FROM actors WHERE id = ?")
      .get(event.message.actorId) as { handle: string } | undefined;
    return { ...event, message: { ...event.message, actorHandle: a?.handle ?? "?" } };
  };

  // Resumption after a break: the client supplies the last message id it saw, and we send the
  // backlog before letting it onto the live stream.
  // 
  // NO parameter and `after=0` are two different things: absent means "I only care about what
  // is yet to arrive", zero means "I have not seen anything, send from the beginning".
  // Collapsing them into one loses the whole history on the first connection of a client that
  // is only now building its cursor.
  const cursorRaw = req.headers["last-event-id"] ?? rc.query.get("after") ?? undefined;
  if (cursorRaw !== undefined && cursorRaw !== null && String(cursorRaw) !== "") {
    const lastSeen = Number(cursorRaw) || 0;
    // In pages until exhausted: a single page with a limit silently lost everything above 200
    // backlogged messages. Our own messages DO enter the replay (includeOwn) - the live stream
    // delivers them, so a resumption has to see the same, otherwise a second device of the same
    // actor loses its own entries from the period of the break.
    let cursor = lastSeen;
    for (;;) {
      // Backpressure may have dropped the connection mid-replay - there is no sense in
      // synchronously reading the whole backlog for a dead socket (node:sqlite is single-threaded,
      // so it would block the event loop for everybody else).
      if (res.destroyed || res.writableEnded) { cleanup(); return; }
      const batch = inboxAfter(rc.ctx, actor.id, cursor, RESUME_PAGE, { includeOwn: true });
      for (const message of batch) {
        send(zAutorem({ type: "message", conversationId: message.conversationId, message }),
             message.id);
      }
      if (batch.length < RESUME_PAGE) break;
      cursor = batch[batch.length - 1].id;
    }
    // Edits and deletions from before the cursor: an id cursor does not cover them. Paginated
    // just like inboxAfter - a single page lost changes above the limit.
    let editCursor = 0;
    const since = rc.ctx.now() - RESUME_EDIT_WINDOW_SEC;
    for (;;) {
      if (res.destroyed || res.writableEnded) { cleanup(); return; }
      const changed = updatedBefore(rc.ctx, actor.id, lastSeen, since, editCursor);
      for (const message of changed) {
        send({ type: "message_updated", conversationId: message.conversationId, message });
      }
      if (changed.length < RESUME_PAGE) break;
      editCursor = changed[changed.length - 1].id;
    }
  }
  res.write(": polaczono\n\n");

  unsubscribe = rc.ctx.bus.subscribe(actor.id, (event) => {
    send(zAutorem(event), event.type === "message" ? event.message.id : undefined);
  });

  // A comment every 20 s. Without it a proxy with an idle timeout drops the connection, and
  // the client cannot tell silence on the channel from a failure.
  //
  // The same beat RE-CHECKS THE IDENTITY. Without it, authentication happened exactly once -
  // when the connection was established - so revoking a token or disabling an account had no
  // way of reaching a stream that was already standing: further HTTP requests got a 401 while
  // the open stream kept delivering every new message from every conversation, until the
  // server restarted. Revoking a token is the ONLY response to a leak this product offers -
  // it has to close what is already flowing as well.
  ping = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    if (!authenticate(rc.ctx, rc.config, req)) {
      // No body and no event: the client is meant to see the break and try to resume, and the
      // resumption goes through full authentication and gets a 401.
      cleanup();
      res.destroy();
      return;
    }
    res.write(": ping\n\n");
  }, PING_MS);
  if (typeof ping.unref === "function") ping.unref();
}

/**
 * GET /api/messages?after=<id>&wait=<sec>
 *
 * Returns immediately if anything is backlogged. Otherwise it waits up to `wait` seconds
 * for the first new message. This is the path for the CLI and for agents in a loop - they
 * need no SSE client and still do not poll for nothing.
 */
export function longPollHandler(_req: Req, res: Res, rc: RouteCtx): Promise<void> {
  const { actor } = requireAuth(rc);
  const after = Number(rc.query.get("after") ?? 0) || 0;
  const wait = Math.min(Math.max(Number(rc.query.get("wait") ?? 0) || 0, 0), MAX_WAIT_SEC);

  const pending = inboxAfter(rc.ctx, actor.id, after);
  if (pending.length > 0 || wait === 0) {
    json(res, 200, { messages: pending });
    return Promise.resolve();
  }

  // A long-poll holds the same things on the server side as SSE (subscriptions, a timer, a
  // socket), only for less time - so the same limit applies to it. Without that, a client in
  // a loop bypassed the stream limit by switching to long-poll.
  if (rc.ctx.bus.streamCount(actor.id) >= MAX_STREAMS_PER_ACTOR) {
    throw tooMany("za_duzo_strumieni",
      `masz juz ${MAX_STREAMS_PER_ACTOR} otwartych oczekiwan - poczekaj na ich koniec`);
  }
  const releaseStream = rc.ctx.bus.openStream(actor.id);

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      releaseStream();
      res.off("close", onClose);
      json(res, 200, { messages: inboxAfter(rc.ctx, actor.id, after) });
      resolve();
    };
    const onClose = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      releaseStream();
      resolve();
    };

    const unsubscribe = rc.ctx.bus.subscribe(actor.id, (event) => {
      // Other people's messages only: inboxAfter skips our own, so waking on our own ended the
      // long-poll with an empty list and the client polled again.
      if (event.type === "message" && event.message.actorId !== actor.id) finish();
    });
    const timer = setTimeout(finish, wait * 1000);
    if (typeof timer.unref === "function") timer.unref();
    // A client that disconnected while waiting must not leave a subscription and a timer behind
    // forever.
    res.on("close", onClose);
  });
}
