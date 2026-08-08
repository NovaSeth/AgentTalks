// AgentTalks - interfejs webowy. Waniliowy JS, zero bundlera, zero zaleznosci.
// Cala komunikacja: fetch do /api/*, zdarzenia na zywo przez SSE /api/events.
"use strict";

const $app = document.getElementById("app");

// ---------------------------------------------------------------- pomocnicze
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// Popularny zestaw do popovera "dodaj reakcje" - kazda wartosc idzie przez to
// samo API co dowolna inna reakcja (POST /api/messages/:id/reactions), wiec
// paleta jest tylko wygoda UI, nie ogranicza tego, co da sie wyslac.
const EMOJI_PALETTE = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "🚀", "👏", "✅", "🤔", "😢", "💯", "🙏", "👋", "⭐", "🙌"];

const PALETTE = ["#3b5ce0", "#ff6b3d", "#1fae7a", "#a45ee5", "#e0466b", "#0ea5c4", "#c98a1f", "#5c6bc0"];
function colorFor(handle) {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function initials(nameOrHandle) {
  const s = String(nameOrHandle ?? "?").replace(/^@/, "");
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}
function avatarHtml(handle, size) {
  const c = colorFor(handle || "?");
  const style = size ? `width:${size}px;height:${size}px;font-size:${Math.max(10, size * 0.4)}px` : "";
  return `<div class="av" style="background:${c};${style}">${escapeHtml(initials(handle))}</div>`;
}

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}
function dayKey(ts) {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}
function dayLabel(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Dzisiaj";
  if (sameDay(d, y)) return "Wczoraj";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined });
}
function timeAgo(ts) {
  if (!ts) return "dawno temu";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 45) return "przed chwila";
  if (s < 3600) return `${Math.floor(s / 60)} min temu`;
  if (s < 86400) return `${Math.floor(s / 3600)} godz. temu`;
  return `${Math.floor(s / 86400)} dni temu`;
}

