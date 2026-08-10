/**
 * Interface language. English is the SOURCE, everything else is a translation.
 *
 * The other direction (Polish source, English dictionary) would have been less
 * typing on day one and would have left Polish sitting in every line of the UI -
 * exactly what a reader of this repository should not have to decode. So the
 * literal in the code is the English sentence, and it doubles as the lookup key:
 * a missing translation degrades to readable English instead of `missing.key`.
 *
 * Two rules worth knowing before you add a string:
 *
 * 1. `t()` does NOT escape interpolated values. Every call site that builds HTML
 *    already escapes them (`escapeHtml`) and many pass whole HTML fragments -
 *    escaping here would double-escape those and break them silently. Pass
 *    escaped values, exactly like the template literals this replaced.
 * 2. Plurals go through `Intl.PluralRules`, not through `n === 1 ? a : b`.
 *    Polish has three forms (1 / 2-4 / 5+) and English has two, so the ternary
 *    is wrong in Polish no matter which language wrote it.
 */
import { PL } from "./i18n-pl.js";

export const LANGS = [
  { code: "en", label: "English", short: "EN" },
  { code: "pl", label: "Polski", short: "PL" },
];

const DICTS = { pl: PL };
const STORAGE_KEY = "atalks_lang";

/** English needs a dictionary only where a form varies - i.e. plurals. Anything
 *  missing here falls through to the key itself, which IS the English text. */
const EN = {
  "{n} new messages": { one: "{n} new message", other: "{n} new messages" },
  "{n} days ago": { one: "{n} day ago", other: "{n} days ago" },
  "{n} unread": { one: "{n} unread", other: "{n} unread" },
  "{n} results": { one: "{n} result", other: "{n} results" },
  "{n} new": { one: "{n} new", other: "{n} new" },
  "{n} pages": { one: "{n} page", other: "{n} pages" },
  "{n} replies": { one: "{n} reply", other: "{n} replies" },
  "{n} members": { one: "{n} member", other: "{n} members" },
  "{n} days": { one: "{n} day", other: "{n} days" },
  "{n} readers": { one: "{n} reader", other: "{n} readers" },
  "{n} files": { one: "{n} file", other: "{n} files" },
};

function detect() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved && LANGS.some((l) => l.code === saved)) return saved;
  } catch { /* private mode - fall through to the browser preference */ }
  // `typeof` rather than a plain read: this module is also loaded by the test,
  // which runs in Node and has neither navigator nor document. A module that only
  // works inside a browser cannot be checked anywhere except in a browser - and a
  // check that needs a browser is a check that does not run.
  const nav = typeof navigator === "undefined" ? null : navigator;
  const wanted = (nav?.languages?.length ? nav.languages : [nav?.language || ""])
    .map((l) => String(l).slice(0, 2).toLowerCase());
  for (const w of wanted) {
    const hit = LANGS.find((l) => l.code === w);
    if (hit) return hit.code;
  }
  return "en";
}

let current = detect();
let onChange = null;

export const lang = () => current;

/** The shell re-renders on a language switch; it registers the callback here so
 *  this module stays a leaf and the import graph stays acyclic. */
export function onLangChange(fn) { onChange = fn; }

export function setLang(code) {
  if (!LANGS.some((l) => l.code === code) || code === current) return;
  current = code;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, code); } catch { /* not fatal */ }
  applyDocumentLang();
  onChange?.();
}

/** Screen readers pick pronunciation from this - a Polish UI announced as
 *  English is unintelligible, so it has to follow the switch. */
export function applyDocumentLang() {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}

const RULES = new Map();

function pickForm(forms, params) {
  const n = params?.n ?? params?.count;
  if (typeof n !== "number") return forms.other ?? forms.many ?? "";
  let rules = RULES.get(current);
  if (!rules) { rules = new Intl.PluralRules(current); RULES.set(current, rules); }
  return forms[rules.select(n)] ?? forms.other ?? forms.many ?? "";
}

function fill(text, params) {
  if (!params) return text;
  return String(text).replace(/\{(\w+)\}/g, (whole, key) => (
    params[key] === undefined ? whole : String(params[key])
  ));
}

/**
 * Translate `text` into the current language.
 *
 * @param {string} text   English source sentence; also the dictionary key.
 * @param {object} [params] Values for `{placeholders}`. `n` (or `count`) also
 *                          selects the plural form. NOT escaped - see the note
 *                          at the top of this file.
 */
export function t(text, params) {
  let out = DICTS[current]?.[text];
  if (out === undefined) out = EN[text] ?? text;
  if (out && typeof out === "object") out = pickForm(out, params);
  return fill(out, params);
}

/** Marks an English sentence as translatable WITHOUT translating it yet.
 *  Identity at runtime. It exists because some sentences have to be defined
 *  before a language is chosen (the error dictionary is built once at import,
 *  but a language switch has to change what the NEXT error says). Without a
 *  marker those strings are invisible to the test that checks every sentence has
 *  a translation - and an invisible string is exactly the kind that ships
 *  untranslated. */
export const msg = (s) => s;

/** Dates and numbers follow the interface language, not the operating system:
 *  a Polish UI printing "Aug 9" reads as a half-finished translation. */
export const locale = () => (current === "pl" ? "pl-PL" : "en-GB");

applyDocumentLang();
