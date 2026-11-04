/**
 * Slash commands, the `+` menu and the ephemeral cards (S5).
 *
 * A human must be able to command agents without reading docs. `@agent do X` stays the main
 * way; the commands here add the TRACKED forms the server already knows: a question that stays
 * open until answered (`/ask`), a lease on a shared resource (`/claim`, `/release`, `/who`),
 * the agents' status (`/status`) and closing a report from its thread (`/fixed`, `/resolved`).
 *
 * Three pure helpers are tested in node: `parseCommand` (text -> command + arguments),
 * `parseDuration` ("1h30m" -> seconds) and `commandSuggestions` (the rows for the "/" popover,
 * hosted by the S4 autocomplete engine in composer.js so there is ONE popover, not two).
 * `runCommand` executes a command; actions.js calls it before posting, so every box (main dock,
 * thread panel) gets commands for free.
 *
 * Answers nobody else needs to see (`/who`, `/status`, a refused `/claim`) render as an
 * ephemeral row in the list: "Only visible to you", never stored, gone on the next full render.
 */
import { askQuestion, claimLease, fixMsg, releaseLease, resolveMsg } from "./actions.js";
import { api } from "./api.js";
import { ensureActors, refreshDigestAndLeases } from "./data.js";
import { avatarHtml, escapeHtml, leaseCountdown, openModal, timeAgo } from "./dom.js";
import { iconFile, iconPlus, iconQuestion } from "./icons.js";
import { t } from "./i18n.js";
import { findMsgById, state, views } from "./state.js";
import { showError, showToast } from "./toasts.js";

// ------------------------------------------------------------- the registry
/** Every command with the hint shown after its name and a one-line description (the popover). */
export const COMMANDS = [
  { name: "ask", hint: () => t("@agent question"), description: () => t("Ask a tracked question - it stays open until somebody answers") },
  { name: "claim", hint: () => t("resource [for 2h] [note]"), description: () => t("Claim a shared resource before you touch it") },
  { name: "release", hint: () => t("resource"), description: () => t("Release a resource you hold") },
  { name: "who", hint: () => t("resource"), description: () => t("Who holds a resource right now (only you see the answer)") },
  { name: "status", hint: () => "", description: () => t("What every agent is doing right now (only you see the answer)") },
  { name: "fixed", hint: () => "", description: () => t("Mark the report in this thread as fixed") },
  { name: "resolved", hint: () => "", description: () => t("Confirm the report in this thread is gone") },
];

const KNOWN = new Set(COMMANDS.map((c) => c.name));

// ------------------------------------------------------------- pure helpers (tested)
/** "2h", "30m", "1d", "1h30m" -> seconds; anything else -> null. */
export function parseDuration(s) {
  const m = String(s ?? "").trim().match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/i);
  if (!m || !m[0]) return null;
  const [, d, h, min] = m;
  if (d === undefined && h === undefined && min === undefined) return null;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60;
}

function parseArgs(name, args) {
  switch (name) {
    case "claim": {
      const m = args.match(/^(\S*)(?:\s+for\s+(\S+))?(?:\s+([\s\S]*))?$/);
      if (!m) return { resource: args, ttlSec: null, note: "" };
      const ttl = m[2] ? parseDuration(m[2]) : null;
      // "for soon" is not a duration: the whole tail becomes the note rather than vanishing.
      const note = ttl === null && m[2] ? `for ${m[2]}${m[3] ? ` ${m[3]}` : ""}` : (m[3] ?? "");
      return { resource: m[1], ttlSec: ttl, note: note.trim() };
    }
    case "release":
    case "who":
      return { resource: args.trim() };
    case "ask": {
      const m = args.match(/^@([a-z0-9._-]+)\s*([\s\S]*)$/i);
      return m ? { to: m[1], question: m[2].trim() } : { to: null, question: args.trim() };
    }
    default:
      return {};
  }
}

/**
 * The command in `text`, or null when the text is just text. A command is "/" at the very
 * first character followed by letters; a slash anywhere else (a path, a URL) is left alone.
 * @returns {null | { name: string, args: string, known: boolean, parsed: object | null }}
 */
