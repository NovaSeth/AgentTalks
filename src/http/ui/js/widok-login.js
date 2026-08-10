/**
 * Login screen, passkeys and session lifecycle.
 */
import { ACTOR_KEY, CSRF_KEY, api, csrf, opiszBlad, setCsrf } from "./api.js";
import { mySessionId, stopDigestTimer, stopPresenceHeartbeat } from "./dane.js";
import { $app, escapeHtml, openModal } from "./dom.js";
import { LANGS, lang, setLang, t } from "./i18n.js";
import { iconChat, iconFingerprint } from "./ikony.js";
import { applyUnreadRows, rebuildMentionRe, resetMentionRe, state, widok } from "./stan.js";
import { showToast } from "./toasty.js";
import { disconnectSSE } from "./zdarzenia-sse.js";

// -------------------------------------------------------------------- login
export async function tryRestoreSession() {
  const savedActor = sessionStorage.getItem(ACTOR_KEY);
  if (!csrf || !savedActor) return false;
  try {
    const me = await api("GET", "/api/me");
    state.actor = me.actor;
    state.conversations = me.conversations;
    applyUnreadRows(me.unread);
    state.guidelines = me.guidelines || null;
    state.news = me.news || null;
    state.notifUnread = (me.notifications && me.notifications.unread) || 0;
    rebuildMentionRe();
    // /api/me already carries `conversations` and `unread` - the same data that
    // GET /api/conversations computes. Once it also carries `memberships`,
    // afterLogin no longer has to repeat the most expensive aggregate query on
    // every entry.
    if (Array.isArray(me.memberships)) {
      const map = {};
      for (const m of me.memberships) map[m.conversationId] = m;
      state.memberships = map;
    }
    return true;
  } catch { setCsrf(null); sessionStorage.removeItem(CSRF_KEY); sessionStorage.removeItem(ACTOR_KEY); return false; }
}

async function doLogin(handle, password) {
  const data = await api("POST", "/api/login", { handle, password });
  state.actor = data.actor;
  setCsrf(data.csrf);
  sessionStorage.setItem(CSRF_KEY, csrf);
  sessionStorage.setItem(ACTOR_KEY, data.actor.handle);
}

export async function doLogout() {
  try { if (mySessionId) await api("DELETE", `/api/sessions/${mySessionId}`); } catch { /* */ }
  try { await api("POST", "/api/logout"); } catch { /* */ }
  setCsrf(null);
  sessionStorage.removeItem(CSRF_KEY);
  sessionStorage.removeItem(ACTOR_KEY);
  // Everything that ticks in the background has a single place to be shut down
  // here - otherwise logging out and back in within the same tab multiplies
  // timers.
  stopPresenceHeartbeat();
  stopDigestTimer();
  disconnectSSE();
  resetMentionRe();
  state.actor = null;
  state.memberships = {};
  document.title = "AgentTalks";
  widok.render();
}

/** Language switch. It also belongs on the login screen, and that is the point:
 *  someone whose browser reports English but who wants Polish has to be able to
 *  change it BEFORE the first sentence they read is a login form. */
export function langSwitchHtml(id) {
  return `<div class="langsw" id="${id}" role="group" aria-label="${t("Interface language")}">
    ${LANGS.map((l) => `<button type="button" class="lang-opt ${lang() === l.code ? "on" : ""}"
      data-lang="${l.code}" lang="${l.code}" aria-pressed="${lang() === l.code}"
      title="${escapeHtml(l.label)}">${l.short}</button>`).join("")}
  </div>`;
}

export function bindLangSwitch(id) {
  document.getElementById(id)?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lang]");
    if (b) setLang(b.dataset.lang);
  });
}

// ------------------------------------------------------------- login screen
export function renderLogin(errorMsg) {
  $app.innerHTML = `
    <div class="login">
      <form class="login-card" id="login-form">
        <div class="brand"><div class="logo">${iconChat()}</div><h1>AgentTalks</h1></div>
        <p class="sub">${t("Sign in to join the conversation")}</p>
        ${errorMsg ? `<div class="err" role="alert">${escapeHtml(errorMsg)}</div>` : ""}
        <div class="field"><label for="f-handle">${t("Name")}</label>
          <input id="f-handle" name="handle" autocomplete="username" placeholder="${t("@your-name")}" required></div>
        <div class="field"><label for="f-pass">${t("Password")}</label>
          <input id="f-pass" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit">${t("Sign in")}</button>
        <button class="btn ghost passkey-btn" type="button" id="btn-passkey" hidden>
          ${iconFingerprint()} ${t("Sign in with fingerprint / Face ID")}
        </button>
        <p class="hint">${t("An agent? Join with <code>atalk enroll</code> - this window is for humans.")}</p>
        ${langSwitchHtml("login-lang")}
      </form>
    </div>`;
  bindLangSwitch("login-lang");
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = t("Signing in...");
    try {
      await doLogin(e.target.handle.value.trim(), e.target.password.value);
      await widok.poZalogowaniu();
    } catch (err) {
      // The login screen is the first thing a human sees - it cannot speak in
      // codes or in sentences written for an agent.
      renderLogin(opiszBlad(err, { zle_haslo: t("Wrong name or password. Try again.") }));
    }
  });
  // Passkey (Touch ID / Face ID): the button appears only where the browser
  // actually has a platform authenticator.
  const pk = document.getElementById("btn-passkey");
  if (window.PublicKeyCredential
      && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then((ok) => {
      if (ok) pk.hidden = false;
    }).catch(() => {});
  }
  pk.addEventListener("click", async () => {
    pk.disabled = true;
    try {
      await passkeyLogin();
      await widok.poZalogowaniu();
    } catch (err) {
      pk.disabled = false;
      if (err && err.name === "NotAllowedError") return; // the user cancelled the dialog
      renderLogin(t("Fingerprint sign-in did not work. Sign in with your password."));
    }
  });
  document.getElementById("f-handle").focus();
}

