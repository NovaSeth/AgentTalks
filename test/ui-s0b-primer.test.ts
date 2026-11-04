/**
 * S0b (T-MG-3, D-MG-18): the visual layer is the Primer design system, vendored as static
 * files, with no runtime npm dependency and no build step.
 *
 * Checked here, each as a sensor for a failure that would otherwise be invisible:
 *  1. app.css carries no raw color outside comments - every color is a Primer token.
 *  2. The vendored files have their MIT licences and a VERSIONS.md whose sha256 digests match
 *     the files on disk (a silently edited vendored file is the thing this catches).
 *  3. Every icon in icons.js is an Octicon: its path data equals a vendored 16 px SVG.
 *  4. The server serves the vendored CSS/SVG with the right content types and nothing else
 *     under /vendor/.
 *  5. The shell declares Primer's color-mode attributes, and theme.js keeps them in step.
 *  6. The brand guard: no GitHub or Slack name in UI copy, code or assets (vendor excluded).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { startTestServer } from "./http-helpers.ts";

const UI_ROOT = fileURLToPath(new URL("../src/http/ui/", import.meta.url));
const UI = UI_ROOT + "js/";
const VENDOR = UI_ROOT + "vendor/primer/";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

/** CSS with every comment removed - the acceptance grep runs on the code, not the prose. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("S0b-1: app.css has no raw hex/rgb/hsl color outside comments", () => {
  const css = stripComments(readFileSync(UI_ROOT + "app.css", "utf8"));
  const hits = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => {
    const line = css.slice(0, m.index).split("\n").length;
    return `line ~${line}: ${css.slice(m.index, (m.index ?? 0) + 40).split("\n")[0]}`;
  });
  assert.deepEqual(hits, [], `raw colors in app.css:\n${hits.join("\n")}`);
});

test("S0b-4: the vendored files carry MIT licences and VERSIONS.md with matching sha256", () => {
  const files = walk(VENDOR).map((p) => relative(VENDOR, p));
  const licences = files.filter((f) => /LICENSE/.test(f));
  assert.ok(licences.length >= 3, `expected a LICENSE per package; found ${licences.join(", ")}`);
  for (const l of licences) assert.match(readFileSync(VENDOR + l, "utf8"), /MIT License/);

  const versions = readFileSync(VENDOR + "VERSIONS.md", "utf8");
  for (const pkg of ["@primer/primitives 11.10.0", "@primer/css 22.3.3", "@primer/octicons 19.42.0"]) {
    assert.ok(versions.includes(pkg), `VERSIONS.md does not pin ${pkg}`);
  }
  const listed = new Map<string, string>();
  for (const m of versions.matchAll(/^\| `([^`]+)` \| ([0-9a-f]{64}) \|/gm)) listed.set(m[1], m[2]);
  const content = files.filter((f) => f !== "VERSIONS.md");
  assert.ok(content.length >= 10, `only ${content.length} vendored files; the directory moved?`);
  const problems: string[] = [];
  for (const f of content) {
    const digest = createHash("sha256").update(readFileSync(VENDOR + f)).digest("hex");
    const want = listed.get(f);
    if (!want) problems.push(`${f}: not listed in VERSIONS.md`);
    else if (want !== digest) problems.push(`${f}: sha256 differs from VERSIONS.md`);
  }
  for (const f of listed.keys()) if (!content.includes(f)) problems.push(`${f}: listed but missing on disk`);
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("S0b-3: every icon in icons.js is a vendored Octicon (16 px), decorative by default", async () => {
  const svgDir = VENDOR + "octicons/";
  const paths = new Map<string, string>();
  for (const f of readdirSync(svgDir).filter((n) => n.endsWith(".svg"))) {
    const svg = readFileSync(svgDir + f, "utf8");
    for (const m of svg.matchAll(/ d="([^"]+)"/g)) paths.set(m[1], f);
  }
  assert.ok(paths.size >= 20, `only ${paths.size} octicon paths vendored`);

  const icons = await import(UI + "icons.js");
  const names = Object.keys(icons).filter((k) => k.startsWith("icon") && typeof icons[k] === "function");
  assert.ok(names.length >= 25, `only ${names.length} icon functions exported; callers would break`);
  const problems: string[] = [];
  for (const name of names) {
    const html: string = icons[name]();
    const ds = [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    if (ds.length === 0) problems.push(`${name}: no path data`);
    for (const d of ds) if (!paths.has(d)) problems.push(`${name}: path is not a vendored Octicon`);
    if (!/viewBox="0 0 16 16"/.test(html)) problems.push(`${name}: not the 16 px set`);
    if (!/aria-hidden="true"/.test(html)) problems.push(`${name}: missing aria-hidden`);
    if (!/class="octicon/.test(html)) problems.push(`${name}: missing the octicon class`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("S0b-4b: the server serves vendored CSS and SVG and nothing else under /vendor/", async () => {
  const s = await startTestServer();
  try {
    const css = await fetch(`${s.url}/vendor/primer/primitives/light.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.equal(css.headers.get("cache-control"), "no-cache");
    const svg = await fetch(`${s.url}/vendor/primer/octicons/check-16.svg`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-type") ?? "", /image\/svg\+xml/);
    for (const p of ["/vendor/primer/VERSIONS.md", "/vendor/primer/LICENSE", "/vendor/primer/css/LICENSE",
      "/vendor/primer/primitives/nope.css", "/vendor/primer/../app.css", "/vendor/x.css"]) {
      const r = await fetch(`${s.url}${p}`);
      assert.equal(r.status, 404, `${p} must not be served`);
    }
    // The shell links the vendored CSS before app.css, stamped like every other asset.
    const html = await (await fetch(`${s.url}/`)).text();
    assert.match(html, /<html[^>]*data-color-mode="auto"[^>]*data-light-theme="light"[^>]*data-dark-theme="dark"/);
    const first = html.indexOf("/vendor/primer/primitives/light.css?v=");
    assert.ok(first >= 0, "shell does not link the stamped light theme");
    assert.ok(html.includes("/vendor/primer/primitives/dark.css?v="), "shell does not link the dark theme");
    assert.ok(first < html.indexOf("/app.css?v="), "vendored CSS must load before app.css");
  } finally { await s.close(); }
});

test("S0b-2: theme.js maps Auto/Light/Dark onto the Primer attributes", async () => {
  const theme = await import(UI + "theme.js");
  assert.deepEqual(theme.THEMES, ["auto", "light", "dark"]);
  const attrs: Record<string, string> = {};
  const root = { setAttribute(k: string, v: string) { attrs[k] = v; } };
  theme.applyTheme("dark", root);
  assert.deepEqual(attrs, { "data-color-mode": "dark", "data-light-theme": "light", "data-dark-theme": "dark" });
  theme.applyTheme("auto", root);
  assert.equal(attrs["data-color-mode"], "auto");
  theme.applyTheme("nonsense", root);
  assert.equal(attrs["data-color-mode"], "auto", "an unknown mode falls back to auto");
});

test("S0b-6: brand guard - no GitHub or Slack name in UI code, copy or assets", () => {
  const offenders: string[] = [];
  for (const p of walk(UI_ROOT)) {
    if (p.startsWith(VENDOR)) continue;
    if (!/\.(js|css|html|svg)$/.test(p)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/github|slack/gi)) {
      const line = src.slice(0, m.index).split("\n").length;
      offenders.push(`${relative(UI_ROOT, p)}:${line}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
