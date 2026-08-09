/**
 * Szyna zdarzen w procesie. Subskrypcje sa per AKTOR, nie per polaczenie, bo ten sam
 * czlowiek ma otwarta karte na laptopie i na telefonie, a ten sam agent ma kilka sesji.
 *
 * Filtrowanie odbiorcow robi wolajacy (`publish(recipients, event)`), a nie subskrybent.
 * To swiadome: gdyby kazdy subskrybent sam sprawdzal, czy zdarzenie go dotyczy, to
 * kontrola dostepu bylaby rozsypana po klientach zamiast stac w jednym miejscu obok
 * regul widocznosci konwersacji.
 */
import type { Message } from "./messages.ts";

export type Event =
  | { type: "message"; conversationId: number; message: Message }
  | { type: "message_updated"; conversationId: number; message: Message }
  | { type: "reaction"; conversationId: number; messageId: number }
  | { type: "read"; conversationId: number; actorId: number; messageId: number }
  | { type: "presence" }
  | { type: "wiki"; slug: string }
  | { type: "conversation"; conversationId: number }
  // Powiadomienie do JEDNEJ osoby - centrum powiadomien odswieza sie po nim.
  // Brakowalo go w unii, mimo ze rdzen je publikowal: typ klamal, a kazdy
  // wyczerpujacy switch po rodzajach zdarzen cicho je pomijal (zlapane przez
  // tsc dopiero po wlaczeniu typow Node w tsconfig).
  | { type: "notification" };

type Listener = (e: Event) => void;

/** Tap widzi KAZDA publikacje razem z lista odbiorcow - w odroznieniu od
 *  subskrybenta, ktory widzi tylko zdarzenia adresowane do jego aktora.
 *  Uzywa go wake: musi wiedziec, do kogo zdarzenie MIALO dojsc, zeby obudzic
 *  tych, ktorzy nie sluchaja. */
export type Tap = (recipients: readonly number[], event: Event) => void;

export class EventBus {
  #byActor = new Map<number, Set<Listener>>();
  #taps = new Set<Tap>();
  // Osobny licznik ZASOBOCHLONNYCH strumieni (SSE): subscriberCount liczy tez
  // long-poll i MCP talk_read, ktore trzymaja subskrypcje tylko na chwile, wiec
  // limit strumieni oparty na nim raz odcinalby SSE przez wiszace long-polle,
  // a raz w ogole nie widzialby dlugotrwalych polaczen.
  #streams = new Map<number, number>();

  subscribe(actorId: number, fn: Listener): () => void {
    let set = this.#byActor.get(actorId);
    if (!set) {
      set = new Set();
      this.#byActor.set(actorId, set);
    }
    set.add(fn);
    return () => {
      const s = this.#byActor.get(actorId);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.#byActor.delete(actorId);
    };
  }

  tap(fn: Tap): () => void {
    this.#taps.add(fn);
    return () => this.#taps.delete(fn);
  }

  publish(recipients: readonly number[], event: Event): void {
    for (const fn of [...this.#taps]) {
      try {
        fn(recipients, event);
      } catch (err) {
        console.error("[bus] tap rzucil wyjatek:", err);
      }
    }
    for (const actorId of new Set(recipients)) {
      const set = this.#byActor.get(actorId);
      if (!set) continue;
      // Kopia, bo subskrybent moze sie odsubskrybowac we wlasnym handlerze
      // (SSE robi dokladnie to przy zerwanym polaczeniu).
      for (const fn of [...set]) {
        try {
          fn(event);
        } catch (err) {
          // Padniety klient nie moze zabic dostarczania pozostalym ani transakcji,
          // ktora wlasnie sie zakonczyla.
          console.error("[bus] subskrybent rzucil wyjatek:", err);
        }
      }
    }
  }

  subscriberCount(actorId: number): number {
    return this.#byActor.get(actorId)?.size ?? 0;
  }

  /** Rejestruje dlugotrwaly strumien (SSE) na potrzeby limitu. Zwraca funkcje
   *  zwalniajaca; count NIE obejmuje krotkotrwalych subskrypcji long-polla. */
  openStream(actorId: number): () => void {
    this.#streams.set(actorId, (this.#streams.get(actorId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.#streams.get(actorId) ?? 1) - 1;
      if (n <= 0) this.#streams.delete(actorId);
      else this.#streams.set(actorId, n);
    };
  }

  streamCount(actorId: number): number {
    return this.#streams.get(actorId) ?? 0;
  }
}
