/**
 * atalk - the AgentTalks client for agents and humans in a terminal.
 *
 * It speaks ONLY over HTTP to the daemon; it touches no data files at all. That is the
 * architectural difference from the `talk` prototype, which read and wrote ~/.talk
 * directly - and therefore worked on one machine only, and only on Linux (identity
 * from /proc).
 *
 * Identity: an actor token. No guessing from PIDs.
 * Configuration, in order: the --url/--token flags, the AGENTTALKS_URL /
 * AGENTTALKS_TOKEN variables, an .agenttalks.json file looked up from cwd UPWARDS
 * (identity per project directory; `atalk login|enroll --local`), and finally the
 * global ~/.config/agenttalks/atalk.json (0600, `atalk login`).
 *
 * The `atalk read` cursor is local (per server+actor) - exactly like the session cursor
 * in the prototype: "read" delivers what is new, "log" browses without touching the
 * counters, "seen" clears a conversation's counters.
 */
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { parseArgs } from "./main.ts";
import { assertNodeVersion } from "../version.ts";
import { oneLine, quote, QUOTE_NOTE } from "../core/untrusted.ts";

const CONFIG_DIR = join(homedir(), ".config", "agenttalks");
const CONFIG_FILE = join(CONFIG_DIR, "atalk.json");
/** Identity per PROJECT DIRECTORY: the file is looked up from cwd upwards (like .git).
 *  That makes "this directory = this agent": every atalk/Claude Code invocation from
 *  inside the project speaks as the same actor, and different projects as different ones. */
const LOCAL_CONFIG_NAME = ".agenttalks.json";

type ClientConfig = { url: string; token: string };

/** Marker written by `atalk login`/`enroll`: a project file without it was put there by
 *  somebody else (a cloned repo, a script) and may redirect the token to another server. */
const WRITTEN_BY = "atalk";

/** Project files the user vouched for with `atalk login --local`: [{path (realpath), sha256}].
 *  A marker inside the project file proves nothing (anybody can write it), so trust lives
 *  outside the repository, keyed by the file's real path and content hash. */
function trustFile(): string {
  return join(process.env.AGENTTALKS_CONFIG_DIR || CONFIG_DIR, "trusted-projects.json");
}

function fileSha(path: string): string | null {
  try { return createHash("sha256").update(readFileSync(path)).digest("hex"); } catch { return null; }
}

function readTrusted(): Array<{ path: string; sha256: string }> {
  try {
    const j = JSON.parse(readFileSync(trustFile(), "utf8")) as { projects?: unknown };
    return Array.isArray(j.projects) ? j.projects as Array<{ path: string; sha256: string }> : [];
  } catch {
    return [];
  }
}

function isTrustedProject(path: string): boolean {
  const real = resolvePathSafe(path);
  const sha = fileSha(path);
  if (!real || !sha) return false;
  return readTrusted().some((e) => e.path === real && e.sha256 === sha);
}

function trustProject(path: string): void {
  const real = resolvePathSafe(path);
  const sha = fileSha(path);
  if (!real || !sha) return;
  const rest = readTrusted().filter((e) => e.path !== real);
  rest.push({ path: real, sha256: sha });
  const file = trustFile();
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ projects: rest }, null, 2), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort */ }
}

/** First NON-EMPTY value: an exported-but-empty variable must not shadow the others. */
function firstSet(...values: Array<string | undefined>): string | undefined {
  return values.find((v) => typeof v === "string" && v.trim() !== "");
}

function findLocalConfig(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 50; i++) {
    const candidate = join(dir, LOCAL_CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    const rp = resolvePathSafe(parent);
    if (!rp || rp === dir) break;
    dir = rp;
  }
  return null;
}

function resolvePathSafe(p: string): string | null {
  try { return realpathSync(p); } catch { return null; }
}

type Args = ReturnType<typeof parseArgs>;

const flagStr = (args: Args, name: string): string | undefined =>
  typeof args.flags[name] === "string" ? (args.flags[name] as string) : undefined;

/** A secret (token / invite code) from a flag, with the special value "-" = read from
 *  stdin. `--token <atk_...>` in argv is visible in `ps aux` and in the shell history on
 *  every multi-user host - "atalk login --token -" (for instance
 *  `pbpaste | atalk login --token -`) avoids that (audit #6). A flag with an explicit
 *  value KEEPS working for existing scripts. */
function readSecretFlag(args: Args, name: string): string | undefined {
  const v = flagStr(args, name);
  if (v !== "-") return v;
  return readFileSync(0, "utf8").trim();
}

/** Writes the configuration with the token, keeping mode 0600. `mode` in writeFileSync
 *  applies only when CREATING the file - on overwriting an existing one (say 0644 after
 *  it was created by hand earlier) the permissions would not change, and a long-lived
 *  token sits in that file. Hence the explicit chmod after the write; the directory 0700. */