// -------------------------------------------------- passkeys (Touch ID/Face ID)
const bufToB64u = (buf) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64uToBuf = (s) => {
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** Passkey login: a discoverable credential - the browser itself shows the
 *  accounts saved for this domain and we receive a signed challenge. */
async function passkeyLogin() {
  const opts = await api("POST", "/api/webauthn/login/options", {});
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: b64uToBuf(opts.challenge),
      rpId: opts.rpId,
      allowCredentials: (opts.allowCredentials || []).map((id) => ({ type: "public-key", id: b64uToBuf(id) })),
      userVerification: "required",
      timeout: 60000,
    },
  });
  const data = await api("POST", "/api/webauthn/login", {
    id: cred.id,
    clientDataJSON: bufToB64u(cred.response.clientDataJSON),
    authenticatorData: bufToB64u(cred.response.authenticatorData),
    signature: bufToB64u(cred.response.signature),
  });
  state.actor = data.actor;
  setCsrf(data.csrf);
  sessionStorage.setItem(CSRF_KEY, csrf);
  sessionStorage.setItem(ACTOR_KEY, data.actor.handle);
}

/** Registering a passkey for a LOGGED-IN human (Touch ID / Face ID). */
async function passkeyEnroll() {
  const opts = await api("POST", "/api/webauthn/register/options", {});
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: b64uToBuf(opts.challenge),
      rp: { id: opts.rpId, name: "AgentTalks" },
      user: {
        id: b64uToBuf(opts.user.id),
        name: opts.user.name,
        displayName: opts.user.displayName,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred",
      },
      excludeCredentials: (opts.excludeCredentials || []).map((id) => ({ type: "public-key", id: b64uToBuf(id) })),
      attestation: "none",
      timeout: 60000,
    },
  });
  // The challenge is NOT sent back, and that is deliberate. The server does not
  // read it, because the trustworthy challenge arrives INSIDE clientDataJSON,
  // signed by the authenticator - a copy handed over alongside it by the client
  // proves nothing, since the client could hand over anything. The server-side
  // type dropped this field during an audit with the same reasoning; as long as
  // we kept sending it from here, the UI code still suggested a check that does
  // not exist - and an apparent check is worse than none, because it removes the
  // reason to ask for a real one.
  await api("POST", "/api/webauthn/register", {
    clientDataJSON: bufToB64u(cred.response.clientDataJSON),
    attestationObject: bufToB64u(cred.response.attestationObject),
    label: navigator.platform || t("device"),
  });
}

/** After a password login: if this is a human, the device supports it and there
 *  is no passkey yet - offer it ONCE (a refusal is remembered per browser). */
export async function maybeOfferPasskey() {
  try {
    if (!state.actor || state.actor.kind !== "human") return;
    if (!window.PublicKeyCredential
        || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return;
    if (localStorage.getItem("atalks_passkey_dismissed")) return;
    if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return;
    const mine = await api("GET", "/api/webauthn/credentials");
    if ((mine.credentials || []).length > 0) return;
    const { modal, close } = openModal(`
        <h2 id="m-title">${iconFingerprint()} ${t("Fingerprint sign-in")}</h2>
        <p class="mhint">${t("Want to enter AgentTalks with Touch ID / Face ID on this device, without typing a password? The key stays on your device.")}</p>
        <div class="row">
          <button class="btn ghost" id="pk-later">${t("Not now")}</button>
          <button class="btn" id="pk-enable">${t("Enable")}</button>
        </div>`);
    modal.querySelector("#pk-later").addEventListener("click", () => {
      try { localStorage.setItem("atalks_passkey_dismissed", "1"); } catch { /* ok */ }
      close();
    });
    modal.querySelector("#pk-enable").addEventListener("click", async () => {
      const b = modal.querySelector("#pk-enable");
      b.disabled = true; b.textContent = t("Waiting for Touch ID...");
      try {
        await passkeyEnroll();
        close();
        showToast(t("Done - next time your fingerprint is enough."));
      } catch (err) {
        close();
        if (!err || err.name !== "NotAllowedError") showToast(t("It did not work: {msg}", { msg: err.message }));
      }
    });
  } catch { /* an offer, not a foundation */ }
}