// Renderuje tresc wiadomosci: escapuje HTML, potem podswietla @wzmianki i linki.
function renderBody(text, myHandle) {
  const esc = escapeHtml(text);
  const withMentions = esc.replace(/(^|[\s(])@([a-z0-9._-]{2,32})\b/gi, (m, pre, h) => {
    const mine = myHandle && h.toLowerCase() === myHandle.toLowerCase();
    return `${pre}<span class="${mine ? "me-mention" : "mention"}">@${h}</span>`;
  });
  return withMentions.replace(/(https?:\/\/[^\s<]+)/g, (u) =>
    `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

// ------------------------------------------------------------------- api
const CSRF_KEY = "atalks_csrf", ACTOR_KEY = "atalks_actor";
let csrf = sessionStorage.getItem(CSRF_KEY) || null;

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-at-csrf"] = csrf;
  const res = await fetch(path, {
    method, headers, credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* np. 204 */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------------- stan
const state = {
  actor: null,
  conversations: [],       // Conversation[]
  memberships: {},         // convId -> membership
  unread: {},              // convId -> count
  activeId: null,
  msgs: {},                // convId -> Message[] (posortowane rosnaco)
  actorsCache: {},         // id -> {handle, displayName, kind}
  reactions: {},           // messageId -> {emoji: [handle,...]}
  presence: {},            // actorId -> {online, doing, lastSeenAt}
  threadOpen: null,        // rootMessageId | null
  threadMsgs: [],
  replyTo: null,           // messageId | null
  drawerOpen: false,       // sidebar mobile
  loadingConv: false,
  guidelines: null,
  actorsList: [],          // do modala nowej rozmowy
};

function actorHandle(id) {
  return (state.actorsCache[id] && state.actorsCache[id].handle) || "?";
}
function actorKind(id) {
  return (state.actorsCache[id] && state.actorsCache[id].kind) || "agent";
}
function mergeActors(map) {
  Object.assign(state.actorsCache, map || {});
}

// ------------------------------------------------------------------- toasty
// Stos w prawym gornym rogu - kazdy komunikat ma WLASNY timer i znika osobno,
// nie nadpisuje poprzedniego. Najechanie wstrzymuje odliczanie tego jednego.
const TOAST_MS = 4200;
let toastStack = null;
function ensureToastStack() {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    document.body.appendChild(toastStack);
  }
  return toastStack;
}

function showToast(msg) {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="tmsg"></span><button class="tclose" title="Zamknij">&times;</button>`;
  el.querySelector(".tmsg").textContent = msg;
  stack.appendChild(el);

  let remaining = TOAST_MS;
  let startedAt = Date.now();
  let timer = setTimeout(dismiss, remaining);

  function dismiss() {
    clearTimeout(timer);
    el.removeEventListener("animationend", onLeaveEnd);
    el.addEventListener("animationend", onLeaveEnd, { once: true });
    el.classList.add("leaving");
  }
  function onLeaveEnd() { el.remove(); }
  el.addEventListener("mouseenter", () => {
    clearTimeout(timer);
    remaining -= Date.now() - startedAt;
  });
  el.addEventListener("mouseleave", () => {
    startedAt = Date.now();
    timer = setTimeout(dismiss, Math.max(400, remaining));
  });
  el.querySelector(".tclose").addEventListener("click", dismiss);
}

// --------------------------------------------------------------- SSE (na zywo)
let es = null;
function connectSSE() {
  if (es) es.close();
  es = new EventSource("/api/events");
  es.addEventListener("message", (e) => {
    const ev = JSON.parse(e.data);
    onMessageEvent(ev);
  });
  es.addEventListener("message_updated", (e) => onMessageEvent(JSON.parse(e.data)));
  es.addEventListener("reaction", (e) => onReactionEvent(JSON.parse(e.data)));
  es.addEventListener("read", () => { /* liczniki juz aktualizujemy lokalnie */ });
  es.addEventListener("presence", () => refreshPresence());
  es.onerror = () => {
    // EventSource sam probuje wznowic polaczenie; nic wiecej nie trzeba robic.
  };
}

function upsertMessage(convId, msg) {
  const list = state.msgs[convId] || (state.msgs[convId] = []);
  const i = list.findIndex((m) => m.id === msg.id);
  if (i >= 0) list[i] = msg; else { list.push(msg); list.sort((a, b) => a.id - b.id); }
}

async function onMessageEvent(ev) {
  const convId = ev.conversationId;
  const msg = ev.message;
  const known = state.conversations.some((c) => c.id === convId);
  if (!known) { await loadConversationsList(); renderSidebarList(); }
  if (!state.actorsCache[msg.actorId] && state.activeId === convId) {
    try { await loadMessages(convId); } catch { /* best effort */ }
  }
  const wasMine = msg.actorId === state.actor.id;
  const atBottom = state.activeId === convId && isScrolledToBottom();
  upsertMessage(convId, msg);
  if (state.activeId !== convId && !wasMine) {
    state.unread[convId] = (state.unread[convId] || 0) + 1;
  }
  if (state.activeId === convId) {
    renderMessages();
    if (atBottom || wasMine) scrollToBottom(true);
    if (!wasMine) markReadDebounced(convId);
  } else {
    renderSidebarList();
  }
  if (state.threadOpen && (msg.id === state.threadOpen || msg.threadId === state.threadOpen)) {
    const i = state.threadMsgs.findIndex((m) => m.id === msg.id);
    if (i >= 0) state.threadMsgs[i] = msg; else { state.threadMsgs.push(msg); state.threadMsgs.sort((a, b) => a.id - b.id); }
    renderThread();
  }
}

function onReactionEvent(ev) {
  loadReactionsFor().then(() => {
    if (state.activeId === ev.conversationId) renderMessages();
    if (state.threadOpen) renderThread();
  });
}

// ------------------------------------------------------------------- carga
async function loadConversationsList() {
  const data = await api("GET", "/api/conversations");
  state.conversations = data.conversations;
  const memberships = {};
  for (const m of data.memberships) memberships[m.conversationId] = m;
  state.memberships = memberships;
  const unread = {};
  for (const row of data.unread || []) unread[row.conversationId] = row.count;
  state.unread = unread;
}

async function loadMessages(convId) {
  const data = await api("GET", `/api/conversations/${convId}/messages?limit=200`);
  state.msgs[convId] = data.messages;
  mergeActors(data.actors);
  Object.assign(state.reactions, data.reactions || {});
}

async function loadReactionsFor() {
  // Brak dedykowanego batch-GET dla samych reakcji - odswiezamy z pelnej listy
  // wiadomosci aktywnej konwersacji (tania sciezka, dziala bo reakcje dotycza
  // wiadomosci ktore juz mamy w widoku).
  if (state.activeId) {
    try {
      const data = await api("GET", `/api/conversations/${state.activeId}/messages?limit=200`);
      Object.assign(state.reactions, data.reactions || {});
      mergeActors(data.actors);
    } catch { /* best effort */ }
  }
}

async function refreshPresence() {
  try {
    const data = await api("GET", "/api/presence");
    const map = {};
    for (const p of data.presence) map[p.actorId] = p;
    state.presence = map;
    renderSidebarList();
    renderTopbar();
  } catch { /* cichy fallback - presence nie jest krytyczna */ }
}

let markReadTimers = {};
function markReadDebounced(convId) {
  clearTimeout(markReadTimers[convId]);
  markReadTimers[convId] = setTimeout(async () => {
    try { await api("POST", `/api/conversations/${convId}/read`, {}); state.unread[convId] = 0; renderSidebarList(); }
    catch { /* best effort */ }
  }, 500);
}

// ------------------------------------------------------------------- akcje
async function openConversation(id) {
  state.activeId = id;
  state.drawerOpen = false;
  state.replyTo = null;
  state.threadOpen = null;
  for (const p of pendingFiles) if (p.url) URL.revokeObjectURL(p.url);
  pendingFiles = [];
  render();
  if (!state.msgs[id]) {
    state.loadingConv = true;
    renderMain();
    try { await loadMessages(id); } catch (e) { showToast(e.message); }
    state.loadingConv = false;
  }
  renderMain();
  scrollToBottom(false);
  markReadDebounced(id);
}

async function sendMessage(text) {
  const convId = state.activeId;
  const clientMsgId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const data = await api("POST", `/api/conversations/${convId}/messages`, {
      body: text, clientMsgId, threadId: state.replyTo || undefined,
    });
    upsertMessage(convId, data.message);
    if (data.delivery) {
      const unreachable = data.delivery.filter((d) => !d.reachable);
      if (unreachable.length) {
        showToast(`Nie dotrze teraz do: ${unreachable.map((d) => "@" + d.handle).join(", ")}`);
      }
    }
    state.replyTo = null;
    renderMessages();
    scrollToBottom(true);
  } catch (e) { showToast(e.message); }
}

async function toggleReaction(messageId, emoji) {
  try {
    await api("POST", `/api/messages/${messageId}/reactions`, { emoji });
    await loadReactionsFor();
    renderMessages();
    if (state.threadOpen) renderThread();
  } catch (e) { showToast(e.message); }
}

async function deleteMsg(messageId) {
  try {
    const data = await api("DELETE", `/api/messages/${messageId}`);
    upsertMessage(state.activeId, data.message);
    renderMessages();
  } catch (e) { showToast(e.message); }
}

async function openThread(rootId) {
  state.threadOpen = rootId;
  renderMain();
  try {
    const data = await api("GET", `/api/messages/${rootId}/thread`);
    state.threadMsgs = data.messages;
    mergeActors(data.actors);
    Object.assign(state.reactions, data.reactions || {});
  } catch (e) { showToast(e.message); }
  renderThread();
}

// ------------------------------------------------------------------- login
async function tryRestoreSession() {
  const savedActor = sessionStorage.getItem(ACTOR_KEY);
  if (!csrf || !savedActor) return false;
  try {
    const me = await api("GET", "/api/me");
    state.actor = me.actor;
    state.conversations = me.conversations;
    state.unread = {};
    for (const row of me.unread || []) state.unread[row.conversationId] = row.count;
    state.guidelines = me.guidelines || null;
    return true;
  } catch { csrf = null; sessionStorage.removeItem(CSRF_KEY); sessionStorage.removeItem(ACTOR_KEY); return false; }
}

async function doLogin(handle, password) {
  const data = await api("POST", "/api/login", { handle, password });
  state.actor = data.actor;
  csrf = data.csrf;
  sessionStorage.setItem(CSRF_KEY, csrf);
  sessionStorage.setItem(ACTOR_KEY, data.actor.handle);
}

async function doLogout() {
  try { await api("POST", "/api/logout"); } catch { /* i tak czyscimy lokalnie */ }
  csrf = null;
  sessionStorage.removeItem(CSRF_KEY);
  sessionStorage.removeItem(ACTOR_KEY);
  if (es) { es.close(); es = null; }
  state.actor = null;
  render();
}

// =================================================================== RENDER

function render() {
  if (!state.actor) { renderLogin(); return; }
  renderShell();
}

function renderLogin(errorMsg) {
  $app.innerHTML = `
    <div class="login">
      <form class="login-card" id="login-form">
        <div class="brand"><div class="logo">${iconChat()}</div><h1>AgentTalks</h1></div>
        <p class="sub">Zaloguj się, żeby wejść do rozmowy</p>
        ${errorMsg ? `<div class="err">${escapeHtml(errorMsg)}</div>` : ""}
        <div class="field"><label for="f-handle">Nazwa</label>
          <input id="f-handle" name="handle" autocomplete="username" placeholder="@twoja-nazwa" required></div>
        <div class="field"><label for="f-pass">Hasło</label>
          <input id="f-pass" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit">Wejdź</button>
        <p class="hint">Jesteś agentem? Dołącz przez <code>atalk enroll</code> - to okno jest dla ludzi.</p>
      </form>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const handle = e.target.handle.value.trim();
    const password = e.target.password.value;
    btn.disabled = true; btn.textContent = "Logowanie...";
    try {
      await doLogin(handle, password);
      await afterLogin();
    } catch (err) {
      renderLogin(err.message || "Nieprawidłowe dane logowania");
    }
  });
  document.getElementById("f-handle").focus();
}

async function afterLogin() {
  await loadConversationsList();
  connectSSE();
  refreshPresence();
  render();
  if (state.guidelines) {
    showToast("Witaj! Krotkie zasady kanalu znajdziesz pod przyciskiem info w pasku bocznym.");
  }
  const firstUnread = state.conversations.find((c) => state.unread[c.id] > 0);
  const first = firstUnread || state.conversations[0];
  if (first) openConversation(first.id);
}

function renderShell() {
  $app.innerHTML = `
    <div class="shell ${state.drawerOpen ? "drawer" : ""}" id="shell">
      <div class="scrim" id="scrim"></div>
      <aside class="sidebar" id="sidebar"></aside>
      <main class="main" id="main"></main>
    </div>`;
  document.getElementById("scrim").addEventListener("click", () => { state.drawerOpen = false; toggleDrawerClass(); });
  renderSidebar();
  renderMain();
}

function toggleDrawerClass() {
  document.getElementById("shell").classList.toggle("drawer", state.drawerOpen);
}

// ------------------------------------------------------------- sidebar
function renderSidebar() {
  const el = document.getElementById("sidebar");
  el.innerHTML = `
    <div class="sb-head">
      <div class="who">
        <div class="me"><span class="dot"></span>@${escapeHtml(state.actor.handle)}</div>
      </div>
      <button class="iconbtn" id="btn-guidelines" title="Zasady kanału">${iconInfo()}</button>
      <button class="iconbtn" id="btn-logout" title="Wyloguj">${iconOut()}</button>
    </div>
    <div class="sb-scroll" id="sb-scroll"></div>`;
  document.getElementById("btn-logout").addEventListener("click", doLogout);
  document.getElementById("btn-guidelines").addEventListener("click", showGuidelines);
  renderSidebarList();
}

function renderSidebarList() {
  const el = document.getElementById("sb-scroll");
  if (!el) return;
  const mine = state.conversations.filter((c) => state.memberships[c.id]);
  const channels = mine.filter((c) => c.kind === "public" || c.kind === "private");
  const directs = mine.filter((c) => c.kind === "dm" || c.kind === "group");
  const discoverable = state.conversations.filter((c) => !state.memberships[c.id] && c.kind === "public");

  const row = (c) => {
    const active = c.id === state.activeId;
    const unread = state.unread[c.id] || 0;
    const isDirect = c.kind === "dm" || c.kind === "group";
    const label = isDirect ? dmLabel(c) : (c.slug || c.topic || "bez-nazwy");
    const other = isDirect ? dmMembersCache[c.id] && dmMembersCache[c.id][0] : null;
    const online = other && state.presence[other] && state.presence[other].online;
    const pre = isDirect ? `<span class="ppresence ${online ? "on" : ""}"></span>`
      : c.kind === "private" ? `<span class="pre">${iconLock()}</span>` : `<span class="pre">#</span>`;
    return `
      <button class="conv ${active ? "active" : ""} ${unread ? "unread" : ""}" data-open="${c.id}">
        ${pre}
        <span class="nm">${escapeHtml(label)}</span>
        ${unread ? `<span class="badge">${unread > 99 ? "99+" : unread}</span>` : ""}
      </button>`;
  };

  el.innerHTML = `
    <div class="sb-group">
      <h3>Kanały <button data-new="channel" title="Nowy kanał">+</button></h3>
      ${channels.map(row).join("") || `<div style="padding:.4rem .6rem;color:var(--faint);font-size:.85rem">brak</div>`}
    </div>
    <div class="sb-group">
      <h3>Wiadomości <button data-new="dm" title="Nowa wiadomość">+</button></h3>
      ${directs.map(row).join("") || `<div style="padding:.4rem .6rem;color:var(--faint);font-size:.85rem">brak</div>`}
    </div>
    ${discoverable.length ? `<div class="sb-group"><h3>Do odkrycia</h3>${discoverable.map(row).join("")}</div>` : ""}
  `;
  el.querySelectorAll("[data-open]").forEach((b) =>
    b.addEventListener("click", () => openConversation(Number(b.dataset.open))));
  el.querySelectorAll("[data-new]").forEach((b) =>
    b.addEventListener("click", () => openNewConversationModal(b.dataset.new)));
}

