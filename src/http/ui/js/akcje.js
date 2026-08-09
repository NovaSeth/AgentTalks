/**
 * Akcje na wiadomosciach: wysylka (optymistyczna, z ponowieniem), reakcje,
 * edycja, kasowanie. Rysowanie przez rejestr `widok`.
 */
import { api } from "./api.js";
import { loadConversationsList, mySessionId, refreshQuestions } from "./dane.js";
import { iconCheck } from "./ikony.js";
import { clearDraft, findMsgById, state, upsertMessage, widok } from "./stan.js";
import { showError, showToast } from "./toasty.js";

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
      if (unreachable.length) {
        showToast(`${unreachable.map((d) => "@" + d.handle).join(", ")} nie odbierze tego teraz - `
          + "wiadomość czeka i zostanie doręczona, gdy wróci.");
      }
    }
    // Wysylka z panelu watku sama rysuje swoja liste i nie dotyka glownego pola.
    // Wszystko inne przechodzi tedy - LACZNIE z odpowiedzia w watku napisana
    // w glownym polu (przycisk "Odpowiedz w wątku" ustawia state.replyTo).
    // Wczesniej taka wiadomosc znikala bez sladu: z glownej listy jest
    // odfiltrowana jako odpowiedz watku, a watek byl zamkniety - wiec jedyna
    // kopia tego, co uzytkownik napisal, przestawala istniec na ekranie.
    if (!opts.threadId) {
      clearDraft(convId);
      state.replyTo = null;
      if (state.activeId === convId) {
        widok.composer();
        if (rec.threadId) {
          widok.wiadomosc(findMsgById(rec.threadId));   // pasek "N odpowiedzi" pod korzeniem
          widok.otworzWatek(rec.threadId);              // i sam watek, zeby bylo widac wyslane
        } else {
          widok.wiadomosc(data.message);
          widok.naDol(true);
        }
      }
    }
    return data.message;
  } catch (e) {
    rec.pending = false; rec.failed = true; rec.error = e.message;
    if (state.activeId === convId && !rec.threadId) widok.wiadomosc(rec);
    showError(e);
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
  } catch (e) { showError(e); }
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
  } catch (e) { showError(e); }
}

/** Domkniecie zgloszenia (np. na #bug): check przy wpisie. */
export async function fixMsg(messageId, fixed) {
  try {
    const data = await api("POST", `/api/messages/${messageId}/fix`, { fixed });
    applyMessageUpdate(data.message);
    showToast(fixed
      ? "Oznaczone jako naprawione. Osoba, która to zgłosiła, dostała prośbę o potwierdzenie, że objaw zniknął."
      : "Cofnięto oznaczenie „naprawione”.");
  } catch (e) { showError(e); }
}

export async function resolveMsg(messageId, resolved) {
  try {
    const data = await api("POST", `/api/messages/${messageId}/resolve`, { resolved });
    applyMessageUpdate(data.message);
    showToast(resolved ? "Potwierdzone - zgłoszenie zamknięte." : "Cofnięto potwierdzenie.");
  } catch (e) { showError(e); }
}

/** Przypiecie wiadomosci. API istnialo od poczatku, ale w interfejsie byla tylko
 *  sekcja "Przypięte" - czyli widac bylo skutek czynnosci, ktorej nie dalo sie
 *  wykonac. */
export async function togglePin(messageId, przypnij) {
  try {
    if (przypnij) {
      const data = await api("POST", `/api/messages/${messageId}/pin`, {});
      state.convPins = [...state.convPins.filter((p) => p.messageId !== messageId), data.pin];
      showToast("Przypięto. Znajdziesz to w szczegółach rozmowy.");
    } else {
      await api("DELETE", `/api/messages/${messageId}/pin`);
      state.convPins = state.convPins.filter((p) => p.messageId !== messageId);
      showToast("Odpięto.");
    }
    widok.wiadomosc(findMsgById(messageId));
    if (state.detailsOpen) widok.szczegoly();
  } catch (e) { showError(e); }
}

/** Pytanie do kanalu. Czlowiek mogl PODJAC cudze pytanie, ale nie mogl zadac
 *  wlasnego - czyli dostawal role wykonawcy zadan agentow, dokladnie odwrotnie
 *  niz obiecuje "rowni uczestnicy". */
export async function askChannel(text) {
  const convId = state.activeId;
  try {
    const data = await api("POST", `/api/conversations/${convId}/ask`, {
      body: text, sessionId: mySessionId || undefined,
    });
    if (data.message) upsertMessage(convId, data.message);
    clearDraft(convId);
    state.askMode = false;
    await refreshQuestions(convId);
    widok.wiadomosci();
    widok.composer();
    widok.naDol(true);
    showToast("Pytanie poszło na kanał. Zobaczysz je jako otwarte, dopóki ktoś nie odpowie.");
    return true;
  } catch (e) { showError(e); return false; }
}

// ------------------------------------------------------------- zajete zasoby
/** Zajecie zasobu przez czlowieka. Tablica dzierzaw byla dotad do samego
 *  ogladania, opisana komendami CLI - a "ogloszenie, zanim ruszysz wspolny
 *  zasob" to regula, ktora obowiazuje ludzi tak samo jak agentow. */
export async function claimLease(resource, note, ttlSec) {
  try {
    const res = await api("POST", "/api/leases", {
      resource, note: note || undefined, ttlSec: ttlSec || undefined,
      sessionId: mySessionId || undefined,
    });
    showToast(`Zasób „${resource}” jest teraz Twój. Zwolnij go, gdy skończysz.`);
    return res;
  } catch (e) {
    // 409 niesie w ciele, kto trzyma i do kiedy - to jest odpowiedz na pytanie
    // "dlaczego nie", a nie awaria.
    if (e.status === 409) showToast(`Zasób „${resource}” trzyma teraz ktoś inny. Poczekaj albo dogadaj się na kanale.`, { alert: true });
    else showError(e);
    return null;
  }
}

export async function releaseLease(resource) {
  try {
    await api("POST", "/api/leases/release", { resource });
    showToast(`Zwolniono „${resource}”.`);
    return true;
  } catch (e) { showError(e); return false; }
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
  } catch (e) { showError(e); if (btn) { btn.disabled = false; btn.textContent = "Dołącz"; } }
}

/** Rozmowa prywatna z palety: jeden Enter zamiast modala "Nowa rozmowa". */
export async function startDirect(handle) {
  try {
    const data = await api("POST", "/api/conversations", { kind: "dm", members: [handle] });
    await loadConversationsList();
    widok.sidebar();
    widok.otworzRozmowe(data.conversation.id);
  } catch (e) { showError(e); }
}
