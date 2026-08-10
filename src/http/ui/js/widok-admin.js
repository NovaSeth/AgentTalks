/**
 * The human admin panel: actors, tokens, invites.
 */
import { api } from "./api.js";
import { avatarHtml, confirmModal, escapeHtml, fmtDateTime, hamburgerHtml, openModal, timeAgo, toggleDrawerClass } from "./dom.js";
import { iconChevron, iconUsers } from "./ikony.js";
import { t } from "./i18n.js";
import { state, widok } from "./stan.js";
import { showError, showToast } from "./toasty.js";

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
  widok.powloka();          // highlight the icon on the rail
  widok.glowny();           // the main column = the accounts panel
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

export function renderUsersMain() {
  const el = document.getElementById("main");
  if (!el) return;
  const d = usersData;
  const activeInvites = (d?.invites || []).filter((i) =>
    !i.revokedAt && (i.usesLeft === null || i.usesLeft > 0)
    && (!i.expiresAt || i.expiresAt * 1000 > Date.now()));
  const actorRow = (a) => {
    const open = usersOpenActor === a.id;
    return `
    <div class="u-row ${a.disabledAt ? "off" : ""}" data-uactor="${a.id}">
      <button class="u-head" data-utoggle="${a.id}" aria-expanded="${open}" aria-controls="u-body-${a.id}">
        ${avatarHtml(a.handle, 30)}
        <span class="u-name">@${escapeHtml(a.handle)}</span>
        <span class="kindtag ${a.kind}">${a.kind === "human" ? t("human") : a.kind === "system" ? t("system") : t("agent")}</span>
        ${a.isAdmin ? `<span class="roletag">admin</span>` : ""}
        ${a.disabledAt ? `<span class="u-offtag">${t("disabled")}</span>` : ""}
        <span class="u-meta">
          <span class="ppresence ${a.online ? "on" : ""}"></span>
          ${a.online ? t("active now") : escapeHtml(fmtIdle(a.idleSec))}
          · ${t("{n} msg.", { n: a.messageCount })} · ${a.tokens.filter((tok) => !tok.revokedAt).length} ${t("tok.")}
        </span>
        <span class="twist ${open ? "" : "closed"}" aria-hidden="true">${iconChevron()}</span>
      </button>
      ${open ? `
      <div class="u-body" id="u-body-${a.id}">
        <h4 class="wsub">${t("Tokens")}</h4>
        ${a.tokens.length ? a.tokens.map((tok) => `
          <div class="u-token ${tok.revokedAt ? "dead" : ""}">
            <span class="u-tname">${escapeHtml(tok.name || t("(unnamed)"))}</span>
            <span class="u-tmeta">${t("created")} ${fmtDateTime(tok.createdAt)}${tok.lastUsedAt ? ` · ${t("last used")} ${timeAgo(tok.lastUsedAt)}` : ` · ${t("never used")}`}${tok.expiresAt ? ` · ${t("expires")} ${fmtDateTime(tok.expiresAt)}` : ""}</span>
            ${tok.revokedAt ? `<span class="u-offtag">${t("revoked")}</span>`
              : `<button class="dm-kick" data-revtoken="${tok.id}" aria-label="${t("Revoke token {name}", { name: escapeHtml(tok.name || t("unnamed")) })}"
                   title="${t("Revoke token")}"><span aria-hidden="true">&times;</span></button>`}
          </div>`).join("") : `<p class="sb-empty">${t("This account has no token.")}</p>`}
        <p class="fhint">${t("A new token is issued through an invite (button at the top). Swapping the token of an existing account still needs server access - the panel cannot do it.")}</p>
        <h4 class="wsub">${t("Recent activity")}</h4>
        <div class="u-activity" id="u-activity-${a.id}">${usersActivity[a.id]
          ? (usersActivity[a.id].length ? usersActivity[a.id].map((m) => `
            <div class="u-act"><span class="u-when">${fmtDateTime(m.ts)}</span>
              <b>${escapeHtml(m.where)}</b> ${m.body !== null ? escapeHtml(m.body) : `<i class="u-priv">${t("content not shown")}</i>`}</div>`).join("")
            : `<p class="sb-empty">${t("This account has not written anything yet.")}</p>`)
          : `<p class="sb-empty">${t("Loading...")}</p>`}</div>
        ${a.kind !== "system" && a.id !== state.actor.id ? `
        <div class="dt-sec dt-danger">
          ${a.disabledAt
            ? `<button class="dt-action" data-uenable="${a.id}">${t("Enable the account again")}</button>`
            : `<button class="dt-action danger" data-udisable="${a.id}">${t("Disable the account (loses access, history stays)")}</button>`}
        </div>` : ""}
      </div>` : ""}
    </div>`;
  };
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
  const act = (sel, path, pytanie) => el.querySelectorAll(sel).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.udisable || b.dataset.uenable;
    if (pytanie && !await confirmModal(pytanie)) return;
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

/** A new invite: the code is visible ONCE, with ready-made text to paste to an agent. */
function newInviteModal() {
  // A "radio" group rendered as pills - one selected; the value in data-val.
  // Without the radiogroup role a screen reader sees three independent buttons and
  // does not say which one is chosen.
  const pillGroup = (name, label, opts, def) => `<div class="pillrow" role="radiogroup"
    aria-label="${label}" data-pillgroup="${name}">
    ${opts.map((o) => `<button type="button" role="radio" aria-checked="${o.val === def}"
      class="pill ${o.val === def ? "on" : ""}" data-val="${o.val}">${o.label}</button>`).join("")}
  </div>`;
  const { modal, close, zablokujZamykanie } = openModal(`
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
  modal.querySelectorAll("[data-pillgroup] .pill").forEach((p) => p.addEventListener("click", () => {
    p.parentElement.querySelectorAll(".pill").forEach((x) => {
      x.classList.remove("on");
      x.setAttribute("aria-checked", "false");
    });
    p.classList.add("on");
    p.setAttribute("aria-checked", "true");
  }));
  const pickPill = (name) => modal.querySelector(`[data-pillgroup="${name}"] .pill.on`)?.dataset.val ?? "";
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
      modal.innerHTML = `
        <h2 id="m-title">${t("Invite ready")}</h2>
        <p class="mhint">${t("You can see this code <b>only now</b> - there is no way to show it a second time. Copy the text and paste it to the agent; it will do the rest.")}</p>
        <label class="sr-only" for="ni-paste">${t("Invite text to paste to the agent")}</label>
        <textarea class="ni-paste" id="ni-paste" readonly rows="5"></textarea>
        <p class="mhint" id="ni-status">${t("Until you copy it, I am not closing this window - so the code does not get lost.")}</p>
        <div class="row">
          <button class="btn ghost" id="ni-skip">${t("Not copying, close")}</button>
          <button class="btn" id="ni-copy">${t("Copy and close")}</button>
        </div>`;
      // The code exists only inside this window. A reflexive Escape (or a click
      // beside it) cost the whole operation - and left a dead invite in the system
      // that nobody could use any more.
      zablokujZamykanie();
      modal.querySelector("#ni-paste").value = paste;
      modal.querySelector("#ni-copy").focus();
      const domknij = async () => {
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
        domknij();
      });
      // Leaving without copying exists, but as an explicit decision with a warning
      // rather than by accident.
      modal.querySelector("#ni-skip").addEventListener("click", async () => {
        if (!await confirmModal({
          title: t("Close without copying the code?"),
          body: t("This code cannot be recovered. The invite stays on the list but is useless - you will have to generate a new one."),
          ok: t("Close anyway"), danger: true,
        })) return;
        domknij();
      });
    } catch (err) { showError(err); }
  });
}
