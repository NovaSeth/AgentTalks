/**
 * Akcje na wiadomosciach: wysylka (optymistyczna, z ponowieniem), reakcje,
 * edycja, kasowanie. Rysowanie przez rejestr `widok`.
 */
import { api } from "./api.js";
import { loadConversationsList, mySessionId, refreshQuestions } from "./dane.js";
import { iconCheck } from "./ikony.js";
import { clearDraft, findMsgById, state, upsertMessage, widok } from "./stan.js";
import { showToast } from "./toasty.js";

// Wysylka optymistyczna. Dymek pojawia sie NATYCHMIAST (wyszarzony), bo w chwili
// wyczyszczenia pola tekstowego jest to jedyna kopia tego, co uzytkownik napisal.
// Nieudana wysylka zostawia go w stanie "Nie wysłano" z przyciskiem ponowienia -
// rdzen ma dedup po clientMsgId, wiec retry nie zdubluje wiadomosci.
let tmpSeq = 0;

function pendingList(convId) { return state.pending[convId] || (state.pending[convId] = []); }

export async function sendMessage(text, opts = {}) {
  const convId = opts.conversationId ?? state.activeId;
  const clientMsgId = opts.clientMsgId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const list = pendingList(convId);
  let rec = list.find((p) => p.clientMsgId === clientMsgId);
  if (!rec) {
    rec = {
      id: `tmp-${++tmpSeq}`, clientMsgId, conversationId: convId, actorId: state.actor.id,
      body: text, ts: Math.floor(Date.now() / 1000), kind: "text",
      threadId: opts.threadId ?? state.replyTo ?? null, pending: true, failed: false,
    };
    list.push(rec);
  }
  rec.pending = true; rec.failed = false;
  if (state.activeId === convId && !rec.threadId) { widok.wiadomosc(rec); widok.naDol(true); }
  try {
    const data = await api("POST", `/api/conversations/${convId}/messages`, {
      body: rec.body, clientMsgId, threadId: rec.threadId || undefined, sessionId: mySessionId || undefined,
    });
    state.pending[convId] = list.filter((p) => p.clientMsgId !== clientMsgId);
    document.querySelector(`#messages [data-msg="${rec.id}"]`)?.remove();
    upsertMessage(convId, data.message);
    if (data.delivery) {
      state.lastDelivery = { conversationId: convId, messageId: data.message.id, delivery: data.delivery };
      const unreachable = data.delivery.filter((d) => !d.reachable);
      if (unreachable.length) showToast(`Nie dotrze teraz do: ${unreachable.map((d) => "@" + d.handle).join(", ")}`);
    }
    // Odpowiedz w watku nie dotyka ani szkicu, ani composera glownej rozmowy.
    if (!rec.threadId) {
      clearDraft(convId);
      state.replyTo = null;
      if (state.activeId === convId) { widok.wiadomosc(data.message); widok.composer(); widok.naDol(true); }
    }
    return data.message;
  } catch (e) {
    rec.pending = false; rec.failed = true; rec.error = e.message;
    if (state.activeId === convId && !rec.threadId) widok.wiadomosc(rec);
    showToast(`Nie wysłano: ${e.message}`, { alert: true });
    return null;
  }
}

export function retryPending(convId, clientMsgId) {
  const rec = (state.pending[convId] || []).find((p) => p.clientMsgId === clientMsgId);
  if (rec) sendMessage(rec.body, { conversationId: convId, clientMsgId, threadId: rec.threadId });
}

/** "Usun" nie kasuje tresci - wraca ona do composera, zeby zadna droga wyjscia
 *  z bledu nie konczyla sie utrata tego, co uzytkownik napisal. */
export function dropPending(convId, clientMsgId) {
  const rec = (state.pending[convId] || []).find((p) => p.clientMsgId === clientMsgId);
  state.pending[convId] = (state.pending[convId] || []).filter((p) => p.clientMsgId !== clientMsgId);
  document.querySelector(`#messages [data-msg="${rec?.id}"]`)?.remove();
  const ta = document.getElementById("composer-input");
  if (rec && ta) { ta.value = rec.body; ta.dispatchEvent(new Event("input")); ta.focus(); }
}

