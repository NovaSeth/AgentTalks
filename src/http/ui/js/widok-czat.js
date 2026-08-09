/**
 * Widok rozmowy: lista wiadomosci, composer, watek, panel szczegolow.
 */
import { answerQuestion, deleteMsg, dropPending, fixMsg, joinChannel, resolveMsg, retryPending, saveEditedMsg, sendMessage, toggleReaction } from "./akcje.js";
import { api, csrf } from "./api.js";
import { ensureActors, loadConversationsList, loadMessages, loadOlderMessages, markReadDebounced, refreshQuestions, signalTyping } from "./dane.js";
import { IMG_RE, avatarHtml, dayKey, dayLabel, emptyStateHtml, escapeHtml, fmtTime, formatBytes, hamburgerHtml, isScrolledToBottom, openModal, scrollToBottom, skeletonHtml, timeAgo, toggleDrawerClass, updateJumpPill, zachowanieScrolla } from "./dom.js";
import { iconAddReaction, iconArrowDown, iconChat, iconCheck, iconCopy, iconEdit, iconFile, iconFlame, iconGear, iconInfo, iconLock, iconPin, iconPlus, iconQuestion, iconReply, iconSend, iconShield, iconThread, iconTrash, iconWrench } from "./ikony.js";
import { renderBody } from "./markdown.js";
import { actorHandle, actorKind, actorOnline, animatedMsgs, canManageActive, dmLabel, dmMembersCache, findMsgById, lastMessageId, loadDraft, mentionsMe, mergeActors, mergeReactions, przytnijCache, pushRecent, saveDraft, state, upsertMessage, widoczneWiadomosci, widok } from "./stan.js";
import { showToast } from "./toasty.js";
import { openWikiPage, renderWikiMain } from "./widok-wiki.js";

// Popularny zestaw do popovera "dodaj reakcje" - kazda wartosc idzie przez to
// samo API co dowolna inna reakcja, wiec paleta jest tylko wygoda UI.
const EMOJI_PALETTE = ["👍", "❤️", "😂", "🎉", "🔥", "👀", "🚀", "👏", "✅", "🤔", "😢", "💯", "🙏", "👋", "⭐", "🙌"];

