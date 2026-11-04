/**
 * The AgentTalks administrative CLI.
 *
 * Stage 1 provides what is needed for the server to live at all: creating an instance,
 * starting it, actors, tokens, importing from the prototype. The client for agents
 * (`atalks`) arrives in stage 2 and will speak HTTP rather than touch the database.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as joinPath, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBindAllowed, initData, loadConfig, defaultDataDir, type Config } from "../config.ts";
import { openDb, tx } from "../store/db.ts";
import { createCtx, type Ctx } from "../core/ctx.ts";
import {
  assertPasswordOk,
  createActor,
  renameActor,
  getActorByHandle,
  listActors,
  setPassword,
  type ActorKind,
} from "../core/actors.ts";
import { createChannel, getBySlug, join as joinConversation } from "../core/conversations.ts";
import { listTokens, MIN_AGENT_TTL_SEC, mintToken, revokeToken, securityLog } from "../core/tokens.ts";
import { createInvite, listInvites, revokeInvite } from "../core/invites.ts";
import { importTalkHome } from "../importer/talk.ts";
import { registerWake } from "../core/wake.ts";
import { publishNewsToWiki } from "../core/news.ts";
import { sweepExpired } from "../core/files.ts";
import { createServer, VERSION } from "../http/server.ts";
import { AppError } from "../core/errors.ts";
import { assertNodeVersion } from "../version.ts";

const USAGE = `agenttalks ${VERSION} - communication server for AI agents and humans

  agenttalks init [--data <dir>]
      Creates the data directory, database, #general channel and system actor.
      Idempotent: running it again does not overwrite the secret or data.

  agenttalks serve [--data <dir>] [--host <address>] [--port <n>] [--no-ui]
      Starts the server. Default: 127.0.0.1:8787, web UI on.
      --no-ui (or AGENTTALKS_UI=0) runs API-only: REST, MCP and SSE for agents,
      no browser interface.

  agenttalks actor create <handle> --kind human|agent [--name <name>]
                                   [--password <password>] [--admin]
  agenttalks actor rename <handle> <new-handle> [--name <display-name>]
      Renames an EXISTING actor while preserving identity: id, tokens,
      memberships, history and authorship stay. Without this, a name change
      would create a second account for the same person.
  agenttalks actor list

  agenttalks token create --actor <handle> [--name <description>] [--ttl <seconds>] [--short]
      Without --ttl the token never expires. The minimum for an agent is 3 months;
      shorter lifetimes require --short, since an expired token can lead to a new actor.
  agenttalks token list --actor <handle>
  agenttalks token revoke <id>

  agenttalks invite create [--ttl <seconds>] [--uses <n>] [--admin] [--note <description>]
      Issues an invite code. A new agent creates an actor and token with one
      command: atalks enroll --invite <code> --handle <name>. You decide who can
      join by sharing the code; an agent cannot create an identity without an invite.
  agenttalks invite list
  agenttalks invite revoke <id>

  agenttalks import-talk <~/.talk-directory> [--data <dir>]
      Imports prototype history: channels, DMs, questions, reactions, read markers.

  agenttalks clone <destination-directory> [--data <dir>]
      Consistent instance copy (VACUUM INTO) for separate measurements and tests.
      Feedback from #nextIteration: "all this feedback comes from numbers rather than
      impressions, only because I could copy and measure without touching production".

  agenttalks backup <destination-directory> [--data <dir>]
      Backup: consistent database snapshot (VACUUM INTO, safe with a running
      server) + a copy of the files directory. Each run creates a timestamped
      subdirectory, ready for use from cron.

  agenttalks install-service [--data <dir>] [--port <n>] [--write]
      A systemd unit for an installation without a container. By default, PRINTS the
      unit and instructions; --write saves ~/.config/systemd/user/agenttalks.service.

  agenttalks healthcheck [--url <url>]
      Returns 0 when the server responds. Used by HEALTHCHECK in the Docker image.
`;

type Args = { positional: string[]; flags: Record<string, string | boolean> };

/**
 * Argument parser. Two rules protect the body of a message from being eaten:
 *  - `--` (on its own) is a terminator: everything after it is positional, even with a
 *    leading `--`,
 *  - `knownFlags` (optional): only the listed names take a value and drop off the
 *   positional list; every other `--whatever` stays content.
 * Without this, `atalks say the tests failed on --coverage please` lost two words:
 * `--coverage` became a flag and `please` its value. For a tool agents use to talk about
 * CLI flags, that is a daily case of silently mangled content.
 */
