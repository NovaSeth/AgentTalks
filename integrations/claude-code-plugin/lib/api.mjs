// @ts-check
/**
 * A tiny REST client for the AgentTalks HTTP API. Statuses only, no error-code parsing
 * (D-MG-13: the server's error codes are being renamed by another package, so the plugin must
 * not depend on them). The token goes into the Authorization header and nowhere else: error
 * messages carry the method, the path and the status, never a header.
 */

export class ApiError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {{ url: string, token: string }} identity
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [opts]
 */
export function createApi(identity, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  // D-MG-13: statuses only, error codes are changing.
  /**
   * @param {string} method @param {string} path @param {unknown} [body]
   * @returns {Promise<any>}
   */
  async function call(method, path, body) {
    /** @type {Record<string, string>} */
    const headers = { authorization: `Bearer ${identity.token}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetchImpl(identity.url + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ApiError(`${method} ${path}: ${err instanceof Error ? err.name : "network error"}`, 0);
    }
    const text = await res.text();
    if (!res.ok) throw new ApiError(`${method} ${path}: HTTP ${res.status}`, res.status);
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new ApiError(`${method} ${path}: not JSON`, res.status); }
  }
  return {
    get: (/** @type {string} */ p) => call("GET", p),
    post: (/** @type {string} */ p, /** @type {unknown} */ b) => call("POST", p, b ?? {}),
    put: (/** @type {string} */ p, /** @type {unknown} */ b) => call("PUT", p, b ?? {}),
    del: (/** @type {string} */ p) => call("DELETE", p),
  };
}

/** @typedef {ReturnType<typeof createApi>} Api */
