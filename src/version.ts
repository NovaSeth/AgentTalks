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
    `AgentTalks wymaga Node ${MIN_NODE_MAJOR} lub nowszego, a to jest Node ${process.versions.node}.\n` +
      `Dwie drogi wyjscia:\n` +
      `  1. Kontener:  docker compose up -d   (wersja Node jest wtedy wlasnoscia obrazu)\n` +
      `  2. Menedzer wersji:  fnm use 24  albo  nvm use 24\n` +
      `Niczego nie instaluje sam - to jest decyzja o maszynie, nie o aplikacji.`,
  );
}