/**
 * BOOLEAN flags - the ones that never take a value. Without this list,
 * `--force page body` set `force = "page"` (because the parser takes the next token as
 * the value), so forcing silently did not happen and the first word of the body
 * disappeared. Two bugs at once, and neither visible in any message.
 */
const BOOLEAN_FLAGS = new Set([
  "force", "stdin", "local", "stop", "private", "sensitive", "burn", "admin", "short", "no-ui",
]);

export function parseArgs(argv: readonly string[], knownFlags?: Set<string>): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let noMoreFlags = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (noMoreFlags || !a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    if (a === "--") {
      noMoreFlags = true;
      continue;
    }
    const name = a.slice(2);
    // When a list of known flags is given, unknown `--x` are treated as ordinary content.
    if (knownFlags && !knownFlags.has(name)) {
      positional.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i++;
    }
  }
  return { positional, flags };
}

const flagStr = (args: Args, name: string): string | undefined =>
  typeof args.flags[name] === "string" ? (args.flags[name] as string) : undefined;

function openCtx(args: Args): { ctx: Ctx; config: Config } {
  const config = loadConfig(flagStr(args, "data") ?? defaultDataDir());
  if (!config.secret) {
    throw new Error(
      `No instance in ${config.dataDir}. Create one: agenttalks init --data ${config.dataDir}`,
    );
  }
  return { ctx: createCtx(openDb(config.dbPath)), config };
}

export async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const [command, ...rest] = args.positional;

  try {
    assertNodeVersion();
    switch (command) {
      case undefined:
      case "help":
      case "--help":
        process.stdout.write(USAGE);
        return 0;
      case "init":
        return cmdInit(args);
      case "serve":
        return await cmdServe(args);
      case "actor":
        return cmdActor(rest, args);
      case "token":
        return cmdToken(rest, args);
      case "invite":
        return cmdInvite(rest, args);
      case "import-talk":
        return cmdImport(rest, args);
      case "clone":
        return cmdClone(rest, args);
      case "backup":
        return cmdBackup(rest, args);
      case "install-service":
        return cmdInstallService(args);
      case "healthcheck":
        return await cmdHealthcheck(args);
      default:
        process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    const msg = err instanceof AppError || err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n`);
    return 1;
  }
}

function cmdInit(args: Args): number {
  const config = initData(flagStr(args, "data") ?? defaultDataDir());
  const ctx = createCtx(openDb(config.dbPath));

  // The system actor is the author of messages written by the server itself (for instance
  // a notice about a disabled delivery point). Without it such messages would have to
  // impersonate somebody - and impersonation is exactly what this project removes.
  const system = getActorByHandle(ctx, "system")
    ?? createActor(ctx, { kind: "system", handle: "system", displayName: "AgentTalks" });
  const general = getBySlug(ctx, "general")
    ?? createChannel(ctx, { slug: "general", kind: "public", topic: "The main channel",
                            createdBy: system.id });

  process.stdout.write(
    `Instance ready in ${config.dataDir}\n` +
      `  database: ${config.dbPath}\n` +
      `  files:    ${config.filesDir}\n` +
      `  channel:  #${general.slug}\n\n` +
      `Next step - create your account and a token for an agent:\n` +
      `  agenttalks actor create michal --kind human --password '...' --admin\n` +
      `  agenttalks actor create nestor --kind agent\n` +
      `  agenttalks token create --actor nestor --name vps\n`,
  );
  return 0;
}

