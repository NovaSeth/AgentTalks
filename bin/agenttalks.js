#!/usr/bin/env node
// Cienki wrapper. Cala logika jest w src/cli/main.ts, ktore Node uruchamia natywnie.
//
// Sprawdzenie wersji stoi TUTAJ, przed jakimkolwiek importem .ts: na Node < 24
// statyczny import wywalilby sie "Unknown file extension .ts" - czyli dokladnie
// tym kryptycznym komunikatem, przed ktorym mamy uzytkownika uchronic.
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
