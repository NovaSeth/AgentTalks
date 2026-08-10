/**
 * An in-process event bus. Subscriptions are per ACTOR, not per connection, because the
 * same human has a tab open on a laptop and on a phone, and the same agent has several sessions.
 *
 * Recipient filtering is done by the caller (`publish(recipients, event)`), not by the
 * subscriber. That is deliberate: if every subscriber checked for itself whether an event
 * concerns it, access control would be scattered across the clients instead of standing in
 * one place next to the conversation visibility rules.
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
  // A notification to ONE person - the notification centre refreshes on it.
  // It was missing from the union even though the core published it: the type lied, and every
  // exhaustive switch over event kinds silently skipped it (caught by tsc only after Node
  // types were enabled in tsconfig).
  | { type: "notification" };

type Listener = (e: Event) => void;

/** A tap sees EVERY publication together with its recipient list - unlike a subscriber,
 *  which sees only the events addressed to its actor. wake uses it: it has to know whom an
 *  event WAS MEANT to reach, in order to wake those who are not listening. */
export type Tap = (recipients: readonly number[], event: Event) => void;

export class EventBus {
  #byActor = new Map<number, Set<Listener>>();
  #taps = new Set<Tap>();
  // A separate counter for EXPENSIVE streams (SSE): subscriberCount also counts long-polls
  // and MCP talk_read, which hold a subscription only briefly, so a stream limit based on it
  // would sometimes cut off SSE because of hanging long-polls and sometimes not see
  // long-lived connections at all.
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
      // A copy, because a subscriber may unsubscribe inside its own handler (SSE does exactly
      // that on a dropped connection).
      for (const fn of [...set]) {
        try {
          fn(event);
        } catch (err) {
          // A client that threw must not kill delivery to the others, nor the transaction that has
          // just finished.
          console.error("[bus] subskrybent rzucil wyjatek:", err);
        }
      }
    }
  }

  subscriberCount(actorId: number): number {
    return this.#byActor.get(actorId)?.size ?? 0;
  }

  /** Registers a long-lived stream (SSE) for the purposes of the limit. Returns a releasing
   *  function; count does NOT include the short-lived subscriptions of a long-poll. */
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