export async function toggleReaction(messageId, emoji) {
  // Wlasny klik: aktualizujemy stan LOKALNIE z odpowiedzi {on}. Wczesniej po
  // kazdym emoji leciala paczka 200 wiadomosci - raz z klikniecia, drugi raz
  // z echa SSE tego samego klikniecia.
  try {
    const res = await api("POST", `/api/messages/${messageId}/reactions`, { emoji });
    const mapa = state.reactions[messageId] || (state.reactions[messageId] = {});
    const kto = (mapa[emoji] || []).filter((h) => h !== state.actor.handle);
    if (res && res.on) kto.push(state.actor.handle);
    if (kto.length) mapa[emoji] = kto; else delete mapa[emoji];
    if (!Object.keys(mapa).length) delete state.reactions[messageId];
    if (state.view === "chat") widok.wiadomosc(findMsgById(messageId));
    if (state.threadOpen) widok.watek();
  } catch (e) { showToast(e.message, { alert: true }); }
}

/** Jedna sciezka aktualizacji wiadomosci po odpowiedzi serwera: stan, dymek na
 *  liscie ORAZ kopia w panelu watku. Ta sama wiadomosc bywa na ekranie dwa razy
 *  (glowna lista + korzen watku), a wczesniej kazda z tych akcji odswiezala
 *  tylko jedna z nich - druga zostawala ze stara trescia. */
function applyMessageUpdate(msg) {
  upsertMessage(msg.conversationId ?? state.activeId, msg);
  const i = state.threadMsgs.findIndex((m) => m.id === msg.id);
  if (i >= 0) state.threadMsgs[i] = msg;
  if (state.view === "chat") widok.wiadomosc(msg);
  if (state.threadOpen) widok.watek();
}

export async function deleteMsg(messageId) {
  try {
    const data = await api("DELETE", `/api/messages/${messageId}`);
    applyMessageUpdate(data.message);
  } catch (e) { showToast(e.message, { alert: true }); }
}

/** Domkniecie zgloszenia (np. na #bug): check przy wpisie. */
export async function fixMsg(messageId, fixed) {
  try {
    const data = await api("POST", `/api/messages/${messageId}/fix`, { fixed });
    applyMessageUpdate(data.message);
    showToast(fixed
      ? "Oznaczone jako naprawione - zgłaszający dostał powiadomienie do potwierdzenia"
      : "Cofnięto 'naprawione'");
  } catch (e) { showToast(e.message); }
}

export async function resolveMsg(messageId, resolved) {
  try {
    const data = await api("POST", `/api/messages/${messageId}/resolve`, { resolved });
    applyMessageUpdate(data.message);
    showToast(resolved ? "Oznaczone jako rozwiązane" : "Cofnięto rozwiązanie");
  } catch (e) { showToast(e.message, { alert: true }); }
}

export async function saveEditedMsg(messageId, text) {
  const data = await api("PATCH", `/api/messages/${messageId}`, { body: text });
  applyMessageUpdate(data.message);
}

export async function answerQuestion(questionId, text) {
  const data = await api("POST", `/api/questions/${questionId}/answer`, { body: text, sessionId: mySessionId || undefined });
  upsertMessage(state.activeId, data.message);
  await refreshQuestions(state.activeId);
  widok.wiadomosci();
}

export async function joinChannel(id, btn) {
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`; }
    await api("POST", `/api/conversations/${id}/join`, {});
    if (btn) btn.innerHTML = iconCheck();
    await loadConversationsList();
    setTimeout(() => { widok.sidebar(); widok.glowny(); }, 350);
  } catch (e) { showToast(e.message); if (btn) { btn.disabled = false; btn.textContent = "Dołącz"; } }
}

/** Rozmowa prywatna z palety: jeden Enter zamiast modala "Nowa rozmowa". */
export async function startDirect(handle) {
  try {
    const data = await api("POST", "/api/conversations", { kind: "dm", members: [handle] });
    await loadConversationsList();
    widok.sidebar();
    widok.otworzRozmowe(data.conversation.id);
  } catch (e) { showToast(e.message, { alert: true }); }
}