export function parseCommand(text) {
  const m = String(text ?? "").match(/^\/([a-z]*)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const args = (m[2] ?? "").trim();
  const known = KNOWN.has(name);
  return { name, args, known, parsed: known ? parseArgs(name, args) : null };
}

function rowHtml(c, i) {
  const hint = c.hint();
  return `<button type="button" role="option" data-mi="${i}" class="cmd-row ${i === 0 ? "sel" : ""}">
    <span class="cmd-name">/${escapeHtml(c.name)}${hint ? ` <span class="cmd-hint">${escapeHtml(hint)}</span>` : ""}</span>
    <span class="cmd-desc">${escapeHtml(c.description())}</span>
  </button>`;
}

/**
 * The rows for the "/" popover: open while the caret sits at the end of the command word at
 * the start of the box; closed after the first space, for a slash inside the text, or when
 * nothing matches. `{ start: 0, items: [{ insert, html }] }` or null.
 */
export function commandSuggestions(text, caret) {
  const m = String(text ?? "").match(/^\/([a-z]*)/i);
  if (!m || caret !== m[0].length) return null;
  const q = m[1].toLowerCase();
  const found = COMMANDS.filter((c) => c.name.startsWith(q));
  if (!found.length) return null;
  return { start: 0, items: found.map((c, i) => ({ insert: "/" + c.name, html: rowHtml(c, i) })) };
}

// ------------------------------------------------------------- ephemeral cards
/** A row only this tab sees. It is not a message: nothing is posted, nothing is stored, and the
 *  next full render of the list lets it go. */
export function showEphemeral(html, convId) {
  const el = document.getElementById("messages");
  if (!el || state.view !== "chat" || (convId && state.activeId !== convId)) return;
  el.insertAdjacentHTML("beforeend", `
    <div class="msg ephemeral" role="status">
      <div class="body">
        <div class="head"><span class="author">${t("Only visible to you")}</span>
          <button type="button" class="eph-close" data-eph-close aria-label="${t("Dismiss")}" title="${t("Dismiss")}"><span aria-hidden="true">&times;</span></button></div>
        <div class="text">${html}</div>
      </div>
    </div>`);
  views.scrollToBottom(true);
}

function leaseCardHtml(l) {
  return `<p><b>${escapeHtml(l.resource)}</b> ${t("is held by")} ${avatarHtml(l.handle, 18)} <b>@${escapeHtml(l.handle)}</b>${l.note ? ` - ${escapeHtml(l.note)}` : ""}</p>
    <p class="eph-sub">${t("It releases itself in {left}.", { left: leaseCountdown(l.expiresAt) })}</p>`;
}

async function findLease(resource) {
  const data = await api("GET", "/api/leases");
  const low = String(resource).toLowerCase();
  return (data.leases || []).find((l) => String(l.resource).toLowerCase() === low) || null;
}

// ------------------------------------------------------------- handlers
const keep = () => ({ handled: true, keepText: true });

const HANDLERS = {
  async ask(p, ctx) {
    if (!p.question) { showToast(t("Write the question after /ask, e.g. /ask @nestor when is the window?"), { alert: true }); return keep(); }
    const body = p.to ? `@${p.to} ${p.question}` : p.question;
    const message = await askQuestion(ctx.conversationId, body);
    return message ? { handled: true, message } : keep();
  },
  async claim(p, ctx) {
    if (!p.resource) { showToast(t("Name the resource: /claim deploy:prod for 1h releasing 2.4"), { alert: true }); return keep(); }
    try {
      await api("POST", "/api/leases", { resource: p.resource, note: p.note || undefined, ttlSec: p.ttlSec || undefined });
      showToast(t("“{resource}” is yours now. Release it when you are done.", { resource: p.resource }));
      refreshDigestAndLeases(true);
      return { handled: true };
    } catch (e) {
      if (e.status !== 409) { showError(e); return keep(); }
      // Refused: who holds it is an answer, not an error - a card only I see, nothing posted.
      const held = await findLease(p.resource).catch(() => null);
      showEphemeral(held ? leaseCardHtml(held) : `<p>${t("“{resource}” is held by somebody else right now.", { resource: escapeHtml(p.resource) })}</p>`, ctx.conversationId);
      return { handled: true };
    }
  },
  async release(p) {
    if (!p.resource) { showToast(t("Name the resource: /release deploy:prod"), { alert: true }); return keep(); }
    if (await releaseLease(p.resource)) refreshDigestAndLeases(true);
    return { handled: true };
  },
  async who(p, ctx) {
    if (!p.resource) { showToast(t("Name the resource: /who deploy:prod"), { alert: true }); return keep(); }
    try {
      const held = await findLease(p.resource);
      showEphemeral(held ? leaseCardHtml(held)
        : `<p><b>${escapeHtml(p.resource)}</b> ${t("is free right now - nobody holds it.")}</p>`, ctx.conversationId);
    } catch (e) { showError(e); }
    return { handled: true };
  },
  async status(_p, ctx) {
    try {
      const [actors, pres] = await Promise.all([ensureActors(), api("GET", "/api/presence")]);
      const byActor = new Map();
      for (const p of pres.presence || []) {
        const cur = byActor.get(p.actorId);
        if (!cur || (p.online && !cur.online) || (p.doing && !cur.doing)) byActor.set(p.actorId, p);
      }
      const agents = (actors || []).filter((a) => a.kind === "agent");
      const rows = agents.map((a) => {
        const p = byActor.get(a.id);
        const stateText = p?.online
          ? (p.doing ? t("working: {doing}", { doing: escapeHtml(p.doing) }) : t("online"))
          : (p?.lastSeenAt || a.lastActiveAt ? t("last seen {when}", { when: timeAgo(p?.lastSeenAt || a.lastActiveAt) }) : t("never seen"));
        return `<li>${avatarHtml(a.handle, 18)} <b>@${escapeHtml(a.handle)}</b> <span class="eph-sub">${stateText}</span></li>`;
      });
      showEphemeral(rows.length ? `<ul class="eph-list">${rows.join("")}</ul>` : `<p>${t("No agents are registered here yet.")}</p>`, ctx.conversationId);
    } catch (e) { showError(e); }
    return { handled: true };
  },
  fixed(_p, ctx) { return markRoot(ctx, true); },
  resolved(_p, ctx) { return markRoot(ctx, false); },
};

/** `/fixed` and `/resolved` act on the root of the thread they are typed in (or the message
 *  being replied to from the main box). With no target there is nothing to mark. */
async function markRoot(ctx, fix) {
  const target = ctx.threadId ?? state.replyTo ?? null;
  if (!target) {
    showToast(t("Use it as a reply in the report's thread, or open More on the message."), { alert: true });
    return keep();
  }
  if (fix) await fixMsg(target, true); else await resolveMsg(target, true);
  return { handled: true, message: findMsgById(target) };
}

/**
 * Run the command in `text`. `ctx`: conversationId, threadId (a thread box), sendAsText(text)
 * for the confirm toast of an unknown command.
 * @returns {Promise<{ handled: boolean, keepText?: boolean, message?: object | null }>}
 *   handled=false: plain text, post it; keepText: the box keeps the text (nothing was sent).
 */
export async function runCommand(text, ctx = {}) {
  const cmd = parseCommand(text);
  if (!cmd || !cmd.name) return { handled: false };
  const conversationId = ctx.conversationId ?? state.activeId;
  if (!cmd.known) {
    showToast(t("“{cmd}” is not a command here. Send it as text?", { cmd: "/" + cmd.name }),
      { action: { label: t("Send as text"), onClick: () => ctx.sendAsText?.(text) } });
    return keep();
  }
  // The channel copy of a thread reply ("also send"): the thread box already ran it.
  if (ctx.silent) return { handled: true };
  return HANDLERS[cmd.name](cmd.parsed, { ...ctx, conversationId });
}

// ------------------------------------------------------------- the + menu
let closePlus = null;

/** The menu under the composer's "+": attach a file, ask a tracked question, claim a resource.
 *  `o.attach()` opens the file dialog the caller owns. */
export function openPlusMenu(anchor, o = {}) {
  if (closePlus) { closePlus(); return; }
  const items = [
    { action: "attach", icon: iconFile(), label: t("Attach a file"), description: t("Images show inline, everything else as a download.") },
    { action: "ask", icon: iconQuestion(), label: t("Ask a tracked question"), description: t("It stays marked as open until somebody answers.") },
    { action: "claim", icon: iconPlus(), label: t("Claim a resource"), description: t("Tell the others you are touching something shared.") },
  ];
  const pop = document.createElement("div");
  pop.className = "msg-menu plus-menu";
  pop.setAttribute("role", "menu");
  pop.innerHTML = items.map((p) => `
    <button type="button" role="menuitem" data-pact="${p.action}">
      <span class="mm-l">${p.icon} ${escapeHtml(p.label)}</span>
      <span class="mm-o">${escapeHtml(p.description)}</span>
    </button>`).join("");
  document.body.appendChild(pop);
  const rect = anchor.getBoundingClientRect();
  const vv = window.visualViewport;
  const vh = vv?.height ?? window.innerHeight, vw = vv?.width ?? window.innerWidth;
  const top = rect.top - pop.offsetHeight - 8;
  pop.style.top = `${Math.max(8, top < 8 ? Math.min(rect.bottom + 8, vh - pop.offsetHeight - 8) : top)}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left, vw - pop.offsetWidth - 8))}px`;
  function close() {
    pop.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    closePlus = null;
  }
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); anchor.focus(); } };
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pact]");
    if (!b) return;
    const action = b.dataset.pact;
    close();
    if (action === "attach") o.attach?.();
    else if (action === "ask") openAskModal(state.activeId);
    else if (action === "claim") openClaimModal();
  });
  setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  document.addEventListener("keydown", onKey, true);
  closePlus = close;
  pop.querySelector("button")?.focus();
}

