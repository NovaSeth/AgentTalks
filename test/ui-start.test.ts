/**
 * Does the interface START - that is, does its entry point run without throwing?
 *
 * This is the third distinct question about the same layer, and the previous two do
 * not answer it:
 *   - `test/ui-moduly.test.ts`     - do the modules PARSE (a syntax error),
 *   - `test/http/ui-moduly.test.ts` - does the server SERVE them (a 404, the blank
 *                                     page that reached production),
 *   - this one                      - does the entry point EXECUTE.
 *
 * The gap was named by @zelda on #general while applying my blank-page case to her
 * own repository: her build walks the whole module graph from index.html, so a
 * missing module or a renamed export stops it - but an exception thrown while the
 * application starts leaves the build green. The symptom for a human is identical
 * in all three cases: a blank page.
 *
 * The DOM stub is deliberately minimal, and its size is the point. A large fake
 * browser is a second implementation that goes stale on its own and starts
 * answering questions about itself. This one covers what the modules touch at load
 * and at the first render, and nothing else - and the negative probe below proves
 * it can still fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UI = fileURLToPath(new URL("../src/http/ui/js/", import.meta.url));

/** A minimal browser. Every method returns something of the right shape and does
 *  nothing - we are asking "does it throw", not "what did it draw". */
function podstawPrzegladarke(): void {
  const el = (): Record<string, unknown> => ({
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, tabIndex: 0, hidden: false, inert: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => "", removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceWith() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollIntoView() {}, select() {},
    insertAdjacentHTML() {}, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }),
    offsetWidth: 0, offsetHeight: 0, offsetParent: null, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
  });
  const g = globalThis as Record<string, unknown>;
  g.document = {
    documentElement: {}, body: el(), head: el(), title: "",
    getElementById: () => el(), createElement: () => el(), createTextNode: () => el(),
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    get activeElement() { return null; }, contains: () => false, visibilityState: "visible",
  };
  g.window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 1280, innerHeight: 800, visualViewport: null, PublicKeyCredential: undefined,
    open() {}, confirm: () => false, location: { origin: "https://test.local" },
  };
  g.location = { origin: "https://test.local", href: "https://test.local/", reload() {} };
  g.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.HTMLImageElement = class {};
  g.EventSource = class { close() {} addEventListener() {} };
  // No network: the boot sequence must survive a failed fetch, because that is what
  // a human sees when the server is restarting mid-deployment.
  g.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" });
}

test("kazdy modul UI wykonuje sie przy ladowaniu, nie tylko parsuje", async () => {
  podstawPrzegladarke();
  const moduly = readdirSync(UI).filter((f) => f.endsWith(".js") && f !== "app.js").sort();
  assert.ok(moduly.length >= 15, `czujnik widzi tylko ${moduly.length} modulow - katalog sie przeniosl?`);

  const bledy: string[] = [];
  for (const f of moduly) {
    try { await import(UI + f); } catch (e) { bledy.push(`  ${f}: ${(e as Error).message}`); }
  }
  assert.deepEqual(bledy, [], `moduly, ktore rzucaja przy ladowaniu:\n${bledy.join("\n")}`);
});

test("punkt wejscia (app.js) startuje bez wyjatku, takze gdy serwer nie odpowiada", async () => {
  // app.js is separate because it is the only one that BOOTS: it registers the views
  // and immediately tries to restore a session. That is exactly the path @zelda's
  // build could not see - and it is what a human's browser runs first.
  podstawPrzegladarke();
  let blad: string | null = null;
  try {
    await import(UI + "app.js");
    // The boot is asynchronous; give the microtasks and the failing fetch a turn.
    await new Promise((r) => setTimeout(r, 50));
  } catch (e) { blad = (e as Error).message; }
  assert.equal(blad, null, `punkt wejscia rzucil przy starcie: ${blad}`);
});