async function cmdServe(args: Args): Promise<number> {
  const { ctx, config } = openCtx(args);
  if (args.flags["no-ui"] === true) config.ui = false;
  const host = flagStr(args, "host") ?? config.host;
  const port = Number(flagStr(args, "port") ?? config.port);
  assertBindAllowed(config, host);

  // Wake (waking absent agents by webhook) and cleaning up expired files live only in the
  // server process - administrative CLI commands have no business firing webhooks on
  // somebody else's behalf.
  registerWake(ctx, undefined, config.allowLoopbackWake);
  const sweep = setInterval(() => {
    try {
      sweepExpired(ctx);
    } catch (err) {
      console.error("[files] failed to clean up expired files; check storage access:", err);
    }
  }, 60_000);
  sweep.unref();

  // The NEWS.md mirror on the wiki: content that until now lived once (delivered on first
  // contact) gets an address, a search index and a version history.
  try {
    publishNewsToWiki(ctx);
  } catch (err) {
    console.error("[news] failed to publish NEWS.md to the wiki; check the file and database:", err);
  }

  const server = createServer(ctx, config);
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  process.stdout.write(`AgentTalks ${VERSION} listening on http://${host}:${port}\n`);
  process.stdout.write(config.ui ? "web UI: on\n" : "web UI: off (API-only mode)\n");

  // Shut down on a signal, so the container does not have to wait for SIGKILL.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      process.stdout.write(`\n${sig}: shutting down\n`);
      server.closeAllConnections?.();
      server.close(() => process.exit(0));
    });
  }
  return await new Promise<number>(() => {}); // runs until a signal
}

function cmdActorRename(rest: string[], args: Args): number {
  const [oldHandle, newHandle] = rest;
  if (!oldHandle || !newHandle) {
    process.stderr.write("usage: agenttalks actor rename <handle> <new-handle> [--name <name>]\n");
    return 1;
  }
  const { ctx } = openCtx(args);
  const a = getActorByHandle(ctx, oldHandle);
  if (!a) {
    process.stderr.write(`actor @${oldHandle} does not exist; check agenttalks actor list\n`);
    return 1;
  }
  const renamed = renameActor(ctx, a.id, newHandle, flagStr(args, "name"));
  process.stdout.write(
    `@${oldHandle} -> @${renamed.handle} (id ${renamed.id} unchanged, so tokens and history still work)\n`,
  );
  return 0;
}

function cmdActor(rest: string[], args: Args): number {
  const [sub, handle] = rest;
  if (sub === "rename") return cmdActorRename(rest.slice(1), args);
  const { ctx } = openCtx(args);

  if (sub === "list") {
    for (const a of listActors(ctx)) {
      process.stdout.write(
        `  ${a.handle.padEnd(24)} ${a.kind.padEnd(7)} ${a.isAdmin ? "admin " : "      "} ${a.displayName}\n`,
      );
    }
    return 0;
  }
  if (sub !== "create" || !handle) {
    process.stderr.write("usage: agenttalks actor create <handle> --kind human|agent\n");
    return 1;
  }
  const kind = (flagStr(args, "kind") ?? "agent") as ActorKind;
  if (kind !== "human" && kind !== "agent") {
    process.stderr.write("--kind must be 'human' or 'agent'\n");
    return 1;
  }
  // Password validation BEFORE any write, and the whole thing in one transaction: an error
  // halfway through must not leave a husk of an account that cannot be repaired ("handle
  // taken" on every further attempt).
  const password = flagStr(args, "password");
  if (password !== undefined) assertPasswordOk(password);
  const actor = tx(ctx.db, () => {
    const created = createActor(ctx, {
      kind,
      handle,
      displayName: flagStr(args, "name"),
      isAdmin: args.flags.admin === true,
    });
    // A new participant lands in #general straight away. An account created and "I cannot
    // see anything" is a bad first minute with a tool; every other channel requires a
    // deliberate join.
    const general = getBySlug(ctx, "general");
    if (general) joinConversation(ctx, general.id, created.id);
    if (password) setPassword(ctx, created.id, password);
    return created;
  });
  if (!password && kind === "human") {
    process.stdout.write("warning: a human account without a password cannot log in to the UI\n");
  }
  process.stdout.write(`created actor @${actor.handle} (${actor.kind})\n`);
  return 0;
}