// ------------------------------------------------------- wejscie do rozmowy
export async function openConversation(id, focusMessageId) {
  saveDraft();                       // szkic POPRZEDNIEJ rozmowy, zanim cokolwiek przerysujemy
  const poprzednia = state.activeId;
  // Kreska "nowe wiadomosci" znika dopiero przy WYJSCIU z rozmowy - inaczej
  // gubi sie w trakcie czytania to jedyne miejsce, ktore mowilo "tu skonczyles".
  if (poprzednia && poprzednia !== id) delete state.readMark[poprzednia];
  state.view = "chat";
  state.activeId = id;
  try { localStorage.setItem("atalks_last_conv", String(id)); } catch { /* prywatny tryb */ }
  pushRecent(id);
  przytnijCache();
  state.drawerOpen = false;
  state.threadOpen = null;
  const draft = loadDraft(id);
  state.pendingFiles = draft?.files ?? [];
  state.replyTo = draft?.replyTo ?? null;
  // Znacznik "dotad przeczytane" zamrozony RAZ, PRZED oznaczeniem przeczytanego:
  // po 500 ms serwer przesuwa go na koniec i informacja "od ktorego miejsca to
  // nowe" przestaje istniec takze po odswiezeniu.
  if (state.readMark[id] === undefined) {
    state.readMark[id] = state.memberships[id]?.lastReadMessageId ?? 0;
  }
  widok.render();
  if (!state.loaded[id]) {
    state.loadingConv = true;
    renderMain();
    try { await loadMessages(id); } catch (e) { showToast(e.message, { alert: true }); }
    state.loadingConv = false;
  }
  if (focusMessageId && !(state.msgs[id] || []).some((m) => m.id === focusMessageId)) {
    try {
      const data = await api("GET", `/api/conversations/${id}/messages?before=${focusMessageId + 1}&limit=100`);
      for (const m of data.messages) { upsertMessage(id, m); animatedMsgs.add(m.id); }
      mergeActors(data.actors);
      mergeReactions(data.messages, data.reactions);
    } catch { /* best effort */ }
  }
  renderMain();
  refreshQuestions(id);
  if (focusMessageId) {
    const el = document.querySelector(`#messages [data-msg="${focusMessageId}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: zachowanieScrolla(false) });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }
  } else {
    // Wejscie ustawia sie na KRESCE nieprzeczytanych, gdy jakas jest - "doczytanie
    // zaleglosci" ma byc czynnoscia skonczona, a nie przewijaniem w gore na wyczucie.
    const linia = document.querySelector("#messages .newline");
    if (linia) linia.scrollIntoView({ block: "start", behavior: zachowanieScrolla(false) });
    else scrollToBottom(false);
  }
  // Dwa powody, dla ktorych to NIE jest bezwarunkowe:
  // 1) serwerowy markRead dopisuje do kanalu, wiec podglad kanalu z sekcji
  //    "Do odkrycia" po cichu zapisywalby nas do niego (i budzil przy @all);
  // 2) skok do konkretnej wiadomosci to zajrzenie w jedno miejsce, a nie
  //    oswiadczenie "przeczytalem cala reszte" - od tego jest dojechanie na dol.
  if (state.memberships[id] && !focusMessageId) markReadDebounced(id, lastMessageId(id));
}

async function openThread(rootId) {
  state.threadOpen = rootId;
  renderMain();
  try {
    const data = await api("GET", `/api/messages/${rootId}/thread`);
    state.threadMsgs = data.messages;
    for (const m of data.messages) animatedMsgs.add(m.id);
    mergeActors(data.actors);
    mergeReactions(data.messages, data.reactions);
  } catch (e) { showToast(e.message); }
  renderThread();
}

export function renderMain() {
  const el = document.getElementById("main");
  if (!el) return;
  if (state.view === "users") { widok.uzytkownicy(); return; }
  if (state.view === "notifications") { widok.powiadomienia(); return; }
  if (state.view === "wiki") { renderWikiMain(); return; }
  if (!state.activeId) {
    el.innerHTML = emptyStateHtml(iconChat(2.6), "Wybierz rozmowę", "...albo załóż nową w panelu bocznym.");
    return;
  }
  const c = state.conversations.find((x) => x.id === state.activeId);
  const isMember = !!state.memberships[state.activeId];
  el.innerHTML = `
    <div class="topbar">
      ${hamburgerHtml()}
      <div class="title">
        <div class="t" id="topbar-title"></div>
        ${c && c.topic ? `<div class="topic">${escapeHtml(c.topic)}</div>` : ""}
      </div>
      <button class="iconbtn ${state.detailsOpen ? "on" : ""}" id="btn-details" aria-label="Szczegóły rozmowy"
        aria-expanded="${state.detailsOpen}" aria-controls="details-slot" title="Szczegóły rozmowy">${iconInfo()}</button>
    </div>
    <div class="messages viewfade" id="messages" role="log" aria-label="Wiadomości"></div>
    <div class="dock">
      <button class="jump-newest" id="jump-newest" aria-label="Przewiń do najnowszej wiadomości" title="Przewiń do najnowszej">
        <span class="jn-label">Najnowsze</span>${iconArrowDown()}
      </button>
      <div class="presence-bar" id="presence-bar"></div>
      ${isMember
        ? `<div class="composer" id="composer"></div>`
        : `<div class="joinbar" id="joinbar">
             <span>Czytasz podgląd <b>#${escapeHtml(c?.slug ?? "")}</b> - dołącz, żeby pisać.</span>
             <button class="joinbtn" id="btn-join">Dołącz</button>
           </div>`}
    </div>
    ${state.threadOpen ? `<div id="thread-slot"></div>` : ""}
    ${state.detailsOpen ? `<div id="details-slot"></div>` : ""}
  `;
  document.getElementById("btn-menu").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen; toggleDrawerClass();
  });
  document.getElementById("btn-details").addEventListener("click", toggleDetails);
  const joinBtn = document.getElementById("btn-join");
  if (joinBtn) joinBtn.addEventListener("click", () => joinChannel(state.activeId, joinBtn));
  const jump = document.getElementById("jump-newest");
  if (jump) jump.addEventListener("click", () => {
    state.newBelow = 0;
    scrollToBottom(true);
    updateJumpPill();
    if (state.activeId && state.memberships[state.activeId]) {
      markReadDebounced(state.activeId, lastMessageId(state.activeId));
    }
  });
  renderTopbar();
  bindScrollWatch(document.getElementById("messages"));
  if (state.loadingConv) document.getElementById("messages").innerHTML = skeletonHtml();
  else renderMessages();
  renderPresenceBar();
  if (isMember) { renderComposer(); bindDropZone(el); }
  if (state.threadOpen) renderThread();
  if (state.detailsOpen) renderDetails();
}

// --------------------------------------------------- panel szczegolow rozmowy
async function toggleDetails() {
  state.detailsOpen = !state.detailsOpen;
  if (state.detailsOpen) await refreshDetailsData();
  renderMain();
}

export async function refreshDetailsData() {
  const id = state.activeId;
  if (!id) return;
  try {
    const [convData, pinsData] = await Promise.all([
      api("GET", `/api/conversations/${id}`),
      api("GET", `/api/conversations/${id}/pins`).catch(() => ({ pins: [] })),
    ]);
    state.convMembers = convData.members || [];
    state.convPins = pinsData.pins || [];
    // Cache aktorow zna tylko autorow wiadomosci - czlonek, ktory nic nie napisal,
    // mialby "@?"; dociagamy katalog raz.
    const missing = state.convMembers.some((m) => !state.actorsCache[m.actorId]);
    if (missing) await ensureActors({ force: true });
  } catch (e) { showToast(e.message, { alert: true }); }
}

export function renderDetails() {
  const host = document.getElementById("details-slot");
  if (!host) return;
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (!c) return;
  const isChannel = c.kind === "public" || c.kind === "private";
  const manage = canManageActive();
  const my = state.memberships[c.id];
  const notify = my?.notify ?? "all";
  const memberRow = (m) => {
    const a = state.actorsCache[m.actorId] || {};
    const handle = a.handle || "?";
    const online = actorOnline(m.actorId);
    const removable = isChannel && (manage || m.actorId === state.actor.id);
    return `
      <div class="dm-row">
        ${avatarHtml(handle, 26)}
        <span class="dm-name">@${escapeHtml(handle)}</span>
        <span class="kindtag ${a.kind || "agent"}">${a.kind === "human" ? "człowiek" : "agent"}</span>
        ${m.role === "admin" ? `<span class="roletag">admin</span>` : ""}
        <span class="ppresence ${online ? "on" : ""}"></span>
        ${removable ? `<button class="dm-kick" data-kick="${escapeHtml(handle)}"
          aria-label="${m.actorId === state.actor.id ? "Opuść rozmowę" : `Usuń @${escapeHtml(handle)} z rozmowy`}"
          title="${m.actorId === state.actor.id ? "Opuść" : "Usuń z rozmowy"}"><span aria-hidden="true">&times;</span></button>` : ""}
      </div>`;
  };
  const pinRow = (p) => {
    const msg = findMsgById(p.messageId);
    const who = msg ? actorHandle(msg.actorId) : p.by;
    const excerpt = msg ? String(msg.body || "").slice(0, 80) : `wiadomość #${p.messageId}`;
    return `
      <button class="pin-row" data-jump="${p.messageId}">
        ${iconPin()}<span class="pin-txt"><b>@${escapeHtml(who)}</b> ${escapeHtml(excerpt)}</span>
      </button>`;
  };
  host.innerHTML = `
    <div class="thread details">
      <div class="th-head">${iconInfo()} Szczegóły
        <button class="iconbtn close" id="dt-close" aria-label="Zamknij szczegóły rozmowy" title="Zamknij"><span aria-hidden="true">&times;</span></button></div>
      <div class="dt-body">
        ${isChannel ? `
        <div class="dt-sec">
          <h4>Kanał</h4>
          <div class="dt-chan">
            <span class="dm-name">${c.kind === "private" ? iconLock(true) : "#"} ${escapeHtml(c.slug ?? "")}</span>
            ${manage ? `<button class="pillbtn slim" id="dt-edit">${iconEdit()} Edytuj</button>` : ""}
          </div>
          ${c.topic ? `<p class="dt-topic">${escapeHtml(c.topic)}</p>` : ""}
        </div>` : ""}
        <div class="dt-sec">
          <h4>Uczestnicy (${state.convMembers.length})</h4>
          ${state.convMembers.map(memberRow).join("") || `<p class="sb-empty">brak</p>`}
          ${c.kind === "private" ? `
          <div class="dt-add">
            <label class="sr-only" for="dt-add-input">Kogo dodać do rozmowy</label>
            <input id="dt-add-input" placeholder="@handle do dodania">
            <button class="pillbtn slim" id="dt-add-btn">Dodaj</button>
          </div>` : ""}
        </div>
        ${my ? `
        <div class="dt-sec">
          <h4 id="dt-notify-label">Powiadomienia</h4>
          <div class="seg small" id="dt-notify" role="radiogroup" aria-labelledby="dt-notify-label">
            <button role="radio" aria-checked="${notify === "all"}" data-notify="all" class="${notify === "all" ? "on" : ""}">Każda wiadomość</button>
            <button role="radio" aria-checked="${notify === "mentions"}" data-notify="mentions" class="${notify === "mentions" ? "on" : ""}">Wzmianki</button>
            <button role="radio" aria-checked="${notify === "none"}" data-notify="none" class="${notify === "none" ? "on" : ""}">Nic</button>
          </div>
          <p class="dt-hint">Kiedy ta rozmowa może Cię zawołać (push / budzenie agenta):
            każda wiadomość, tylko wzmianki i DM, albo wcale.</p>
        </div>` : ""}
        ${state.convPins.length ? `
        <div class="dt-sec">
          <h4>Przypięte (${state.convPins.length})</h4>
          ${state.convPins.map(pinRow).join("")}
        </div>` : ""}
        ${isChannel && my ? `
        <div class="dt-sec dt-danger">
          <h4>Akcje</h4>
          <button class="dt-action" id="dt-leave">Opuść kanał</button>
          ${manage ? `<button class="dt-action danger" id="dt-archive">Zarchiwizuj kanał (znika z list, historia zostaje)</button>` : ""}
        </div>` : ""}
      </div>
    </div>`;
  document.getElementById("dt-close").addEventListener("click", () => { state.detailsOpen = false; renderMain(); });
  const edit = document.getElementById("dt-edit");
  if (edit) edit.addEventListener("click", () => editChannelModal(c));
  host.querySelectorAll("[data-kick]").forEach((b) =>
    b.addEventListener("click", async () => {
      const h = b.dataset.kick;
      const self = h === state.actor.handle;
      if (!confirm(self ? "Opuścić tę rozmowę?" : `Usunąć @${h} z rozmowy?`)) return;
      try {
        await api("DELETE", `/api/conversations/${c.id}/members/${encodeURIComponent(h)}`);
        if (self) { state.detailsOpen = false; await loadConversationsList(); widok.sidebar(); renderMain(); return; }
        await refreshDetailsData(); renderDetails();
      } catch (e) { showToast(e.message); }
    }));
  const addBtn = document.getElementById("dt-add-btn");
  if (addBtn) addBtn.addEventListener("click", async () => {
    const input = document.getElementById("dt-add-input");
    const h = input.value.trim().replace(/^@/, "");
    if (!h) return;
    try {
      await api("POST", `/api/conversations/${c.id}/members`, { handle: h });
      input.value = "";
      await refreshDetailsData(); renderDetails();
    } catch (e) { showToast(e.message); }
  });
  host.querySelectorAll("[data-notify]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        await api("POST", `/api/conversations/${c.id}/notify`, { notify: b.dataset.notify });
        if (state.memberships[c.id]) state.memberships[c.id].notify = b.dataset.notify;
        renderDetails();
      } catch (e) { showToast(e.message); }
    }));
  host.querySelectorAll("[data-jump]").forEach((b) =>
    b.addEventListener("click", () => {
      state.detailsOpen = false;
      openConversation(c.id, Number(b.dataset.jump));
    }));
  const leaveBtn = document.getElementById("dt-leave");
  if (leaveBtn) leaveBtn.addEventListener("click", async () => {
    if (!confirm(`Opuścić #${c.slug ?? ""}?`)) return;
    try {
      await api("POST", `/api/conversations/${c.id}/leave`, {});
      state.detailsOpen = false;
      await loadConversationsList(); widok.sidebar(); renderMain();
    } catch (e) { showToast(e.message); }
  });
  const arch = document.getElementById("dt-archive");
  if (arch) arch.addEventListener("click", async () => {
    if (!confirm(`Zarchiwizować #${c.slug ?? ""}? Kanał zniknie z list i przestanie przyjmować wiadomości; historia zostaje.`)) return;
    try {
      await api("DELETE", `/api/conversations/${c.id}`);
      state.detailsOpen = false;
      showToast("Kanał zarchiwizowany");
      await loadConversationsList();
      const next = state.conversations.find((x) => state.memberships[x.id]);
      state.activeId = null;
      widok.sidebar();
      if (next) openConversation(next.id); else renderMain();
    } catch (e) { showToast(e.message); }
  });
}

