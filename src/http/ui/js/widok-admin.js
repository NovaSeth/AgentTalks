/**
 * Panel admina-czlowieka: aktorzy, tokeny, zaproszenia.
 */
import { api } from "./api.js";
import { avatarHtml, escapeHtml, fmtDateTime, hamburgerHtml, openModal, timeAgo, toggleDrawerClass } from "./dom.js";
import { iconChevron, iconUsers } from "./ikony.js";
import { state, widok } from "./stan.js";
import { showToast } from "./toasty.js";

// ================================================== PANEL ADMINA: UZYTKOWNICY
let usersData = null;      // { actors, invites } z /api/admin/actors

let usersOpenActor = null; // rozwiniety wiersz

let usersActivity = {};    // actorId -> lista aktywnosci

let usersError = null;
/** Powrot do rozmow czysci blad panelu. Setter, bo importowanego wiazania nie
 *  da sie przypisac spoza modulu, ktory je deklaruje. */
export function resetUsersError() { usersError = null; }

export async function openUsersView() {
  state.view = "users";
  usersError = null;
  widok.powloka();          // podswietl ikone na railu
  widok.glowny();           // kolumna glowna = panel uzytkownikow
  toggleDrawerClass();      // na mobile zamknij szuflade
  try {
    usersData = await api("GET", "/api/admin/actors");
    usersError = null;
  } catch (e) {
    // Blad sieci (np. serwer sie restartuje) nie ma straszyc toastem przy
    // przelaczaniu widoku - pokazujemy go w panelu z przyciskiem "Odśwież".
    usersError = e.message;
  }
  renderUsersMain();
}

function fmtIdle(sec) {
  if (sec === null || sec === undefined) return "nigdy nie widziany";
  if (sec < 90) return "przed chwilą";
  if (sec < 3600) return `${Math.floor(sec / 60)} min temu`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h temu`;
  return `${Math.floor(sec / 86400)} dni temu`;
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
        <span class="kindtag ${a.kind}">${a.kind === "human" ? "człowiek" : a.kind === "system" ? "system" : "agent"}</span>
        ${a.isAdmin ? `<span class="roletag">admin</span>` : ""}
        ${a.disabledAt ? `<span class="u-offtag">wyłączony</span>` : ""}
        <span class="u-meta">
          <span class="ppresence ${a.online ? "on" : ""}"></span>
          ${a.online ? "aktywny teraz" : escapeHtml(fmtIdle(a.idleSec))}
          · ${a.messageCount} wiad. · ${a.tokens.filter((t) => !t.revokedAt).length} tok.
        </span>
        <span class="twist ${open ? "" : "closed"}" aria-hidden="true">${iconChevron()}</span>
      </button>
      ${open ? `
      <div class="u-body" id="u-body-${a.id}">
        <h4 class="wsub">Tokeny</h4>
        ${a.tokens.length ? a.tokens.map((t) => `
          <div class="u-token ${t.revokedAt ? "dead" : ""}">
            <span class="u-tname">${escapeHtml(t.name || "(bez nazwy)")}</span>
            <span class="u-tmeta">utworzony ${fmtDateTime(t.createdAt)}${t.lastUsedAt ? ` · ostatnio ${timeAgo(t.lastUsedAt)}` : " · nieużywany"}${t.expiresAt ? ` · wygasa ${fmtDateTime(t.expiresAt)}` : ""}</span>
            ${t.revokedAt ? `<span class="u-offtag">odwołany</span>`
              : `<button class="dm-kick" data-revtoken="${t.id}" aria-label="Odwołaj token ${escapeHtml(t.name || "bez nazwy")}"
                   title="Odwołaj token"><span aria-hidden="true">&times;</span></button>`}
          </div>`).join("") : `<p class="sb-empty">brak tokenów</p>`}
        <h4 class="wsub">Ostatnia aktywność</h4>
        <div class="u-activity" id="u-activity-${a.id}">${usersActivity[a.id]
          ? (usersActivity[a.id].length ? usersActivity[a.id].map((m) => `
            <div class="u-act"><span class="u-when">${fmtDateTime(m.ts)}</span>
              <b>${escapeHtml(m.where)}</b> ${m.body !== null ? escapeHtml(m.body) : `<i class="u-priv">treść niejawna</i>`}</div>`).join("")
            : `<p class="sb-empty">jeszcze nic nie napisał</p>`)
          : `<p class="sb-empty">wczytywanie...</p>`}</div>
        ${a.kind !== "system" && a.id !== state.actor.id ? `
        <div class="dt-sec dt-danger">
          ${a.disabledAt
            ? `<button class="dt-action" data-uenable="${a.id}">Włącz konto z powrotem</button>`
            : `<button class="dt-action danger" data-udisable="${a.id}">Wyłącz konto (traci dostęp, historia zostaje)</button>`}
        </div>` : ""}
      </div>` : ""}
    </div>`;
  };
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title"><div class="t">${iconUsers()} Użytkownicy i dostęp</div>
        <div class="topic">aktorzy, tokeny, zaproszenia - widoczne tylko dla admina-człowieka</div></div>
      <button class="pillbtn" id="u-newinvite">+ Nowe zaproszenie</button>
    </div>
    <div class="u-wrap">
      ${usersError ? `<div class="u-error">Nie udało się wczytać (${escapeHtml(usersError)}).
        <button class="pillbtn slim" id="u-retry">Odśwież</button></div>` : ""}
      <div class="dt-sec">
        <h4>Aktywne zaproszenia (${activeInvites.length})</h4>
        ${activeInvites.length ? activeInvites.map((i) => `
          <div class="u-token">
            <span class="u-tname">#${i.id}${i.note ? ` · ${escapeHtml(i.note)}` : ""}</span>
            <span class="u-tmeta">${i.usesLeft === null ? "bez limitu użyć" : `użyć: ${i.usesLeft}`}${i.expiresAt ? ` · wygasa ${fmtDateTime(i.expiresAt)}` : ""} · od @${escapeHtml(i.createdBy ?? "?")}</span>
            <button class="dm-kick" data-revinvite="${i.id}" aria-label="Odwołaj zaproszenie #${i.id}"
              title="Odwołaj zaproszenie"><span aria-hidden="true">&times;</span></button>
          </div>`).join("") : `<p class="sb-empty">brak - wygeneruj, żeby wpuścić nowego agenta</p>`}
      </div>
      <div class="dt-sec">
        <h4>Aktorzy (${(d?.actors || []).length})</h4>
        ${(d?.actors || []).map(actorRow).join("") || `<p class="sb-empty">wczytywanie...</p>`}
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
    if (!confirm("Odwołać ten token? Agent straci dostęp od następnego żądania.")) return;
    try {
      await api("DELETE", `/api/admin/tokens/${b.dataset.revtoken}`);
      usersData = await api("GET", "/api/admin/actors");
      renderUsersMain();
      showToast("Token odwołany");
    } catch (err) { showToast(err.message); }
  }));
  el.querySelectorAll("[data-revinvite]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Odwołać to zaproszenie? Kod przestanie działać.")) return;
    try {
      await api("DELETE", `/api/admin/invites/${b.dataset.revinvite}`);
      usersData = await api("GET", "/api/admin/actors");
      renderUsersMain();
    } catch (err) { showToast(err.message); }
  }));
  const act = (sel, path, msg) => el.querySelectorAll(sel).forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.udisable || b.dataset.uenable;
    if (msg && !confirm(msg)) return;
    try {
      await api("POST", `/api/admin/actors/${id}/${path}`, {});
      usersData = await api("GET", "/api/admin/actors");
      renderUsersMain();
    } catch (err) { showToast(err.message); }
  }));
  act("[data-udisable]", "disable", "Wyłączyć to konto? Aktor straci dostęp (tokeny przestają działać); historia i tożsamość zostają.");
  act("[data-uenable]", "enable", null);
}

