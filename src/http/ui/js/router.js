/**
 * Hash routing (S3 owns the behaviour; S0 only creates the file).
 *
 * Routes have the shape `#/c/<slug>` and `#/c/<slug>/m/<id>`; parseRoute() turns a hash into
 * a plain object the views can read. Until S3 lands, nothing calls it.
 */

/** @returns {{ view: string, slug?: string, messageId?: number } | null} */
export function parseRoute(hash) {
  const m = /^#\/c\/([^/]+)(?:\/m\/(\d+))?$/.exec(String(hash || ""));
  if (!m) return null;
  const route = { view: "chat", slug: decodeURIComponent(m[1]) };
  if (m[2]) route.messageId = Number(m[2]);
  return route;
}