/** Modal edycji kanalu: temat + slug (nazwa). */
function editChannelModal(c) {
  const { modal, close } = openModal(`
      <h2 id="m-title">Edytuj kanał</h2>
      <div class="field"><label for="ec-slug">Nazwa (slug)</label><input id="ec-slug" value="${escapeHtml(c.slug ?? "")}"></div>
      <div class="field"><label for="ec-topic">Temat</label><input id="ec-topic" value="${escapeHtml(c.topic ?? "")}"></div>
      <div class="row"><button class="btn ghost" id="ec-cancel">Anuluj</button><button class="btn" id="ec-save">Zapisz</button></div>`);
  modal.querySelector("#ec-cancel").addEventListener("click", close);
  modal.querySelector("#ec-save").addEventListener("click", async () => {
    const slug = modal.querySelector("#ec-slug").value.trim().replace(/^#/, "");
    const topic = modal.querySelector("#ec-topic").value.trim();
    try {
      await api("PATCH", `/api/conversations/${c.id}`, { slug: slug || undefined, topic });
      close();
      await loadConversationsList();
      widok.sidebar(); renderMain();
      showToast("Kanał zaktualizowany");
    } catch (e) { showToast(e.message, { alert: true }); }
  });
}

export function renderTopbar() {
  const t = document.getElementById("topbar-title");
  if (!t) return;
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (!c || state.view !== "chat") return;
  const isDirect = c.kind === "dm" || c.kind === "group";
  if (isDirect) {
    const other = dmMembersCache[c.id] && dmMembersCache[c.id][0];
    const online = other != null && actorOnline(other);
    t.innerHTML = `<span class="ppresence big ${online ? "on" : ""}"></span> ${escapeHtml(dmLabel(c))}`;
  } else {
    const pre = c.kind === "private" ? `${iconLock(true)} ` : "# ";
    t.innerHTML = `${pre}${escapeHtml(c.slug || "bez-nazwy")}`;
  }
}

// ------------------------------------------------------------- pasek obecnosci
// "pisze..." (czlowiek, kropki jak iMessage) vs "pracuje" (agent, zebatka) -
// dwa ROZNE sygnaly, celowo rozna forma.
/** Piszacy w danym miejscu ("c:<id>" / "w:<slug>"), po jednym na aktora.
 *  Sygnal bez miejsca (starsi klienci) liczy sie wszedzie. */
function typersAt(loc) {
  const seen = new Set();
  const out = [];
  for (const p of state.presence) {
    if (!p.typing || p.actorId === state.actor.id || seen.has(p.actorId)) continue;
    if (p.typingIn && p.typingIn !== loc) continue;
    seen.add(p.actorId);
    out.push(p);
  }
  return out;
}

/** Kuleczki piszacych: DOKLADNIE ten sam wyglad co mini-awatary przy pasku
 *  watku (rozmiar, inicjaly, kolor aktora) - jedna kuleczka na aktora,
 *  podskakujaca z przesunieciem fazy. */
export function typingFacesHtml(loc) {
  const typers = typersAt(loc);
  if (!typers.length) return "";
  return `<span class="typing-faces" title="${escapeHtml(typers.map((p) => "@" + p.handle).join(", "))} pisze...">
    ${typers.slice(0, 6).map((p, i) =>
      `<span class="tf" style="animation-delay:${i * 0.14}s">${avatarHtml(p.handle, 20)}</span>`).join("")}
    <span class="tf-label">${typers.length === 1 ? "pisze" : "piszą"}...</span>
  </span>`;
}

export function renderPresenceBar() {
  const el = document.getElementById("presence-bar");
  if (!el) return;
  const parts = [];
  const faces = state.activeId ? typingFacesHtml(`c:${state.activeId}`) : "";
  if (faces) parts.push(faces);
  const seen = new Set();
  for (const p of state.presence) {
    if (p.actorId === state.actor.id || seen.has(p.actorId)) continue;
    if (p.busy && !p.typing) {
      seen.add(p.actorId);
      parts.push(`<span class="pres busy">${iconGear()} @${escapeHtml(p.handle)} pracuje${p.doing ? `: <i>${escapeHtml(p.doing)}</i>` : ""}</span>`);
    }
    if (parts.length >= 4) break;
  }
  el.innerHTML = parts.join("");
  el.classList.toggle("on", parts.length > 0);
}

/** Podpiete raz na render listy: sledzi pozycje scrolla i steruje pillem. */
function bindScrollWatch(el) {
  el.addEventListener("scroll", () => {
    updateJumpPill();
    // Oznaczenie przeczytanego nalezy do TEGO warunku: dojechales na dol, wiec
    // naprawde widzisz najnowsze. Podglad kanalu, do ktorego nie nalezysz, nie
    // moze zapisywac Cie do niego przez sam scroll.
    if (isScrolledToBottom() && state.activeId && state.memberships[state.activeId]) {
      markReadDebounced(state.activeId, lastMessageId(state.activeId));
    }
    // Doczytywanie starszych: bez klikania, gdy zblizasz sie do gory listy.
    // Prog 300 px, zeby paczka zdazyla dojsc, zanim uderzysz w sufit.
    if (el.scrollTop < 300 && state.activeId && state.hasMore[state.activeId]) {
      loadOlderMessages(state.activeId);
    }
  }, { passive: true });
}

/** Otwarta edycja inline zyje WYLACZNIE w DOM - przed przerysowaniem trzeba ja
 *  zapamietac, inaczej dowolne zdarzenie SSE kasuje w polowie napisane zdanie. */
function zapiszOtwartaEdycje(el) {
  const ta = el.querySelector(".inline-edit textarea");
  if (!ta) return null;
  const holder = ta.closest("[data-text],[data-answer-cta]");
  if (!holder) return null;
  return {
    sel: holder.dataset.text ? `[data-text="${holder.dataset.text}"]` : `[data-answer-cta="${holder.dataset.answerCta}"]`,
    answer: !holder.dataset.text,
    value: ta.value,
    start: ta.selectionStart,
    end: ta.selectionEnd,
  };
}

function odtworzOtwartaEdycje(el, snap) {
  if (!snap) return;
  const holder = el.querySelector(snap.sel);
  if (!holder) return;
  const id = Number(snap.answer ? holder.dataset.answerCta : holder.dataset.text);
  if (snap.answer) startInlineAnswer(state.openQuestions[id], id, el);
  else startInlineEdit(id, el);
  const ta = el.querySelector(`${snap.sel} textarea`);
  if (!ta) return;
  ta.value = snap.value;
  ta.setSelectionRange(snap.start, snap.end);
}

export function renderMessages() {
  const el = document.getElementById("messages");
  if (!el) return;
  if (closeEmojiPopover) closeEmojiPopover();
  const edycja = zapiszOtwartaEdycje(el);
  const trzymajDol = isScrolledToBottom();
  const scrollTop = el.scrollTop;
  const list = widoczneWiadomosci(state.activeId);
  if (!list.length) { el.innerHTML = emptyStateHtml(iconChat(2.2), "Na razie cicho", "Napisz pierwszą wiadomość."); return; }

  const c = state.conversations.find((x) => x.id === state.activeId);
  if (c && (c.kind === "dm" || c.kind === "group") && !dmMembersCache[c.id]) {
    const others = [...new Set((state.msgs[c.id] || []).map((m) => m.actorId))].filter((id) => id !== state.actor.id);
    if (others.length) dmMembersCache[c.id] = others;
  }

  // Starsze doczytuja sie same przy przewijaniu w gore; przycisk zostaje jako
  // droga awaryjna (np. gdy paczka nie wypelnila ekranu i nie ma czego scrollowac).
  let html = state.hasMore[state.activeId]
    ? `<button class="loadmore" id="btn-loadmore">Starsze wiadomości</button>` : "";
  const idx = threadIndex(state.activeId);
  const mark = state.readMark[state.activeId] || 0;
  let kreska = false;
  let lastDay = null, lastAuthor = null, lastTs = 0;
  for (const m of list) {
    const day = dayKey(m.ts);
    if (day !== lastDay) { html += `<div class="day">${dayLabel(m.ts)}</div>`; lastDay = day; lastAuthor = null; }
    // Kreska "nowe wiadomosci": jedno miejsce, ktore mowi "tu skonczyles czytac".
    // Serwer podaje lastReadMessageId od zawsze, a UI nie uzywal go ani razu.
    if (!kreska && mark && typeof m.id === "number" && m.id > mark && m.actorId !== state.actor.id) {
      html += `<div class="newline"><span>Nowe wiadomości</span></div>`;
      kreska = true;
      lastAuthor = null;
    }
    const cont = m.actorId === lastAuthor && (m.ts - lastTs) < 300 && !m.deletedAt && m.kind !== "ask";
    html += messageHtml(m, cont, { threads: idx });
    // Pytanie ma wlasna, wyrozniona rame - nic sie z nim nie skleja (ani ono
    // z poprzednim, ani nastepna wiadomosc z nim), inaczej gubi sie autor.
    lastAuthor = m.kind === "ask" ? null : m.actorId;
    lastTs = m.ts;
  }
  el.innerHTML = html;
  bindMessageEvents(el);
  const lm = el.querySelector("#btn-loadmore");
  if (lm) lm.addEventListener("click", () => { lm.disabled = true; loadOlderMessages(state.activeId); });
  // Pozycja czytania: podmiana dzieci zeruje scrollTop, wiec albo trzymamy dol
  // (bo tam bylismy), albo wracamy tam, gdzie uzytkownik faktycznie patrzyl.
  el.scrollTop = trzymajDol ? el.scrollHeight : scrollTop;
  odtworzOtwartaEdycje(el, edycja);
}

/** Punktowa podmiana JEDNEGO dymka - domyslna sciezka dla zdarzen na zywo.
 *  Pelny render listy przy kazdej wiadomosci, reakcji i odswiezeniu pytan
 *  kasowal caly stan zyjacy w DOM i kosztowal tyle, co cala rozmowa. */
export function upsertMessageNode(msg) {
  if (!msg || state.view !== "chat") return;
  const el = document.getElementById("messages");
  if (!el) return;
  if (msg.threadId) { if (state.threadOpen) renderThread(); return; }
  const stary = el.querySelector(`[data-msg="${msg.id}"]`);
  const idx = threadIndex(state.activeId);
  if (stary) {
    // Dymek, w ktorym uzytkownik wlasnie pisze, jest nietykalny.
    if (stary.querySelector(".inline-edit")) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = messageHtml(msg, stary.classList.contains("cont"), { threads: idx });
    stary.replaceWith(tmp.firstElementChild);
    return;
  }
  // Dokladamy TYLKO na koniec i tylko, gdy lista faktycznie jest na ekranie.
  // Wstawka w srodku (dosylka po przerwie) idzie normalnym renderem, zeby nie
  // popsuc kolejnosci ani separatorow dni.
  const lista = widoczneWiadomosci(state.activeId);
  const i = lista.findIndex((x) => x.id === msg.id);
  if (i !== lista.length - 1 || !el.querySelector("[data-msg]")) { renderMessages(); return; }
  const poprz = lista[i - 1] || null;
  const nowyDzien = !poprz || dayKey(poprz.ts) !== dayKey(msg.ts);
  if (nowyDzien) el.insertAdjacentHTML("beforeend", `<div class="day">${dayLabel(msg.ts)}</div>`);
  const cont = !nowyDzien && !!poprz && poprz.actorId === msg.actorId
    && (msg.ts - poprz.ts) < 300 && !msg.deletedAt && msg.kind !== "ask" && poprz.kind !== "ask";
  el.insertAdjacentHTML("beforeend", messageHtml(msg, cont, { threads: idx }));
}

function reactionChipsHtml(m) {
  const r = state.reactions[m.id];
  if (!r) return "";
  // Wartosc reakcji to niezaufane wejscie innego aktora (normalizeEmoji dopuszcza
  // kazdy krotki token) - MUSI byc escapowana takze przy wyswietlaniu.
  return Object.entries(r).map(([emoji, handles]) => {
    const mine = handles.includes(state.actor.handle);
    const safeEmoji = escapeHtml(emoji);
    return `<button class="react ${mine ? "mine" : ""}" data-react="${m.id}" data-emoji="${safeEmoji}"
      title="${escapeHtml(handles.join(", "))}">${safeEmoji}<span class="n">${handles.length}</span></button>`;
  }).join("");
}

/** Pasek watku jak w Slacku: awatary uczestnikow + liczba odpowiedzi + czas
 *  ostatniej. Widoczny zawsze, gdy watek istnieje - to on robi watki
 *  odkrywalnymi (ikona w hover-menu tylko go ZAKLADA). */
/** Mapa "korzen watku -> odpowiedzi", liczona RAZ na render. Wczesniej kazda
 *  wiadomosc filtrowala w tym celu cala tablice rozmowy, czyli koszt rosl
 *  z kwadratem liczby wiadomosci - przy kazdym zdarzeniu SSE. */
function threadIndex(convId) {
  const map = new Map();
  for (const m of state.msgs[convId] || []) {
    if (!m.threadId) continue;
    const arr = map.get(m.threadId);
    if (arr) arr.push(m); else map.set(m.threadId, [m]);
  }
  return map;
}

function threadLinkHtml(m, index) {
  const replies = index
    ? (index.get(m.id) || [])
    : (state.msgs[m.conversationId] || []).filter((x) => x.threadId === m.id);
  if (!replies.length) return "";
  const last = replies[replies.length - 1];
  const seen = new Set();
  const faces = [];
  for (const r of replies) {
    if (seen.has(r.actorId)) continue;
    seen.add(r.actorId);
    faces.push(avatarHtml(actorHandle(r.actorId), 20));
    if (faces.length >= 4) break;
  }
  const more = seen.size > 4 ? `<span class="tl-more">+${seen.size - 4}</span>` : "";
  return `<button class="thread-link" data-thread="${m.id}">
    <span class="tl-faces">${faces.join("")}${more}</span>
    <span class="tl-count">${replies.length} ${replies.length === 1 ? "odpowiedź" : "odpowiedzi"}</span>
    <span class="tl-when">ostatnia ${timeAgo(last.ts)}</span>
  </button>`;
}

function attachmentHtml(m) {
  const meta = m.meta || {};
  const name = escapeHtml(meta.name ?? "plik");
  const size = formatBytes(meta.size);
  const fileUrl = `/api/files/${encodeURIComponent(meta.fileId ?? "")}`;
  if (IMG_RE.test(meta.name ?? "")) {
    return `<button class="msg-img-wrap" data-lightbox="${fileUrl}" title="${name}">
      <img class="msg-img" src="${fileUrl}" alt="${name}" loading="lazy">
    </button>`;
  }
  return `<a class="attachment" href="${fileUrl}" download="${name}">
    <span class="fic">${iconFile()}</span>
    <span><span class="fname">${name}</span>${size ? `<br><span class="fsize">${size}</span>` : ""}</span>
  </a>`;
}

function deliveryHtml(m) {
  const d = state.lastDelivery;
  if (!d || d.conversationId !== m.conversationId || d.messageId !== m.id) return "";
  const parts = d.delivery.map((r) => {
    if (r.online) return `<span class="ok">@${escapeHtml(r.handle)}: online</span>`;
    if (r.wakeable) return `<span class="warn">@${escapeHtml(r.handle)}: cisza ${timeAgo(r.lastSeenAt).replace(" temu", "")} - obudzalny</span>`;
    return `<span class="off">@${escapeHtml(r.handle)}: nieosiągalny</span>`;
  });
  return `<div class="delivery">${parts.join(" · ")}</div>`;
}

/* Animacja wejscia tylko przy PIERWSZYM renderze wiadomosci. Kazdy re-render
   (reakcja, edycja, odczyt) przerysowuje cala liste i bez tej pamieci wszystkie
   dymki odgrywaly "wjazd" od nowa. */

function messageHtml(m, cont, opts = {}) {
  const handle = actorHandle(m.actorId);
  const kind = actorKind(m.actorId);
  const mine = m.actorId === state.actor.id;
  // Wpis w locie: ten sam ksztalt dymka, ale wyszarzony i bez akcji, ktorych
  // serwer jeszcze nie zna. Przy bledzie tresc ZOSTAJE na ekranie z ponowieniem -
  // w tym momencie jest to jedyna kopia tego, co uzytkownik napisal.
  if (m.pending || m.failed) {
    return `
    <div class="msg ${cont ? "cont" : ""} ${m.failed ? "failed" : "sending"}" data-msg="${m.id}">
      ${avatarHtml(handle)}
      <div class="body">
        <div class="head">
          <span class="author">@${escapeHtml(handle)}</span>
          <span class="time">${m.failed ? "nie wysłano" : "wysyłanie..."}</span>
        </div>
        <div class="text">${renderBody(m.body, state.actor.handle)}</div>
        ${m.failed ? `
        <div class="failbar">
          <span class="failwhy">${escapeHtml(m.error || "Nie udało się wysłać")}</span>
          <button data-retry="${escapeHtml(m.clientMsgId)}">Wyślij ponownie</button>
          <button data-copytext="${escapeHtml(m.clientMsgId)}">Kopiuj treść</button>
          <button data-droppending="${escapeHtml(m.clientMsgId)}">Usuń</button>
        </div>` : ""}
      </div>
    </div>`;
  }
  const wolaMnie = mentionsMe(m.body);
  const isAsk = m.kind === "ask";
  const qid = state.openQuestions[m.id];
  const askOpen = isAsk && qid !== undefined;
  const chips = m.deletedAt ? "" : reactionChipsHtml(m);
  const resolved = !!m.resolvedAt;
  // Dwa RÓŻNE twierdzenia, wiec dwa rozne znaczki: "naprawione" mowi ten, kto
  // zmienil kod, "potwierdzone" - ten, kto zglosil (albo admin). Jeden znaczek
  // na oba czytaloby sie jak weryfikacja, a znaczyloby "ktos twierdzi, ze zrobil".
  const fixed = !!m.fixedAt && !resolved;
  // Rozwiazac moze autor, admin instancji, albo admin kanalu (jak na serwerze).
  const myMem = state.memberships[m.conversationId];
  const canResolve = !m.deletedAt && m.kind !== "answer"
    && (mine || state.actor.isAdmin || (myMem && myMem.role === "admin"));
  const fresh = !animatedMsgs.has(m.id);
  // Zbior rosl przez cale zycie karty. Reset po przekroczeniu progu kosztuje
  // jedna niepotrzebna animacje wejscia i oddaje pamiec.
  if (animatedMsgs.size > 5000) animatedMsgs.clear();
  if (fresh) animatedMsgs.add(m.id);
  return `
    <div class="msg ${fresh ? "enter" : ""} ${cont ? "cont" : ""} ${m.deletedAt ? "deleted" : ""} ${wolaMnie ? "mine-mention" : ""} ${isAsk ? "ask" : ""} ${m.kind === "answer" ? "answer" : ""} ${resolved ? "resolved" : ""}" data-msg="${m.id}">
      ${avatarHtml(handle)}
      <div class="body">
        <div class="head">
          <span class="author">@${escapeHtml(handle)}</span>
          <span class="kindtag ${kind}">${kind === "human" ? "człowiek" : "agent"}</span>
          <span class="time">${fmtTime(m.ts)}</span>
          ${m.editedAt ? `<span class="edited">(edytowano)</span>` : ""}
          ${resolved ? `<span class="qbadge done" title="Potwierdzone przez @${escapeHtml(actorHandle(m.resolvedBy))}${m.fixedAt ? `, naprawił(a) @${escapeHtml(actorHandle(m.fixedBy))}` : ""}">${iconCheck(true)} Potwierdzone</span>` : ""}
          ${fixed ? `<span class="qbadge fixed" title="@${escapeHtml(actorHandle(m.fixedBy))} zmienił(a) kod. Czeka na potwierdzenie zgłaszającego, że objaw zniknął.">${iconWrench()} Naprawione · czeka na potwierdzenie</span>` : ""}
          ${isAsk ? (askOpen
            ? `<span class="qbadge open"><span class="qdot"></span>Otwarte pytanie</span>`
            : `<span class="qbadge done">${iconCheck(true)} Odpowiedziane</span>`) : ""}
          ${m.kind === "answer" ? `<span class="qbadge done">${iconCheck(true)} odpowiedź</span>` : ""}
        </div>
        ${m.deletedAt ? `<div class="text">wiadomość usunięta</div>`
          : m.kind === "file" ? attachmentHtml(m)
          : `<div class="text" data-text="${m.id}">${renderBody(m.body, state.actor.handle)}</div>`}
        ${askOpen && !m.deletedAt ? `
        <div class="answer-cta" data-answer-cta="${m.id}">
          <button class="answerbtn" data-answer="${qid}" data-msg-ref="${m.id}">${iconReply()} Odpowiedz</button>
        </div>` : ""}
        ${(() => {
          // Jeden staly wiersz pod wpisem, jak w Slacku: chipy reakcji,
          // za nimi widoczny przycisk "dodaj reakcje", a odpowiedzi watku po prawej.
          if (m.deletedAt) return "";
          const tlink = !m.threadId && !opts.noThreadLink ? threadLinkHtml(m, opts.threads) : "";
          return `<div class="reacts">${chips}
            <button class="react addreact" data-addreact="${m.id}" aria-label="Dodaj reakcję" title="Dodaj reakcję">${iconAddReaction()}</button>
            ${tlink}</div>`;
        })()}
        ${mine ? deliveryHtml(m) : ""}
      </div>
      ${!m.deletedAt ? `
      <div class="actions" role="group" aria-label="Akcje wiadomości od @${escapeHtml(handle)}">
        ${canResolve ? `<button data-resolve="${m.id}" data-on="${resolved ? "1" : ""}" class="${resolved ? "on" : ""}" aria-pressed="${resolved}" aria-label="${resolved ? "Cofnij potwierdzenie" : "Potwierdź: objaw zniknął"}" title="${resolved ? "Cofnij potwierdzenie" : "Potwierdź: objaw zniknął"}">${iconCheck(true)}</button>` : ""}
        ${!mine && m.kind === "text" ? `<button data-fix="${m.id}" data-on="${m.fixedAt ? "1" : ""}" class="${m.fixedAt ? "on" : ""}" aria-pressed="${!!m.fixedAt}" aria-label="${m.fixedAt ? "Cofnij oznaczenie 'naprawione'" : "Oznacz jako naprawione"}" title="${m.fixedAt ? "Cofnij 'naprawione'" : "Oznacz: naprawiłem, czeka na potwierdzenie"}">${iconWrench()}</button>` : ""}
        <button data-reply="${m.id}" aria-label="Odpowiedz w wątku" title="Odpowiedz w wątku">${iconThread()}</button>
        ${mine && m.kind === "text" ? `<button data-edit="${m.id}" aria-label="Edytuj wiadomość" title="Edytuj">${iconEdit()}</button>` : ""}
        ${mine ? `<button data-delete="${m.id}" aria-label="Usuń wiadomość" title="Usuń">${iconTrash()}</button>` : ""}
      </div>` : ""}
    </div>`;
}

// JEDEN delegowany sluchacz na kontener zamiast dwunastu przebiegow
// querySelectorAll po kazdym renderze. Dzieki temu podmiana pojedynczego dymka
// nie wymaga podpinania czegokolwiek na nowo - a listy wiadomosci nie trzeba
// przerysowywac tylko po to, zeby przyciski znowu dzialaly.
const PODPIETE = new WeakSet();

export function bindMessageEvents(scope) {
  if (!scope || PODPIETE.has(scope)) return;
  PODPIETE.add(scope);
  scope.addEventListener("click", async (e) => {
    const wez = (sel) => e.target.closest(sel);
    let b;
    if ((b = wez("[data-react]"))) { toggleReaction(Number(b.dataset.react), b.dataset.emoji); return; }
    if ((b = wez("[data-addreact]"))) { openEmojiPopover(Number(b.dataset.addreact), b); return; }
    if ((b = wez("[data-reply]"))) { state.replyTo = Number(b.dataset.reply); renderComposer(); focusComposer(); return; }
    if ((b = wez("[data-thread]"))) { openThread(Number(b.dataset.thread)); return; }
    if ((b = wez("[data-resolve]"))) { resolveMsg(Number(b.dataset.resolve), !b.dataset.on); return; }
    if ((b = wez("[data-fix]"))) { fixMsg(Number(b.dataset.fix), !b.dataset.on); return; }
    if ((b = wez("[data-delete]"))) { if (confirm("Usunąć tę wiadomość?")) deleteMsg(Number(b.dataset.delete)); return; }
    if ((b = wez("[data-edit]"))) { startInlineEdit(Number(b.dataset.edit), scope); return; }
    if ((b = wez("[data-answer]"))) { startInlineAnswer(Number(b.dataset.answer), Number(b.dataset.msgRef), scope); return; }
    if ((b = wez("[data-retry]"))) { retryPending(state.activeId, b.dataset.retry); return; }
    if ((b = wez("[data-droppending]"))) { dropPending(state.activeId, b.dataset.droppending); return; }
    if ((b = wez("[data-copytext]"))) {
      const rec = (state.pending[state.activeId] || []).find((p) => p.clientMsgId === b.dataset.copytext);
      try { await navigator.clipboard.writeText(rec?.body ?? ""); showToast("Skopiowane do schowka"); }
      catch { showToast("Nie udało się skopiować", { alert: true }); }
      return;
    }
    if ((b = wez("[data-lightbox]"))) { openLightbox(b.dataset.lightbox); return; }
    if ((b = wez("[data-copy]"))) {
      const code = b.parentElement.querySelector("code");
      try {
        await navigator.clipboard.writeText(code.textContent);
        b.classList.add("copied"); b.innerHTML = iconCheck(true);
        setTimeout(() => { b.classList.remove("copied"); b.innerHTML = iconCopy(); }, 1400);
      } catch { showToast("Nie udało się skopiować", { alert: true }); }
      return;
    }
    if ((b = wez("[data-wikilink]"))) {
      e.preventDefault();
      const slug = b.dataset.wikilink;
      if (state.wiki.pages.some((p) => p.slug === slug)) { openWikiPage(slug); return; }
      // Czerwony link: strony nie ma - otwieramy edytor nowej pod tym slugiem.
      state.view = "wiki";
      state.wiki.slug = slug;
      state.wiki.page = null;
      state.wiki.files = [];
      state.wiki.history = [];
      state.wiki.revision = null;
      state.wiki.editing = true;
      state.wiki.draft = { title: slug, body: "" };
      widok.sidebar();
      renderWikiMain();
    }
  });
  // Dotyk nie zna hover, a pasek akcji zyl wylacznie na hoverze. Dlugie
  // przytrzymanie wiadomosci (500 ms) odslania go tak samo jak w Slacku.
  let holdTimer = null;
  scope.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const msg = e.target.closest(".msg");
    if (!msg) return;
    holdTimer = setTimeout(() => {
      scope.querySelectorAll(".msg.touch-actions").forEach((n) => n.classList.remove("touch-actions"));
      msg.classList.add("touch-actions");
    }, 500);
  }, { passive: true });
  const anuluj = () => { clearTimeout(holdTimer); holdTimer = null; };
  scope.addEventListener("pointerup", anuluj, { passive: true });
  scope.addEventListener("pointercancel", anuluj, { passive: true });
  scope.addEventListener("pointermove", anuluj, { passive: true });
}