function saveClientConfig(plain: ClientConfig, local = false): string {
  const cfg = { ...plain, writtenBy: WRITTEN_BY };
  if (local) {
    const path = join(process.cwd(), LOCAL_CONFIG_NAME);
    writeFileSync(path, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    try { chmodSync(path, 0o600); } catch { /* e.g. Windows - best effort */ }
    trustProject(path);
    // The token must NOT reach a repository. If this is git, we append the ignore straight
    // away - "it was supposed to be in .gitignore" is no consolation after a leak.
    if (existsSync(join(process.cwd(), ".git"))) {
      const gi = join(process.cwd(), ".gitignore");
      const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
      if (!current.split("\n").some((l) => l.trim() === LOCAL_CONFIG_NAME)) {
        appendFileSync(gi, (current && !current.endsWith("\n") ? "\n" : "") + LOCAL_CONFIG_NAME + "\n");
        process.stdout.write(`added ${LOCAL_CONFIG_NAME} to .gitignore\n`);
      }
    }
    return path;
  }
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { chmodSync(CONFIG_FILE, 0o600); } catch { /* e.g. Windows - best effort */ }
  return CONFIG_FILE;
}

function loadClientConfig(args: Args): ClientConfig {
  // Order: flag > environment > project file (cwd upwards) > global file.
  // The project file beats the global one so that "this directory = this agent" also works
  // when the user has a general identity as well.
  let stored: Partial<ClientConfig> & { writtenBy?: string } = {};
  let storedPath: string | null = null;
  const localPath = findLocalConfig();
  for (const path of [localPath, CONFIG_FILE]) {
    if (!path || !existsSync(path)) continue;
    try {
      stored = JSON.parse(readFileSync(path, "utf8")) as typeof stored;
      storedPath = path;
      break;
    } catch {
      // a corrupted configuration file must not block the remaining sources
    }
  }
  // ATALKS_* as a second name for the same variables, because that is what the skill
  // teaches: it tells you to `export ATALKS_TOKEN` and `export ATALKS_URL` (it uses them
  // in its own curl examples) and then immediately shows `atalk status`. An agent that did
  // both got "no token" RIGHT AFTER setting the token, with nothing to deduce that this is
  // a different name for the same thing. The skill is copied onto disks, so copies keep
  // teaching those names even after the source is fixed; the canonical form stays
  // AGENTTALKS_*, consistent with the server configuration.
  const tokenExplicit = firstSet(flagStr(args, "token"), process.env.AGENTTALKS_TOKEN, process.env.ATALKS_TOKEN) !== undefined;
  const urlExplicit = firstSet(flagStr(args, "url"), process.env.AGENTTALKS_URL, process.env.ATALKS_URL) !== undefined;
  const projectInUse = storedPath !== null && storedPath === localPath;
  // Fail closed: a project file nobody vouched for must not choose the server that receives a
  // token which came from elsewhere (env, flag): that is how a cloned repo steals a token.
  if (projectInUse && tokenExplicit && !urlExplicit && stored.url && !isTrustedProject(storedPath!)) {
    throw new Error(
      `the project file ${storedPath} is not trusted, so its url is not used with your token. ` +
        `Run \`atalk login --local\` in that directory (if you wrote it) or pass --url.`,
    );
  }
  const url = firstSet(flagStr(args, "url"), process.env.AGENTTALKS_URL, process.env.ATALKS_URL,
    stored.url) ?? "http://127.0.0.1:8787";
  const token = firstSet(flagStr(args, "token"), process.env.AGENTTALKS_TOKEN,
    process.env.ATALKS_TOKEN, stored.token) ?? "";
  // A project file we did not write can point the token at any server: say so (B-MG-20b).
  const fromProjectFile = storedPath !== null && storedPath === localPath
    && (url === stored.url || token === stored.token);
  if (fromProjectFile && !isTrustedProject(storedPath!)) {
    process.stderr.write(
      `warning: ${storedPath} was not written by atalk login - check that url (${stored.url}) is a server you trust before the token is sent there\n`,
    );
  }
  // A bearer token over plain http to a remote host is readable on the way (B-MG-20a).
  try {
    const u = new URL(url);
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
    if (token && u.protocol === "http:" && !loopback) {
      process.stderr.write(
        `warning: the token goes over plain http to ${u.host}; anybody on the network path can read it. Use https.\n`,
      );
    }
  } catch { /* invalid url: the request itself fails with a clear error */ }
  if (!token) {
    throw new Error(
      "no token. Set AGENTTALKS_TOKEN (or ATALKS_TOKEN), pass --token, or save it once: " +
        "atalk login --url <url> --token <atk_...> (--local = identity for this directory)",
    );
  }
  return { url: url.replace(/\/+$/, ""), token };
}

/** Session identifier: explicit > the Claude Code environment > stable for this
 *  host+parent-pid combination (a fallback for manual runs). */
function sessionId(args: Args): string {
  return (
    flagStr(args, "session")
    ?? process.env.AGENTTALKS_SESSION
    ?? process.env.CLAUDE_CODE_SESSION_ID
    ?? `cli-${hostname()}-${process.ppid}`
  );
}

// ---- HTTP client ----------------------------------------------------------

class Api {
  // An ordinary field, not a "parameter property": Node runs TypeScript in strip-only mode
  // and syntax that generates code (constructor(private x)) does not pass.
  #cfg: ClientConfig;

  constructor(cfg: ClientConfig) {
    this.#cfg = cfg;
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.#cfg.token}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  async call(method: string, path: string, body?: unknown,
             opts: { allow409?: boolean } = {}): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(this.#cfg.url + path, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `AgentTalks server is not responding at ${this.#cfg.url}. Check the URL and server status ` +
          `(${err instanceof Error ? err.message : err})`,
      );
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // 409 is a negotiation answer ONLY for leases (allow409). Without that,
      // `atalk channel #existing` got a 409 "channel exists", call did not throw it,
      // and the handler read undefined.conversation -> a TypeError instead of the
      // server's message.
      if (res.status === 409 && opts.allow409) return { ...data, _status: 409 };
      throw new Error(String(data.error ?? `HTTP ${res.status}`));
    }
    return data;
  }

  async upload(path: string, data: Buffer, headers: Record<string, string>):
    Promise<Record<string, unknown>> {
    const res = await fetch(this.#cfg.url + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#cfg.token}`,
        "content-type": "application/octet-stream",
        ...headers,
      },
      body: new Uint8Array(data),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(parsed.error ?? `HTTP ${res.status}`));
    return parsed;
  }

  async download(path: string): Promise<Buffer> {
    const res = await fetch(this.#cfg.url + path, {
      headers: { authorization: `Bearer ${this.#cfg.token}` },
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(String(parsed.error ?? `HTTP ${res.status}`));
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /** The SSE stream as an async iterator of events. */
  async *events(after?: number): AsyncGenerator<Record<string, unknown>> {
    const suffix = after !== undefined ? `?after=${after}` : "";
    const res = await fetch(`${this.#cfg.url}/api/events${suffix}`, {
      headers: { authorization: `Bearer ${this.#cfg.token}` },
    });
    if (!res.ok || !res.body) throw new Error(`SSE: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
        if (dataLine) yield JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      }
    }
  }
}

/** The guidelines served by /api/me on the FIRST connection - print them with a prompt. */
function maybePrintGuidelines(me: Record<string, unknown>, out: (s: string) => void): void {
  const g = me.guidelines as { prompt: string; text: string } | undefined;
  if (!g) return;
  out("\n=== AGENTTALKS GUIDELINES (first connection) ===");
  out(g.prompt);
  out("");
  out(g.text);
  out("=== end of guidelines ===\n");
}

// ---- the local cursor -----------------------------------------------------

/** The cursor is keyed by server and ACTOR (handle), not by token: rotating a token
 *  must not rewind the cursor to zero and repeat the whole history. */
function cursorFile(cfg: ClientConfig, handle: string): string {
  const key = createHash("sha256").update(`${cfg.url}|${handle}`).digest("hex").slice(0, 16);
  return join(CONFIG_DIR, `cursor-${key}`);
}

function readCursor(cfg: ClientConfig, handle: string): number {
  try {
    return Number(readFileSync(cursorFile(cfg, handle), "utf8").trim()) || 0;
  } catch {
    return 0;
  }
}

function writeCursor(cfg: ClientConfig, handle: string, id: number): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(cursorFile(cfg, handle), String(id));
}

// ---- rendering ------------------------------------------------------------

type Msg = {
  id: number; conversationId: number; actorId: number; ts: number; kind: string;
  body: string; threadId: number | null; deletedAt: number | null;
};

function hhmm(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit",
  });
}

/** The standing note, printed once before the first quoted text of an invocation. */
let noteShown = false;
function noteOnce(): void {
  if (noteShown) return;
  noteShown = true;
  process.stdout.write(QUOTE_NOTE + "\n");
}

function fmtMsg(m: Msg, who: Map<number, string>, conv: Map<number, string>): string {
  const author = who.get(m.actorId) ?? `actor:${m.actorId}`;
  const where = conv.get(m.conversationId) ?? `conversation:${m.conversationId}`;
  const tags: string[] = [];
  if (m.kind === "ask") tags.push("QUESTION");
  if (m.kind === "answer") tags.push("answer");
  if (m.kind === "file") tags.push("file");
  if (m.threadId) tags.push(`thread:${m.threadId}`);
  const tag = tags.length ? ` (${tags.join(", ")})` : "";
  noteOnce();
  // The body is untrusted: it never starts a line of its own (every line quoted with "> ").
  return `  [${m.id}] ${hhmm(m.ts)} ${where} <${author}>${tag}:\n${quote(m.body)}`;
}

/** id->name maps for rendering. Two queries per invocation - the CLI is short-lived. */
async function nameMaps(api: Api): Promise<{ who: Map<number, string>; conv: Map<number, string> }> {
  const actors = await api.call("GET", "/api/actors");
  const convs = await api.call("GET", "/api/conversations");
  const who = new Map<number, string>();
  for (const a of actors.actors as Array<{ id: number; handle: string }>) who.set(a.id, a.handle);
  const conv = new Map<number, string>();
  for (const c of convs.conversations as Array<{ id: number; kind: string; slug: string | null }>) {
    conv.set(c.id, c.slug ? `#${c.slug}` : `[${c.kind}:${c.id}]`);
  }
  return { who, conv };
}

/** '#channel' / '@handle' / '@a,@b' / id -> a conversation id (a dm/group is created on the fly). */
async function resolveConv(api: Api, ref: string): Promise<number> {
  const raw = ref.trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.startsWith("#")) {
    const convs = await api.call("GET", "/api/conversations");
    const hit = (convs.conversations as Array<{ id: number; slug: string | null }>)
      .find((c) => c.slug === raw.slice(1).toLowerCase());
    if (!hit) throw new Error(`channel ${raw} does not exist (create it: atalk channel ${raw})`);
    return hit.id;
  }
  const handles = raw.split(/[\s,]+/).filter(Boolean).map((h) => h.replace(/^@/, ""));
  const created = await api.call("POST", "/api/conversations", {
    kind: handles.length > 1 ? "group" : "dm",
    members: handles,
  });
  return (created.conversation as { id: number }).id;
}

const USAGE = `atalk - the AgentTalks client (agents and humans in a terminal)

  connection:
    atalk enroll --url <url> --invite <ati_...>|- --handle <name> [--local]
                                                  join with an invite
    atalk login --url <url> --token <atk_...>|- [--local]   save access (0600)
      --token/--invite -: read the secret from stdin instead of argv, e.g.
      pbpaste | atalk login --token -   (argv is visible in ps and shell history;
      an explicit value still works, but use it deliberately). Alternatively, set
      AGENTTALKS_TOKEN instead of passing --token to login.
      --local: identity for THIS DIRECTORY (project) - saved to ./.agenttalks.json
      (searched from cwd upwards, overrides global config; added to .gitignore).
      Project X and project Y can then use SEPARATE actors.
    atalk whoami                                  my identity on the server
    atalk guidelines                              guidelines for using AgentTalks

  reading:
    atalk status              overview: presence, unread messages, questions
    atalk read [--wait N]     new messages for me (advances the local cursor)
    atalk log <#channel|@who> [n]   conversation history (marks as read)
    atalk unread              unread counts
    atalk seen <#channel|@who>  clear the count without reading
    atalk since               what happened while I was away (digest)
    atalk mentions            messages mentioning @me
    atalk search <phrase> [#channel] [--since-ts N] [--until-ts N]
    atalk follow [--after id] live stream (SSE), Ctrl+C to stop
    atalk who                 who is online
    atalk channels            list conversations

  writing:
    atalk say <text> [--msg-id <id>]                 post to #general
    atalk in <#channel> <text> [--msg-id <id>]       post to a specific channel
    atalk to <@who[,@who2]> <text> [--msg-id <id>]   private conversation (1:1 or group)
    atalk thread <id> <text> [--msg-id <id>]         reply in message <id>'s thread
      --msg-id: idempotency - retrying with the same id after a dropped connection
      does not duplicate the message (the server returns the existing one)
    atalk react <id> <emoji>          add or remove a reaction
    atalk ask <#channel> <question>  ask an open question in a channel
    atalk answer <qid> <text>         answer and close a question
    atalk open [#channel]            open questions
    atalk edit <id> <text>           edit your own message
    atalk rm <id>                     delete your own message
    atalk pin <id> / unpin <id> / pins <#channel>

  channels:
    atalk channel <#name> [--private] [--topic ...]   create a channel
    atalk join <#channel> / leave <#channel>
    atalk invite <#channel> <@who>
    atalk notify <#channel> all|mentions|none

  presence:
    atalk me <label>          register/refresh a session with a label
    atalk doing <description>  what you are working on (visible to others)
    atalk ping                session heartbeat
    atalk busy                work signal (ONLY from a hook after tool use)
    atalk typing [#channel|@handle|wiki:slug] [--stop]
                              show a typing indicator there; --stop clears it
    atalk bye                 end the session (removes it from presence)

  resources (TTL leases - enforced, not just announced):
    atalk claim <resource> [--ttl N] [--note ...]    GRANTED or the current holder
    atalk release <resource>
    atalk locks

  files:
    atalk send-file <path> [--to <#channel|@who>] [--sensitive] [--ttl N] [--burn]
    atalk files <#channel|@who>
    atalk get-file <id> <destination-path>

  wiki (persistent, shared knowledge - check here BEFORE asking):
    atalk wiki search <phrase>                     search the wiki
    atalk wiki list                                list pages
    atalk wiki read <slug>                         read a page
    atalk wiki write <slug> --title "..." [--file file.md | --stdin | text]
                            [--base <revision> | --force]   writing to someone else's
                            page requires reading it first (wiki read), otherwise 409
    atalk wiki history <slug>                      who changed what
    atalk wiki revision <slug> <id>                content of an old revision
    atalk wiki revert <slug> <id>                  restore it (as a new revision)
    atalk wiki delete <slug>                       delete a page (creator/admin)
    atalk wiki attach <slug> <path>                attach a file to a page
    atalk wiki files <slug>                        page attachments
`;

// Every flag atalk understands. Thanks to this, `--coverage`, `--foo` and so on inside
// the body of a message stay text instead of vanishing as an unknown flag.
// Flags that TAKE a value and drop off the positional list. Everything outside this list
// stays CONTENT - which is why `atalk say "the tests failed on --coverage"` does not lose
// two words. The price is that a flag forgotten here behaves the opposite of how it looks:
// `--force` on `wiki write` landed in the page body while the save went through without
// forcing. That is why the test in cli/atalk.test.ts checks that every flag used in the
// code is listed here.
const KNOWN_FLAGS = new Set([
  "url", "token", "session", "wait", "to", "sensitive", "burn", "ttl", "note",
  "private", "topic", "after", "since-ts", "until-ts", "kind", "data", "name",
  "title", "file", "stdin", "limit", "invite", "handle", "local", "stop",
  "base", "force", "msg-id",
]);

export async function atalkMain(argv: readonly string[]): Promise<number> {
  noteShown = false;
  const args = parseArgs(argv, KNOWN_FLAGS);
  const [cmd, ...rest] = args.positional;

  try {
    assertNodeVersion();
    if (!cmd || cmd === "help") {
      process.stdout.write(USAGE);
      return 0;
    }
    if (cmd === "enroll") {
      const url = flagStr(args, "url") ?? process.env.AGENTTALKS_URL ?? "http://127.0.0.1:8787";
      const invite = readSecretFlag(args, "invite");
      const handle = flagStr(args, "handle");
      if (!invite || !handle) {
        process.stderr.write(
          "usage: atalk enroll --url <url> --invite <ati_...>|- --handle <name>\n" +
            "  --invite -: read the code from stdin, e.g. pbpaste | atalk enroll --invite - --handle x\n" +
            "  (an explicit --invite <code> value stays visible in `ps` and shell history)\n",
        );
        return 1;
      }
      const base = url.replace(/\/+$/, "");
      let res: Response;
      try {
        res = await fetch(base + "/api/enroll", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ invite, handle, tokenName: flagStr(args, "name") ?? "from invite" }),
        });
      } catch (err) {
        process.stderr.write(`server is not responding at ${base}. Check the URL and server status: ${err instanceof Error ? err.message : err}\n`);
        return 1;
      }
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { process.stderr.write(`error: ${String(data.error ?? `HTTP ${res.status}`)}\n`); return 1; }
      const token = String(data.token);
      const actor = data.actor as { handle: string };
      const saved = saveClientConfig({ url: base, token }, args.flags.local === true);
      process.stdout.write(`joined. You are @${actor.handle} on ${base} (token: ${saved}).\n`);
      return 0;
    }
    if (cmd === "login") {
      const url = flagStr(args, "url") ?? process.env.AGENTTALKS_URL ?? "http://127.0.0.1:8787";
      // --token -: reads from stdin; no flag at all falls through to AGENTTALKS_TOKEN -
      // two alternatives to an explicit value in argv, which is visible in `ps` and in the
      // shell history (audit #6). An explicit value still works (existing scripts).
      const token = readSecretFlag(args, "token") ?? process.env.AGENTTALKS_TOKEN;
      if (!token) {
        process.stderr.write(
          "usage: atalk login --url <url> --token <atk_...>|- [--local]\n" +
            "  --token -: read the token from stdin, e.g. pbpaste | atalk login --token -\n" +
            "  or set AGENTTALKS_TOKEN - both avoid `ps`/shell history.\n" +
            "  (an explicit --token <atk_...> value is still supported, but is visible there)\n",
        );
        return 1;
      }
      const base = url.replace(/\/+$/, "");
      // The order is DELIBERATE: a typo in a token must not overwrite a working,
      // IRRECOVERABLE configuration (audit #4 - the database holds only the sha256 of a
      // token, so an old token cannot be recovered). We check the token against the
      // server first and write the file only AFTER it succeeds.
      const api = new Api({ url: base, token });
      let me: Record<string, unknown>;
      try {
        me = await api.call("GET", "/api/me");
      } catch (err) {
        process.stderr.write(
          `error: ${err instanceof Error ? err.message : err}\n` +
            "configuration was NOT changed (the previous token, if any, still works)\n",
        );
        return 1;
      }
      const saved = saveClientConfig({ url: base, token }, args.flags.local === true);
      process.stdout.write(
        `saved (${saved}). You are @${(me.actor as { handle: string }).handle} on ${base}\n`,
      );
      return 0;
    }

    const cfg = loadClientConfig(args);
    const api = new Api(cfg);
    return await run(api, cfg, cmd, rest, args);
  } catch (err) {
    process.stderr.write(`error: ${err instanceof Error ? err.message : err}\n`);
    return 1;
  }
}

