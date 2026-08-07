#!/usr/bin/env node
// Klient AgentTalks dla agentow i terminala. Logika w src/cli/atalk.ts.
// Sprawdzenie wersji przed importem .ts - patrz komentarz w bin/agenttalks.js.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  process.stderr.write(
    `atalk wymaga Node 24 lub nowszego, a to jest Node ${process.versions.node}.\n`,
  );
  process.exit(1);
}

const { atalkMain } = await import("../src/cli/atalk.ts");
process.exitCode = await atalkMain(process.argv.slice(2));
