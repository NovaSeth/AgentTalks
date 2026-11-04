/**
 * People (S6): the profile in the side panel, the member picker of the "New conversation" modal,
 * the pure helpers both share (filtering, @system hidden, presence facts).
 *
 * Who opens a profile: a click on a name or avatar in a message (delegated, see
 * `bindProfileClicks`), a "Who is here" row, a member row in Details, a face in the channel
 * header. The panel is the S2 side panel: `state.profileHandle` (a dynamic field; state.js is
 * not this slice's file) makes `sidePanelOf` answer `{ kind: "profile" }`, `renderMain` writes
 * `#profile-slot`, and `renderProfile` fills it. Esc closes it and gives focus back to what was
 * clicked, as a popover would.
 */
import { startDirect } from "./actions.js";
import { api, sessionGeneration } from "./api.js";
import { ensureActors } from "./data.js";
import { avatarHtml, escapeHtml, timeAgo } from "./dom.js";
import { iconChat, iconClose, iconGear, iconUsers } from "./icons.js";
import { t } from "./i18n.js";
import { handleOnline, state, views } from "./state.js";
import { showError } from "./toasts.js";

/** Renders the people view into `el`. There is no stand-alone people screen yet: the sidebar's
 *  "Who is here" and the profile panel are the directory. */
export function renderPeople(el) {
  if (el) el.innerHTML = "";
}

// --------------------------------------------------------------- pure helpers
const low = (s) => String(s ?? "").toLowerCase();

/** The people a picker offers for `query`. `@system` is a machine account and is left out
 *  unless `excludeSystem: false`; `excludeHandle` is usually me; `exclude` the chips already
 *  chosen. A handle prefix ranks first, then a handle containing the text, then a display name
 *  containing it; ties by handle. An empty query lists everybody left, sorted by handle. */
export function filterPeople(list, query, opts = {}) {
  if (!Array.isArray(list)) return [];
  const excludeSystem = opts.excludeSystem !== false;
  const skip = new Set((opts.exclude || []).map(low));
  if (opts.excludeHandle) skip.add(low(opts.excludeHandle));
  const q = low(query).trim().replace(/^@/, "");
  const rank = (a) => {
    if (!q) return 0;
    const h = low(a.handle), d = low(a.displayName);
    if (h.startsWith(q)) return 1;
    if (h.includes(q)) return 2;
    if (d.includes(q)) return 3;
    return 0;
  };
  return list
    .filter((a) => a && a.handle && !skip.has(low(a.handle)) && !(excludeSystem && a.kind === "system"))
    .map((a) => ({ a, r: rank(a) }))
    .filter((x) => !q || x.r > 0)
    .sort((x, y) => (x.r - y.r) || low(x.a.handle).localeCompare(low(y.a.handle)))
    .map((x) => x.a);
}

/** Member rows without the machine account. An unknown actor (not in the cache yet) stays:
 *  hiding somebody because the directory has not arrived would be a lie about the room. */
export function visibleMembers(members, cache) {
  return (members || []).filter((m) => (cache?.[m.actorId]?.kind) !== "system");
}

/** What a profile says about presence: online now, what an agent is doing (from its session),
 *  and the last trace otherwise. Pure: `presence` is the rows of GET /api/presence. */
export function profileFacts(actor, presence) {
  const rows = (presence || []).filter((p) => p.actorId === actor.id || low(p.handle) === low(actor.handle));
  const online = rows.some((p) => p.online);
  const busy = rows.find((p) => p.online && p.doing) || rows.find((p) => p.doing);
  return {
    online,
    doing: busy ? busy.doing : null,
    lastActiveAt: actor.lastActiveAt ?? null,
    wakeable: actor.wakeable ?? null,
  };
}

function actorByHandle(handle) {
  const h = low(handle);
  for (const a of state.actorsList) if (low(a.handle) === h) return a;
  for (const [id, a] of Object.entries(state.actorsCache)) if (low(a.handle) === h) return { id: Number(id), ...a };
  return null;
}

// ---------------------------------------------------------------- the profile
// The element that opened the profile, so Esc can give focus back to it. The main column is
// rebuilt when the panel closes, so a locator is kept next to the node and re-queried then.
let profileAnchor = null;
let profileAnchorLocator = null;
let profileKeysBound = false;

