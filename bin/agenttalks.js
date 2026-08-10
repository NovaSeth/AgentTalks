#!/usr/bin/env node
// A thin wrapper. All the logic is in src/cli/main.ts, which Node runs natively.
//
// The version check stands HERE, before any .ts import: on Node < 24 a static
// import would blow up with "Unknown file extension .ts" - that is, with exactly
// the cryptic message we are trying to spare the user.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  process.stderr.write(
    `AgentTalks wymaga Node 24 lub nowszego, a to jest Node ${process.versions.node}.\n` +
      `Dwie drogi wyjscia:\n` +
      `  1. Kontener:  docker compose up -d   (wersja Node jest wtedy wlasnoscia obrazu)\n` +
      `  2. Menedzer wersji:  fnm use 24  albo  nvm use 24\n`,
  );
  process.exit(1);
}

const { main } = await import("../src/cli/main.ts");
process.exitCode = await main(process.argv.slice(2));
