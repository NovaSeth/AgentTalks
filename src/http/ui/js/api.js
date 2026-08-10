/**
 * HTTP layer: a single entry point to /api/* together with the CSRF header, plus
 * the dictionary that turns server error codes into sentences for a human.
 */
import { msg, t } from "./i18n.js";

// --------------------------------------------------------------------- api
export const CSRF_KEY = "atalks_csrf", ACTOR_KEY = "atalks_actor", SID_KEY = "atalks_sid";

export let csrf = sessionStorage.getItem(CSRF_KEY) || null;

/** The CSRF token changes on login and logout, and a module that reads it cannot
 *  assign to another module's binding - hence the explicit setter. */
export function setCsrf(v) { csrf = v; }

export async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-at-csrf"] = csrf;
  const res = await fetch(path, {
    method, headers, credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* e.g. 204 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------ error dictionary
// The server speaks to an AGENT: it gives codes, route names and openly suggests
// curl. Those are good messages - for a program. A human used to get them raw in
// a toast that vanished after four seconds ("nie ma konwersacji 12"). We translate
// them here, in ONE place: a sentence and, where it makes sense, a pointer to the
// next move. An unknown code falls back to the server text - better than nothing.
//
// The values are English source sentences that go through `t()` at LOOKUP time,
// not at module load: this object is built once, and a language switch has to
// change what the next error says without a page reload.
const ERRORS = {
  // access and identity
  csrf: msg("Your session in this tab has expired. Refresh the page and sign in again."),
  sesja: msg("Your session no longer works. Sign in again."),
  token: msg("The access token is invalid or has been revoked."),
  brak_dostepu: msg("You do not have access to this conversation. Ask one of its members to add you."),
  brak_uprawnien: msg("You are not allowed to do that. Ask a channel admin or the instance admin."),
  nie_admin: msg("Only the instance admin can do that."),
  tylko_admin_czlowiek: msg("The “Accounts and access” panel is only available to an admin who is a human."),
  tylko_ludzie: msg("This only works for human accounts."),
  nie_autor: msg("Only the author, a channel admin or the instance admin can change this."),
  nie_twoja_strona: msg("Only the author or the instance admin can delete a page. Want to remove just the content? Save the page empty - the history stays."),
  nie_twoja_sesja: msg("This session belongs to somebody else."),
  aktor_wylaczony: msg("This account is disabled. An admin can enable it again."),
  zle_haslo: msg("Wrong name or password."),
  haslo_za_krotkie: msg("That password is too short. Use a longer one."),
  zle_zaproszenie: msg("This invite code is invalid, used up or expired. Ask an admin for a new one."),
  zaproszenie: msg("There is no such invite - it may already have been revoked."),
  poswiadczenie: msg("The key on this device could not be used. Sign in with your password."),
  // what does not exist
  konwersacja: msg("This conversation no longer exists - it may have been archived."),
  wiadomosc: msg("That message is gone."),
  strona: msg("There is no such wiki page."),
  rewizja: msg("There is no such version of the page."),
  aktor: msg("There is no such account."),
  pytanie: msg("That question is gone."),
  plik: msg("There is no such file - it may have expired or been burned after reading."),
  nie_znaleziono: msg("There is no such thing."),
  skasowana: msg("This message has been deleted."),
  zarchiwizowana: msg("This channel is archived - it no longer accepts messages."),
  // conflicts and rules
  konflikt_wiki: msg("Somebody saved this page before you managed to save your version."),
  cykl_wiki: msg("A page cannot be placed under its own subpage - pick another spot in the tree."),
  kanal_istnieje: msg("A channel with that name already exists. Pick another one."),
  handle_zajety: msg("That name is already taken. Pick another one."),
  slug_zarezerwowany: msg("That name is reserved by the system. Pick another one."),
  slug: msg("Invalid name. Use lower-case letters, digits, hyphen and dot - no spaces and no accented characters."),
  juz_zamkniete: msg("This question has already been closed."),
  obcy_watek: msg("This reply belongs to a thread in another conversation."),
  dm_staly: msg("A direct conversation cannot be turned into a channel."),
  dm_nie_znika: msg("A direct conversation cannot be archived."),
  nie_mozna_wyjsc: msg("You cannot leave a direct conversation."),
  nie_siebie: msg("You cannot do that to yourself."),
  za_malo_uczestnikow: msg("Name at least one person for the conversation."),
  brak_czlonkow: msg("Name at least one person for the conversation."),
  publiczny_sam: msg("Anyone joins an open channel by themselves - nobody has to be added."),
  nie_dla_rozmow: msg("This action does not apply to direct conversations."),
  // user input
  tresc_za_dluga: msg("This content is too long. Shorten it or attach it as a file."),
  tytul_za_dlugi: msg("The title is too long - shorten it."),
  brak_tytulu: msg("Enter a title."),
  brak_nazwy: msg("Enter a name."),
  puste_cialo: msg("There is nothing to send - write something."),
  pusty_plik: msg("This file is empty."),
  brak_pliku: msg("No file selected."),
  emoji: msg("That is not a valid reaction."),
  zly_notify: msg("Unknown notification setting."),
  zly_zasob: msg("Name the resource you want to claim."),
  zly_rodzaj: msg("Unknown account kind."),
};

// Resources claimed by somebody else (409 from /api/leases) carry who and until
// when in the body - which is why that one case builds its sentence from data
// rather than from ready-made text.
const STATUSES = {
  401: msg("You are not signed in. Refresh the page and sign in again."),
  403: msg("You are not allowed to do that."),
  404: msg("That is gone."),
  409: msg("Somebody got there first - refresh and try again."),
  413: msg("That is too big to send."),
  429: msg("Too many attempts at once. Wait a moment and try again."),
  500: msg("The server stumbled. Try again, and if it comes back - tell an admin."),
  502: msg("The server is not responding right now (a deployment is probably running). Try again shortly."),
  503: msg("The server is not responding right now (a deployment is probably running). Try again shortly."),
  504: msg("The server is not responding right now (a deployment is probably running). Try again shortly."),
};

/** A human sentence for an error from /api/*.
 *  @param e error from api()
 *  @param kontekst per-call-site overrides, e.g. { slug: "Invalid page address..." }
 *         - the same code means different things for a channel and for the wiki.
 *         Values are already translated by the caller. */
export function opiszBlad(e, kontekst) {
  if (!e) return t("Something went wrong.");
  if (kontekst && e.code && kontekst[e.code]) return kontekst[e.code];
  if (e.code && ERRORS[e.code]) return t(ERRORS[e.code]);
  if (e.status && STATUSES[e.status]) return t(STATUSES[e.status]);
  // No network: fetch throws a TypeError with no status - that is not a server error.
  if (!e.status && !e.code) return t("No connection to the server. Check your network and try again.");
  return e.message || t("Something went wrong.");
}
