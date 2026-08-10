/**
 * Tools for HTTP tests: a live server on a random port and a minimal SSE client.
 *
 *The tests go through a REAL socket, not through calling a handler with stubs. A lesson from
 *the prototype: checking with `curl` a layer that did not break, and calling that interface
 *testing, let five classes of bug through. An HTTP contract is to be checked as an HTTP
 *contract.
 */
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { openDb } from "../src/store/db.ts";
import { createCtx, type Ctx } from "../src/core/ctx.ts";
import { EventBus } from "../src/core/events.ts";
import { createServer } from "../src/http/server.ts";
import { COOKIE_NAME, csrfFor } from "../src/http/auth.ts";
import type { Config } from "../src/config.ts";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    dataDir: "/tmp/agenttalks-test",
    dbPath: ":memory:",
    filesDir: "/tmp/agenttalks-test/files",
    host: "127.0.0.1",
    port: 0,
    // A secret UNIQUE per test server: the limiters are keyed by the instance secret, so a shared
    // secret would mean shared counters between tests - and a test that deliberately exhausts the
    // limit would block the next one.
    secret: `sekret-testowy-${randomBytes(8).toString("hex")}`,
    trustProxy: false,
    allowPublicBind: false,
    allowLoopbackWake: false,
    maxMessageBytes: 65536,
    maxFileBytes: 1024 * 1024,
    sessionTtlSec: 3600,
    // Optional fields in Config are STRINGS (empty = off), so the defaults have to be explicitly
    // empty - otherwise `...overrides` of type Partial<Config> injects `undefined` where the type
    // promises a string.
    sitePassword: "",
    baseUrl: "",
    ...overrides,
  };
}

export type TestServer = {
  url: string;
  ctx: Ctx;
  config: Config;
  close: () => Promise<void>;
};

/** A test server with the option to override the configuration. Without that parameter the
 *  anti-bot gate was UNTESTABLE (it only turns on when a password is set), so access control
 *  for the whole interface had not a single test. */
export async function startTestServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const ctx = createCtx(openDb(":memory:"), new EventBus());
  const config = testConfig(overrides);
  const server = createServer(ctx, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // unref: a listening socket does NOT keep the event loop alive.
  //
  //Without it a test that fails before its `close()` (that is, EVERY failing test with an
  //assertion in the middle) leaves a live server and the process never finishes. The runner
  //then prints not a single line - a failure looks like a hang rather than a failure, so you go
  //looking for an infinite loop instead of reading the assertion. It cost me twice in one
  //night.
  //
  //The tests wait for their responses anyway, so having no handle on the loop shortens nothing;
  //the only change is that after the last test the process CAN exit.
  server.unref();
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    ctx,
    config,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export const bearer = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

/** Headers for a cookie session, together with a CSRF token computed as in the client. */
export function cookieAuth(setCookie: string): Record<string, string> {
  const value = setCookie.split(";")[0];
  return {
    cookie: value,
    "content-type": "application/json",
    "x-at-csrf": csrfFor(value.slice(COOKIE_NAME.length + 1)),
  };
}

export type SseClient = {
  next: (timeoutMs?: number) => Promise<Record<string, unknown>>;
  close: () => void;
};

/** A minimal SSE client. No dependency needed: the format is three text fields. */
export async function openSse(url: string, token: string): Promise<SseClient> {
  const controller = new AbortController();
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  if (!res.body) throw new Error("SSE bez ciala odpowiedzi");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queue: Array<Record<string, unknown>> = [];
  const waiters: Array<(e: Record<string, unknown>) => void> = [];

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue; // komentarz keep-alive
          const parsed = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
          const waiter = waiters.shift();
          if (waiter) waiter(parsed);
          else queue.push(parsed);
        }
      }
    } catch { /* zamkniecie strumienia jest normalnym koncem */ }
  })();

  return {
    next: (timeoutMs = 2000) =>
      new Promise((resolve, reject) => {
        const ready = queue.shift();
        if (ready) return resolve(ready);
        const timer = setTimeout(() => {
          const i = waiters.indexOf(onEvent);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error("timeout: nie przyszlo zadne zdarzenie"));
        }, timeoutMs);
        const onEvent = (e: Record<string, unknown>) => {
          clearTimeout(timer);
          resolve(e);
        };
        waiters.push(onEvent);
      }),
    close: () => controller.abort(),
  };
}
