import { test } from "node:test";
import assert from "node:assert/strict";
import { mkActor, testCtx } from "../helpers.ts";
import {
  endSession,
  heartbeat,
  presence,
  registerSession,
  setDoing,
  signal,
} from "../../src/core/presence.ts";

test("typing gasnie po 7 s, busy trzyma 30 s", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  signal(ctx, "s1", "typing");
  signal(ctx, "s1", "busy");
  assert.equal(presence(ctx)[0].typing, true);
  assert.equal(presence(ctx)[0].busy, true);
  t += 8;
  assert.equal(presence(ctx)[0].typing, false);
  assert.equal(presence(ctx)[0].busy, true);
  t += 30;
  assert.equal(presence(ctx)[0].busy, false);
});

test("efemeryda znika z obecnosci szybciej niz sesja trwala", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "efem", actorId: a.id, kind: "ephemeral" });
  registerSession(ctx, { sessionId: "trwala", actorId: a.id, kind: "durable" });
  t += 120;
  const byId = Object.fromEntries(presence(ctx).map((p) => [p.sessionId, p]));
  assert.equal(byId["efem"], undefined);
  assert.equal(byId["trwala"].stale, false);
});

test("zakonczona sesja znika z obecnosci, tozsamosc zostaje w rosterze", () => {
  // Feedback z #nextIteration: lista uczestnikow prototypu rosla monotonicznie,
  // bo zakonczone sesje nigdy nie znikaly. Obecnosc pokazuje, z kim mozna
  // rozmawiac TERAZ; kto ISTNIEJE, mowi roster aktorow.
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "efem", actorId: a.id, kind: "ephemeral" });
  registerSession(ctx, { sessionId: "trwala", actorId: a.id, kind: "durable" });
  endSession(ctx, "efem");
  endSession(ctx, "trwala");
  assert.deepEqual(presence(ctx), []);
});

test("sesja trwala bez heartbeatu znika po oknie retencji, wczesniej jest stale", () => {
  let t = 1_000_000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, kind: "durable" });
  t += 6 * 24 * 3600;
  assert.equal(presence(ctx).length, 1);
  assert.equal(presence(ctx)[0].stale, true);
  t += 2 * 24 * 3600;
  assert.deepEqual(presence(ctx), []);
});

test("rodzaj sesji jest deklarowany, nie zgadywany z ksztaltu nazwy", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  // Prototyp zgadywal po prefiksie "bs/" i uznawal to za efemeryde.
  registerSession(ctx, { sessionId: "x", actorId: a.id, label: "bs/uzytkownik" });
  assert.equal(presence(ctx)[0].kind, "durable");
});

test("dwie sesje tego samego aktora to jeden rozmowca, bez sufiksow", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "vps" });
  registerSession(ctx, { sessionId: "s2", actorId: a.id, label: "laptop" });
  const rows = presence(ctx);
  assert.equal(rows.length, 2);
  assert.deepEqual([...new Set(rows.map((r) => r.handle))], ["nestor"]);
});

test("ponowna rejestracja tej samej sesji aktualizuje, a nie dubluje", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "stara" });
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "nowa" });
  assert.equal(presence(ctx).length, 1);
  assert.equal(presence(ctx)[0].label, "nowa");
});

test("heartbeat odswieza, sesja przestaje byc stale", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  t += 700;
  assert.equal(presence(ctx)[0].stale, true);
  heartbeat(ctx, "s1");
  assert.equal(presence(ctx)[0].stale, false);
});

test("doing widac w obecnosci", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  setDoing(ctx, "s1", "deploy motowolt");
  assert.equal(presence(ctx)[0].doing, "deploy motowolt");
});

test("rejestracja sesji nieistniejacego aktora jest odrzucona", () => {
  const ctx = testCtx();
  assert.throws(() => registerSession(ctx, { sessionId: "s1", actorId: 999 }), /nie ma aktora/);
});

test("heartbeat i sygnaly NIE kasuja etykiety ustawionej przez me", () => {
  const ctx = testCtx();
  const a = mkActor(ctx, "nestor");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, label: "vps-deploy", kind: "durable" });
  // atalk ping/busy woła registerSession z samym sessionId
  registerSession(ctx, { sessionId: "s1", actorId: a.id });
  signal(ctx, "s1", "busy");
  const p = presence(ctx)[0];
  assert.equal(p.label, "vps-deploy", "heartbeat zjadl etykiete");
  assert.equal(p.kind, "durable");
});

