/**
 * Push do klienta: SSE dla polaczen dlugo zyjacych, long-poll dla tych, ktore nie
 * chca trzymac strumienia.
 *
 * Prototyp pollowal `/talk/api/state?since=0` co 2,5 s i za kazdym razem dostawal
 * CALA historie (parametr `since` byl zaimplementowany na serwerze, ale klient zawsze
 * wysylal zero). Tutaj klient dostaje wylacznie to, co przyszlo po jego kursorze,
 * i tylko z konwersacji, ktorych jest czlonkiem.
 */
import type { Event } from "../core/events.ts";
import { inboxAfter } from "../core/messages.ts";
import { requireAuth } from "./auth.ts";
import { json } from "./respond.ts";
import type { Req, Res, RouteCtx } from "./router.ts";

const PING_MS = 20_000;
const MAX_WAIT_SEC = 300;

export function sseHandler(req: Req, res: Res, rc: RouteCtx): void {
  const { actor } = requireAuth(rc);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Nginx buforuje text/event-stream domyslnie i zdarzenia dochodza paczkami
    // albo wcale. To jest naglowek, ktory kaze mu tego nie robic.
    "x-accel-buffering": "no",
  });

  const send = (event: Event, id?: number) => {
    if (id !== undefined) res.write(`id: ${id}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Wznowienie po zerwaniu: klient podaje ostatnie widziane id wiadomosci, a my
  // dosylamy zaleglosci, zanim wpuscimy go na zywy strumien.
  //
  // BRAK parametru i `after=0` to dwie rozne rzeczy: brak znaczy "interesuje mnie
  // tylko to, co dopiero nadejdzie", a zero znaczy "nie widzialem jeszcze niczego,
  // dosylaj od poczatku". Zwiniecie ich w jedno gubi cala historie przy pierwszym
  // polaczeniu klienta, ktory dopiero buduje swoj kursor.
  const cursorRaw = req.headers["last-event-id"] ?? rc.query.get("after") ?? undefined;
  if (cursorRaw !== undefined && cursorRaw !== null && String(cursorRaw) !== "") {
    const lastSeen = Number(cursorRaw) || 0;
    for (const message of inboxAfter(rc.ctx, actor.id, lastSeen)) {
      send({ type: "message", conversationId: message.conversationId, message }, message.id);
    }
  }
  res.write(": polaczono\n\n");

  const unsubscribe = rc.ctx.bus.subscribe(actor.id, (event) => {
    send(event, event.type === "message" ? event.message.id : undefined);
  });

  // Komentarz co 20 s. Bez niego proxy z timeoutem bezczynnosci zrywa polaczenie,
  // a klient nie wie, czy to cisza w kanale, czy awaria.
  const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
  if (typeof ping.unref === "function") ping.unref();

  const cleanup = () => {
    clearInterval(ping);
    unsubscribe();
  };
  res.on("close", cleanup);
  res.on("error", cleanup);
}

/**
 * GET /api/messages?after=<id>&wait=<sek>
 *
 * Zwraca natychmiast, jesli cokolwiek zalega. Inaczej czeka do `wait` sekund na
 * pierwsza nowa wiadomosc. To jest sciezka dla CLI i dla agentow w petli - nie
 * potrzebuja klienta SSE, a i tak nie pollują na pusto.
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

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      res.off("close", finish);
      json(res, 200, { messages: inboxAfter(rc.ctx, actor.id, after) });
      resolve();
    };

    const unsubscribe = rc.ctx.bus.subscribe(actor.id, (event) => {
      if (event.type === "message") finish();
    });
    const timer = setTimeout(finish, wait * 1000);
    // Klient, ktory sie rozlaczyl w trakcie czekania, nie moze zostawic
    // subskrypcji i timera na zawsze.
    res.on("close", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}
