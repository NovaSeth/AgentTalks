/**
 * Narzedzia do testow HTTP: zywy serwer na losowym porcie i minimalny klient SSE.
 *
 * Testy ida przez PRAWDZIWE gniazdo, a nie przez wywolanie handlera z atrapami.
 * Lekcja z prototypu: sprawdzanie `curl`-em warstwy, ktora sie nie psula, i nazywanie
 * tego testowaniem interfejsu, przepuscilo piec klas bledow. Kontrakt HTTP ma byc
 * sprawdzany jako kontrakt HTTP.
 */
import type { AddressInfo } from "node:net";
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
    secret: "sekret-testowy-0123456789abcdef",
    trustProxy: false,
    allowPublicBind: false,
    allowLoopbackWake: false,
    maxMessageBytes: 65536,
    maxFileBytes: 1024 * 1024,
    sessionTtlSec: 3600,
    ...overrides,
  };
}

export type TestServer = {
  url: string;
  ctx: Ctx;
  config: Config;
  close: () => Promise<void>;
};

export async function startTestServer(): Promise<TestServer> {
  const ctx = createCtx(openDb(":memory:"), new EventBus());
  const config = testConfig();
  const server = createServer(ctx, config);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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

/** Naglowki dla sesji na cookie, razem z tokenem CSRF wyliczonym tak jak w kliencie. */
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

/** Minimalny klient SSE. Nie ma potrzeby zaleznosci: format to trzy pola tekstowe. */
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
