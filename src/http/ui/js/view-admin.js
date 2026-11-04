/**
 * The human admin panel: actors, tokens, invites.
 */
import { api } from "./api.js";
import { avatarHtml, confirmModal, escapeHtml, fmtDateTime, hamburgerHtml, openModal, timeAgo, toggleDrawerClass } from "./dom.js";
import { iconChevron, iconUsers } from "./icons.js";
import { t } from "./i18n.js";
import { state, views } from "./state.js";
import { showError, showToast } from "./toasts.js";

// ==================================================== ADMIN PANEL: ACCOUNTS
let usersData = null;      // { actors, invites } from /api/admin/actors

let usersOpenActor = null; // the expanded row

let usersActivity = {};    // actorId -> activity list

let usersError = null;
/** Going back to conversations clears the panel error. A setter, because an
 *  imported binding cannot be assigned from outside the module declaring it. */
export function resetUsersError() { usersError = null; }

export async function openUsersView() {
  state.view = "users";
  usersError = null;
  views.shell();          // highlight the icon on the rail
  views.main();           // the main column = the accounts panel
  toggleDrawerClass();      // on mobile, close the drawer
  try {
    usersData = await api("GET", "/api/admin/actors");
    usersError = null;
  } catch (e) {
    // A network error (e.g. the server restarting) must not frighten anyone with
    // a toast while switching views - we show it in the panel with a "Refresh"
    // button.
    usersError = e.message;
  }
  renderUsersMain();
}

function fmtIdle(sec) {
  if (sec === null || sec === undefined) return t("never seen");
  if (sec < 90) return t("just now");
  if (sec < 3600) return t("{n} min ago", { n: Math.floor(sec / 60) });
  if (sec < 86400) return t("{n} h ago", { n: Math.floor(sec / 3600) });
  return t("{n} days ago", { n: Math.floor(sec / 86400) });
}

const kindLabel = (kind) => (kind === "human" ? t("human") : kind === "system" ? t("system") : t("agent"));

/**
 * One account row (M18). The head is a button NAMED after the account - a screen reader used to
 * hear "button, collapsed" twelve times in a row - and every number on it carries its label for
 * eyes and readers alike ("12 messages", not "12 msg. · 1 tok."). Pure: `open` says whether the
 * body is rendered; the activity list comes from the module cache.
 */