const cssEscape = (s) => (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");

/** A selector that finds the same control after a redraw, or null when nothing stable is known. */
function locatorOf(el) {
  if (!el || typeof el.closest !== "function") return null;
  const tagged = el.closest("[data-profile]");
  if (tagged) return `[data-profile="${cssEscape(tagged.dataset.profile)}"]`;
  const person = el.closest("[data-person]");
  if (person) return `[data-person="${cssEscape(person.dataset.person)}"]`;
  const msg = el.closest(".msg[data-msg]");
  if (msg) return `.msg[data-msg="${cssEscape(msg.dataset.msg)}"] .head .author`;
  return null;
}

/** Opens @handle's profile in the side panel. `anchor` is the clicked element (focus returns
 *  there on Esc). A click on my own name opens my profile too: it is the one place that says
 *  what the room sees about me. */
export async function openProfile(handle, anchor) {
  const h = String(handle || "").replace(/^@/, "").trim();
  if (!h || h === "?") return;
  profileAnchor = anchor || document.activeElement || null;
  profileAnchorLocator = locatorOf(profileAnchor);
  state.profileHandle = h;
  bindProfileKeys();
  if (!actorByHandle(h)) {
    const gen = sessionGeneration();
    try { await ensureActors({ force: true }); } catch { /* the panel says "unknown" below */ }
    if (gen !== sessionGeneration()) return;   // the account changed while the directory loaded (F1)
  }
  views.main();
  const panel = document.getElementById("profile-slot");
  // Focus moves into the panel so a keyboard user lands on what just opened; the close button
  // is the first thing in reading order.
  panel?.querySelector("#pf-close")?.focus();
}

/** Closes the profile and returns focus to the element that opened it (acceptance 6). */
export function closeProfile() {
  if (!state.profileHandle) return;
  state.profileHandle = null;
  views.main();
  let back = profileAnchor;
  const locator = profileAnchorLocator;
  profileAnchor = null; profileAnchorLocator = null;
  if (back && document.contains?.(back) === false && locator) back = document.querySelector(locator);
  if (!back || typeof back.focus !== "function") return;
  // A message name is a plain span: it takes focus only with a tabindex, set once, out of the
  // tab order, so the panel hands focus back exactly where the hand was.
  if (back.tabIndex < 0 && typeof back.setAttribute === "function" && !back.hasAttribute?.("tabindex")) back.setAttribute("tabindex", "-1");
  back.focus();
}

function bindProfileKeys() {
  if (profileKeysBound) return;
  profileKeysBound = true;
  // Capture phase: app.js's bubble-phase Escape would close the thread or the details first;
  // the profile is the top-most layer while it is open. Windows (.overlay) keep their own Esc.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !state.profileHandle) return;
    if (document.querySelector(".overlay")) return;
    e.preventDefault();
    e.stopPropagation();
    closeProfile();
  }, true);
}

/** Message names and avatars are plain markup owned by the message renderer; one delegated
 *  listener on the document makes every `.msg .author` and `.msg > .av` open a profile, and
 *  `[data-profile]` anywhere (header faces, member rows) too. Bound once. */
let clicksBound = false;
export function bindProfileClicks() {
  if (clicksBound) return;
  clicksBound = true;
  document.addEventListener("click", (e) => {
    // A feature check, not `instanceof Element`: the node test stubs fire plain objects.
    const target = e.target && typeof e.target.closest === "function" ? e.target : null;
    if (!target) return;
    const tagged = target.closest("[data-profile]");
    if (tagged) { e.preventDefault(); openProfile(tagged.dataset.profile, tagged); return; }
    const msg = target.closest(".msg");
    if (!msg || msg.classList.contains("sending") || msg.classList.contains("failed")) return;
    const author = target.closest(".msg .head .author");
    const av = target.closest(".msg > .av");
    if (!author && !av) return;
    const name = (author || msg.querySelector(".head .author"))?.textContent || "";
    openProfile(name.replace(/^@/, "").trim(), author || av);
  });
}

