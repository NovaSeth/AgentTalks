import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY } from "../../src/core/error-codes.ts";

// These codes are emitted only by the MCP transport or MCP tool dispatch.
const AGENT_ONLY_ERRORS = [
  { code: "invalid_address", reason: "MCP conversation-address parser; the UI uses conversation IDs." },
  { code: "url_required", reason: "MCP conversation-address parser; the UI uses conversation IDs." },
  { code: "mcp_unavailable", reason: "The /mcp endpoint is unavailable; the UI uses /api routes." },
  { code: "post_only", reason: "The stateless /mcp endpoint requires POST; the UI does not call it." },
  { code: "unknown_tool", reason: "MCP tool dispatch; the UI does not call MCP tools." },
] as const;

test("every API error code has a translated UI message or an explained agent-only exception", async (context) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => null } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  const { describeError } = await import("../../src/http/ui/js/api.js");
  const { lang, setLang } = await import("../../src/http/ui/js/i18n.js");
  const { PL } = await import("../../src/http/ui/js/i18n-pl.js");
  const previousLanguage = lang();
  context.after(() => setLang(previousLanguage));
  const exceptions = new Set<string>(AGENT_ONLY_ERRORS.map(({ code, reason }) => {
    assert.ok(Object.hasOwn(LEGACY, code), `stale agent-only exception: ${code}`);
    assert.ok(reason.trim(), `missing agent-only reason: ${code}`);
    return code;
  }));
  assert.equal(exceptions.size, AGENT_ONLY_ERRORS.length);
  const codes = [...Object.keys(LEGACY).filter((code) => !exceptions.has(code)),
    "csrf", "token", "emoji", "slug", "cbor", "webauthn", "webauthn_challenge",
    "webauthn_origin", "webauthn_rpid", "webauthn_uv"];
  const fallback = "Raw server error: do not show this to a human";
  setLang("en");
  const messages = codes.map((code) => ({ code, message: describeError({ code, status: 418, message: fallback }, undefined) }));
  const missing = messages.filter(({ message }) => message === fallback).map(({ code }) => code);
  assert.deepEqual(missing, [], `${missing.length} codes fall back instead of using ERRORS: ${missing.join(", ")}`);
  for (const { code, message } of messages) {
    assert.ok(message.trim() && message !== code, `${code}: empty or raw code message`);
    assert.ok(Object.hasOwn(PL, message), `${code}: missing Polish translation for ${message}`);
    setLang("pl");
    const translated = describeError({ code, status: 418, message: fallback }, undefined);
    assert.equal(translated, (PL as Record<string, unknown>)[message], `${code}: language switch did not translate the error`);
    assert.notEqual(translated, message, `${code}: Polish UI still shows English`);
    setLang("en");
  }
});