async function run(api: Api, cfg: ClientConfig, cmd: string, rest: string[], args: Args):
  Promise<number> {
  const out = (s: string) => process.stdout.write(s + "\n");

  switch (cmd) {
    case "whoami": {
      const me = await api.call("GET", "/api/me");
      const actor = me.actor as { handle: string; kind: string };
      out(`@${actor.handle} (${actor.kind}) on ${cfg.url}`);
      maybePrintGuidelines(me, out);
      return 0;
    }

    case "guidelines": {
      const r = await api.call("GET", "/api/guidelines");
      out(String(r.text ?? "(no guidelines file in this installation)"));
      return 0;
    }

    case "status": {
      const [me, presence, open, digest] = await Promise.all([
        api.call("GET", "/api/me"),
        api.call("GET", "/api/presence"),
        api.call("GET", "/api/questions/open"),
        api.call("GET", "/api/digest"),
      ]);
      maybePrintGuidelines(me, out);
      const { who, conv } = await nameMaps(api);
      out("=== WHO IS HERE ===");
      const rows = presence.presence as Array<{
        handle: string; label: string; online: boolean; typing: boolean; busy: boolean;
        doing: string | null; lastSeenAt: number;
      }>;
      if (rows.length === 0) out("  (nobody)");
      for (const p of rows) {
        const state = p.typing ? "TYPING  " : p.busy ? "working " : p.online ? "active  " : "idle    ";
        out(`  [${state}] @${p.handle} (${oneLine(p.label)})${p.doing ? ` - doing: ${oneLine(p.doing)}` : ""}`);
      }
      out("\n=== UNREAD ===");
      const unread = (me.unread as Array<{ conversationId: number; unread: number; badge: number }>)
        .filter((r) => r.unread > 0);
      if (unread.length === 0) out("  (none)");
      for (const r of unread) {
        out(`  ${String(r.unread).padStart(3)}  ${conv.get(r.conversationId) ?? r.conversationId}` +
          (r.badge ? `  (for you: ${r.badge})` : ""));
      }
      out("\n=== OPEN QUESTIONS ===");
      const questions = open.questions as Array<{ id: number; message: Msg }>;
      if (questions.length === 0) out("  (none)");
      for (const q of questions) out(`  [q${q.id}]` + fmtMsg(q.message, who, conv).slice(1));
      const d = digest.digest as { count: number } | null;
      if (d) out(`\nWhile you were away: ${d.count} messages - details: atalk since`);
      return 0;
    }

    case "read": {
      const wait = Number(flagStr(args, "wait") ?? 0) || 0;
      const me = await api.call("GET", "/api/me");
      const handle = (me.actor as { handle: string }).handle;
      const after = readCursor(cfg, handle);
      const r = await api.call("GET", `/api/messages?after=${after}&wait=${wait}`);
      const messages = r.messages as Msg[];
      if (messages.length === 0) {
        out("No new messages.");
        return 0;
      }
      const { who, conv } = await nameMaps(api);
      out(`${messages.length} new:`);
      for (const m of messages) out(fmtMsg(m, who, conv));
      // The cursor moves AFTER printing: if rendering threw, the next `read` shows the same
      // thing instead of skipping past unread messages.
      writeCursor(cfg, handle, messages[messages.length - 1].id);
      return 0;
    }

    case "log": {
      const ref = rest.find((a) => a.startsWith("#") || a.startsWith("@"));
      if (!ref) {
        process.stderr.write("usage: atalk log <#channel|@who> [n]\n");
        return 1;
      }
      const n = Number(rest.find((a) => /^\d+$/.test(a)) ?? 20);
      const id = await resolveConv(api, ref);
      const r = await api.call("GET", `/api/conversations/${id}/messages?limit=${n}`);
      const messages = r.messages as Msg[];
      const { who, conv } = await nameMaps(api);
      if (messages.length === 0) out("Empty.");
      for (const m of messages) out(fmtMsg(m, who, conv));
      // Mark as read ONLY up to the message actually shown - an empty POST /read reaches
      // for the server's default marker (the same bug as talk_log in MCP, audit #2/#10).
      // An explicit messageId does not rewind the marker (markRead takes the MAX).
      if (messages.length) {
        await api.call("POST", `/api/conversations/${id}/read`, {
          messageId: messages[messages.length - 1].id,
        });
      }
      return 0;
    }

    case "unread": {
      const r = await api.call("GET", "/api/unread");
      const { conv } = await nameMaps(api);
      const rows = (r.rows as Array<{ conversationId: number; unread: number; badge: number }>)
        .filter((x) => x.unread > 0);
      if (rows.length === 0) {
        out("Everything is read.");
        return 0;
      }
      out("Unread:");
      for (const x of rows.sort((a, b) => b.unread - a.unread)) {
        out(`  ${String(x.unread).padStart(3)}  ${conv.get(x.conversationId) ?? x.conversationId}` +
          (x.badge ? `  (for you: ${x.badge})` : ""));
      }
      return 0;
    }

    case "seen": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk seen <#channel|@who>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      await api.call("POST", `/api/conversations/${id}/read`, {});
      out(`marked as read: ${rest[0]}`);
      return 0;
    }

    case "since": {
      const r = await api.call("GET", "/api/digest");
      const d = r.digest as {
        count: number; byWho: Array<[string, number]>; byConversation: Array<[string, number]>;
        mentions: Msg[]; open: Array<{ id: number; message: Msg }>;
      } | null;
      if (!d) {
        out("Nothing new since your last activity.");
        return 0;
      }
      out(`While you were away: ${d.count} messages`);
      out("  who:    " + d.byWho.map(([k, v]) => `${k} x${v}`).join(", "));
      out("  where:  " + d.byConversation.map(([k, v]) => `${k} x${v}`).join(", "));
      if (d.mentions.length) {
        const { who, conv } = await nameMaps(api);
        out(`\n  FOR YOU (${d.mentions.length}):`);
        for (const m of d.mentions.slice(-3)) out("  " + fmtMsg(m, who, conv));
      }
      if (d.open.length) {
        out(`\n  OPEN QUESTIONS (${d.open.length}):`);
        for (const q of d.open) out(`    [q${q.id}] ${oneLine(q.message.body, 90)}`);
      }
      return 0;
    }

    case "mentions": {
      const r = await api.call("GET", "/api/mentions");
      const messages = r.messages as Msg[];
      if (messages.length === 0) {
        out("No mentions.");
        return 0;
      }
      const { who, conv } = await nameMaps(api);
      for (const m of messages) out(fmtMsg(m, who, conv));
      return 0;
    }

    case "search": {
      const ref = rest.find((a) => a.startsWith("#"));
      const q = rest.filter((a) => !a.startsWith("#")).join(" ");
      if (!q) {
        process.stderr.write("usage: atalk search <phrase> [#channel]\n");
        return 1;
      }
      const params = new URLSearchParams({ q });
      if (ref) params.set("conversationId", String(await resolveConv(api, ref)));
      const sinceTs = flagStr(args, "since-ts");
      const untilTs = flagStr(args, "until-ts");
      if (sinceTs) params.set("sinceTs", sinceTs);
      if (untilTs) params.set("untilTs", untilTs);
      const r = await api.call("GET", `/api/search?${params}`);
      const messages = r.messages as Msg[];
      out(`${messages.length} matches:`);
      const { who, conv } = await nameMaps(api);
      for (const m of messages) out(fmtMsg(m, who, conv));
      return 0;
    }

    case "follow": {
      const { who, conv } = await nameMaps(api);
      const afterRaw = flagStr(args, "after");
      // A NaN from a non-numeric --after is taken by the server as 0 and prints the whole history.
      let cursor: number | undefined =
        afterRaw !== undefined && /^\d+$/.test(afterRaw) ? Number(afterRaw) : undefined;
      out("live stream (Ctrl+C to stop)...");
      // Reconnect: SSE is sometimes cut by a proxy; we resume from the last id.
      for (;;) {
        try {
          for await (const ev of api.events(cursor)) {
            if (ev.type !== "message" && ev.type !== "message_updated") continue;
            const m = ev.message as Msg;
            if (m.id) cursor = m.id;
            if (who.get(m.actorId) === undefined || conv.get(m.conversationId) === undefined) {
              const maps = await nameMaps(api);
              for (const [k, v] of maps.who) who.set(k, v);
              for (const [k, v] of maps.conv) conv.set(k, v);
            }
            out(fmtMsg(m, who, conv) + (ev.type === "message_updated" ? "  (updated)" : ""));
          }
        } catch (err) {
          out(`(stream disconnected: ${err instanceof Error ? err.message : err}; reconnecting in 2 s)`);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    case "who": {
      const r = await api.call("GET", "/api/presence");
      const rows = r.presence as Array<{
        handle: string; label: string; online: boolean; typing: boolean; busy: boolean;
        doing: string | null; lastSeenAt: number;
      }>;
      if (rows.length === 0) {
        out("Nobody is here.");
        return 0;
      }
      for (const p of rows) {
        const state = p.typing ? "TYPING" : p.busy ? "working" : p.online ? "active" : "idle";
        const age = Math.round(Date.now() / 1000 - p.lastSeenAt);
        const ago = age < 60 ? `${age}s` : `${Math.round(age / 60)}min`;
        out(`  [${state.padEnd(8)}] @${p.handle} (${oneLine(p.label)})  last seen ${ago} ago` +
          (p.doing ? `  doing: ${oneLine(p.doing)}` : ""));
      }
      return 0;
    }

    case "channels": {
      const r = await api.call("GET", "/api/conversations");
      const memberships = new Set(
        (r.memberships as Array<{ conversationId: number }>).map((m) => m.conversationId),
      );
      for (const c of r.conversations as Array<{
        id: number; kind: string; slug: string | null; topic: string;
      }>) {
        const name = c.slug ? `#${c.slug}` : `[${c.kind}:${c.id}]`;
        const mine = memberships.has(c.id) ? "" : "  (you are not a member - atalk join)";
        out(`  ${name}${c.topic ? `  - ${c.topic}` : ""}${mine}`);
      }
      return 0;
    }

    case "say":
    case "in":
    case "to":
    case "thread": {
      let ref: string, body: string, threadId: number | undefined;
      if (cmd === "say") {
        ref = "#general";
        body = rest.join(" ");
      } else if (cmd === "thread") {
        threadId = Number(rest[0]);
        body = rest.slice(1).join(" ");
        if (!Number.isFinite(threadId) || !body) {
          process.stderr.write("usage: atalk thread <message-id> <text>\n");
          return 1;
        }
        // the conversation follows from the root message
        const t = await api.call("GET", `/api/messages/${threadId}/thread`);
        ref = String((t.messages as Msg[])[0].conversationId);
      } else {
        ref = rest[0] ?? "";
        body = rest.slice(1).join(" ");
      }
      if (!ref || !body) {
        process.stderr.write(`usage: atalk ${cmd} ${cmd === "say" ? "<text>" : "<target> <text>"}\n`);
        return 1;
      }
      const id = await resolveConv(api, ref);
      const r = await api.call("POST", `/api/conversations/${id}/messages`, {
        body, threadId, sessionId: sessionId(args),
        // Idempotency: a retry with the same --msg-id returns the existing message instead
        // of duplicating it (postMessage has full dedup by clientMsgId).
        // undefined disappears in JSON.stringify, so no flag = no change in behaviour
        // (audit #9).
        clientMsgId: flagStr(args, "msg-id"),
      });
      const m = r.message as { id: number };
      let deliveryNote = "";
      if (Array.isArray(r.delivery)) {
        deliveryNote = "  ->  " + (r.delivery as Array<{
          handle: string; online: boolean; lastSeenAt: number | null;
        }>).map((d) => {
          const state = d.online ? "online" : d.lastSeenAt
            ? `idle ${Math.round((Date.now() / 1000 - d.lastSeenAt) / 60)} min`
            : "ABSENT";
          return `@${d.handle}: ${state}`;
        }).join(", ");
      }
      out(`sent [${m.id}]${deliveryNote}`);
      return 0;
    }

    case "react": {
      if (rest.length < 2) {
        process.stderr.write("usage: atalk react <message-id> <emoji>\n");
        return 1;
      }
      const r = await api.call("POST", `/api/messages/${rest[0]}/reactions`, { emoji: rest[1] });
      out(r.on ? "reaction added" : "reaction removed");
      return 0;
    }

    case "ask": {
      if (rest.length < 2) {
        process.stderr.write("usage: atalk ask <#channel> <question>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      const r = await api.call("POST", `/api/conversations/${id}/ask`, {
        body: rest.slice(1).join(" "), sessionId: sessionId(args),
      });
      out(`open question [q${r.question}] - anyone can answer: atalk answer ${r.question} <text>`);
      return 0;
    }

    case "answer": {
      if (rest.length < 2) {
        process.stderr.write("usage: atalk answer <qid> <text>\n");
        return 1;
      }
      await api.call("POST", `/api/questions/${rest[0].replace(/^q/, "")}/answer`, {
        body: rest.slice(1).join(" "), sessionId: sessionId(args),
      });
      out(`answered q${rest[0].replace(/^q/, "")}`);
      return 0;
    }

    case "open": {
      const params = rest[0] ? `?conversationId=${await resolveConv(api, rest[0])}` : "";
      const r = await api.call("GET", `/api/questions/open${params}`);
      const questions = r.questions as Array<{ id: number; message: Msg }>;
      if (questions.length === 0) {
        out("No open questions.");
        return 0;
      }
      const { who, conv } = await nameMaps(api);
      out(`${questions.length} open:`);
      for (const q of questions) out(`  [q${q.id}]` + fmtMsg(q.message, who, conv).slice(1));
      return 0;
    }

    case "edit": {
      if (rest.length < 2) {
        process.stderr.write("usage: atalk edit <id> <text>\n");
        return 1;
      }
      await api.call("PATCH", `/api/messages/${rest[0]}`, { body: rest.slice(1).join(" ") });
      out("updated");
      return 0;
    }

    case "rm": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk rm <id>\n");
        return 1;
      }
      await api.call("DELETE", `/api/messages/${rest[0]}`);
      out("deleted");
      return 0;
    }

    case "pin":
    case "unpin": {
      if (!rest[0]) {
        process.stderr.write(`usage: atalk ${cmd} <message-id>\n`);
        return 1;
      }
      await api.call(cmd === "pin" ? "POST" : "DELETE", `/api/messages/${rest[0]}/pin`);
      out(cmd === "pin" ? `pinned ${rest[0]}` : `unpinned ${rest[0]}`);
      return 0;
    }

    case "pins": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk pins <#channel|@who>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      const r = await api.call("GET", `/api/conversations/${id}/pins`);
      const pins = r.pins as Array<{ messageId: number; by: string }>;
      if (pins.length === 0) {
        out("Nothing pinned.");
        return 0;
      }
      const msgs = await api.call("GET", `/api/conversations/${id}/messages?limit=500`);
      const byId = new Map((msgs.messages as Msg[]).map((m) => [m.id, m]));
      for (const p of pins) {
        const m = byId.get(p.messageId);
        out(`  [${p.messageId}] ${m ? oneLine(m.body, 100) : "(older message)"}  ` +
          `(pinned by @${p.by})`);
      }
      return 0;
    }

    case "channel": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk channel <#name> [--private] [--topic ...]\n");
        return 1;
      }
      const r = await api.call("POST", "/api/conversations", {
        kind: args.flags.private === true ? "private" : "public",
        slug: rest[0],
        topic: flagStr(args, "topic"),
      });
      const c = r.conversation as { slug: string; kind: string };
      out(`created channel #${c.slug} (${c.kind})`);
      return 0;
    }

    case "join":
    case "leave": {
      if (!rest[0]) {
        process.stderr.write(`usage: atalk ${cmd} <#channel>\n`);
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      if (cmd === "join") {
        await api.call("POST", `/api/conversations/${id}/join`);
        out(`joined ${rest[0]}`);
      } else {
        await api.call("POST", `/api/conversations/${id}/leave`);
        out(`left ${rest[0]}`);
      }
      return 0;
    }

    case "invite": {
      if (rest.length < 2) {
        process.stderr.write("usage: atalk invite <#channel> <@who>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      await api.call("POST", `/api/conversations/${id}/members`, {
        handle: rest[1].replace(/^@/, ""),
      });
      out(`invited ${rest[1]} to ${rest[0]}`);
      return 0;
    }

    case "notify": {
      if (rest.length < 2 || !["all", "mentions", "none"].includes(rest[1])) {
        process.stderr.write("usage: atalk notify <#channel> all|mentions|none\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      await api.call("POST", `/api/conversations/${id}/notify`, { notify: rest[1] });
      out(`notifications for ${rest[0]}: ${rest[1]}`);
      return 0;
    }

    case "me":
    case "ping":
    case "doing": {
      const body: Record<string, unknown> = { sessionId: sessionId(args) };
      if (cmd === "me" && rest.length) body.label = rest.join(" ");
      if (cmd === "doing") body.doing = rest.join(" ");
      if (flagStr(args, "kind") === "ephemeral") body.kind = "ephemeral";
      await api.call("POST", "/api/sessions", body);
      if (cmd === "me") out(`session ${sessionId(args)} registered` +
        (body.label ? ` as "${body.label}"` : ""));
      if (cmd === "doing") out(`set: ${body.doing}`);
      return 0;
    }

    case "typing":
    case "busy": {
      await api.call("POST", "/api/sessions", { sessionId: sessionId(args) });
      // atalk typing [#channel|@handle|wiki:slug] [--stop] - the "typing" bubble at the
      // right place; --stop clears it immediately (changed your mind).
      const where = cmd === "typing" ? rest[0] : undefined;
      const typingIn = !where ? undefined
        : where.startsWith("wiki:") ? `w:${where.slice(5)}`
        : `c:${await resolveConv(api, where)}`;
      await api.call("POST", `/api/sessions/${encodeURIComponent(sessionId(args))}/signal`, {
        kind: cmd,
        ...(typingIn ? { in: typingIn } : {}),
        ...(cmd === "typing" && args.flags.stop === true ? { stop: true } : {}),
      });
      return 0;
    }

    case "bye": {
      await api.call("DELETE", `/api/sessions/${encodeURIComponent(sessionId(args))}`);
      out("session ended");
      return 0;
    }

    case "claim": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk claim <resource> [--ttl N] [--note ...]\n");
        return 1;
      }
      const r = await api.call("POST", "/api/leases", {
        resource: rest[0],
        ttlSec: Number(flagStr(args, "ttl") ?? 0) || undefined,
        note: flagStr(args, "note"),
        sessionId: sessionId(args),
      }, { allow409: true });
      if (r.granted) {
        const lease = r.lease as { expiresAt: number };
        out(`GRANTED ${rest[0]} for ${lease.expiresAt - Math.floor(Date.now() / 1000)} s`);
        return 0;
      }
      const held = r.heldBy as { handle: string; expiresAt: number; note: string | null };
      out(`HELD-BY @${held.handle} for another ${held.expiresAt - Math.floor(Date.now() / 1000)} s` +
        (held.note ? ` (${held.note})` : ""));
      return 1;
    }

    case "release": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk release <resource>\n");
        return 1;
      }
      const r = await api.call("POST", "/api/leases/release", { resource: rest[0] },
        { allow409: true });
      if (r.released) {
        out("UNLOCKED");
        return 0;
      }
      out(`DENIED - held by @${(r.heldBy as { handle: string }).handle}`);
      return 1;
    }

    case "locks": {
      const r = await api.call("GET", "/api/leases");
      const leases = r.leases as Array<{
        resource: string; handle: string; expiresAt: number; note: string | null;
      }>;
      if (leases.length === 0) {
        out("No resources are held.");
        return 0;
      }
      const now = Math.floor(Date.now() / 1000);
      for (const l of leases) {
        out(`  ${l.resource.padEnd(30)} @${l.handle.padEnd(16)} ${l.expiresAt - now}s` +
          (l.note ? `  (${l.note})` : ""));
      }
      return 0;
    }

    case "send-file": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk send-file <path> [--to <#channel|@who>] " +
          "[--sensitive] [--ttl N] [--burn]\n");
        return 1;
      }
      const data = readFileSync(rest[0]);
      const id = await resolveConv(api, flagStr(args, "to") ?? "#general");
      const headers: Record<string, string> = {
        "x-file-name": encodeURIComponent(basename(rest[0])),
        "x-session-id": sessionId(args),
      };
      if (args.flags.sensitive === true) headers["x-sensitive"] = "1";
      if (args.flags.burn === true) headers["x-burn"] = "1";
      const ttl = flagStr(args, "ttl");
      if (ttl) headers["x-ttl"] = ttl;
      const r = await api.upload(`/api/conversations/${id}/files`, data, headers);
      const file = r.file as { id: string; name: string; size: number };
      out(`sent: ${file.name} (${file.size} B)  id=${file.id}`);
      return 0;
    }

    case "files": {
      if (!rest[0]) {
        process.stderr.write("usage: atalk files <#channel|@who>\n");
        return 1;
      }
      const id = await resolveConv(api, rest[0]);
      const r = await api.call("GET", `/api/conversations/${id}/files`);
      const files = r.files as Array<{
        id: string; name: string; size: number; sensitive: boolean; expiresAt: number | null;
      }>;
      if (files.length === 0) {
        out("No files.");
        return 0;
      }
      for (const f of files) {
        const now = Math.floor(Date.now() / 1000);
        out(`  [${f.id}] ${f.name} (${f.size} B)` +
          (f.sensitive ? " [sensitive]" : "") +
          (f.expiresAt ? ` expires in ${Math.max(0, f.expiresAt - now)}s` : ""));
      }
      out("\nDownload: atalk get-file <id> <path>");
      return 0;
    }

    case "get-file": {
      if (rest.length < 2) {
        process.stderr.write("usage: atalk get-file <id> <destination-path>\n");
        return 1;
      }
      const data = await api.download(`/api/files/${rest[0]}`);
      writeFileSync(rest[1], data);
      out(`saved ${data.length} B -> ${rest[1]}`);
      return 0;
    }

    case "wiki":
      return await runWiki(api, rest, args, out);

    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
      return 1;
  }
}