// ------------------------------------------------------- edycja inline
/** @param scope kontener, z ktorego przyszedl klik. Ta sama wiadomosc bywa
 *  w dokumencie DWA razy (glowna lista + korzen watku), wiec szukanie po calym
 *  dokumencie zawsze trafialo w pierwsze wystapienie - czyli otwieralo pole
 *  edycji w kopii, ktorej uzytkownik w tej chwili nie widzi. */
function startInlineEdit(messageId, scope) {
  const holder = (scope || document).querySelector(`[data-text="${messageId}"]`);
  if (!holder) return;
  const msg = findMsgById(messageId);
  if (!msg) return;
  holder.innerHTML = `
    <div class="inline-edit">
      <textarea rows="1"></textarea>
      <div class="hint">Enter zapisz · Escape anuluj</div>
    </div>`;
  const ta = holder.querySelector("textarea");
  ta.value = msg.body;
  const autos = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 300) + "px"; };
  ta.addEventListener("input", autos);
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = ta.value.trim();
      if (!v || v === msg.body) { renderMessages(); return; }
      try { await saveEditedMsg(messageId, v); } catch (err) { showToast(err.message); }
    }
    if (e.key === "Escape") renderMessages();
  });
  autos(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ------------------------------------------------------- odpowiedz na pytanie
function startInlineAnswer(questionId, messageId, scope) {
  const cta = (scope || document).querySelector(`[data-answer-cta="${messageId}"]`);
  if (!cta) return;
  cta.innerHTML = `
    <div class="inline-edit answerbox">
      <textarea rows="1" placeholder="Twoja odpowiedź..."></textarea>
      <div class="hint">Enter wyślij · Escape anuluj</div>
    </div>`;
  const ta = cta.querySelector("textarea");
  const autos = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 300) + "px"; };
  ta.addEventListener("input", autos);
  ta.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = ta.value.trim();
      if (!v) return;
      try { await answerQuestion(questionId, v); showToast("Pytanie domknięte - dzięki!"); }
      catch (err) { showToast(err.message); renderMessages(); }
    }
    if (e.key === "Escape") renderMessages();
  });
  autos(); ta.focus();
}

