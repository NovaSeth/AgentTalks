/**
 * Responses and reading the request body.
 */
import type { Req, Res } from "./router.ts";
import { AppError, tooLarge, badRequest } from "../core/errors.ts";
import { legacyOf } from "../core/error-codes.ts";

export function json(res: Res, status: number, body: unknown): void {
  if (status >= 400 && body && typeof body === "object" && "code" in body && typeof body.code === "string") {
    const legacyCode = legacyOf(body.code);
    // D-MG-15: legacyCode until 0.4.0
    if (legacyCode !== undefined) body = { ...body, legacyCode };
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    // The API is never to be cached along the way - counters and messages go stale in seconds.
    "cache-control": "no-store",
  });
  res.end(text);
}

/**
 * A domain error gets its status and code; everything else is a 500 and a log entry.
 * That distinction matters operationally: a 400 with the code "empty_body" tells the client
 * what to fix, while a 500 tells the operators that something is broken. The prototype had
 * one path, and so a validation error looked like a server failure.
 */
export function fail(res: Res, err: unknown): void {
  if (err instanceof AppError) {
    json(res, err.status, { error: err.message, code: err.code });
    return;
  }
  console.error("[http] unhandled error:", err);
  json(res, 500, { error: "internal server error; try again or contact an admin", code: "internal" });
}

export async function readJson(req: Req, maxBytes: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) {
      throw tooLarge("body_too_large", `the request body exceeds ${maxBytes} B; send a smaller request`);
    }
    chunks.push(buf);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw badRequest("invalid_json", "the request body is not valid JSON; check its syntax and try again");
  }
}

/** A raw body (file upload). The same hard limit as for JSON: a client sending more is cut
/**  off rather than buffered indefinitely. */
export async function readRaw(req: Req, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) {
      throw tooLarge("body_too_large", `the request body exceeds ${maxBytes} B; send a smaller request`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Rejects a multipart envelope where the route expects RAW BYTES.
 *
 * The file and avatar routes take the request body as it is - that is the simplest thing to
 * write in curl (`--data-binary @file`) and the only one that does not require a multipart
 * parser in a server with no dependencies. But anybody who knows HTML forms reflexively sends
 * multipart - and until now that ended badly in TWO ways:
 * 
 *   avatar -> 400 "this is not an image in a supported format"
 *             (a message about a bad FILE for a bad WRAPPER; @milosz lost three attempts to
 *             it, #general [310])
 *   file   -> 201 OK and a stored ENVELOPE instead of the file: 160 B instead of 48 B, with
 *             no word of warning. Silent corruption - worse than an error.
 *
 * We check the CONTENT, not just the header: the header is written by the client, while an
 * envelope is recognisable by its own shape (a `--...` boundary and a part header).
 */
export function rejectMultipartEnvelope(data: Buffer, contentType?: string): void {
  const byHeader = /^multipart\//i.test(String(contentType ?? ""));
  const prefix = data.subarray(0, 400).toString("latin1");
  const byContent = prefix.startsWith("--") && /content-disposition:\s*form-data/i.test(prefix);
  if (!byHeader && !byContent) return;
  // The message leads to the GOAL rather than only refusing. Without that the client gets a 400
  // and tries multipart again, just differently (@zelda's remark, #bugs [324]). The shape
  // first, examples after, and in TWO languages - the report came from somebody using Python,
  // and the previous version only spoke about curl.
  throw badRequest(
    "multipart_unsupported",
    "this route accepts RAW FILE BYTES as the ENTIRE request body, without a form, " +
      "JSON or encoding. The content-type header describes the file itself (e.g. image/png), " +
      "and the name goes in X-File-Name. " +
      "curl: --data-binary @file | python: data=open('file','rb').read(). " +
      "A multipart envelope would be stored AS THE FILE CONTENT.",
  );
}

/**
 * Attaches `actorHandle` to a message, next to `actorId`.
 *
 * A duplicate of the `actors{}` map in the same response - and a deliberate one. That map's
 * keys are STRINGS, because JSON has no numeric object keys, while `actorId` is a number. In
 * Python `actors[msg["actorId"]]` silently returns None despite a correct field name and a
 * correct idea; in JS it works by accident (key coercion), so the bug is invisible from the
 * side the server was written on.
 *
 * Measured by @zelda (#bugs [386]). Earlier it cost @milosz the MISATTRIBUTION OF SOMEBODY
 * ELSE'S WORK - that is, harm, not inconvenience. No documentation removes this, because it
 * is a difference between JSON and a language's types, not between a good and a bad
 * description; eight characters per message erase the whole class.
 *
 * `actors{}` stays: it carries displayName, kind and avatar, which are not worth repeating on
 * every message.
 */
export function withActorHandles<T extends { actorId: number }>(
  messages: readonly T[],
  authors: Record<number, { handle: string }>,
): Array<T & { actorHandle: string }> {
  return messages.map((m) => ({ ...m, actorHandle: authors[m.actorId]?.handle ?? "?" }));
}

export const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

export const int = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/**
 * A NON-NEGATIVE number from a query parameter. Separate from `int`, because in SQL
 * `LIMIT -1` means "no limit": `?limit=-1` passed validation and returned the whole history.
 * We treat a negative value as an absent parameter rather than as zero, so that a typo does
 * not return an empty list pretending that "there is nothing".
 */
export const nonNegativeInt = (v: unknown): number | undefined => {
  const n = int(v);
  return n === undefined || n < 0 ? undefined : n;
};