/** "Ask a tracked question" (restores M7): pick the agent, write the question. */
export async function openAskModal(convId) {
  const actors = await ensureActors().catch(() => state.actorsList);
  const agents = (actors || []).filter((a) => a.kind === "agent" && a.id !== state.actor?.id);
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("Ask a tracked question")}</h2>
      <p class="mhint">${t("The question gets an “Open question” badge and counts in Catch up until somebody answers. You can also type /ask @agent question in the box.")}</p>
      <div class="field"><label for="ask-to">${t("Who should answer")}</label>
        <select id="ask-to">
          <option value="">${t("Anybody in this conversation")}</option>
          ${agents.map((a) => `<option value="${escapeHtml(a.handle)}">@${escapeHtml(a.handle)}${a.displayName ? ` - ${escapeHtml(a.displayName)}` : ""}</option>`).join("")}
        </select></div>
      <div class="field"><label for="ask-q">${t("The question")}</label>
        <textarea id="ask-q" rows="3" placeholder="${t("e.g. when is the deployment window?")}"></textarea></div>
      <div class="row"><button class="btn ghost" id="ask-cancel">${t("Cancel")}</button><button class="btn" id="ask-ok">${t("Ask")}</button></div>`);
  modal.querySelector("#ask-cancel").addEventListener("click", close);
  modal.querySelector("#ask-ok").addEventListener("click", async () => {
    const q = modal.querySelector("#ask-q").value.trim();
    if (!q) { modal.querySelector("#ask-q").focus(); return; }
    const to = modal.querySelector("#ask-to").value;
    close();
    await askQuestion(convId ?? state.activeId, to ? `@${to} ${q}` : q);
  });
  modal.querySelector("#ask-q")?.focus();
}

/** "Claim a resource" from the + menu: the same fields as the sidebar's modal. */
export function openClaimModal(prefill = "") {
  const { modal, close } = openModal(`
      <h2 id="m-title">${t("Claim a resource")}</h2>
      <p class="mhint">${t("Tell the others that you are touching this right now. They will see it on the list and wait, instead of walking into the same thing at once.")}</p>
      <div class="field"><label for="cl-res">${t("What you are claiming")}</label>
        <input id="cl-res" value="${escapeHtml(prefill)}" placeholder="${t("e.g. deploy-production")}">
        <span class="fhint">${t("Any name, as long as everybody reads it the same way. No spaces.")}</span></div>
      <div class="field"><label for="cl-note">${t("What you are doing with it (optional)")}</label>
        <input id="cl-note" placeholder="${t("e.g. releasing version 2.4")}"></div>
      <div class="field"><label for="cl-ttl">${t("Release automatically after")}</label>
        <select id="cl-ttl">
          <option value="900">${t("15 minutes")}</option>
          <option value="3600" selected>${t("an hour")}</option>
          <option value="14400">${t("4 hours")}</option>
          <option value="86400">${t("a day")}</option>
        </select>
        <span class="fhint">${t("A safety net in case you forget to release it. You can release it earlier.")}</span></div>
      <div class="row"><button class="btn ghost" id="cl-cancel">${t("Cancel")}</button><button class="btn" id="cl-ok">${t("Claim")}</button></div>`);
  modal.querySelector("#cl-cancel").addEventListener("click", close);
  modal.querySelector("#cl-ok").addEventListener("click", async () => {
    const res = modal.querySelector("#cl-res").value.trim();
    if (!res) return;
    close();
    const ok = await claimLease(res, modal.querySelector("#cl-note").value.trim(), Number(modal.querySelector("#cl-ttl").value));
    if (ok) refreshDigestAndLeases(true);
  });
  modal.querySelector("#cl-res")?.focus();
}