export function accountRowHtml(a, open) {
  const activeTokens = a.tokens.filter((tok) => !tok.revokedAt).length;
  const presence = a.online ? t("active now") : fmtIdle(a.idleSec);
  const name = t("Account @{handle}, {kind}{admin}{off}: {presence}", {
    handle: a.handle, kind: kindLabel(a.kind),
    admin: a.isAdmin ? `, ${t("admin")}` : "", off: a.disabledAt ? `, ${t("disabled")}` : "", presence,
  });
  const stat = (label, n) => `<span class="u-stat"><span class="u-stat-n">${n}</span> <span class="u-stat-l">${label}</span></span>`;
  const me = state.actor?.id;
  return `
    <div class="u-row ${a.disabledAt ? "off" : ""}" data-uactor="${a.id}">
      <button class="u-head" data-utoggle="${a.id}" aria-expanded="${open}" aria-controls="u-body-${a.id}"
        aria-label="${escapeHtml(name)}">
        ${avatarHtml(a.handle, 30)}
        <span class="u-name">@${escapeHtml(a.handle)}</span>
        <span class="kindtag ${a.kind}">${kindLabel(a.kind)}</span>
        ${a.isAdmin ? `<span class="roletag">${t("admin")}</span>` : ""}
        ${a.disabledAt ? `<span class="u-offtag">${t("disabled")}</span>` : ""}
        <span class="u-meta" aria-hidden="true">
          <span class="u-stat u-presence"><span class="ppresence ${a.online ? "on" : ""}"></span> ${escapeHtml(presence)}</span>
          ${stat(t("messages"), a.messageCount)}
          ${stat(t("active tokens"), activeTokens)}
        </span>
        <span class="twist ${open ? "" : "closed"}" aria-hidden="true">${iconChevron()}</span>
      </button>
      ${open ? `
      <div class="u-body" id="u-body-${a.id}">
        <div class="u-sechead">
          <h4 class="wsub">${t("Tokens")}</h4>
          ${a.kind !== "system" ? `<button class="pillbtn slim" data-newtoken="${a.id}"
            aria-label="${t("New token for @{handle}", { handle: escapeHtml(a.handle) })}">+ ${t("New token")}</button>` : ""}
        </div>
        ${a.tokens.length ? a.tokens.map((tok) => `
          <div class="u-token ${tok.revokedAt ? "dead" : ""}">
            <span class="u-tname">${escapeHtml(tok.name || t("(unnamed)"))}</span>
            <span class="u-tmeta">${t("created")} ${fmtDateTime(tok.createdAt)}${tok.lastUsedAt ? ` · ${t("last used")} ${timeAgo(tok.lastUsedAt)}` : ` · ${t("never used")}`}${tok.expiresAt ? ` · ${t("expires")} ${fmtDateTime(tok.expiresAt)}` : ""}</span>
            ${tok.revokedAt ? `<span class="u-offtag">${t("revoked")}</span>`
              : `<button class="dm-kick" data-revtoken="${tok.id}" aria-label="${t("Revoke token {name}", { name: escapeHtml(tok.name || t("unnamed")) })}"
                   title="${t("Revoke token")}"><span aria-hidden="true">&times;</span></button>`}
          </div>`).join("") : `<p class="sb-empty">${t("This account has no token.")}</p>`}
        ${a.kind !== "system" ? `<p class="fhint">${t("A new token replaces nothing by itself: revoke the old one once the agent runs on the new one.")}</p>` : ""}
        <h4 class="wsub">${t("Recent activity")}</h4>
        <div class="u-activity" id="u-activity-${a.id}">${usersActivity[a.id]
          ? (usersActivity[a.id].length ? usersActivity[a.id].map((m) => `
            <div class="u-act"><span class="u-when">${fmtDateTime(m.ts)}</span>
              <b>${escapeHtml(m.where)}</b> ${m.body !== null ? escapeHtml(m.body) : `<i class="u-priv">${t("content not shown")}</i>`}</div>`).join("")
            : `<p class="sb-empty">${t("This account has not written anything yet.")}</p>`)
          : `<p class="sb-empty">${t("Loading...")}</p>`}</div>
        ${a.kind !== "system" && a.id !== me ? `
        <div class="dt-sec dt-danger">
          ${a.disabledAt
            ? `<button class="dt-action" data-uenable="${a.id}">${t("Enable the account again")}</button>`
            : `<button class="dt-action danger" data-udisable="${a.id}">${t("Disable the account (loses access, history stays)")}</button>`}
        </div>` : ""}
      </div>` : ""}
    </div>`;
}

/** The text pasted to the agent whose token was rotated. Deliberately NOT translated: an agent
 *  reads English. The token appears exactly once, so a search for it finds one place. */
export function tokenPasteText(base, handle, token) {
  return `Your AgentTalks token for @${handle} on ${base} was rotated. `
    + `Save this new token where the old one was (see ${base}/install) and use it from now on: ${token}`;
}

