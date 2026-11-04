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

// The session-lost hook (S7): a 401 from any call except signing in or out means the session
// ended under the user - the handler saves the draft and returns to the sign-in screen. Set by
// sse-events.js at load; kept here so that api() does not import the state or the views.
let unauthorized = null;

export function onUnauthorized(handler) { unauthorized = handler; }

const SESSION_FREE = /^\/api\/(login|logout|webauthn)/;

// The session generation (T-MG-3 F1). Every sign-in, sign-out and session loss starts a new one;
// a response that comes back under another generation than its request was sent in belongs to
// an account that is no longer here. It is dropped HERE, before any caller merges it into the
// state or the DOM - one guard instead of a check after every await in forty call sites - and it
// never reaches the session-lost handler (an old 401 must not sign the next person out).
let sessionGen = 0;

export function sessionGeneration() { return sessionGen; }

export function newSessionGeneration() { return ++sessionGen; }

/** The error a stale answer turns into: callers see a rejection, showError stays silent. */
function staleError(path) {
  const err = new Error(`stale response for ${path}`);
  err.stale = true;
  err.sessionLost = true;
  return err;
}

export async function api(method, path, body) {
  const gen = sessionGen;
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-at-csrf"] = csrf;
  let res;
  try {
    res = await fetch(path, {
      method, headers, credentials: "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (gen !== sessionGen) throw staleError(path);
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* e.g. 204 */ }
  if (gen !== sessionGen) throw staleError(path);
  if (!res.ok) {
    // `message` is the human sentence (the fail bar, usersError and toasts read it); the raw
    // server text stays in `serverMessage` for the fallback and for debugging.
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.serverMessage = err.message;
    err.code = data && englishCode(data.code, res.status);
    err.status = res.status;
    err.message = describeError(err);
    if (res.status === 401 && !SESSION_FREE.test(path)) {
      // The session-lost handler shows ONE toast; the failing caller must not add its own
      // (W2-S7-C): showError skips an error flagged this way.
      err.sessionLost = true;
      if (unauthorized) {
        try { unauthorized(err, path); } catch { /* the caller still gets its error */ }
      }
    }
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
  account_disabled: msg("This account is disabled. An admin can enable it again."),
  unauthenticated: msg("You are not signed in. Refresh the page and sign in again."),
  token_expired: msg("Your access token has expired. Ask an admin for a replacement."),
  token_revoked: msg("Your access token has been revoked. Ask an admin for a replacement."),
  too_many_attempts: msg("Too many attempts at once. Wait a moment and try again."),
  too_many_streams: msg("Too many live connections are open. Close unused AgentTalks tabs and try again."),
  invalid_data: msg("Check your username and password, then try signing in again."),
  wrong_password: msg("Wrong name or password."),
  password_too_short: msg("That password is too short. Use a longer one."),
  invalid_invite: msg("This invite code is invalid, used up or expired. Ask an admin for a new one."),
  invite_not_found: msg("There is no such invite - it may already have been revoked."),
  credential_not_found: msg("The key on this device could not be used. Sign in with your password."),
  base_url_required: msg("Passkeys are not configured on this server. Sign in with your password and ask an admin to configure the server URL."),
  cbor: msg("The passkey data could not be read. Try again or sign in with your password."),
  webauthn: msg("The passkey could not be used. Try again or sign in with your password."),
  webauthn_challenge: msg("The passkey request has expired or is invalid. Start the passkey operation again."),
  webauthn_origin: msg("This address does not match your passkey. Open the server's configured URL and try again."),
  webauthn_rpid: msg("This address does not match your passkey. Open the server's configured URL and try again."),
  webauthn_uv: msg("Verify your identity with your fingerprint, face or device PIN, then try again."),
  webauthn_counter: msg("This passkey was rejected. Sign in with your password and register a new passkey."),
  webauthn_signature: msg("The passkey signature could not be verified. Try again or sign in with your password."),
  // what does not exist
  conversation_not_found: msg("This conversation no longer exists - it may have been archived."),
  message_not_found: msg("That message is gone."),
  page_not_found: msg("There is no such wiki page."),
  revision_not_found: msg("There is no such version of the page."),
  actor_not_found: msg("There is no such account."),
  question_not_found: msg("That question is gone."),
  file_not_found: msg("There is no such file - it may have expired or been burned after reading."),
  avatar_not_found: msg("This avatar is missing. Upload the image again."),
  section_not_found: msg("That wiki section no longer exists. Open the full page and choose another section."),
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
  slug_required: msg("Direct conversations cannot be renamed. Change the topic instead."),
  no_changes: msg("There are no changes to save. Edit something before saving."),
  // user input
  body_too_long: msg("This content is too long. Shorten it or attach it as a file."),
  message_too_long: msg("This content is too long. Shorten it or attach it as a file."),
  body_too_large: msg("This request is too large. Send less content or a smaller file."),
  file_too_large: msg("This file is too large. Choose a smaller file."),
  avatar_too_large: msg("This avatar is too large. Resize it to a thumbnail and upload it again."),
  empty_avatar: msg("This avatar file is empty. Choose an image with content."),
  invalid_format: msg("This image format is not supported. Choose a PNG, JPEG, WebP or GIF."),
  invalid_name: msg("The filename could not be read. Rename the file and upload it again."),
  multipart_unsupported: msg("The upload format was not accepted. Select the file again and retry."),
  actor_required: msg("Select an account before continuing."),
  revision_required: msg("Select a page version before restoring it."),
  session_id_required: msg("Your activity session is missing. Refresh the page and sign in again."),
  invalid_id: msg("This item could not be identified. Refresh the page and select it again."),
  invalid_json: msg("The request could not be read. Refresh the page and try again."),
  invalid_signal: msg("Your activity status could not be updated. Refresh the page and try again."),
  target_required: msg("Enter a webhook URL before saving."),
  invalid_target: msg("The webhook address is invalid. Enter an allowed HTTP or HTTPS URL."),
  ttl_too_short: msg("The token would expire too soon. Choose a longer validity period."),
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
  internal: msg("The server stumbled. Try again, and if it comes back - tell an admin."),
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
 *  @param context per-call-site overrides, e.g. { slug: "Invalid page address..." }
 *         - the same code means different things for a channel and for the wiki.
 *         Values are already translated by the caller. */
export function describeError(e, context) {
  if (!e) return t("Something went wrong.");
  const code = englishCode(e.code, e.status);
  if (context && code && context[code]) return context[code];
  if (code && ERRORS[code]) return t(ERRORS[code]);
  if (e.status && STATUSES[e.status]) return t(STATUSES[e.status]);
  // No network: fetch throws a TypeError with no status - that is not a server error.
  if (!e.status && !e.code) return t("No connection to the server. Check your network and try again.");
  return e.serverMessage || e.message || t("Something went wrong.");
}
