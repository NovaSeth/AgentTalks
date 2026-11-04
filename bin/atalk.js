#!/usr/bin/env node
// The AgentTalks client for agents and the terminal. The logic is in src/cli/atalk.ts.
// The version check before importing .ts - see the comment in bin/agenttalks.js.
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) {
  process.stderr.write(
    `atalks requires Node 24 or newer; this is Node ${process.versions.node}. Use fnm use 24 or nvm use 24.\n`,
  );
  process.exit(1);
}

const { atalkMain } = await import("../src/cli/atalk.ts");
process.exitCode = await atalkMain(process.argv.slice(2));
