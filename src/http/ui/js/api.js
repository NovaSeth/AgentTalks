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
    err.code = data && englishCode(data.code, res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Reverse of src/core/error-codes.ts LEGACY; t-mg-2-codes.test.ts checks equality.
// Older servers still reach the English keys during a rolling deployment.
export const LEGACY = {
  aktor: "actor_not_found",
  aktor_wylaczony: "actor_disabled",
  awatar: "avatar_not_found",
  awatar_za_duzy: "avatar_too_large",
  bez_slug: "slug_required",
  bez_zmian: "no_changes",
  brak_adresu: "url_required",
  brak_aktora: "actor_required",
  brak_base_url: "base_url_required",
  brak_czlonkow: "members_required",
  brak_dostepu: "no_access",
  brak_nazwy: "name_required",
  brak_pliku: "file_required",
  brak_rewizji: "revision_required",
  brak_sessionid: "session_id_required",
  brak_target: "target_required",
  brak_tytulu: "title_required",
  brak_uprawnien: "not_permitted",
  cialo_za_dlugie: "message_too_long",
  cialo_za_duze: "body_too_large",
  cykl_wiki: "wiki_cycle",
  dm_nie_znika: "dm_cannot_be_deleted",
  dm_staly: "dm_members_fixed",
  handle_zajety: "handle_taken",
  haslo_za_krotkie: "password_too_short",
  juz_zamkniete: "already_closed",
  kanal_istnieje: "channel_exists",
  konflikt_wiki: "wiki_conflict",
  konto_wylaczone: "account_disabled",
  konwersacja: "conversation_not_found",
  mcp_niedostepny: "mcp_unavailable",
  multipart_niewspierany: "multipart_unsupported",
  nie_admin: "not_admin",
  nie_autor: "not_author",
  nie_dla_rozmow: "not_for_conversations",
  nie_mozna_wyjsc: "cannot_leave",
  nie_siebie: "not_self",
  nie_twoja_sesja: "not_your_session",
  nie_twoja_strona: "not_your_page",
  nie_znaleziono: "not_found",
  nieuwierzytelniony: "unauthenticated",
  nieznane_narzedzie: "unknown_tool",
  obcy_watek: "foreign_thread",
  plik: "file_not_found",
  plik_za_duzy: "file_too_large",
  poswiadczenie: "credential_not_found",
  publiczny_sam: "public_channel_open",
  puste_cialo: "empty_body",
  pusty_awatar: "empty_avatar",
  pusty_plik: "empty_file",
  pytanie: "question_not_found",
  rewizja: "revision_not_found",
  sekcja: "section_not_found",
  sesja: "session_not_found",
  skasowana: "message_deleted",
  slug_zarezerwowany: "slug_reserved",
  strona: "page_not_found",
  token_odwolany: "token_revoked",
  token_wygasl: "token_expired",
  tresc_za_dluga: "body_too_long",
  ttl_za_krotki: "ttl_too_short",
  tylko_admin_czlowiek: "human_admin_only",
  tylko_ludzie: "humans_only",
  tylko_post: "post_only",
  tytul_za_dlugi: "title_too_long",
  webauthn_licznik: "webauthn_counter",
  webauthn_podpis: "webauthn_signature",
  wewnetrzny: "internal",
  wiadomosc: "message_not_found",
  za_duzo_prob: "too_many_attempts",
  za_duzo_strumieni: "too_many_streams",
  za_malo_uczestnikow: "too_few_members",
  zaproszenie: "invite_not_found",
  zarchiwizowana: "conversation_archived",
  zla_nazwa: "invalid_name",
  zle_dane: "invalid_data",
  zle_haslo: "wrong_password",
  zle_id: "invalid_id",
  zle_zaproszenie: "invalid_invite",
  zly_adres: "invalid_address",
  zly_format: "invalid_format",
  zly_json: "invalid_json",
  zly_notify: "invalid_notify",
  zly_rodzaj: "invalid_kind",
  zly_sygnal: "invalid_signal",
  zly_target: "invalid_target",
  zly_zasob: "invalid_resource",
};
function englishCode(code, status) {
  // The old session code covered both a missing session and an invalid login session.
  const translated = Object.hasOwn(LEGACY, code) ? LEGACY[code] : code;
  return translated === "session_not_found" && status === 401 ? "session_invalid" : translated;
}

// ------------------------------------------------------------ error dictionary
// The server speaks to an AGENT: it gives codes, route names and openly suggests
// curl. Those are good messages - for a program. A human used to get them raw in
// a toast that vanished after four seconds (a raw "no such conversation 12"). We translate
// them here, in ONE place: a sentence and, where it makes sense, a pointer to the
// next move. An unknown code falls back to the server text - better than nothing.
//
// The values are English source sentences that go through `t()` at LOOKUP time,
// not at module load: this object is built once, and a language switch has to
// change what the next error says without a page reload.
const ERRORS = {
  // access and identity
  csrf: msg("Your session in this tab has expired. Refresh the page and sign in again."),
  session_not_found: msg("Your session no longer works. Sign in again."),
  session_invalid: msg("Your session no longer works. Sign in again."),
  token: msg("The access token is invalid or has been revoked."),
  no_access: msg("You do not have access to this conversation. Ask one of its members to add you."),
  not_permitted: msg("You are not allowed to do that. Ask a channel admin or the instance admin."),
  not_admin: msg("Only the instance admin can do that."),
  human_admin_only: msg("The “Accounts and access” panel is only available to an admin who is a human."),
  humans_only: msg("This only works for human accounts."),
  not_author: msg("Only the author, a channel admin or the instance admin can change this."),
  not_your_page: msg("Only the author or the instance admin can delete a page. Want to remove just the content? Save the page empty - the history stays."),
  not_your_session: msg("This session belongs to somebody else."),
  actor_disabled: msg("This account is disabled. An admin can enable it again."),
  wrong_password: msg("Wrong name or password."),
  password_too_short: msg("That password is too short. Use a longer one."),
  invalid_invite: msg("This invite code is invalid, used up or expired. Ask an admin for a new one."),
  invite_not_found: msg("There is no such invite - it may already have been revoked."),
  credential_not_found: msg("The key on this device could not be used. Sign in with your password."),
  // what does not exist
  conversation_not_found: msg("This conversation no longer exists - it may have been archived."),
  message_not_found: msg("That message is gone."),
  page_not_found: msg("There is no such wiki page."),
  revision_not_found: msg("There is no such version of the page."),
  actor_not_found: msg("There is no such account."),
  question_not_found: msg("That question is gone."),
  file_not_found: msg("There is no such file - it may have expired or been burned after reading."),
  not_found: msg("There is no such thing."),
  message_deleted: msg("This message has been deleted."),
  conversation_archived: msg("This channel is archived - it no longer accepts messages."),
  // conflicts and rules
  wiki_conflict: msg("Somebody saved this page before you managed to save your version."),
  wiki_cycle: msg("A page cannot be placed under its own subpage - pick another spot in the tree."),
  channel_exists: msg("A channel with that name already exists. Pick another one."),
  handle_taken: msg("That name is already taken. Pick another one."),
  slug_reserved: msg("That name is reserved by the system. Pick another one."),
  slug: msg("Invalid name. Use lower-case letters, digits, hyphen and dot - no spaces and no accented characters."),
  already_closed: msg("This question has already been closed."),
  foreign_thread: msg("This reply belongs to a thread in another conversation."),
  dm_members_fixed: msg("A direct conversation cannot be turned into a channel."),
  dm_cannot_be_deleted: msg("A direct conversation cannot be archived."),
  cannot_leave: msg("You cannot leave a direct conversation."),
  not_self: msg("You cannot do that to yourself."),
  too_few_members: msg("Name at least one person for the conversation."),
  members_required: msg("Name at least one person for the conversation."),
  public_channel_open: msg("Anyone joins an open channel by themselves - nobody has to be added."),
  not_for_conversations: msg("This action does not apply to direct conversations."),
  // user input
  body_too_long: msg("This content is too long. Shorten it or attach it as a file."),
  title_too_long: msg("The title is too long - shorten it."),
  title_required: msg("Enter a title."),
  name_required: msg("Enter a name."),
  empty_body: msg("There is nothing to send - write something."),
  empty_file: msg("This file is empty."),
  file_required: msg("No file selected."),
  emoji: msg("That is not a valid reaction."),
  invalid_notify: msg("Unknown notification setting."),
  invalid_resource: msg("Name the resource you want to claim."),
  invalid_kind: msg("Unknown account kind."),
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
  const code = englishCode(e.code, e.status);
  if (kontekst && code && kontekst[code]) return kontekst[code];
  if (code && ERRORS[code]) return t(ERRORS[code]);
  if (e.status && STATUSES[e.status]) return t(STATUSES[e.status]);
  // No network: fetch throws a TypeError with no status - that is not a server error.
  if (!e.status && !e.code) return t("No connection to the server. Check your network and try again.");
  return e.message || t("Something went wrong.");
}
