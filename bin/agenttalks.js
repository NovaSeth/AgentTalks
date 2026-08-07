#!/usr/bin/env node
// Cienki wrapper. Cala logika jest w src/cli/main.ts, ktore Node uruchamia natywnie
// (od wersji 24). Ten plik istnieje tylko po to, zeby `npm i -g` mial co wskazac
// w polu "bin" i zeby shebang byl w pliku .js, ktory npm oznaczy jako wykonywalny.
import { main } from "../src/cli/main.ts";

process.exitCode = await main(process.argv.slice(2));