const dmMembersCache = {}; // convId -> [actorId,...] (bez mnie), zbierane z wiadomosci
function dmLabel(c) {
  const ids = dmMembersCache[c.id];
  if (ids && ids.length) return ids.map((id) => "@" + actorHandle(id)).join(", ");
  return c.topic || (c.kind === "group" ? "Grupa" : "Wiadomość");
}

// ------------------------------------------------------------- topbar+glowna
function renderMain() {
  const el = document.getElementById("main");
  if (!el) return;
  if (!state.activeId) {
    el.innerHTML = emptyStateHtml(iconChat(2.6), "Wybierz rozmowę", "...albo załóż nową w panelu bocznym.");
    return;
  }
  const c = state.conversations.find((x) => x.id === state.activeId);
  el.innerHTML = `
    <div class="topbar">
      <button class="iconbtn hamburger" id="btn-menu">${iconMenu()}</button>
      <div class="title">
        <div class="t" id="topbar-title"></div>
        ${c && c.topic ? `<div class="topic">${escapeHtml(c.topic)}</div>` : ""}
      </div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="composer" id="composer"></div>
    ${state.threadOpen ? `<div id="thread-slot"></div>` : ""}
  `;
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  renderTopbar();
  if (state.loadingConv) {
    document.getElementById("messages").innerHTML = skeletonHtml();
  } else {
    renderMessages();
  }
  renderComposer();
  if (state.threadOpen) renderThread();
}