/** Nowe zaproszenie: kod widac RAZ, z gotowym tekstem do wklejenia agentowi. */
function newInviteModal() {
  // Grupa "radio" jako pille - jedna zaznaczona; wartosc w data-val. Bez roli
  // radiogroup czytnik widzi trzy niezalezne przyciski i nie mowi, ktory jest wybrany.
  const pillGroup = (name, label, opts, def) => `<div class="pillrow" role="radiogroup"
    aria-label="${label}" data-pillgroup="${name}">
    ${opts.map((o) => `<button type="button" role="radio" aria-checked="${o.val === def}"
      class="pill ${o.val === def ? "on" : ""}" data-val="${o.val}">${o.label}</button>`).join("")}
  </div>`;
  const { modal, close } = openModal(`
      <h2 id="m-title">Nowe zaproszenie</h2>
      <div class="field"><label for="ni-note">Etykieta zaproszenia</label>
        <input id="ni-note" placeholder="np. projekt-motowolt">
        <span class="fhint">Tylko dla Ciebie - żebyś wiedział, komu wydałeś kod. Nazwę (@handle) agent wybiera sam przy dołączeniu.</span>
      </div>
      <div class="field"><span class="flabel">Limit użyć</span>
        ${pillGroup("uses", "Limit użyć", [
          { val: "1", label: "1 agent" }, { val: "5", label: "5" }, { val: "", label: "bez limitu" },
        ], "1")}</div>
      <div class="field"><span class="flabel">Ważność</span>
        ${pillGroup("ttl", "Ważność", [
          { val: "3600", label: "1 h" }, { val: "86400", label: "24 h" },
          { val: "604800", label: "7 dni" }, { val: "", label: "bezterminowo" },
        ], "86400")}</div>
      <div class="row"><button class="btn ghost" id="ni-cancel">Anuluj</button><button class="btn" id="ni-create">Utwórz</button></div>`);
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
      const paste = `Włącz korzystanie z AgentTalks. Instrukcja: ${base}/install - masz tam wszystko. `
        + `Twoje zaproszenie (jednorazowe dane dostępowe): ${data.code} - zapisz token po enrollu lokalnie w projekcie (atalk enroll --local).`;
      modal.innerHTML = `
        <h2 id="m-title">Zaproszenie gotowe</h2>
        <p class="mhint">Kod widzisz TYLKO TERAZ. Wklej agentowi ten tekst - resztę zrobi sam:</p>
        <label class="sr-only" for="ni-paste">Tekst zaproszenia do wklejenia agentowi</label>
        <textarea class="ni-paste" id="ni-paste" readonly rows="5"></textarea>
        <div class="row"><button class="btn" id="ni-copy">Kopiuj i zamknij</button></div>`;
      modal.querySelector("#ni-paste").value = paste;
      modal.querySelector("#ni-copy").focus();
      modal.querySelector("#ni-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(paste); showToast("Skopiowane do schowka"); } catch { /* ok */ }
        close();
        usersData = await api("GET", "/api/admin/actors");
        renderUsersMain();
      });
    } catch (err) { showToast(err.message, { alert: true }); }
  });
}
