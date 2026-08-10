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
import { inboxAfter, updatedBefore } from "../core/messages.ts";
import { authenticate, requireAuth } from "./auth.ts";
import { json } from "./respond.ts";
import { tooMany } from "../core/errors.ts";
import type { Req, Res, RouteCtx } from "./router.ts";

const PING_MS = 20_000;
const MAX_WAIT_SEC = 300;
const RESUME_PAGE = 200;
// Okno odtwarzania edycji/kasowan przy wznowieniu. Kursor id nie niesie zmian
// starych wiadomosci, wiec po zerwaniu dosylamy message_updated dla wszystkiego,
// co zmienilo sie w tym oknie. Realne zerwania mierzy sie w minutach; 24 h to
// zapas na laptop zamkniety na noc.
const RESUME_EDIT_WINDOW_SEC = 24 * 3600;
// Limit rownoleglych strumieni per aktor: SSE trzyma zasoby po stronie serwera,
// a klient w petli reconnect potrafi otworzyc setki polaczen w minute.
const MAX_STREAMS_PER_ACTOR = 8;
// Prog odciecia zapchanego klienta: gdy bufor zapisu urosnie ponad to, klient
// nie odbiera - dalsze pisanie tylko konsumuje pamiec serwera. Zerwanie jest
// bezpieczne, bo klient wznowi sie od Last-Event-ID.
const MAX_BUFFERED_BYTES = 1024 * 1024;

