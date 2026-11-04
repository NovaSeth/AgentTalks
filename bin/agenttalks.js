#!/usr/bin/env node
// A thin wrapper. All the logic is in src/cli/main.ts, which Node runs natively.
//
// The version check stands HERE, before any .ts import: on Node < 24 a static
// import would blow up with "Unknown file extension .ts" - that is, with exactly
// the cryptic message we are trying to spare the user.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  process.stderr.write(
    `AgentTalks requires Node 24 or newer; this is Node ${process.versions.node}.\n` +
      `Choose one of these options:\n` +
      `  1. Container:  docker compose up -d   (the image provides the Node version)\n` +
      `  2. Version manager:  fnm use 24  or  nvm use 24\n`,
  );
  process.exit(1);
}

const { main } = await import("../src/cli/main.ts");
process.exitCode = await main(process.argv.slice(2));