// ------------------------------------------------------------- lightbox
function openLightbox(url) {
  const overlay = document.createElement("div");
  overlay.className = "overlay lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Podgląd obrazu - Escape zamyka");
  overlay.innerHTML = `<img src="${url}" alt="Powiększony załącznik">`;
  document.body.appendChild(overlay);
  const wrocDo = document.activeElement;
  // Sluchacz zdejmowany w JEDNYM miejscu: wczesniej wychodzilo tylko galezia
  // Escape, wiec zamkniecie klikiem zostawialo zywe domkniecie z referencja
  // do usunietego elementu.
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    if (wrocDo && document.contains(wrocDo)) wrocDo.focus();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
}

// ------------------------------------------------------------- reakcje: popover
let closeEmojiPopover = null;

let emojiPopoverAnchor = null;

function openEmojiPopover(messageId, anchor) {
  const reopeningSame = emojiPopoverAnchor === anchor;
  if (closeEmojiPopover) closeEmojiPopover();
  if (reopeningSame) return;
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
let draftTimer = null;

function zapiszSzkicPozniej() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); }

/** Wspolne wejscie dla plikow z dialogu, ze schowka i z przeciagniecia. */
function dodajPliki(files) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  for (const file of files) {
    // Zrzut ekranu ze schowka przychodzi bez sensownej nazwy ("image.png"),
    // a na liscie zalacznikow ma sie dac go pozniej rozpoznac.
    const nazwany = file.name && file.name !== "image.png"
      ? file
      : new File([file], `wklejone-${stamp}.${file.type.split("/")[1] || "png"}`, { type: file.type });
    state.pendingFiles.push({
      file: nazwany, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url: nazwany.type.startsWith("image/") ? URL.createObjectURL(nazwany) : null,
      sensitive: false, burn: false, ttlSec: 0,
    });
  }
  renderPreviews();
  odswiezPrzyciskWyslij();
  saveDraft();
}