export function sseHandler(req: Req, res: Res, rc: RouteCtx): void {
  const { actor } = requireAuth(rc);
  // HEAD na trasie GET nie moze otwierac strumienia: klient nie odbiera ciala,
  // wiec polaczenie wisialoby do timeoutu, trzymajac slot z limitu. Monitoring
  // sondujacy HEAD-em ma dostac potwierdzenie i rozlaczenie.
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

  // Sprzatanie rejestrujemy OD RAZU po zajeciu slotu, a nie na koncu funkcji.
  // Powod jest konkretny: dosylka zaleglosci nizej ma dwa wyjscia przez `return`
  // (gdy gniazdo padnie w trakcie), a kazde z nich omijalo rejestracje `cleanup`
  // - slot zostawal zajety do restartu procesu i po osmiu takich zerwaniach
  // aktor dostawal 429 na wlasny strumien, bez zadnego sposobu odzyskania go.
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
    // Nginx buforuje text/event-stream domyslnie i zdarzenia dochodza paczkami
    // albo wcale. To jest naglowek, ktory kaze mu tego nie robic.
    "x-accel-buffering": "no",
  });

  const send = (event: Event, id?: number) => {
    if (res.writableEnded || res.destroyed) return;
    if (id !== undefined) res.write(`id: ${id}\n`);
    res.write(`event: ${event.type}\n`);
    const ok = res.write(`data: ${JSON.stringify(event)}\n\n`);
    // Backpressure: klient nie nadaza. Po przekroczeniu progu zrywamy - to nie
    // kara, tylko przejscie na sciezke wznowienia, ktora i tak istnieje.
    if (!ok && res.writableLength > MAX_BUFFERED_BYTES) res.destroy();
  };

  /**
   * Dokleja `actorHandle` do zdarzen niosacych wiadomosc.
   *
   * Na strumieniu agent NIE dostaje mapy `actors` w ogole - musialby osobno
   * pobrac roster i utrzymywac go aktualnym. To ta sama pulapka co w REST
   * (#bugs [386]), tylko dotkliwsza, bo tam mapa przynajmniej jest w odpowiedzi.
   */
  const zAutorem = (event: Event): Event => {
    if (event.type !== "message" && event.type !== "message_updated") return event;
    const a = rc.ctx.db.prepare("SELECT handle FROM actors WHERE id = ?")
      .get(event.message.actorId) as { handle: string } | undefined;
    return { ...event, message: { ...event.message, actorHandle: a?.handle ?? "?" } };
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
    // Stronami az do wyczerpania: pojedyncza strona z limitem gubila bez sladu
    // wszystko powyzej 200 zaleglych wiadomosci. Wlasne wiadomosci WCHODZA do
    // dosylki (includeOwn) - zywy strumien je dostarcza, wiec wznowienie musi
    // widziec to samo, inaczej drugie urzadzenie tego samego aktora traci
    // wlasne wpisy z okresu zerwania.
    let cursor = lastSeen;
    for (;;) {
      // Backpressure moglo zerwac polaczenie w trakcie dosylki - nie ma sensu
      // synchronicznie doczytywac calego backlogu dla martwego gniazda (node:sqlite
      // jest jednowatkowe, wiec blokowaloby to event loop wszystkim pozostalym).
      if (res.destroyed || res.writableEnded) { cleanup(); return; }
      const batch = inboxAfter(rc.ctx, actor.id, cursor, RESUME_PAGE, { includeOwn: true });
      for (const message of batch) {
        send(zAutorem({ type: "message", conversationId: message.conversationId, message }),
             message.id);
      }
      if (batch.length < RESUME_PAGE) break;
      cursor = batch[batch.length - 1].id;
    }
    // Edycje i kasowania sprzed kursora: kursor id ich nie obejmuje. Stronicowane
    // tak samo jak inboxAfter - pojedyncza strona gubila zmiany powyzej limitu.
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

  // Komentarz co 20 s. Bez niego proxy z timeoutem bezczynnosci zrywa polaczenie,
  // a klient nie wie, czy to cisza w kanale, czy awaria.
  //
  // Ten sam takt SPRAWDZA PONOWNIE TOZSAMOSC. Bez tego uwierzytelnienie dzialo
  // sie dokladnie raz - przy nawiazaniu polaczenia - wiec odwolanie tokenu albo
  // wylaczenie konta nie mialo jak dosiegnac strumienia, ktory juz stoi: kolejne
  // zadania HTTP dostawaly 401, a otwarty strumien dalej dostarczal kazda nowa
  // wiadomosc ze wszystkich rozmow, az do restartu serwera. Odwolanie tokenu
  // jest JEDYNA reakcja na wyciek, jaka ten produkt oferuje - musi domykac tez
  // to, co juz plynie.
  ping = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    if (!authenticate(rc.ctx, rc.config, req)) {
      // Bez ciala i bez zdarzenia: klient ma zobaczyc zerwanie i probowac
      // wznowic, a wznowienie przejdzie przez pelne uwierzytelnienie i dostanie 401.
      cleanup();
      res.destroy();
      return;
    }
    res.write(": ping\n\n");
  }, PING_MS);
  if (typeof ping.unref === "function") ping.unref();
}

/**
 * GET /api/messages?after=<id>&wait=<sek>
 *
 * Zwraca natychmiast, jesli cokolwiek zalega. Inaczej czeka do `wait` sekund na
 * pierwsza nowa wiadomosc. To jest sciezka dla CLI i dla agentow w petli - nie
 * potrzebuja klienta SSE, a i tak nie polluja na pusto.
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

  // Long-poll trzyma po stronie serwera to samo, co SSE (subskrypcje, timer,
  // gniazdo), tylko krocej - wiec obowiazuje go ten sam limit. Bez niego klient
  // w petli omijal limit strumieni, przechodzac na long-poll.
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
      // Tylko cudze wiadomosci: inboxAfter pomija wlasne, wiec obudzenie na
      // wlasnej konczylo long-poll pusta lista i klient odpytywal od nowa.
      if (event.type === "message" && event.message.actorId !== actor.id) finish();
    });
    const timer = setTimeout(finish, wait * 1000);
    if (typeof timer.unref === "function") timer.unref();
    // Klient, ktory sie rozlaczyl w trakcie czekania, nie moze zostawic
    // subskrypcji i timera na zawsze.
    res.on("close", onClose);
  });
}