/** The profile panel markup + bindings, into `#profile-slot` (written by renderMain). */
export function renderProfile() {
  const host = document.getElementById("profile-slot");
  if (!host) return;
  const h = state.profileHandle;
  if (!h) { host.innerHTML = ""; return; }
  const a = actorByHandle(h);
  const me = state.actor && low(state.actor.handle) === low(h);
  const facts = a ? profileFacts(a, state.presence) : { online: handleOnline(h), doing: null, lastActiveAt: null, wakeable: null };
  const kind = a?.kind || "agent";
  const kindLabel = kind === "human" ? t("human") : kind === "system" ? t("system") : t("agent");
  const presenceLine = facts.online
    ? `<span class="pf-online"><span class="ppresence on"></span> ${t("online now")}</span>`
    : `<span class="pf-offline"><span class="ppresence"></span> ${t("last seen {when}", { when: escapeHtml(timeAgo(facts.lastActiveAt)) })}</span>`;
  host.innerHTML = `
    <div class="thread profile" role="region" aria-label="${t("Profile of @{handle}", { handle: escapeHtml(h) })}">
      <div class="th-head">${t("Profile")}
        <button class="iconbtn close" id="pf-close" aria-label="${t("Close the profile")}" title="${t("Close")}">${iconClose()}</button></div>
      <div class="dt-body pf-body">
        <div class="pf-card ${kind}">
          ${avatarHtml(h, 72)}
          <div class="pf-names">
            <div class="pf-handle">@${escapeHtml(h)}</div>
            ${a?.displayName && low(a.displayName) !== low(h) ? `<div class="pf-display">${escapeHtml(a.displayName)}</div>` : ""}
            <span class="kindtag ${kind}">${kindLabel}</span>
            ${me ? `<span class="roletag">${t("you")}</span>` : ""}
          </div>
        </div>
        ${a ? "" : `<p class="dt-hint">${t("Nobody by this name is in the directory. The account may have been removed.")}</p>`}
        <div class="dt-sec pf-presence">${presenceLine}</div>
        ${facts.doing ? `<div class="dt-sec pf-doing">${iconGear()} <span>${t("working")}: <i>${escapeHtml(facts.doing)}</i></span></div>` : ""}
        ${facts.wakeable === true ? `<div class="dt-sec pf-wake">${t("Can be woken while asleep")}</div>` : ""}
        ${!me && kind !== "system" ? `
        <div class="dt-sec pf-actions">
          <button class="btn" id="pf-message" title="${t("Write to @{handle} privately", { handle: escapeHtml(h) })}">${iconChat()} ${t("Message")}</button>
        </div>` : ""}
      </div>
    </div>`;
  host.querySelector("#pf-close")?.addEventListener("click", closeProfile);
  host.querySelector("#pf-message")?.addEventListener("click", async () => {
    const handle = h;
    state.profileHandle = null;
    profileAnchor = null;
    try { await startDirect(handle); } catch (e) { showError(e); }
  });
}

// ------------------------------------------------------------ the people picker
/**
 * Mounts a picker into `host`: chips for the chosen people, a search box, a list of matches
 * (avatar, @handle, display name, kind tag). Enter adds the first match, Backspace in an empty
 * box removes the last chip, arrows move in the list. Returns `{ selected(), focus() }`.
 * `@system` is never offered (filterPeople's default).
 */
export function mountPeoplePicker(host, opts = {}) {
  const people = opts.people || state.actorsList;
  const me = opts.excludeHandle ?? state.actor?.handle;
  const chosen = [];
  let active = 0;
  const id = opts.id || "pp";
  host.innerHTML = `
    <div class="pp" id="${id}">
      <div class="pp-chips" id="${id}-chips" role="list" aria-label="${t("Chosen people")}"></div>
      <label class="sr-only" for="${id}-input">${t("Search people")}</label>
      <input id="${id}-input" class="pp-input" autocomplete="off" placeholder="${t("Type a name, Enter adds")}"
        role="combobox" aria-expanded="true" aria-controls="${id}-list" aria-autocomplete="list">
      <div class="pp-list" id="${id}-list" role="listbox" aria-label="${t("People")}"></div>
    </div>`;
  const input = host.querySelector(`#${id}-input`);
  const chips = host.querySelector(`#${id}-chips`);
  const list = host.querySelector(`#${id}-list`);
  const matches = () => filterPeople(people, input.value, { excludeHandle: me, exclude: chosen.map((a) => a.handle) });
  const renderChips = () => {
    chips.innerHTML = chosen.map((a) => `
      <span class="pp-chip ${a.kind}" role="listitem">${avatarHtml(a.handle, 18)}<span>@${escapeHtml(a.handle)}</span>
        <button type="button" class="pp-x" data-unpick="${escapeHtml(a.handle)}" aria-label="${t("Remove @{handle}", { handle: escapeHtml(a.handle) })}">${iconClose()}</button>
      </span>`).join("");
    chips.querySelectorAll("[data-unpick]").forEach((b) => b.addEventListener("click", () => {
      const i = chosen.findIndex((a) => a.handle === b.dataset.unpick);
      if (i >= 0) chosen.splice(i, 1);
      renderChips(); renderList(); input.focus(); opts.onChange?.(chosen.slice());
    }));
  };
  const renderList = () => {
    const m = matches();
    if (active >= m.length) active = Math.max(0, m.length - 1);
    if (!m.length) {
      list.innerHTML = `<p class="pp-empty">${chosen.length ? t("Nobody else matches") : t("Nobody matches")}</p>`;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    list.innerHTML = m.map((a, i) => `
      <button type="button" class="pp-row ${i === active ? "active" : ""}" role="option" id="${id}-opt-${i}"
        aria-selected="${i === active}" data-pick="${escapeHtml(a.handle)}">
        <span class="conv-face">${avatarHtml(a.handle, 22)}<span class="ppresence ${handleOnline(a.handle) ? "on" : ""}"></span></span>
        <span class="pp-handle">@${escapeHtml(a.handle)}</span>
        ${a.displayName && low(a.displayName) !== low(a.handle) ? `<span class="pp-name">${escapeHtml(a.displayName)}</span>` : ""}
        <span class="kindtag ${a.kind}">${a.kind === "human" ? t("human") : t("agent")}</span>
      </button>`).join("");
    input.setAttribute("aria-activedescendant", `${id}-opt-${active}`);
    list.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => pick(b.dataset.pick)));
  };
  const pick = (handle) => {
    const a = people.find((x) => low(x.handle) === low(handle));
    if (!a || chosen.some((c) => c.handle === a.handle)) return;
    chosen.push(a);
    input.value = "";
    active = 0;
    renderChips(); renderList(); input.focus();
    opts.onChange?.(chosen.slice());
  };
  input.addEventListener("input", () => { active = 0; renderList(); });
  input.addEventListener("keydown", (e) => {
    const m = matches();
    if (e.key === "Enter") {
      e.preventDefault();
      if (m[active]) pick(m[active].handle);
      else if (!input.value && chosen.length) opts.onSubmit?.(chosen.slice());
    } else if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(m.length - 1, active + 1); renderList(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); renderList(); }
    else if (e.key === "Backspace" && !input.value && chosen.length) {
      chosen.pop(); renderChips(); renderList(); opts.onChange?.(chosen.slice());
    }
  });
  renderChips(); renderList();
  return { selected: () => chosen.map((a) => a.handle), focus: () => input.focus() };
}