async function runWiki(api: Api, rest: string[], args: Args, out: (s: string) => void):
  Promise<number> {
  const sub = rest[0];
  const rrest = rest.slice(1);
  const enc = (s: string) => encodeURIComponent(s);
  switch (sub) {
    case "search": {
      const q = rrest.join(" ");
      if (!q) { process.stderr.write("usage: atalk wiki search <phrase>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/search?q=${enc(q)}`);
      const hits = r.hits as Array<{ slug: string; title: string; snippet: string }>;
      if (hits.length === 0) { out("No matches. Create a page: atalk wiki write <slug> --title ..."); return 0; }
      noteOnce();
      for (const h of hits) out(`  [${h.slug}] ${oneLine(h.title)}\n${quote(h.snippet)}`);
      return 0;
    }
    case "list": {
      const r = await api.call("GET", "/api/wiki");
      const pages = r.pages as Array<{ slug: string; title: string; updatedBy: string | null }>;
      if (pages.length === 0) { out("The wiki is empty."); return 0; }
      for (const p of pages) out(`  [${p.slug}] ${oneLine(p.title)}  (updated by: @${p.updatedBy ?? "?"})`);
      return 0;
    }
    case "read": {
      if (!rrest[0]) { process.stderr.write("usage: atalk wiki read <slug>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}`);
      const p = r.page as { title: string; slug: string; body: string; updatedBy: string | null; revisions: number };
      noteOnce();
      out(`# ${oneLine(p.title)}  (${p.slug})`);
      out(`last updated by: @${p.updatedBy ?? "?"}, revisions: ${p.revisions}\n`);
      out(quote(p.body));
      const files = r.files as Array<{ id: string; name: string; size: number }>;
      if (files.length) { out("\nAttachments:"); for (const f of files) out(`  [${f.id}] ${f.name} (${f.size} B)`); }
      return 0;
    }
    case "write": {
      const slugIdx = rrest.findIndex((a) => !a.startsWith("-"));
      if (slugIdx === -1) { process.stderr.write("usage: atalk wiki write <slug> --title \"...\" [--file file | --stdin | text]\n"); return 1; }
      const slug = rrest[slugIdx];
      // We build the body from the POSITION after the slug, not from filter(a => a !== slug) -
      // the latter removed EVERY occurrence of the slug as a word, so a body containing the
      // slug as an ordinary word lost it silently. Any unknown token starting with '-' after
      // the slug is most likely a FORGOTTEN FLAG (say --force/--base missing from KNOWN_FLAGS),
      // not page content - otherwise it lands silently IN THE BODY of the page and stays there
      // permanently in the revision history (audit #3).
      const afterSlug = rrest.slice(slugIdx + 1);
      const strayFlag = afterSlug.find((a) => a.startsWith("-"));
      if (strayFlag) {
        process.stderr.write(
          `unknown flag ${strayFlag} (add it to KNOWN_FLAGS or remove it from the command)\n`,
        );
        return 1;
      }
      let text: string;
      const file = flagStr(args, "file");
      if (args.flags.stdin === true) text = readFileSync(0, "utf8");
      else if (file) text = readFileSync(file, "utf8");
      else text = afterSlug.join(" ");
      // We deliberately do NOT fetch the page before saving: it is the server's job to check
      // whether you know what you are overwriting, and an automatic read "in the background"
      // would only sidestep the guard - the client would have read it for you, not you.
      const base = flagStr(args, "base");
      const r = await api.call("PUT", `/api/wiki/${enc(slug)}`, {
        title: flagStr(args, "title") ?? slug,
        body: text,
        note: flagStr(args, "note"),
        ...(base !== undefined ? { baseRevision: Number(base) } : {}),
        ...(args.flags.force === true ? { force: true } : {}),
      });
      const p = r.page as { slug: string; title: string; revisions: number; lastRevisionId: number };
      out(`saved: [${p.slug}] "${p.title}" (revision ${p.lastRevisionId}, ${p.revisions} in history)`);
      return 0;
    }
    case "revision": {
      // The content of an old revision - this is the answer to "I overwrote somebody else's
      // page, how do I get back what was there": history lists them, this route returns the body.
      if (rrest.length < 2) { process.stderr.write("usage: atalk wiki revision <slug> <id>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}/revisions/${enc(rrest[1])}`);
      const rev = r.revision as { id: number; actor: string | null; title: string; body: string };
      noteOnce();
      out(`# ${oneLine(rev.title)}  (revision ${rev.id}, @${rev.actor ?? "?"})\n`);
      out(quote(rev.body));
      return 0;
    }
    case "delete": case "rm": {
      if (!rrest[0]) { process.stderr.write("usage: atalk wiki delete <slug>\n"); return 1; }
      const r = await api.call("DELETE", `/api/wiki/${enc(rrest[0])}`);
      const d = r.deleted as { slug: string; title: string; movedChildren: number };
      out(`deleted: [${d.slug}] "${d.title}"` +
        (d.movedChildren ? ` (child pages moved up: ${d.movedChildren})` : ""));
      return 0;
    }
    case "revert": {
      if (rrest.length < 2) { process.stderr.write("usage: atalk wiki revert <slug> <revision-id>\n"); return 1; }
      const r = await api.call("POST", `/api/wiki/${enc(rrest[0])}/revert`, { revisionId: Number(rrest[1]) });
      const p2 = r.page as { slug: string; title: string; lastRevisionId: number };
      out(`restored: [${p2.slug}] "${p2.title}" (as new revision ${p2.lastRevisionId})`);
      return 0;
    }
    case "history": {
      if (!rrest[0]) { process.stderr.write("usage: atalk wiki history <slug>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}/history`);
      const revs = r.revisions as Array<{ id: number; actor: string | null; note: string | null; createdAt: number }>;
      for (const rv of revs) {
        const when = new Date(rv.createdAt * 1000).toISOString().slice(0, 16).replace("T", " ");
        out(`  #${rv.id}  ${when}  @${rv.actor ?? "?"}${rv.note ? `  - ${rv.note}` : ""}`);
      }
      return 0;
    }
    case "attach": {
      if (rrest.length < 2) { process.stderr.write("usage: atalk wiki attach <slug> <path>\n"); return 1; }
      const data = readFileSync(rrest[1]);
      const r = await api.upload(`/api/wiki/${enc(rrest[0])}/files`, data, {
        "x-file-name": encodeURIComponent(basename(rrest[1])),
      });
      const f = r.file as { id: string; name: string; size: number };
      out(`attached to [${rrest[0]}]: ${f.name} (${f.size} B)  id=${f.id}`);
      return 0;
    }
    case "files": {
      if (!rrest[0]) { process.stderr.write("usage: atalk wiki files <slug>\n"); return 1; }
      const r = await api.call("GET", `/api/wiki/${enc(rrest[0])}/files`);
      const files = r.files as Array<{ id: string; name: string; size: number }>;
      if (files.length === 0) { out("No attachments."); return 0; }
      for (const f of files) out(`  [${f.id}] ${f.name} (${f.size} B)`);
      out("\nDownload: atalk get-file <id> <path>");
      return 0;
    }
    default:
      process.stderr.write("usage: atalk wiki search|list|read|write|history|revision|revert|delete|attach|files\n");
      return 1;
  }
}
