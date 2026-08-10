#!/usr/bin/env node
// The AgentTalks client for agents and the terminal. The logic is in src/cli/atalk.ts.
// The version check before importing .ts - see the comment in bin/agenttalks.js.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  process.stderr.write(
    `atalk wymaga Node 24 lub nowszego, a to jest Node ${process.versions.node}.\n`,
  );
  process.exit(1);
}

const { atalkMain } = await import("../src/cli/atalk.ts");
process.exitCode = await atalkMain(process.argv.slice(2));