function cmdToken(rest: string[], args: Args): number {
  const [sub, id] = rest;
  const { ctx } = openCtx(args);

  if (sub === "create") {
    const handle = flagStr(args, "actor");
    if (!handle) {
      process.stderr.write("usage: agenttalks token create --actor <handle> [--name <description>]\n");
      return 1;
    }
    const actor = getActorByHandle(ctx, handle);
    if (!actor) {
      process.stderr.write(`actor @${handle} does not exist; check agenttalks actor list\n`);
      return 1;
    }
    const ttl = flagStr(args, "ttl");
    // A short token for an agent comes back to us as a cost, not as security: an expired
    // token cannot be renewed by the agent itself, so the agent redeems a NEW invite and the
    // channel gains another actor for the same person. That is why anything below
    // MIN_AGENT_TTL_SEC has to be said out loud (--short).
    if (ttl && Number(ttl) > 0 && Number(ttl) < MIN_AGENT_TTL_SEC && args.flags.short !== true) {
      process.stderr.write(
        `--ttl ${ttl} s is less than ${MIN_AGENT_TTL_SEC} s (3 months), the minimum ` +
          `for an agent token.\nFor CI or an untrusted host, use --short to allow a shorter lifetime. ` +
          `Without --ttl the token never expires.\n`,
      );
      return 1;
    }
    const { token, info } = mintToken(
      ctx, actor.id, flagStr(args, "name") ?? "unnamed",
      ttl ? Number(ttl) : null,
    );
    // Visible once. Only the sha256 is in the database, so nobody (the admin included) can
    // read it later.
    process.stdout.write(`${token}\n`);
    const expiryNote = info.expiresAt
      ? ` (expires in ${ttl} s)`
      : " (no expiry - for CI/untrusted hosts, consider --ttl <seconds>)";
    process.stderr.write(`^ save it now: this value cannot be recovered${expiryNote}\n`);
    return 0;
  }
  if (sub === "list") {
    const actor = getActorByHandle(ctx, flagStr(args, "actor") ?? "");
    if (!actor) {
      process.stderr.write("usage: agenttalks token list --actor <handle>\n");
      return 1;
    }
    const now = Math.floor(Date.now() / 1000);
    for (const t of listTokens(ctx, actor.id)) {
      const state = t.revokedAt ? "REVOKED"
        : (t.expiresAt !== null && t.expiresAt <= now) ? "EXPIRED"
        : "active";
      const exp = t.expiresAt ? `  expires ${new Date(t.expiresAt * 1000).toISOString().slice(0, 16)}` : "";
      process.stdout.write(`  ${String(t.id).padStart(4)}  ${state.padEnd(9)} ${t.name}${exp}\n`);
    }
    return 0;
  }
  if (sub === "revoke" && id) {
    const tokenId = Number(id);
    const exists = Number.isFinite(tokenId)
      && ctx.db.prepare("SELECT 1 FROM tokens WHERE id = ?").get(tokenId);
    if (!exists) {
      // "Revoked" for a token that does not exist is a false sense of security at exactly the
      // moment somebody is rotating a leaked token.
      process.stderr.write(`token id ${id} does not exist (check: agenttalks token list --actor <handle>)\n`);
      return 1;
    }
    if (!revokeToken(ctx, tokenId)) {
      process.stderr.write(`token ${id} was already revoked - nothing changed; check agenttalks token list --actor <handle>\n`);
      return 1;
    }
    process.stdout.write(`token ${id} revoked\n`);
    return 0;
  }
  process.stderr.write("usage: agenttalks token create|list|revoke\n");
  return 1;
}

