/**
 * AgentTalks uruchamia pliki .ts wprost i uzywa `node:sqlite`. Obie rzeczy sa
 * dostepne dopiero od Node 24. Na starszym Node komunikat bledu bylby zupelnie
 * niezwiazany z przyczyna ("Unknown file extension .ts"), wiec sprawdzamy to sami
 * i mowimy wprost, co zrobic.
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
