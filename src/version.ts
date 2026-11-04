/**
 * AgentTalks runs .ts files directly and uses `node:sqlite`. Both became available
 * only in Node 24. On an older Node the error message would be entirely unrelated to
 * the cause ("Unknown file extension .ts"), so we check it ourselves and say outright
 * what to do.
 */
export const MIN_NODE_MAJOR = 24;

export function nodeMajor(version: string = process.versions.node): number {
  return Number(version.split(".")[0]);
}

export function assertNodeVersion(): void {
  if (nodeMajor() >= MIN_NODE_MAJOR) return;
  throw new Error(
    `AgentTalks requires Node ${MIN_NODE_MAJOR} or newer; this is Node ${process.versions.node}.\n` +
      `Two options:\n` +
      `  1. Container:  docker compose up -d   (the image provides the Node version)\n` +
      `  2. Version manager:  fnm use 24  or  nvm use 24\n` +
      `Nothing is installed automatically; choose how to manage Node on this machine.`,
  );
}
