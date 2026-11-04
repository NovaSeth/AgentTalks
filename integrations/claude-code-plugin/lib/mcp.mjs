// @ts-check
/**
 * A minimal stdio MCP server, written by hand: the plugin must run from a git checkout with
 * no `npm install`, so it cannot import @modelcontextprotocol/sdk. The stdio transport is
 * JSON-RPC 2.0 with one JSON message per line on stdin/stdout; stdout carries protocol
 * messages ONLY (all logging goes to stderr), or Claude Code drops the server.
 *
 * Implemented: initialize, notifications/initialized, ping, tools/list, tools/call, and
 * outgoing notifications. Anything else with an id gets -32601 (method not found).
 */

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const MAX_LINE_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {{
 *   description: string,
 *   inputSchema: object,
 *   handler: (args: any) => Promise<{ text: string, isError?: boolean }>,
 * }} Tool
 */

/**
 * @param {{
 *   input: NodeJS.ReadableStream, output: NodeJS.WritableStream,
 *   info: { name: string, version: string },
 *   capabilities: object, instructions?: string,
 *   tools: Record<string, Tool>,
 *   onInitialized?: () => void,
 *   onClose?: () => void,
 *   log?: (line: string) => void,
 * }} opts
 */
export function createStdioServer(opts) {
  const log = opts.log ?? (() => {});
  let buf = "";
  let initialized = false;
  const toolMap = new Map(Object.entries(opts.tools));

  /** Resolves once the line is handed to the output (its write callback).
   *  @param {object} msg @returns {Promise<void>} */
  function write(msg) {
    return new Promise((resolve, reject) => {
      opts.output.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n",
        (/** @type {any} */ err) => (err ? reject(err) : resolve()));
    });
  }

  /** @param {unknown} id @param {number} code @param {string} message */
  function error(id, code, message) {
    write({ id: id ?? null, error: { code, message } });
  }

  /** @param {any} msg */
  async function handle(msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      return error(msg?.id, -32600, "invalid request");
    }
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    if (typeof method !== "string") {
      // A response to something we never send requests for: ignore it.
      return;
    }
    if (!isRequest) {
      if (method === "notifications/initialized" && !initialized) {
        initialized = true;
        opts.onInitialized?.();
      }
      return; // other notifications (cancelled, progress) need no action here
    }
    try {
      switch (method) {
        case "initialize": {
          const asked = params?.protocolVersion;
          const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL_VERSION;
          return write({
            id,
            result: {
              protocolVersion,
              capabilities: opts.capabilities,
              serverInfo: opts.info,
              ...(opts.instructions ? { instructions: opts.instructions } : {}),
            },
          });
        }
        case "ping":
          return write({ id, result: {} });
        case "tools/list":
          return write({
            id,
            result: {
              tools: Object.entries(opts.tools).map(([name, t]) => ({
                name, description: t.description, inputSchema: t.inputSchema,
              })),
            },
          });
        case "tools/call": {
          // A Map, not a property lookup: "constructor" or "__proto__" must be unknown tools.
          const tool = typeof params?.name === "string" ? toolMap.get(params.name) : undefined;
          if (!tool) return error(id, -32602, `unknown tool: ${String(params?.name).slice(0, 64)}`);
          let out;
          try {
            out = await tool.handler(params?.arguments ?? {});
          } catch (err) {
            out = { text: err instanceof Error ? err.message : "tool failed", isError: true };
          }
          return write({
            id,
            result: { content: [{ type: "text", text: out.text }], ...(out.isError ? { isError: true } : {}) },
          });
        }
        default:
          return error(id, -32601, `method not found: ${method.slice(0, 64)}`);
      }
    } catch (err) {
      log(`request ${method} failed: ${err instanceof Error ? err.message : err}`);
      return error(id, -32603, "internal error");
    }
  }

  opts.input.setEncoding?.("utf8");
  opts.input.on("data", (/** @type {string} */ chunk) => {
    buf += chunk;
    if (buf.length > MAX_LINE_BYTES && buf.indexOf("\n") < 0) {
      buf = "";
      error(null, -32700, "message too large");
      return;
    }
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { error(null, -32700, "parse error"); continue; }
      if (Array.isArray(msg)) { for (const m of msg) void handle(m); } else void handle(msg);
    }
  });
  opts.input.on("end", () => opts.onClose?.());
  opts.input.on("close", () => opts.onClose?.());

  return {
    /** @param {string} method @param {object} params */
    /** @param {string} method @param {object} params
     *  @returns {Promise<void>} settles when the notification is written */
    notify(method, params) { return write({ method, params }); },
    get initialized() { return initialized; },
  };
}
