import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
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

test("clone robi spojna kopie z wlasnym sekretem", async () => {
  const src = tmpDir(), dst = tmpDir() + "/kopia";
  await main(["init", "--data", src]);
  await main(["actor", "create", "probny", "--kind", "agent", "--data", src]);
  assert.equal(await main(["clone", dst, "--data", src]), 0);
  const srcCfg = loadConfig(src), dstCfg = loadConfig(dst);
  assert.notEqual(dstCfg.secret, srcCfg.secret, "kopia nie moze dzielic sekretu sesji");
  const ctx = createCtx(openDb(dstCfg.dbPath));
  assert.ok(getActorByHandle(ctx, "probny"), "dane nie przeszly do kopii");
});

test("parseArgs z lista znanych flag nie zjada tresci z --", () => {
  const a = parseArgs(["say", "testy", "padly", "na", "--coverage", "prosze", "sprawdz"],
    new Set(["to", "url"]));
  assert.deepEqual(a.positional,
    ["say", "testy", "padly", "na", "--coverage", "prosze", "sprawdz"]);
});

test("parseArgs terminator -- przenosi reszte do positional", () => {
  const a = parseArgs(["say", "--", "--to", "@kto"], new Set(["to"]));
  assert.deepEqual(a.positional, ["say", "--to", "@kto"]);
});

test("parseArgs bez listy nadal parsuje znane flagi", () => {
  const a = parseArgs(["claim", "deploy", "--ttl", "300"]);
  assert.deepEqual(a.positional, ["claim", "deploy"]);
  assert.equal(a.flags.ttl, "300");
});

test("haslo bramki z pliku: wartosc z pliku wygrywa, pusty/brakujacy plik nie wpuszcza cicho", () => {
  const dir = tmpDir();
  initData(dir);
  const pwPath = join(dir, "site-password");
  writeFileSync(pwPath, "tajne-haslo-bramki\n", { mode: 0o600 });
  const prev = process.env.AGENTTALKS_SITE_PASSWORD_FILE;
  const prevEnv = process.env.AGENTTALKS_SITE_PASSWORD;
  try {
    process.env.AGENTTALKS_SITE_PASSWORD_FILE = pwPath;
    // A trailing newline belongs to writing the file, not to the password.
    assert.equal(loadConfig(dir).sitePassword, "tajne-haslo-bramki");
    // The file takes precedence over the environment - this is the path we want to promote.
    process.env.AGENTTALKS_SITE_PASSWORD = "z-env";
    assert.equal(loadConfig(dir).sitePassword, "tajne-haslo-bramki");
    // An empty file is not "no password" but an OPEN gate - hence the refusal to start.
    writeFileSync(pwPath, "", { mode: 0o600 });
    assert.throws(() => loadConfig(dir), /pusty/);
    // A missing file likewise: silent emptiness would be a failure nobody sees.
    process.env.AGENTTALKS_SITE_PASSWORD_FILE = join(dir, "nie-ma-takiego");
    assert.throws(() => loadConfig(dir), /nie da sie odczytac/);
  } finally {
    if (prev === undefined) delete process.env.AGENTTALKS_SITE_PASSWORD_FILE;
    else process.env.AGENTTALKS_SITE_PASSWORD_FILE = prev;
    if (prevEnv === undefined) delete process.env.AGENTTALKS_SITE_PASSWORD;
    else process.env.AGENTTALKS_SITE_PASSWORD = prevEnv;
  }
});

test("NEWS.md ląduje na wiki jako strona z historią, ale nie dokłada rewizji bez zmian", async () => {
  const { publishNewsToWiki, NEWS_SLUG } = await import("../../src/core/news.ts");
  const { getPage, pageHistory } = await import("../../src/core/wiki.ts");
  const dir = tmpDir();
  initData(dir);
  const { openDb: open } = await import("../../src/store/db.ts");
  const { createCtx: mk } = await import("../../src/core/ctx.ts");
  const ctx = mk(open(join(dir, "agenttalks.sqlite")));
  const { createActor } = await import("../../src/core/actors.ts");
  createActor(ctx, { kind: "system", handle: "system" });

  assert.equal(publishNewsToWiki(ctx), "zapisane");
  const page = getPage(ctx, NEWS_SLUG)!;
  assert.match(page.body, /What's new in AgentTalks/);
  assert.equal(page.updatedBy, "system");
  // A server restart must not produce "no change" revisions - otherwise the page's history would
  // be about deployments rather than about content.
  assert.equal(publishNewsToWiki(ctx), "bez_zmian");
  assert.equal(pageHistory(ctx, NEWS_SLUG).length, 1);
});
