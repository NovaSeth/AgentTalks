import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertBindAllowed, defaultDataDir, inContainer, initData, loadConfig }
  from "../../src/config.ts";
import { openDb } from "../../src/store/db.ts";
import { createCtx } from "../../src/core/ctx.ts";
import { getActorByHandle } from "../../src/core/actors.ts";
import { getBySlug } from "../../src/core/conversations.ts";
import { main, parseArgs } from "../../src/cli/main.ts";
import { nodeMajor } from "../../src/version.ts";

const tmpDir = () => mkdtempSync(join(tmpdir(), "agenttalks-"));

test("parseArgs rozdziela pozycyjne i flagi, w tym flagi bez wartosci", () => {
  const a = parseArgs(["actor", "create", "michal", "--kind", "human", "--admin"]);
  assert.deepEqual(a.positional, ["actor", "create", "michal"]);
  assert.equal(a.flags.kind, "human");
  assert.equal(a.flags.admin, true);
});

test("init tworzy katalog danych, baze i sekret o dlugosci 64 znakow", () => {
  const dir = tmpDir();
  const cfg = initData(dir);
  assert.equal(cfg.secret.length, 64);
  assert.ok(existsSync(join(dir, "agenttalks.sqlite")) === false, "baza powstaje przy init CLI");
  assert.ok(existsSync(join(dir, "agenttalks.json")));
  assert.ok(existsSync(join(dir, "files")));
});

test("init nie nadpisuje sekretu istniejacej instancji", () => {
  const dir = tmpDir();
  const first = initData(dir);
  assert.equal(initData(dir).secret, first.secret);
});

test("plik konfiguracji ma prawa 600", () => {
  const dir = tmpDir();
  initData(dir);
  assert.equal(statSync(join(dir, "agenttalks.json")).mode & 0o777, 0o600);
});

test("komenda init zaklada kanal general i aktora systemowego", async () => {
  const dir = tmpDir();
  assert.equal(await main(["init", "--data", dir]), 0);
  const cfg = loadConfig(dir);
  const ctx = createCtx(openDb(cfg.dbPath));
  assert.ok(getBySlug(ctx, "general"));
  assert.equal(getActorByHandle(ctx, "system")?.kind, "system");
});

test("komenda init jest idempotentna", async () => {
  const dir = tmpDir();
  await main(["init", "--data", dir]);
  assert.equal(await main(["init", "--data", dir]), 0);
});

test("komendy na nieistniejacej instancji mowia, co zrobic", async () => {
  const dir = tmpDir();
  assert.equal(await main(["actor", "list", "--data", dir]), 1);
});

test("aktor i token przechodza przez CLI", async () => {
  const dir = tmpDir();
  await main(["init", "--data", dir]);
  assert.equal(await main(["actor", "create", "nestor", "--kind", "agent", "--data", dir]), 0);
  assert.equal(await main(["token", "create", "--actor", "nestor", "--name", "vps",
                           "--data", dir]), 0);
  const ctx = createCtx(openDb(loadConfig(dir).dbPath));
  const nestor = getActorByHandle(ctx, "nestor")!;
  const n = ctx.db.prepare("SELECT count(*) AS n FROM tokens WHERE actor_id = ?")
    .get(nestor.id) as { n: number };
  assert.equal(n.n, 1);
});

test("token dla nieistniejacego aktora konczy sie kodem 1, nie wyjatkiem", async () => {
  const dir = tmpDir();
  await main(["init", "--data", dir]);
  assert.equal(await main(["token", "create", "--actor", "kogo-nie-ma", "--data", dir]), 1);
});

test("poza kontenerem bind na 0.0.0.0 jest zablokowany", async () => {
  const dir = tmpDir();
  await main(["init", "--data", dir]);
  delete process.env.AGENTTALKS_IN_CONTAINER;
  assert.equal(await main(["serve", "--data", dir, "--host", "0.0.0.0"]), 1);
});

test("w kontenerze bind na 0.0.0.0 jest dozwolony", () => {
  const dir = tmpDir();
  const cfg = initData(dir);
  process.env.AGENTTALKS_IN_CONTAINER = "1";
  try {
    assert.equal(inContainer(), true);
    assert.doesNotThrow(() => assertBindAllowed(cfg, "0.0.0.0"));
  } finally {
    delete process.env.AGENTTALKS_IN_CONTAINER;
  }
});

test("bind na petli zwrotnej zawsze przechodzi", () => {
  const dir = tmpDir();
  const cfg = initData(dir);
  assert.doesNotThrow(() => assertBindAllowed(cfg, "127.0.0.1"));
});

test("AGENTTALKS_DATA wskazuje katalog danych", () => {
  process.env.AGENTTALKS_DATA = "/tmp/agenttalks-z-env";
  try {
    assert.equal(defaultDataDir(), "/tmp/agenttalks-z-env");
  } finally {
    delete process.env.AGENTTALKS_DATA;
  }
});

test("healthcheck zwraca 1, gdy serwer nie odpowiada", async () => {
  assert.equal(await main(["healthcheck", "--url", "http://127.0.0.1:1/api/health"]), 1);
});

test("wymagana wersja Node jest sprawdzana z majora", () => {
  assert.equal(nodeMajor("24.1.0"), 24);
  assert.equal(nodeMajor("18.20.1"), 18);
});
