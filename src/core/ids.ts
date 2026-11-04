/**
 * Validation of identifiers visible to a human.
 *
 * The prototype derived a participant's name from `basename(cwd)` and defended itself
 * against useless names with a blacklist ("claude", "home", "root", "tmp"...). Here that
 * problem does not exist by construction: a `handle` is given when an actor is created, by
 * a human or an administrator, is fixed, and is the addressing key.
 * A display name can change freely and touches neither routing nor history.
 */
import { badRequest } from "./errors.ts";

const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;

/**
 * Transliteration before filtering characters out. Without it, "Michal" written with Polish
 * diacritics would give "micha" (the `ł` alone disappeared, because NFD does not decompose it -
 * it is a separate character, not a letter with a diacritic). A handle is to stay recognisable.
 */
const POLISH_TRANSLITERATION: Record<string, string> = {
  "ą": "a", "ć": "c", "ę": "e", "ł": "l",
  "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z",
};

export function transliterate(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => POLISH_TRANSLITERATION[c])
    // The remaining Latin alphabets: NFD decomposition strips the diacritics.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * "@Nestor" -> "nestor", "bs/user" -> "bs-user".
 * A slash and a space become a hyphen, because the prototype used them in labels
 * ("Nestor/motowolt", "bs/sceptic") - the import reproduces them without losing their sense.
 */
export function normalizeHandle(raw: string): string {
  const cleaned = transliterate(String(raw ?? "").trim().replace(/^@+/, ""))
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  if (!HANDLE_RE.test(cleaned)) {
    throw badRequest(
      "handle",
      `invalid handle: "${raw}". Use 2-32 characters from [a-z0-9._-].`,
    );
  }
  return cleaned;
}

/** "#general" -> "general". Channels in the prototype had the hash in their name; here the
 *  hash is decoration in the interface, not part of the identifier.
 *
 *  `nameKind` names the THING the name belongs to, because the same function serves channels
 *  and wiki pages: the message "invalid channel name" while creating a PAGE pointed
 *  attention at a completely different part of the product (UX audit, D23). */
export function normalizeSlug(raw: string, nameKind = "name"): string {
  const cleaned = transliterate(String(raw ?? "").trim().replace(/^#+/, ""))
    .replace(/[\s/\\]+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  if (!SLUG_RE.test(cleaned)) {
    throw badRequest(
      "slug",
      `invalid ${nameKind}: "${raw}". Use lowercase letters, digits, dots, underscores or hyphens ` +
        `(e.g. "how-to-deploy").`,
    );
  }
  return cleaned;
}

/** A reaction emoji: short, non-empty, no whitespace. We do not check whether it is a
 *  "real" emoji - any attempt at such validation ages faster than Unicode does. */
export function normalizeEmoji(raw: string): string {
  const e = String(raw ?? "").trim();
  if (!e || e.length > 16 || /\s/.test(e)) {
    throw badRequest("emoji", "use a short reaction without spaces");
  }
  return e;
}


/**
 * A user query -> an FTS5 phrase with prefixes. ONE place, because the same rule governs
 * the message search and the wiki search - and two copies of the same escaping are two
 * chances to forget to fix one of them.
 * A quotation mark is removed rather than escaped: in FTS5 it quotes a phrase, so letting
 * it through would change the meaning of the query.
 */
export function ftsMatch(text: string): string | null {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}