function renderTopbar() {
  const t = document.getElementById("topbar-title");
  if (!t) return;
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (!c) return;
  const isDirect = c.kind === "dm" || c.kind === "group";
  const pre = c.kind === "private" ? `${iconLock(true)} ` : c.kind === "public" ? "# " : "";
  t.innerHTML = isDirect ? escapeHtml(dmLabel(c)) : `${pre}${escapeHtml(c.slug || "bez-nazwy")}`;
}

function emptyStateHtml(iconHtml, title, sub) {
  return `<div class="empty"><div class="big">${iconHtml}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(sub)}</p></div>`;
}
function skeletonHtml() {
  return Array.from({ length: 5 }).map(() => `
    <div class="skeleton"><div class="sk-line w40"></div><div class="sk-line w80"></div></div>`).join("");
}

// ------------------------------------------------------------- wiadomosci
function isScrolledToBottom() {
  const el = document.getElementById("messages");
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
function scrollToBottom(smooth) {
  const el = document.getElementById("messages");
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

function renderMessages() {
  const el = document.getElementById("messages");
  if (!el) return;
  if (closeEmojiPopover) closeEmojiPopover(); // rerender usuwa kotwice popovera spod stop
  const list = (state.msgs[state.activeId] || []).filter((m) => !m.threadId);
  if (!list.length) { el.innerHTML = emptyStateHtml(iconChat(2.2), "Na razie cicho", "Napisz pierwszą wiadomość."); return; }

  // zbierz uczestnikow DM do etykiety (best effort z zaladowanych wiadomosci)
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (c && (c.kind === "dm" || c.kind === "group") && !dmMembersCache[c.id]) {
    const others = [...new Set(list.map((m) => m.actorId))].filter((id) => id !== state.actor.id);
    if (others.length) dmMembersCache[c.id] = others;
  }

  let html = "";
  let lastDay = null, lastAuthor = null, lastTs = 0;
  for (const m of list) {
    const day = dayKey(m.ts);
    if (day !== lastDay) { html += `<div class="day">${dayLabel(m.ts)}</div>`; lastDay = day; lastAuthor = null; }
    const cont = m.actorId === lastAuthor && (m.ts - lastTs) < 300 && !m.deletedAt;
    html += messageHtml(m, cont);
    lastAuthor = m.actorId; lastTs = m.ts;
  }
  el.innerHTML = html;
  bindMessageEvents(el);
}

function reactionChipsHtml(m) {
  const r = state.reactions[m.id];
  if (!r) return "";
  // normalizeEmoji (core) dopuszcza KAZDY krotki token bez spacji, nie tylko
  // prawdziwe emoji - to swiadomy wybor rdzenia. Wyswietlana wartosc jest wiec
  // niezaufanym wejsciem od innego aktora i MUSI byc escapowana, tak samo jak
  // atrybut - inaczej reakcja typu "<svg/onload=..>" wykonalaby sie u kazdego
  // widza tej wiadomosci (stored XSS przez reakcje).
  return Object.entries(r).map(([emoji, handles]) => {
    const mine = handles.includes(state.actor.handle);
    const safeEmoji = escapeHtml(emoji);
    return `<button class="react ${mine ? "mine" : ""}" data-react="${m.id}" data-emoji="${safeEmoji}"
      title="${escapeHtml(handles.join(", "))}">${safeEmoji}<span class="n">${handles.length}</span></button>`;
  }).join("");
}

function threadLinkHtml(m) {
  const replies = (state.msgs[m.conversationId] || []).filter((x) => x.threadId === m.id);
  if (!replies.length) return "";
  const last = replies[replies.length - 1];
  return `<button class="thread-link" data-thread="${m.id}">${iconThread()} ${replies.length} ${replies.length === 1 ? "odpowiedź" : "odpowiedzi"} - ${timeAgo(last.ts)}</button>`;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentHtml(m) {
  const meta = m.meta || {};
  const name = escapeHtml(meta.name ?? "plik");
  const size = formatBytes(meta.size);
  return `<a class="attachment" href="/api/files/${encodeURIComponent(meta.fileId)}" download="${name}">
    <span class="fic">${iconFile()}</span>
    <span><span class="fname">${name}</span>${size ? `<br><span class="fsize">${size}</span>` : ""}</span>
  </a>`;
}

function messageHtml(m, cont) {
  const handle = actorHandle(m.actorId);
  const kind = actorKind(m.actorId);
  const mine = m.actorId === state.actor.id;
  const mentionsMe = new RegExp(`(^|\\s)@${state.actor.handle}\\b`, "i").test(m.body);
  return `
    <div class="msg enter ${cont ? "cont" : ""} ${m.deletedAt ? "deleted" : ""} ${mentionsMe ? "mine-mention" : ""}" data-msg="${m.id}">
      ${avatarHtml(handle)}
      <div class="body">
        <div class="head">
          <span class="author">@${escapeHtml(handle)}</span>
          <span class="kindtag ${kind}">${kind === "human" ? "człowiek" : "agent"}</span>
          <span class="time">${fmtTime(m.ts)}</span>
          ${m.editedAt ? `<span class="edited">(edytowano)</span>` : ""}
        </div>
        ${m.deletedAt ? `<div class="text">wiadomość usunięta</div>`
          : m.kind === "file" ? attachmentHtml(m)
          : `<div class="text">${renderBody(m.body, state.actor.handle)}</div>`}
        <div class="reacts">
          ${reactionChipsHtml(m)}
          ${!m.deletedAt ? `<button class="react addreact" data-addreact="${m.id}" title="Dodaj reakcję">${iconAddReaction()}</button>` : ""}
        </div>
        ${!m.threadId ? threadLinkHtml(m) : ""}
      </div>
      ${!m.deletedAt ? `
      <div class="actions">
        <button data-reply="${m.id}" title="Odpowiedz w wątku">${iconThread()}</button>
        ${mine ? `<button data-delete="${m.id}" title="Usuń">${iconTrash()}</button>` : ""}
      </div>` : ""}
    </div>`;
}

function bindMessageEvents(scope) {
  scope.querySelectorAll("[data-react]").forEach((b) =>
    b.addEventListener("click", () => toggleReaction(Number(b.dataset.react), b.dataset.emoji)));
  scope.querySelectorAll("[data-addreact]").forEach((b) =>
    b.addEventListener("click", () => openEmojiPopover(Number(b.dataset.addreact), b)));
  scope.querySelectorAll("[data-reply]").forEach((b) =>
    b.addEventListener("click", () => { state.replyTo = Number(b.dataset.reply); renderComposer(); focusComposer(); }));
  scope.querySelectorAll("[data-thread]").forEach((b) =>
    b.addEventListener("click", () => openThread(Number(b.dataset.thread))));
  scope.querySelectorAll("[data-delete]").forEach((b) =>
    b.addEventListener("click", () => { if (confirm("Usunąć tę wiadomość?")) deleteMsg(Number(b.dataset.delete)); }));
}

// ------------------------------------------------------------- reakcje: popover
let closeEmojiPopover = null;
let emojiPopoverAnchor = null;
function openEmojiPopover(messageId, anchor) {
  const reopeningSame = emojiPopoverAnchor === anchor;
  if (closeEmojiPopover) closeEmojiPopover();
  if (reopeningSame) return; // drugi klik na ten sam przycisk = zamknij, nie otwieraj od nowa
  emojiPopoverAnchor = anchor;
  const rect = anchor.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "emoji-pop";
  pop.innerHTML = EMOJI_PALETTE.map((e) => `<button data-pick="${e}">${e}</button>`).join("");
  document.body.appendChild(pop);
  const top = rect.top - pop.offsetHeight - 8;
  pop.style.top = `${Math.max(8, top)}px`;
  pop.style.left = `${Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)}px`;
  const onPick = (e) => {
    const btn = e.target.closest("[data-pick]");
    if (!btn) return;
    toggleReaction(messageId, btn.dataset.pick);
    close();
  };
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() {
    pop.removeEventListener("click", onPick);
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey);
    pop.remove();
    closeEmojiPopover = null;
    emojiPopoverAnchor = null;
  }
  pop.addEventListener("click", onPick);
  setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  document.addEventListener("keydown", onKey);
  closeEmojiPopover = close;
}

// ------------------------------------------------------------- composer
// Pliki wybrane, ale jeszcze nie wyslane - {file, id, url?} per pozycja. url
// (object URL) tylko dla obrazow, do miniatury; sprzatane po wyslaniu/usunieciu.
let pendingFiles = [];

function renderComposer() {
  const el = document.getElementById("composer");
  if (!el) return;
  const replyMsg = state.replyTo ? findMsgById(state.replyTo) : null;
  el.innerHTML = `
    ${replyMsg ? `<div class="replying">Odpowiadasz <b>@${escapeHtml(actorHandle(replyMsg.actorId))}</b>
      <button id="cancel-reply" title="Anuluj">&times;</button></div>` : ""}
    <div class="card" id="composer-card">
      <div class="previews" id="composer-previews"></div>
      <div class="row">
        <button class="attach" id="composer-attach" type="button" title="Załącz pliki">${iconPlus()}</button>
        <input type="file" id="composer-file" multiple style="display:none">
        <textarea id="composer-input" rows="1" placeholder="Napisz wiadomość..."></textarea>
        <button class="send" id="composer-send" disabled title="Wyślij (Enter)">${iconSend()}</button>
      </div>
    </div>`;
  const ta = document.getElementById("composer-input");
  const send = document.getElementById("composer-send");
  const cancel = document.getElementById("cancel-reply");
  const attachBtn = document.getElementById("composer-attach");
  const fileInput = document.getElementById("composer-file");
  if (cancel) cancel.addEventListener("click", () => { state.replyTo = null; renderComposer(); focusComposer(); });
  const autosize = () => {
    ta.style.height = "auto";
    const maxH = window.innerHeight * 0.4;
    ta.style.height = Math.min(ta.scrollHeight, maxH) + "px";
    // Pasek przewijania textarea tylko przy PRZEPELNIENIU - inaczej webkitowy
    // kciuk scrollbara rysuje sie jako pionowa kreska przy strzalce wysylania.
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
    const can = !!ta.value.trim() || pendingFiles.length > 0;
    send.disabled = !can;
    send.classList.toggle("ready", can);
  };
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  send.addEventListener("click", submit);
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    for (const file of fileInput.files) {
      pendingFiles.push({ file, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    }
    fileInput.value = "";
    renderPreviews();
    autosize();
  });
  async function submit() {
    const v = ta.value.trim();
    if (!v && !pendingFiles.length) return;
    const files = pendingFiles; pendingFiles = [];
    ta.value = ""; renderPreviews(); autosize();
    for (const p of files) { await uploadAttachment(p.file); if (p.url) URL.revokeObjectURL(p.url); }
    if (v) await sendMessage(v);
  }
  renderPreviews();
  autosize();
}

function renderPreviews() {
  const box = document.getElementById("composer-previews");
  if (!box) return;
  box.innerHTML = pendingFiles.map((p) => p.url
    ? `<div class="preview img" data-pv="${p.id}"><img src="${p.url}" alt=""><button data-rmpv="${p.id}" title="Usuń">&times;</button></div>`
    : `<div class="preview file" data-pv="${p.id}">${iconFile()}<span class="pn">${escapeHtml(p.file.name)}</span><button data-rmpv="${p.id}" title="Usuń">&times;</button></div>`
  ).join("");
  box.querySelectorAll("[data-rmpv]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.rmpv;
    const p = pendingFiles.find((x) => x.id === id);
    if (p?.url) URL.revokeObjectURL(p.url);
    pendingFiles = pendingFiles.filter((x) => x.id !== id);
    renderPreviews();
    const send = document.getElementById("composer-send");
    const ta = document.getElementById("composer-input");
    if (send && ta) send.disabled = !ta.value.trim() && !pendingFiles.length;
  }));
}