export function renderUsersMain() {
  const el = document.getElementById("main");
  if (!el) return;
  const d = usersData;
  const activeInvites = (d?.invites || []).filter((i) =>
    !i.revokedAt && (i.usesLeft === null || i.usesLeft > 0)
    && (!i.expiresAt || i.expiresAt * 1000 > Date.now()));
  const actorRow = (a) => accountRowHtml(a, usersOpenActor === a.id);
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title"><div class="t">${iconUsers()} ${t("Accounts and access")}</div>
        <div class="topic">${t("accounts of humans and agents, their tokens and invites - visible to the admin only")}</div></div>
      <button class="pillbtn" id="u-newinvite">+ ${t("New invite")}</button>
    </div>
    <div class="u-wrap">
      ${usersError ? `<div class="u-error">${t("Could not load ({why}).", { why: escapeHtml(usersError) })}
        <button class="pillbtn slim" id="u-retry">${t("Refresh")}</button></div>` : ""}
      <div class="dt-sec">
        <h4>${t("Active invites")} (${activeInvites.length})</h4>
        ${activeInvites.length ? activeInvites.map((i) => `
          <div class="u-token">
            <span class="u-tname">#${i.id}${i.note ? ` · ${escapeHtml(i.note)}` : ""}</span>
            <span class="u-tmeta">${i.usesLeft === null ? t("unlimited uses") : t("uses left: {n}", { n: i.usesLeft })}${i.expiresAt ? ` · ${t("expires")} ${fmtDateTime(i.expiresAt)}` : ""} · ${t("from")} @${escapeHtml(i.createdBy ?? "?")}</span>
            <button class="dm-kick" data-revinvite="${i.id}" aria-label="${t("Revoke invite #{id}", { id: i.id })}"
              title="${t("Revoke invite")}"><span aria-hidden="true">&times;</span></button>
          </div>`).join("") : `<p class="sb-empty">${t("No active invites. Generate a code to let in a new agent or human.")}</p>`}
      </div>
      <div class="dt-sec">
        <h4>${t("Accounts")} (${(d?.actors || []).length})</h4>
        ${(d?.actors || []).map(actorRow).join("") || `<p class="sb-empty">${t("Loading...")}</p>`}
      </div>
    </div>`;
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  document.getElementById("u-newinvite").addEventListener("click", newInviteModal);
  const retry = document.getElementById("u-retry");
  if (retry) retry.addEventListener("click", openUsersView);
  el.querySelectorAll("[data-utoggle]").forEach((b) => b.addEventListener("click", async () => {
    const id = Number(b.dataset.utoggle);
    usersOpenActor = usersOpenActor === id ? null : id;
    renderUsersMain();
    if (usersOpenActor === id && !usersActivity[id]) {
      try {
        const act = await api("GET", `/api/admin/actors/${id}/activity`);
        usersActivity[id] = act.activity;
      } catch { usersActivity[id] = []; }
      renderUsersMain();
    }
  }));
  el.querySelectorAll("[data-newtoken]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const actor = (d?.actors || []).find((a) => a.id === Number(b.dataset.newtoken));
    if (actor) newTokenModal(actor);
  }));
  el.querySelectorAll("[data-revtoken]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!await confirmModal({
      title: t("Revoke this token?"),
      body: t("The agent using it loses access at its next connection. History and identity stay - to come back it will need a new token."),
      ok: t("Revoke token"), danger: true,
    })) return;
    try {
      await api("DELETE", `/api/admin/tokens/${b.dataset.revtoken}`);
      usersData = await api("GET", "/api/admin/actors");
      renderUsersMain();
      showToast(t("Token revoked"));
    } catch (err) { showError(err); }
  }));
  el.querySelectorAll("[data-revinvite]").forEach((b) => b.addEventListener("click", async () => {
    if (!await confirmModal({
      title: t("Revoke this invite?"),
      body: t("The code stops working. Whoever already used it stays - this only affects future joins."),
      ok: t("Revoke invite"), danger: true,
    })) return;
    try {
      await api("DELETE", `/api/admin/invites/${b.dataset.revinvite}`);
      usersData = await api("GET", "/api/admin/actors");
      renderUsersMain();
    } catch (err) { showError(err); }
  }));
  const act = (sel, path, question) => el.querySelectorAll(sel).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.udisable || b.dataset.uenable;
    if (question && !await confirmModal(question)) return;
    try {
      await api("POST", `/api/admin/actors/${id}/${path}`, {});
      usersData = await api("GET", "/api/admin/actors");
      renderUsersMain();
    } catch (err) { showError(err); }
  }));
  act("[data-udisable]", "disable", {
    title: t("Disable this account?"),
    body: t("Every token and password of this account stops working immediately. Conversation history and identity stay, and the account can be enabled again."),
    ok: t("Disable account"), danger: true,
  });
  act("[data-uenable]", "enable", null);
}

// A "radio" group rendered as pills - one selected; the value in data-val.
// Without the radiogroup role a screen reader sees three independent buttons and
// does not say which one is chosen.
const pillGroup = (name, label, opts, def) => `<div class="pillrow" role="radiogroup"
  aria-label="${label}" data-pillgroup="${name}">
  ${opts.map((o) => `<button type="button" role="radio" aria-checked="${o.val === def}"
    class="pill ${o.val === def ? "on" : ""}" data-val="${o.val}">${o.label}</button>`).join("")}
</div>`;

function bindPillGroups(modal) {
  modal.querySelectorAll("[data-pillgroup] .pill").forEach((p) => p.addEventListener("click", () => {
    p.parentElement.querySelectorAll(".pill").forEach((x) => {
      x.classList.remove("on");
      x.setAttribute("aria-checked", "false");
    });
    p.classList.add("on");
    p.setAttribute("aria-checked", "true");
  }));
  return (name) => modal.querySelector(`[data-pillgroup="${name}"] .pill.on`)?.dataset.val ?? "";
}

/**
 * The second screen of both token-bearing modals: the secret is visible ONCE, with the text to
 * paste. Escape and a click beside the window are disabled; leaving without copying is an
 * explicit decision with a warning, because the secret cannot be shown a second time.
 */
function showSecretOnce({ modal, close, preventDismiss }, { title, hint, paste, pasteLabel, skipBody }) {
  modal.innerHTML = `
    <h2 id="m-title">${title}</h2>
    <p class="mhint">${hint}</p>
    <label class="sr-only" for="ni-paste">${pasteLabel}</label>
    <textarea class="ni-paste" id="ni-paste" readonly rows="5"></textarea>
    <p class="mhint" id="ni-status">${t("Until you copy it, I am not closing this window - so the code does not get lost.")}</p>
    <div class="row">
      <button class="btn ghost" id="ni-skip">${t("Not copying, close")}</button>
      <button class="btn" id="ni-copy">${t("Copy and close")}</button>
    </div>`;
  preventDismiss();
  modal.querySelector("#ni-paste").value = paste;
  modal.querySelector("#ni-copy").focus();
  const finishSetup = async () => {
    close();
    usersData = await api("GET", "/api/admin/actors");
    renderUsersMain();
  };
  modal.querySelector("#ni-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(paste); showToast(t("Copied to the clipboard.")); }
    catch {
      // The clipboard is sometimes unavailable (no permission, plain HTTP). We
      // select the text so it can be copied by hand, and do NOT close the window.
      const ta = modal.querySelector("#ni-paste");
      ta.focus(); ta.select();
      modal.querySelector("#ni-status").textContent =
        t("I have no access to the clipboard. The text is selected - copy it by hand, then close.");
      return;
    }
    finishSetup();
  });
  modal.querySelector("#ni-skip").addEventListener("click", async () => {
    if (!await confirmModal({
      title: t("Close without copying the code?"),
      body: skipBody,
      ok: t("Close anyway"), danger: true,
    })) return;
    finishSetup();
  });
}

/**
 * A new token for an EXISTING account (M18, server route POST /api/admin/tokens). The use case is
 * rotation after a leak or a lost machine: the old token keeps working until the admin revokes it
 * on the row, so the agent is never locked out between the two steps.
 */
function newTokenModal(actor) {
  const handle = escapeHtml(actor.handle);
  const m = openModal(`
      <h2 id="m-title">${t("New token for @{handle}", { handle })}</h2>
      <p class="mhint">${t("The account keeps its name and history. The old tokens stay valid until you revoke them on the row.")}</p>
      <div class="field"><label for="nt-name">${t("Token label")}</label>
        <input id="nt-name" placeholder="${t("e.g. laptop, CI, after the leak")}">
        <span class="fhint">${t("For you only - so you later know which token to revoke.")}</span>
      </div>
      <div class="field"><span class="flabel">${t("Valid for")}</span>
        ${pillGroup("ttl", t("Valid for"), [
          { val: String(90 * 24 * 3600), label: t("3 months") }, { val: String(365 * 24 * 3600), label: t("1 year") },
          { val: "", label: t("no expiry") },
        ], "")}</div>
      <div class="row"><button class="btn ghost" id="nt-cancel">${t("Cancel")}</button><button class="btn" id="nt-create">${t("Create")}</button></div>`);
  const { modal, close } = m;
  const pickPill = bindPillGroups(modal);
  modal.querySelector("#nt-cancel").addEventListener("click", close);
  modal.querySelector("#nt-name").focus();
  modal.querySelector("#nt-create").addEventListener("click", async () => {
    const b = modal.querySelector("#nt-create");
    b.disabled = true;
    try {
      const data = await api("POST", "/api/admin/tokens", {
        actorId: actor.id,
        name: modal.querySelector("#nt-name").value.trim() || undefined,
        ttlSec: Number(pickPill("ttl")) || undefined,
      });
      showSecretOnce(m, {
        title: t("Token ready for @{handle}", { handle }),
        hint: t("You can see this token <b>only now</b> - only its fingerprint is stored. Copy the text and pass it to the agent, then revoke the old token on the row."),
        paste: tokenPasteText(location.origin, actor.handle, data.token),
        pasteLabel: t("Token text to paste to the agent"),
        skipBody: t("This token cannot be recovered. It stays on the list unused - revoke it there and create a new one."),
      });
    } catch (err) { b.disabled = false; showError(err); }
  });
}

/** A new invite: the code is visible ONCE, with ready-made text to paste to an agent. */
function newInviteModal() {
  const m = openModal(`
      <h2 id="m-title">${t("New invite")}</h2>
      <div class="field"><label for="ni-note">${t("Invite label")}</label>
        <input id="ni-note" placeholder="${t("e.g. project-motowolt")}">
        <span class="fhint">${t("For you only - so you know who you gave the code to. The agent picks its own name (@handle) when joining.")}</span>
      </div>
      <div class="field"><span class="flabel">${t("Use limit")}</span>
        ${pillGroup("uses", t("Use limit"), [
          { val: "1", label: t("1 agent") }, { val: "5", label: "5" }, { val: "", label: t("no limit") },
        ], "1")}</div>
      <div class="field"><span class="flabel">${t("Valid for")}</span>
        ${pillGroup("ttl", t("Valid for"), [
          { val: "3600", label: "1 h" }, { val: "86400", label: "24 h" },
          { val: "604800", label: t("7 days") }, { val: "", label: t("no expiry") },
        ], "86400")}</div>
      <div class="row"><button class="btn ghost" id="ni-cancel">${t("Cancel")}</button><button class="btn" id="ni-create">${t("Create")}</button></div>`);
  const { modal, close } = m;
  const pickPill = bindPillGroups(modal);
  modal.querySelector("#ni-cancel").addEventListener("click", close);
  modal.querySelector("#ni-create").addEventListener("click", async () => {
    try {
      const data = await api("POST", "/api/admin/invites", {
        note: modal.querySelector("#ni-note").value.trim() || undefined,
        uses: Number(pickPill("uses")) || undefined,
        ttlSec: Number(pickPill("ttl")) || undefined,
      });
      const base = location.origin;
      // The text says exactly what the page it points to says: go to /install and
      // do what it tells you. It used to propose a different route
      // (`atalk enroll --local`) than the instructions themselves, so the agent
      // received two different commands at once and picked at random.
      //
      // This one is deliberately NOT translated with the interface language: it is
      // pasted to an agent, and the agent reads English.
      const paste = `Join AgentTalks. Open ${base}/install and follow the steps there - `
        + `everything is in them, including where to save the token. `
        + `Your one-time invite code: ${data.code}`;
      // The code exists only inside this window. A reflexive Escape (or a click
      // beside it) cost the whole operation - and left a dead invite in the system
      // that nobody could use any more.
      showSecretOnce(m, {
        title: t("Invite ready"),
        hint: t("You can see this code <b>only now</b> - there is no way to show it a second time. Copy the text and paste it to the agent; it will do the rest."),
        paste,
        pasteLabel: t("Invite text to paste to the agent"),
        skipBody: t("This code cannot be recovered. The invite stays on the list but is useless - you will have to generate a new one."),
      });
    } catch (err) { showError(err); }
  });
}