/**
 * Rozgloszenie obecnosci TYLKO przy realnej zmianie.
 *
 * Interfejs bije heartbeat co 30 s tym samym `registerSession`. Gdyby kazde
 * takie wywolanie publikowalo zdarzenie, przy N otwartych sesjach kazda co 30 s
 * budzilaby wszystkie pozostale - ruch rosnie z KWADRATEM liczby uczestnikow,
 * a tresc zdarzenia jest za kazdym razem ta sama. Tlumienie jest niewidoczne
 * w dzialaniu (nic sie nie psuje, tylko robi drogo), wiec bez testu wroci
 * przy pierwszej refaktoryzacji.
 */
test("presence rozglasza sie przy zmianie, a nie przy kazdym heartbeacie", () => {
  const ctx = testCtx();
  const ala = mkActor(ctx, "ala");
  let rozgloszenia = 0;
  const oryginal = ctx.bus.publish.bind(ctx.bus);
  ctx.bus.publish = (odbiorcy, ev) => {
    if (ev.type === "presence") rozgloszenia++;
    return oryginal(odbiorcy, ev);
  };

  registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "praca", kind: "durable" });
  assert.equal(rozgloszenia, 1, "nowa sesja MA obudzic innych");

  // Trzy heartbeaty tym samym wywolaniem, nic sie nie zmienia.
  for (let i = 0; i < 3; i++) {
    registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "praca", kind: "durable" });
  }
  assert.equal(rozgloszenia, 1, "heartbeat bez zmiany nie ma budzic nikogo");

  // Zmiana etykiety JEST widoczna dla innych, wiec ma sie rozniesc.
  registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "deploy", kind: "durable" });
  assert.equal(rozgloszenia, 2, "zmiana etykiety ma sie rozniesc");

  // Powrot po zakonczeniu sesji tez jest zmiana stanu.
  endSession(ctx, "s1");
  const poZakonczeniu = rozgloszenia;
  registerSession(ctx, { sessionId: "s1", actorId: ala.id, label: "deploy", kind: "durable" });
  assert.equal(rozgloszenia, poZakonczeniu + 1, "powrot sesji ma sie rozniesc");
});

/**
 * Sygnal "pisze" z wlasnym czasem zycia.
 *
 * Siedem sekund jest dobre dla CZLOWIEKA - kazdy klawisz odswieza sygnal.
 * Dla agenta jest bezuzyteczne: agent sklada odpowiedz jednym ruchem trwajacym
 * kilkadziesiat sekund i nie ma czego odswiezac po drodze, wiec bak gasl, zanim
 * ktokolwiek zdazyl go zobaczyc. Zmierzone na produkcji przed ta zmiana: sygnal
 * ustawilo KIEDYKOLWIEK 8 z 26 sesji, w wiekszosci moje wlasne proby.
 */
test("sygnal 'pisze' moze niesc wlasny czas zycia, domyslnie 7 s", () => {
  let t = 1000;
  const ctx = testCtx(() => t);
  const a = mkActor(ctx, "ala");
  registerSession(ctx, { sessionId: "s1", actorId: a.id, kind: "durable" });
  const pisze = () => presence(ctx).find((p) => p.sessionId === "s1")?.typing ?? false;

  // Domyslnie: 7 s, jak dotad.
  signal(ctx, "s1", "typing", { typingIn: "c:1" });
  assert.equal(pisze(), true);
  t += 8;
  assert.equal(pisze(), false, "domyslny czas zycia nie moze sie wydluzyc");

  // Wlasny: agent deklaruje, ile realnie zajmie mu zlozenie odpowiedzi.
  t += 1;
  signal(ctx, "s1", "typing", { typingIn: "c:1", sec: 90 });
  t += 60;
  assert.equal(pisze(), true, "sygnal zgasl w polowie zadeklarowanego okna");
  t += 31;
  assert.equal(pisze(), false, "sygnal nie moze zyc dluzej, niz zadeklarowano");

  // Gorna granica: deklaracja nie moze zamienic baka w stale swiatlo.
  t += 1;
  signal(ctx, "s1", "typing", { typingIn: "c:1", sec: 99_999 });
  t += 301;
  assert.equal(pisze(), false, "brak gornego ograniczenia - bak wisialby godzinami");

  // stop gasi natychmiast, takze dlugi sygnal.
  t += 1;
  signal(ctx, "s1", "typing", { typingIn: "c:1", sec: 300 });
  assert.equal(pisze(), true);
  signal(ctx, "s1", "typing", { stop: true });
  assert.equal(pisze(), false, "stop musi gasic takze sygnal z dlugim oknem");
});