// ------------------------------------------------------- the channel header meta
/** Members of the active conversation for the header: fetched once per conversation (the
 *  details panel fetches the same resource and shares `state.convMembers`). Calls `onReady`
 *  after a fetch so the header can redraw with the faces. The faces are decoration: the fetch
 *  waits for the first paint so it never competes with the message load, and without a frame
 *  scheduler (node) the header simply stays without faces until Details is opened. */
// U6: the conversation whose member fetch is in flight. `state.convMembersFor` is set only AFTER
// the fetch succeeds: marking it before left the header believing it had the list while the
// list was empty (a bare "0" pill) whenever the open was abandoned mid-way, with nothing ever
// retrying because the mark said "done".
let membersInFlight = null;

export function ensureHeaderMembers(convId, onReady) {
  if (!convId || state.convMembersFor === convId || membersInFlight === convId) return;
  if (typeof requestAnimationFrame !== "function") return;
  membersInFlight = convId;
  requestAnimationFrame(() => {
    if (state.activeId !== convId) { membersInFlight = null; return; }
    const gen = sessionGeneration();
    api("GET", `/api/conversations/${convId}`).then(async (d) => {
      if (state.activeId !== convId || gen !== sessionGeneration()) return;
      const members = d.members || [];
      if (members.some((m) => !state.actorsCache[m.actorId])) await ensureActors({ force: true });
      if (gen !== sessionGeneration() || state.activeId !== convId) return;
      state.convMembers = members;
      state.convMembersFor = convId;
      onReady?.();
    }).catch(() => {}).finally(() => { if (membersInFlight === convId) membersInFlight = null; });
  });
}

/** Stacked faces + a count for a channel header. `members` are the rows of GET /:id, @system
 *  hidden; up to `max` faces, the count is of all visible members. An empty list draws nothing:
 *  a lone "0" before the members arrive is false (U6). The people Octicon says what the number is.
 *  U17: three faces at most and a "+N" chip for the rest on every width - six squeezed faces
 *  overlapped their initials on a phone; the count after the chip is still the total. */
export function headerFacesHtml(members, cache, max = 3) {
  const rows = visibleMembers(members, cache);
  if (!rows.length) return "";
  const faces = rows.slice(0, max).map((m) => avatarHtml(cache?.[m.actorId]?.handle || "?", 22)).join("");
  const more = rows.length > max ? `<span class="hdr-more">+${rows.length - max}</span>` : "";
  return `${iconUsers()}<span class="hdr-faces" aria-hidden="true">${faces}${more}</span><span class="hdr-count">${rows.length}</span>`;
}