function odswiezPrzyciskWyslij() {
  const send = document.getElementById("composer-send");
  const ta = document.getElementById("composer-input");
  if (!send || !ta) return;
  const can = !!ta.value.trim() || state.pendingFiles.length > 0;
  send.disabled = !can;
  send.classList.toggle("ready", can);
}

/** Upuszczenie pliku na CALY obszar rozmowy, jak w Slacku - trzy kroki (zapisz
 *  na dysk, otworz dialog, znajdz plik) zamieniaja sie w jeden. */
function bindDropZone(el) {
  if (el.dataset.dropbound) return;
  el.dataset.dropbound = "1";
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  el.addEventListener("dragover", (e) => { stop(e); el.classList.add("dropping"); });
  el.addEventListener("dragleave", (e) => { if (e.target === el) el.classList.remove("dropping"); });
  el.addEventListener("drop", (e) => {
    stop(e);
    el.classList.remove("dropping");
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) dodajPliki(files);
  });
}

export function renderComposer() {
  const el = document.getElementById("composer");
  if (!el) return;
  const replyMsg = state.replyTo ? findMsgById(state.replyTo) : null;
  el.innerHTML = `
    ${replyMsg ? `<div class="replying">Odpowiadasz <b>@${escapeHtml(actorHandle(replyMsg.actorId))}</b>
      <button id="cancel-reply" aria-label="Anuluj odpowiadanie" title="Anuluj"><span aria-hidden="true">&times;</span></button></div>` : ""}
    <div class="card" id="composer-card">
      <div class="previews" id="composer-previews"></div>
      <div class="row">
        <button class="attach" id="composer-attach" type="button" aria-label="Załącz pliki" title="Załącz pliki">${iconPlus()}</button>
        <input type="file" id="composer-file" multiple style="display:none" aria-label="Wybierz pliki do wysłania">
        <label class="sr-only" for="composer-input">Twoja wiadomość</label>
        <textarea id="composer-input" rows="1" placeholder="Twoja wiadomość..."></textarea>
        <button class="send" id="composer-send" disabled aria-label="Wyślij wiadomość" title="Wyślij (Enter)">${iconSend()}</button>
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
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
    const can = !!ta.value.trim() || state.pendingFiles.length > 0;
    send.disabled = !can;
    send.classList.toggle("ready", can);
  };
  // Szkic wraca do pola razem z rozmowa (i przezywa F5 - tekst siedzi w localStorage).
  const draft = state.drafts[state.activeId];
  if (draft?.text) ta.value = draft.text;
  ta.addEventListener("input", () => { autosize(); signalTyping(); mentionAutocomplete(ta); zapiszSzkicPozniej(); });
  ta.addEventListener("keydown", (e) => {
    if (mentionKeydown(e, ta)) return;
    // Slackowe ArrowUp na PUSTYM polu: edycja ostatniej wlasnej wiadomosci.
    // Bez tego literowke poprawia sie wylacznie trafiajac w ikone 1.8rem,
    // widoczna tylko przy najechaniu myszka.
    if (e.key === "ArrowUp" && !ta.value.trim() && !state.pendingFiles.length) {
      const mine = [...widoczneWiadomosci(state.activeId)].reverse()
        .find((m) => m.actorId === state.actor.id && m.kind === "text" && !m.deletedAt && !m.pending && !m.failed);
      if (mine) { e.preventDefault(); startInlineEdit(mine.id, document.getElementById("messages")); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  // Wklejenie zrzutu ekranu wprost do rozmowy - najczestsza forma zalacznika
  // w narzedziu dla programistow i agentow; wczesniej Ctrl+V nie robilo nic.
  ta.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    dodajPliki(files);
    autosize();
  });
  send.addEventListener("click", submit);
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    dodajPliki([...fileInput.files]);
    fileInput.value = "";
    autosize();
  });
  async function submit() {
    const v = ta.value.trim();
    if (!v && !state.pendingFiles.length) return;
    closeMentionPopover();
    const files = state.pendingFiles; state.pendingFiles = [];
    ta.value = ""; renderPreviews(); autosize();
    // Plik, ktorego nie udalo sie wyslac, WRACA do podgladow - inaczej znikalby
    // razem z jedyna kopia wyboru, ktorego uzytkownik dokonal.
    const nieudane = [];
    for (const p of files) {
      const ok = await uploadAttachment(p);
      if (ok) { if (p.url) URL.revokeObjectURL(p.url); } else nieudane.push(p);
    }
    if (nieudane.length) { state.pendingFiles = [...nieudane, ...state.pendingFiles]; renderPreviews(); odswiezPrzyciskWyslij(); }
    if (v) await sendMessage(v);
    saveDraft();
  }
  renderPreviews();
  autosize();
}

/** Opcje pliku pod podgladem: wrazliwy (domyslny TTL 24 h po stronie serwera),
 *  spal po odczycie, TTL. Ida jako naglowki x-sensitive / x-burn / x-ttl. */
function fileOptsHtml(p) {
  return `<div class="pv-opts">
    <button class="pv-opt ${p.sensitive ? "on" : ""}" data-pvsens="${p.id}" title="Wrażliwy: domyślnie zniknie po 24 h, bez podglądu w kanale">${iconShield()}</button>
    <button class="pv-opt ${p.burn ? "on" : ""}" data-pvburn="${p.id}" title="Spal po odczycie: znika po pierwszym pobraniu przez odbiorcę">${iconFlame()}</button>
    <select class="pv-ttl" data-pvttl="${p.id}" title="Po jakim czasie plik ma zniknąć">
      <option value="0" ${!p.ttlSec ? "selected" : ""}>bez limitu</option>
      <option value="3600" ${p.ttlSec === 3600 ? "selected" : ""}>1 h</option>
      <option value="86400" ${p.ttlSec === 86400 ? "selected" : ""}>24 h</option>
      <option value="604800" ${p.ttlSec === 604800 ? "selected" : ""}>7 dni</option>
    </select>
  </div>`;
}

function renderPreviews() {
  const box = document.getElementById("composer-previews");
  if (!box) return;
  const usun = (p) => `<button data-rmpv="${p.id}" aria-label="Usuń załącznik ${escapeHtml(p.file.name)}"
    title="Usuń"><span aria-hidden="true">&times;</span></button>`;
  box.innerHTML = state.pendingFiles.map((p) => p.url
    ? `<div class="preview img" data-pv="${p.id}"><img src="${p.url}" alt="${escapeHtml(p.file.name)}">${usun(p)}${fileOptsHtml(p)}</div>`
    : `<div class="preview file" data-pv="${p.id}"><div class="pv-main">${iconFile()}<span class="pn">${escapeHtml(p.file.name)}</span>${usun(p)}</div>${fileOptsHtml(p)}</div>`
  ).join("");
  box.querySelectorAll("[data-rmpv]").forEach((b) => b.addEventListener("click", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.rmpv);
    if (p?.url) URL.revokeObjectURL(p.url);
    state.pendingFiles = state.pendingFiles.filter((x) => x.id !== b.dataset.rmpv);
    renderPreviews();
    odswiezPrzyciskWyslij();
    saveDraft();
  }));
  box.querySelectorAll("[data-pvsens]").forEach((b) => b.addEventListener("click", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.pvsens);
    if (p) { p.sensitive = !p.sensitive; renderPreviews(); }
  }));
  box.querySelectorAll("[data-pvburn]").forEach((b) => b.addEventListener("click", () => {
    const p = state.pendingFiles.find((x) => x.id === b.dataset.pvburn);
    if (p) { p.burn = !p.burn; renderPreviews(); }
  }));
  box.querySelectorAll("[data-pvttl]").forEach((s) => s.addEventListener("change", () => {
    const p = state.pendingFiles.find((x) => x.id === s.dataset.pvttl);
    if (p) p.ttlSec = Number(s.value) || 0;
  }));
}

async function uploadAttachment(p) {
  const convId = state.activeId;
  const file = p.file;
  try {
    const res = await fetch(`/api/conversations/${convId}/files`, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        ...(p.sensitive ? { "x-sensitive": "1" } : {}),
        ...(p.burn ? { "x-burn": "1" } : {}),
        ...(p.ttlSec ? { "x-ttl": String(p.ttlSec) } : {}),
        ...(csrf ? { "x-at-csrf": csrf } : {}),
      },
      credentials: "same-origin",
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    upsertMessage(convId, data.message);
    upsertMessageNode(data.message);
    scrollToBottom(true);
    return true;
  } catch (e) {
    showToast(`Nie udało się wysłać pliku: ${e.message}`, { alert: true });
    return false;
  }
}

function focusComposer() { const ta = document.getElementById("composer-input"); if (ta) ta.focus(); }

// ---------------------------------------------- autouzupelnianie @wzmianek
let mentionPop = null, mentionItems = [], mentionIndex = 0, mentionStart = -1;

function closeMentionPopover() {
  if (mentionPop) { mentionPop.remove(); mentionPop = null; mentionItems = []; }
}

async function mentionAutocomplete(ta) {
  const upto = ta.value.slice(0, ta.selectionStart ?? ta.value.length);
  const m = upto.match(/(^|[\s(])@([a-z0-9._-]{0,24})$/i);
  if (!m) { closeMentionPopover(); return; }
  mentionStart = upto.length - m[2].length - 1;
  // Jedna regula odswiezania katalogu (TTL) zamiast trzech roznych - inaczej
  // agent, ktory dolaczyl minute temu, nie istnial dla podpowiedzi.
  await ensureActors();
  const q = m[2].toLowerCase();
  // @all na gorze listy, gdy pasuje - jedno ogloszenie budzi caly kanal.
  const allItem = { handle: "all", displayName: "wszyscy na kanale", kind: "all" };
  const showAll = (!q || "all".startsWith(q) || "wszyscy".startsWith(q));
  mentionItems = [
    ...(showAll ? [allItem] : []),
    ...state.actorsList
      .filter((a) => a.handle !== state.actor.handle)
      .filter((a) => !q || a.handle.toLowerCase().includes(q) || (a.displayName || "").toLowerCase().includes(q)),
  ].slice(0, 6);
  if (!mentionItems.length) { closeMentionPopover(); return; }
  mentionIndex = 0;
  if (!mentionPop) {
    mentionPop = document.createElement("div");
    mentionPop.className = "mention-pop";
    document.body.appendChild(mentionPop);
  }
  const rect = ta.getBoundingClientRect();
  mentionPop.innerHTML = mentionItems.map((a, i) => `
    <button data-mi="${i}" class="${i === mentionIndex ? "sel" : ""}">
      ${a.kind === "all" ? `<span class="mention-all-ic">@</span>` : avatarHtml(a.handle, 22)}
      <span class="mh">@${escapeHtml(a.handle)}</span>
      <span class="kindtag ${a.kind === "all" ? "" : a.kind}">${a.kind === "all" ? "cały kanał" : a.kind === "human" ? "człowiek" : "agent"}</span>
    </button>`).join("");
  mentionPop.style.left = `${rect.left + 8}px`;
  mentionPop.style.top = `${rect.top - mentionPop.offsetHeight - 6}px`;
  mentionPop.querySelectorAll("[data-mi]").forEach((b) =>
    b.addEventListener("mousedown", (e) => { e.preventDefault(); pickMention(ta, Number(b.dataset.mi)); }));
}

function pickMention(ta, idx) {
  const a = mentionItems[idx];
  if (!a) return;
  const after = ta.value.slice(ta.selectionStart ?? ta.value.length);
  ta.value = ta.value.slice(0, mentionStart) + "@" + a.handle + " " + after;
  const pos = mentionStart + a.handle.length + 2;
  ta.setSelectionRange(pos, pos);
  closeMentionPopover();
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function mentionKeydown(e, ta) {
  if (!mentionPop) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    mentionIndex = (mentionIndex + (e.key === "ArrowDown" ? 1 : mentionItems.length - 1)) % mentionItems.length;
    mentionPop.querySelectorAll("[data-mi]").forEach((b, i) => b.classList.toggle("sel", i === mentionIndex));
    return true;
  }
  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(ta, mentionIndex); return true; }
  if (e.key === "Escape") { closeMentionPopover(); return true; }
  return false;
}

// ------------------------------------------------------------- watek (drawer)
export function renderThread() {
  let host = document.getElementById("thread-slot");
  if (!host) return;
  const root = findMsgById(state.threadOpen);
  const replies = state.threadMsgs.filter((m) => m.id !== state.threadOpen);
  host.innerHTML = `
    <div class="thread" role="region" aria-label="Wątek">
      <div class="th-head">${iconThread()} Wątek
        <button class="iconbtn close" id="th-close" aria-label="Zamknij wątek" title="Zamknij"><span aria-hidden="true">&times;</span></button></div>
      <div class="th-msgs" id="th-msgs">
        ${root ? messageHtml(root, false, { noThreadLink: true }) : ""}
        ${replies.map((m, i) => messageHtml(m, i > 0 && replies[i - 1].actorId === m.actorId)).join("")}
      </div>
      <div class="composer" id="th-composer"></div>
    </div>`;
  document.getElementById("th-close").addEventListener("click", closeThread);
  bindMessageEvents(document.getElementById("th-msgs"));
  const tc = document.getElementById("th-composer");
  tc.innerHTML = `<div class="card"><div class="row">
    <label class="sr-only" for="th-input">Odpowiedź w wątku</label>
    <textarea id="th-input" rows="1" placeholder="Odpowiedz w wątku..."></textarea>
    <button class="send" id="th-send" disabled aria-label="Wyślij odpowiedź">${iconSend()}</button></div></div>`;
  const ta = document.getElementById("th-input"), send = document.getElementById("th-send");
  const autosize = () => {
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    ta.style.overflowY = ta.scrollHeight > 200 ? "auto" : "hidden";
    send.disabled = !ta.value.trim();
    send.classList.toggle("ready", !!ta.value.trim());
  };
  ta.addEventListener("input", () => { autosize(); signalTyping(); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  send.addEventListener("click", submit);
  async function submit() {
    const v = ta.value.trim(); if (!v) return;
    ta.value = ""; autosize();
    const msg = await sendMessage(v, { threadId: state.threadOpen });
    // Nieudana wysylka oddaje tekst do pola - tak samo jak w glownym composerze.
    if (!msg) { ta.value = v; autosize(); ta.focus(); return; }
    state.threadMsgs.push(msg);
    renderThread();
    upsertMessageNode(findMsgById(state.threadOpen));   // pasek watku na glownej liscie
    document.getElementById("th-msgs").scrollTop = 999999;
  }
  document.getElementById("th-msgs").scrollTop = 999999;
}

/** Zamkniecie watku z powrotem fokusu na pasek, ktory go otworzyl. */
export function closeThread() {
  const rootId = state.threadOpen;
  state.threadOpen = null;
  renderMain();
  document.querySelector(`#messages [data-thread="${rootId}"]`)?.focus();
}