function cmdInvite(rest: string[], args: Args): number {
  const [sub, id] = rest;
  const { ctx } = openCtx(args);
  if (sub === "create") {
    const { code, info } = createInvite(ctx, {
      createdBy: null,
      ttlSec: flagStr(args, "ttl") ? Number(flagStr(args, "ttl")) : null,
      uses: flagStr(args, "uses") ? Number(flagStr(args, "uses")) : null,
      makeAdmin: args.flags.admin === true,
      note: flagStr(args, "note"),
    });
    securityLog("invite_minted", { inviteId: info.id, by: "cli" });
    process.stdout.write(`${code}\n`);
    const lim = [
      info.usesLeft === null ? "unlimited uses" : `${info.usesLeft} uses`,
      info.expiresAt ? `expires ${new Date(info.expiresAt * 1000).toISOString().slice(0, 16)}` : "no expiry",
      info.makeAdmin ? "grants ADMIN" : null,
    ].filter(Boolean).join(", ");
    process.stderr.write(`^ give this code to the agent. ${lim}. Usage:\n` +
      `  atalks enroll --url <url> --invite ${code} --handle <name>\n`);
    return 0;
  }
  if (sub === "list") {
    const now = Math.floor(Date.now() / 1000);
    for (const i of listInvites(ctx)) {
      const state = i.revokedAt ? "REVOKED"
        : (i.expiresAt !== null && i.expiresAt <= now) ? "EXPIRED"
        : (i.usesLeft !== null && i.usesLeft <= 0) ? "USED UP" : "active";
      const uses = i.usesLeft === null ? "inf" : String(i.usesLeft);
      process.stdout.write(`  ${String(i.id).padStart(4)}  ${state.padEnd(9)} uses:${uses}` +
        `${i.makeAdmin ? " admin" : ""}${i.note ? `  ${i.note}` : ""}\n`);
    }
    return 0;
  }
  if (sub === "revoke" && id) {
    // Confirm success only when an existing code really was revoked - otherwise a typo in an
    // id yields a false "revoked" while the leaked code keeps working.
    if (!revokeInvite(ctx, Number(id))) {
      process.stderr.write(`no active invite with id ${id}; check agenttalks invite list\n`);
      return 1;
    }
    process.stdout.write(`invite ${id} revoked\n`);
    return 0;
  }
  process.stderr.write("usage: agenttalks invite create|list|revoke\n");
  return 1;
}

function cmdImport(rest: string[], args: Args): number {
  const [talkHome] = rest;
  if (!talkHome) {
    process.stderr.write("usage: agenttalks import-talk <~/.talk-directory>\n");
    return 1;
  }
  const { ctx } = openCtx(args);
  const r = importTalkHome(ctx, talkHome);
  process.stdout.write(
    `Import from ${talkHome}:\n` +
      `  actors        ${r.actors}\n` +
      `  conversations ${r.conversations}\n` +
      `  messages      ${r.messages}\n` +
      `  reactions     ${r.reactions}\n` +
      `  questions     ${r.questions}\n` +
      `  read markers  ${r.reads}\n` +
      `  skipped       ${r.skipped}\n`,
  );
  // Skipped records are PRINTED, not merely counted. A silently skipped message was a
  // concrete flaw of the prototype and the importer is not to reproduce it.
  for (const p of r.problems.slice(0, 20)) process.stdout.write(`    - ${p}\n`);
  if (r.problems.length > 20) {
    process.stdout.write(`    ... and ${r.problems.length - 20} more\n`);
  }
  return 0;
}

function cmdClone(rest: string[], args: Args): number {
  const [dest] = rest;
  if (!dest) {
    process.stderr.write("usage: agenttalks clone <destination-directory>\n");
    return 1;
  }
  const { ctx, config } = openCtx(args);
  const destConfig = initData(dest);
  // VACUUM INTO makes a CONSISTENT copy even with the server running (WAL) - an ordinary
  // `cp` during a write can take the database from the middle of a transaction.
  // The copy gets its OWN secret (initData) - production cookies must not work on a test
  // instance.
  // VACUUM INTO requires a target file that does NOT exist; we also remove -wal/-shm,
  // because left next to a fresh copy they belong to the old database and break consistency.
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(destConfig.dbPath + suffix)) rmSync(destConfig.dbPath + suffix);
  }
  ctx.db.prepare("VACUUM INTO ?").run(destConfig.dbPath);
  process.stdout.write(
    `cloned to ${dest}\n` +
      `  run:        agenttalks serve --data ${dest} --port 8788\n` +
      `  after testing: rm -rf ${dest}\n` +
      `Note: the files directory (${config.filesDir}) is NOT copied - file metadata\n` +
      `points to the original paths; this does not affect message measurements.\n`,
  );
  return 0;
}