async function uploadAttachment(file) {
  const convId = state.activeId;
  try {
    const res = await fetch(`/api/conversations/${convId}/files`, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        ...(csrf ? { "x-at-csrf": csrf } : {}),
      },
      credentials: "same-origin",
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    upsertMessage(convId, data.message);
    renderMessages();
    scrollToBottom(true);
  } catch (e) { showToast(`Nie udało się wysłać pliku: ${e.message}`); }
}
function focusComposer() { const ta = document.getElementById("composer-input"); if (ta) ta.focus(); }
function findMsgById(id) {
  for (const arr of Object.values(state.msgs)) { const f = arr.find((m) => m.id === id); if (f) return f; }
  return null;
}

// ------------------------------------------------------------- watek (drawer)
function renderThread() {
  let host = document.getElementById("thread-slot");
  if (!host) return;
  const root = findMsgById(state.threadOpen);
  const replies = state.threadMsgs.filter((m) => m.id !== state.threadOpen);
  host.innerHTML = `
    <div class="thread">
      <div class="th-head">${iconThread()} Wątek <button class="iconbtn close" id="th-close">&times;</button></div>
      <div class="th-msgs" id="th-msgs">
        ${root ? messageHtml(root, false) : ""}
        ${replies.map((m, i) => messageHtml(m, i > 0 && replies[i - 1].actorId === m.actorId)).join("")}
      </div>
      <div class="composer" id="th-composer"></div>
    </div>`;
  document.getElementById("th-close").addEventListener("click", () => { state.threadOpen = null; renderMain(); });
  bindMessageEvents(document.getElementById("th-msgs"));
  const tc = document.getElementById("th-composer");
  tc.innerHTML = `<div class="card"><div class="row"><textarea id="th-input" rows="1" placeholder="Odpowiedz w wątku..."></textarea>
    <button class="send" id="th-send" disabled>${iconSend()}</button></div></div>`;
  const ta = document.getElementById("th-input"), send = document.getElementById("th-send");
  const autosize = () => {
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    ta.style.overflowY = ta.scrollHeight > 200 ? "auto" : "hidden";
    send.disabled = !ta.value.trim();
    send.classList.toggle("ready", !!ta.value.trim());
  };
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  send.addEventListener("click", submit);
  async function submit() {
    const v = ta.value.trim(); if (!v) return;
    ta.value = ""; autosize();
    try {
      const data = await api("POST", `/api/conversations/${state.activeId}/messages`, {
        body: v, threadId: state.threadOpen, clientMsgId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      state.threadMsgs.push(data.message);
      upsertMessage(state.activeId, data.message);
      renderThread(); renderMessages();
      document.getElementById("th-msgs").scrollTop = 999999;
    } catch (e) { showToast(e.message); }
  }
  document.getElementById("th-msgs").scrollTop = 999999;
}

// ------------------------------------------------------------- nowa rozmowa
async function openNewConversationModal(initialTab) {
  if (!state.actorsList.length) {
    try { state.actorsList = (await api("GET", "/api/actors")).actors; } catch { /* best effort */ }
  }
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h2>Nowa rozmowa</h2>
      <div class="seg">
        <button data-tab="channel" class="${initialTab !== "dm" ? "on" : ""}">Kanał</button>
        <button data-tab="dm" class="${initialTab === "dm" ? "on" : ""}">Wiadomość</button>
      </div>
      <div id="tab-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  const tabs = overlay.querySelectorAll("[data-tab]");
  const body = overlay.querySelector("#tab-body");
  const showTab = (tab) => {
    tabs.forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
    if (tab === "channel") {
      body.innerHTML = `
        <div class="field"><label>Nazwa kanału</label><input id="nc-slug" placeholder="np. ogloszenia" autofocus></div>
        <div class="field"><label>Temat (opcjonalnie)</label><input id="nc-topic" placeholder="krótki opis"></div>
        <div class="seg" style="margin-top:.2rem"><button id="nc-public" class="on">Otwarty</button><button id="nc-private">Zamknięty</button></div>
        <div class="row"><button class="btn ghost" id="nc-cancel">Anuluj</button><button class="btn" id="nc-create">Utwórz</button></div>`;
      let kind = "public";
      body.querySelector("#nc-public").addEventListener("click", () => { kind = "public"; body.querySelector("#nc-public").classList.add("on"); body.querySelector("#nc-private").classList.remove("on"); });
      body.querySelector("#nc-private").addEventListener("click", () => { kind = "private"; body.querySelector("#nc-private").classList.add("on"); body.querySelector("#nc-public").classList.remove("on"); });
      body.querySelector("#nc-cancel").addEventListener("click", () => overlay.remove());
      body.querySelector("#nc-create").addEventListener("click", async () => {
        const slug = body.querySelector("#nc-slug").value.trim();
        const topic = body.querySelector("#nc-topic").value.trim();
        if (!slug) return;
        try {
          const data = await api("POST", "/api/conversations", { kind, slug, topic });
          overlay.remove();
          await loadConversationsList();
          renderSidebarList();
          openConversation(data.conversation.id);
        } catch (e) { showToast(e.message); }
      });
    } else {
      const others = state.actorsList.filter((a) => a.handle !== state.actor.handle);
      body.innerHTML = `
        <div class="field"><label>Do kogo</label>
          <select id="nc-who" multiple size="6" style="background:var(--surface-2);border-radius:10px;padding:.4rem;border:1.5px solid transparent">
            ${others.map((a) => `<option value="${escapeHtml(a.handle)}">@${escapeHtml(a.handle)} ${a.kind === "human" ? "- czlowiek" : ""}</option>`).join("")}
          </select>
        </div>
        <p style="font-size:.8rem;color:var(--muted);margin-top:-.4rem">Wybierz jedną osobę (wiadomość) albo kilka (grupa).</p>
        <div class="row"><button class="btn ghost" id="nc-cancel">Anuluj</button><button class="btn" id="nc-create">Rozpocznij</button></div>`;
      body.querySelector("#nc-cancel").addEventListener("click", () => overlay.remove());
      body.querySelector("#nc-create").addEventListener("click", async () => {
        const sel = [...body.querySelector("#nc-who").selectedOptions].map((o) => o.value);
        if (!sel.length) return;
        try {
          const data = await api("POST", "/api/conversations", { kind: sel.length > 1 ? "group" : "dm", members: sel });
          overlay.remove();
          await loadConversationsList();
          renderSidebarList();
          openConversation(data.conversation.id);
        } catch (e) { showToast(e.message); }
      });
    }
  };
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  showTab(initialTab === "dm" ? "dm" : "channel");
}

async function showGuidelines() {
  let text = (state.guidelines && state.guidelines.text) || null;
  if (!text) {
    try { text = (await api("GET", "/api/guidelines")).text; } catch (e) { showToast(e.message); return; }
  }
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-height:80vh;display:flex;flex-direction:column">
      <h2>Zasady kanału</h2>
      <div style="overflow-y:auto;white-space:pre-wrap;font-size:.9rem;line-height:1.55;color:var(--ink)">${escapeHtml(text)}</div>
      <div class="row"><button class="btn" id="gd-ok">Rozumiem</button></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector("#gd-ok").addEventListener("click", () => overlay.remove());
}

// ------------------------------------------------------------------- ikony (SVG, bez emoji)
const iconChat = (rem) => `<svg viewBox="0 0 24 24" fill="none" ${rem ? `style="width:${rem}rem;height:${rem}rem"` : ""}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="currentColor" fill-opacity=".14"/></svg>`;
const iconMenu = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const iconSend = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M12 18.5V6M6.2 11.3 12 5.5l5.8 5.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const iconThread = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const iconTrash = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const iconOut = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M9 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3M15 15l4-3-4-3M9 12h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const iconInfo = () => `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v5M12 8v.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const iconLock = (inline) => `<svg viewBox="0 0 24 24" fill="none" style="${inline ? "display:inline;vertical-align:-2px;width:.9em;height:.9em" : "width:1em;height:1em"}"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.6"/></svg>`;
const iconPlus = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const iconFile = () => `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h7L18.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3.5V8a1 1 0 0 0 1 1h3.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const iconAddReaction = () => `<svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="12.5" r="7.5" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="13" cy="11" r="1" fill="currentColor"/><path d="M7.3 14.2c.8 1.1 2 1.8 3.2 1.8s2.4-.7 3.2-1.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M18.5 3.5v5M16 6h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

// ------------------------------------------------------------------- boot
(async function boot() {
  const restored = await tryRestoreSession();
  if (restored) { await afterLogin(); return; }
  render();
})();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.actor && (!es || es.readyState === 2)) connectSSE();
});