// ============================================================= PYTANIA panel
export async function openQuestionsPanel() {
  let data;
  try { data = await api("GET", "/api/questions/open"); } catch (e) { showToast(e.message); return; }
  const { modal, close } = openModal(`
      <h2 id="m-title">${iconQuestion()} Otwarte pytania</h2>
      <div class="qlist">
        ${data.questions.length ? data.questions.map((q) => {
          const conv = state.conversations.find((c) => c.id === q.message.conversationId);
          const where = conv ? (conv.slug ? "#" + conv.slug : dmLabel(conv)) : "";
          return `
          <button class="qrow" data-goto="${q.message.conversationId}" data-mid="${q.message.id}">
            ${avatarHtml(actorHandle(q.message.actorId), 26)}
            <span class="qmain">
              <span class="qtop">@${escapeHtml(actorHandle(q.message.actorId))} <span class="pal-where">${escapeHtml(where)} · ${timeAgo(q.message.ts)}</span></span>
              <span class="qbody">${escapeHtml(q.message.body.slice(0, 160))}</span>
            </span>
          </button>`;
        }).join("") : `<p class="sb-empty">Nie ma otwartych pytań - wszystko domknięte.</p>`}
      </div>
      <div class="row"><button class="btn ghost" id="q-close">Zamknij</button></div>`,
  { modalClass: "wide" });
  modal.querySelector("#q-close").addEventListener("click", close);
  modal.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => {
      close();
      openConversation(Number(b.dataset.goto), Number(b.dataset.mid));
    }));
}

