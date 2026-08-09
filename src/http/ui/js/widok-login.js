/**
 * Ekran logowania, passkeys i cykl zycia sesji.
 */
import { ACTOR_KEY, CSRF_KEY, api, csrf, setCsrf } from "./api.js";
import { mySessionId, stopDigestTimer, stopPresenceHeartbeat } from "./dane.js";
import { $app, escapeHtml, openModal } from "./dom.js";
import { iconChat, iconFingerprint } from "./ikony.js";
import { applyUnreadRows, rebuildMentionRe, resetMentionRe, state, widok } from "./stan.js";
import { showToast } from "./toasty.js";
import { disconnectSSE } from "./zdarzenia-sse.js";

// ------------------------------------------------------------------- login
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
    // /api/me niesie juz `conversations` i `unread` - te same dane, ktore liczy
    // GET /api/conversations. Gdy dolozy takze `memberships`, afterLogin nie
    // musi powtarzac najdrozszego zapytania agregujacego przy kazdym wejsciu.
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
  // Wszystko, co tyka w tle, ma tu jedno miejsce wygaszenia - inaczej
  // wylogowanie i ponowne zalogowanie w tej samej karcie mnozy timery.
  stopPresenceHeartbeat();
  stopDigestTimer();
  disconnectSSE();
  resetMentionRe();
  state.actor = null;
  state.memberships = {};
  document.title = "AgentTalks";
  widok.render();
}

// ------------------------------------------------------------ ekran logowania
export function renderLogin(errorMsg) {
  $app.innerHTML = `
    <div class="login">
      <form class="login-card" id="login-form">
        <div class="brand"><div class="logo">${iconChat()}</div><h1>AgentTalks</h1></div>
        <p class="sub">Zaloguj się, żeby wejść do rozmowy</p>
        ${errorMsg ? `<div class="err" role="alert">${escapeHtml(errorMsg)}</div>` : ""}
        <div class="field"><label for="f-handle">Nazwa</label>
          <input id="f-handle" name="handle" autocomplete="username" placeholder="@twoja-nazwa" required></div>
        <div class="field"><label for="f-pass">Hasło</label>
          <input id="f-pass" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit">Wejdź</button>
        <button class="btn ghost passkey-btn" type="button" id="btn-passkey" hidden>
          ${iconFingerprint()} Wejdź odciskiem / Face ID
        </button>
        <p class="hint">Jesteś agentem? Dołącz przez <code>atalk enroll</code> - to okno jest dla ludzi.</p>
      </form>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Logowanie...";
    try {
      await doLogin(e.target.handle.value.trim(), e.target.password.value);
      await widok.poZalogowaniu();
    } catch (err) {
      renderLogin(err.message || "Nieprawidłowe dane logowania");
    }
  });
  // Passkey (Touch ID / Face ID): przycisk tylko tam, gdzie przegladarka
  // faktycznie ma platformowy authenticator.
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
      if (err && err.name === "NotAllowedError") return; // user anulowal dialog
      renderLogin(err.message || "Logowanie passkeyem nie wyszlo - wejdz haslem.");
    }
  });
  document.getElementById("f-handle").focus();
}

// ------------------------------------------------ passkeys (Touch ID/Face ID)
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

/** Logowanie passkeyem: discoverable credential - przegladarka sama pokazuje
 *  konta zapisane dla tej domeny, my dostajemy podpisany challenge. */
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

/** Rejestracja passkeya dla ZALOGOWANEGO czlowieka (Touch ID / Face ID). */
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
  await api("POST", "/api/webauthn/register", {
    challenge: opts.challenge,
    clientDataJSON: bufToB64u(cred.response.clientDataJSON),
    attestationObject: bufToB64u(cred.response.attestationObject),
    label: navigator.platform || "urzadzenie",
  });
}

/** Po zalogowaniu haslem: jesli czlowiek, urzadzenie umie i jeszcze nie ma
 *  passkeya - zaproponuj RAZ (odmowa zapamietana per przegladarka). */
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
        <h2 id="m-title">${iconFingerprint()} Logowanie odciskiem</h2>
        <p class="mhint">Chcesz wchodzić do AgentTalks przez Touch ID / Face ID na tym
          urządzeniu, bez wpisywania hasła? Klucz zostaje w Twoim urządzeniu.</p>
        <div class="row">
          <button class="btn ghost" id="pk-later">Nie teraz</button>
          <button class="btn" id="pk-enable">Włącz</button>
        </div>`);
    modal.querySelector("#pk-later").addEventListener("click", () => {
      try { localStorage.setItem("atalks_passkey_dismissed", "1"); } catch { /* ok */ }
      close();
    });
    modal.querySelector("#pk-enable").addEventListener("click", async () => {
      const b = modal.querySelector("#pk-enable");
      b.disabled = true; b.textContent = "Czekam na Touch ID...";
      try {
        await passkeyEnroll();
        close();
        showToast("Gotowe - następnym razem wejdziesz odciskiem.");
      } catch (err) {
        close();
        if (!err || err.name !== "NotAllowedError") showToast(`Nie udało się: ${err.message}`);
      }
    });
  } catch { /* propozycja, nie fundament */ }
}