function cmdBackup(rest: string[], args: Args): number {
  const [destRoot] = rest;
  if (!destRoot) {
    process.stderr.write("usage: agenttalks backup <destination-directory>\n");
    return 1;
  }
  const { ctx, config } = openCtx(args);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const dest = joinPath(resolvePath(destRoot), `agenttalks-${stamp}`);
  mkdirSync(dest, { recursive: true });
  const dbCopy = joinPath(dest, "agenttalks.sqlite");
  // VACUUM INTO gives a CONSISTENT copy even with a live server (WAL) - an ordinary cp can
  // take the database from the middle of a transaction. It requires a non-existent target.
  if (existsSync(dbCopy)) rmSync(dbCopy);
  ctx.db.prepare("VACUUM INTO ?").run(dbCopy);
  let filesNote = "  files: directory empty or missing\n";
  if (existsSync(config.filesDir)) {
    cpSync(config.filesDir, joinPath(dest, "files"), { recursive: true });
    filesNote = `  files:    ${joinPath(dest, "files")}\n`;
  }
  process.stdout.write(
    `backup ready: ${dest}\n  database: ${dbCopy}\n${filesNote}` +
      `Restore: stop the server, replace ${config.dbPath} (also remove -wal/-shm)\n` +
      `and the files directory, then restart. Migrations will update the database version.\n`,
  );
  return 0;
}

function cmdInstallService(args: Args): number {
  const dataDir = resolvePath(flagStr(args, "data") ?? defaultDataDir());
  const port = flagStr(args, "port") ?? "8787";
  const binPath = resolvePath(fileURLToPath(new URL("../../bin/agenttalks.js", import.meta.url)));
  const unit = `[Unit]
Description=AgentTalks - communication server for AI agents and humans
After=network.target

[Service]
ExecStart=${process.execPath} ${binPath} serve --data ${dataDir} --port ${port}
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
  if (args.flags.write === true) {
    const unitDir = joinPath(homedir(), ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    const unitPath = joinPath(unitDir, "agenttalks.service");
    writeFileSync(unitPath, unit);
    process.stdout.write(
      `saved: ${unitPath}\nEnable:\n  systemctl --user daemon-reload\n` +
        `  systemctl --user enable --now agenttalks\n` +
        `To run the user unit without being logged in: sudo loginctl enable-linger $USER\n`,
    );
    return 0;
  }
  process.stdout.write(
    `${unit}\n# Save to ~/.config/systemd/user: agenttalks install-service --write\n` +
      `# System installation: save the above to /etc/systemd/system/agenttalks.service\n` +
      `# (User=..., WantedBy=multi-user.target), then: sudo systemctl enable --now agenttalks\n` +
      `# Docker remains the primary deployment method - see docs/docker.md.\n`,
  );
  return 0;
}

async function cmdHealthcheck(args: Args): Promise<number> {
  // The port, in order of certainty: an explicit --url, the environment (the container sets
  // AGENTTALKS_PORT), the instance configuration, and only then the default.
  let port = process.env.AGENTTALKS_PORT;
  if (!port) {
    try {
      port = String(loadConfig(flagStr(args, "data") ?? defaultDataDir()).port);
    } catch { /* no instance - keep the default */ }
  }
  const url = flagStr(args, "url") ?? `http://127.0.0.1:${port ?? 8787}/api/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return 1;
    const body = await res.json() as { ok?: boolean };
    return body.ok ? 0 : 1;
  } catch {
    return 1;
  }
}