// ------------------------------------------------------------- nowa rozmowa
export async function openNewConversationModal(initialTab) {
  await ensureActors();
  const { modal, close } = openModal(`
      <h2 id="m-title">Nowa rozmowa</h2>
      <div class="seg" role="tablist" aria-label="Rodzaj rozmowy">
        <button role="tab" aria-selected="${initialTab !== "dm"}" aria-controls="tab-body"
          data-tab="channel" class="${initialTab !== "dm" ? "on" : ""}">Kanał</button>
        <button role="tab" aria-selected="${initialTab === "dm"}" aria-controls="tab-body"
          data-tab="dm" class="${initialTab === "dm" ? "on" : ""}">Wiadomość</button>
      </div>
      <div id="tab-body" role="tabpanel"></div>`);

  const tabs = modal.querySelectorAll("[data-tab]");
  const body = modal.querySelector("#tab-body");
  const showTab = (tab) => {
    tabs.forEach((t) => {
      t.classList.toggle("on", t.dataset.tab === tab);
      t.setAttribute("aria-selected", String(t.dataset.tab === tab));
    });
    if (tab === "channel") {
      body.innerHTML = `
        <div class="field"><label for="nc-slug">Nazwa kanału</label><input id="nc-slug" placeholder="np. ogloszenia"></div>
        <div class="field"><label for="nc-topic">Temat (opcjonalnie)</label><input id="nc-topic" placeholder="krótki opis"></div>
        <div class="seg" style="margin-top:.2rem" role="radiogroup" aria-label="Kto może wejść">
          <button role="radio" aria-checked="true" id="nc-public" class="on">Otwarty</button>
          <button role="radio" aria-checked="false" id="nc-private">Zamknięty</button></div>
        <div class="row"><button class="btn ghost" id="nc-cancel">Anuluj</button><button class="btn" id="nc-create">Utwórz</button></div>`;
      let kind = "public";
      const pub = body.querySelector("#nc-public"), priv = body.querySelector("#nc-private");
      const wybierz = (ktory) => {
        kind = ktory === pub ? "public" : "private";
        for (const b of [pub, priv]) {
          b.classList.toggle("on", b === ktory);
          b.setAttribute("aria-checked", String(b === ktory));
        }
      };
      pub.addEventListener("click", () => wybierz(pub));
      priv.addEventListener("click", () => wybierz(priv));
      body.querySelector("#nc-cancel").addEventListener("click", close);
      body.querySelector("#nc-create").addEventListener("click", async () => {
        const slug = body.querySelector("#nc-slug").value.trim();
        const topic = body.querySelector("#nc-topic").value.trim();
        if (!slug) return;
        try {
          const data = await api("POST", "/api/conversations", { kind, slug, topic });
          close();
          await loadConversationsList();
          widok.sidebar();
          openConversation(data.conversation.id);
        } catch (e) { showToast(e.message, { alert: true }); }
      });
      body.querySelector("#nc-slug").focus();
    } else {
      const others = state.actorsList.filter((a) => a.handle !== state.actor.handle);
      body.innerHTML = `
        <div class="field"><label for="nc-who">Do kogo</label>
          <select id="nc-who" multiple size="6" class="who-select">
            ${others.map((a) => `<option value="${escapeHtml(a.handle)}">@${escapeHtml(a.handle)} ${a.kind === "human" ? "- człowiek" : ""}</option>`).join("")}
          </select>
        </div>
        <p class="mhint">Wybierz jedną osobę (wiadomość) albo kilka (grupa).</p>
        <div class="row"><button class="btn ghost" id="nc-cancel">Anuluj</button><button class="btn" id="nc-create">Rozpocznij</button></div>`;
      body.querySelector("#nc-cancel").addEventListener("click", close);
      body.querySelector("#nc-create").addEventListener("click", async () => {
        const selHandles = [...body.querySelector("#nc-who").selectedOptions].map((o) => o.value);
        if (!selHandles.length) return;
        try {
          const data = await api("POST", "/api/conversations", { kind: selHandles.length > 1 ? "group" : "dm", members: selHandles });
          close();
          await loadConversationsList();
          widok.sidebar();
          openConversation(data.conversation.id);
        } catch (e) { showToast(e.message, { alert: true }); }
      });
      body.querySelector("#nc-who").focus();
    }
  };
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  showTab(initialTab === "dm" ? "dm" : "channel");
}
