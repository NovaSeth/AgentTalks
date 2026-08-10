/**
 * Message actions: sending (optimistic, with retry), reactions, editing,
 * deleting. Drawing goes through the `widok` registry.
 */
import { api } from "./api.js";
import { loadConversationsList, mySessionId, refreshQuestions } from "./dane.js";
import { iconCheck } from "./ikony.js";
import { t } from "./i18n.js";
import { clearDraft, findMsgById, state, upsertMessage, widok } from "./stan.js";
import { showError, showToast } from "./toasty.js";

// Optimistic send. The bubble appears IMMEDIATELY (greyed out), because the
// moment the text field is cleared it is the only copy of what the user wrote.
// A failed send leaves it in a "Not sent" state with a retry button - the core
// deduplicates by clientMsgId, so a retry will not double the message.
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
        showToast(t("{who} will not receive this right now - the message waits and will be delivered when they are back.",
          { who: unreachable.map((d) => "@" + d.handle).join(", ") }));
      }
    }
    // A send from the thread panel draws its own list and does not touch the main
    // field. Everything else comes through here - INCLUDING a thread reply typed
    // in the main field (the "Reply in thread" button sets state.replyTo).
    // Such a message used to vanish without a trace: it is filtered out of the
    // main list as a thread reply, and the thread was closed - so the only copy
    // of what the user wrote stopped existing on screen.
    if (!opts.threadId) {
      clearDraft(convId);
      state.replyTo = null;
      if (state.activeId === convId) {
        widok.composer();
        if (rec.threadId) {
          widok.wiadomosc(findMsgById(rec.threadId));   // the "N replies" bar under the root
          widok.otworzWatek(rec.threadId);              // and the thread itself, so the sent message is visible
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

/** "Discard" does not destroy the text - it returns to the composer, so that no
 *  route out of an error ends in losing what the user wrote. */
export function dropPending(convId, clientMsgId) {
  const rec = (state.pending[convId] || []).find((p) => p.clientMsgId === clientMsgId);
  state.pending[convId] = (state.pending[convId] || []).filter((p) => p.clientMsgId !== clientMsgId);
  document.querySelector(`#messages [data-msg="${rec?.id}"]`)?.remove();
  const ta = document.getElementById("composer-input");
  if (rec && ta) { ta.value = rec.body; ta.dispatchEvent(new Event("input")); ta.focus(); }
}

export async function toggleReaction(messageId, emoji) {
  // Our own click: we update the state LOCALLY from the {on} response. Every
  // emoji used to trigger a batch of 200 messages - once from the click, once
  // from the SSE echo of that same click.
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

/** One update path for a message after the server responds: the state, the
 *  bubble in the list AND the copy in the thread panel. The same message is
 *  sometimes on screen twice (main list + thread root), and each of these
 *  actions used to refresh only one of them - the other kept the old text. */
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

/** Closing a report (e.g. on #bug): a check mark on the entry. */
export async function fixMsg(messageId, fixed) {
  try {
    const data = await api("POST", `/api/messages/${messageId}/fix`, { fixed });
    applyMessageUpdate(data.message);
    showToast(fixed
      ? t("Marked as fixed. Whoever reported it has been asked to confirm the symptom is gone.")
      : t("The “fixed” mark has been taken back."));
  } catch (e) { showError(e); }
}

export async function resolveMsg(messageId, resolved) {
  try {
    const data = await api("POST", `/api/messages/${messageId}/resolve`, { resolved });
    applyMessageUpdate(data.message);
    showToast(resolved ? t("Confirmed - the report is closed.") : t("The confirmation has been taken back."));
  } catch (e) { showError(e); }
}

/** Pinning a message. The API existed from the start, but the interface only had
 *  a "Pinned" section - that is, you could see the result of an action you had no
 *  way to perform. */
export async function togglePin(messageId, przypnij) {
  try {
    if (przypnij) {
      const data = await api("POST", `/api/messages/${messageId}/pin`, {});
      state.convPins = [...state.convPins.filter((p) => p.messageId !== messageId), data.pin];
      showToast(t("Pinned. You will find it in the conversation details."));
    } else {
      await api("DELETE", `/api/messages/${messageId}/pin`);
      state.convPins = state.convPins.filter((p) => p.messageId !== messageId);
      showToast(t("Unpinned."));
    }
    widok.wiadomosc(findMsgById(messageId));
    if (state.detailsOpen) widok.szczegoly();
  } catch (e) { showError(e); }
}

/** A question to the channel. A human could TAKE UP somebody else's question but
 *  could not ask their own - which cast them as the executor of the agents' tasks,
 *  the exact opposite of what "peers" promises. */
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
    showToast(t("The question went to the channel. You will see it as open until somebody answers."));
    return true;
  } catch (e) { showError(e); return false; }
}

// ------------------------------------------------------------ claimed resources
/** A human claiming a resource. The lease board was until now for looking at
 *  only, described in terms of CLI commands - while "announce before you touch a
 *  shared resource" is a rule that binds humans exactly as much as agents. */
export async function claimLease(resource, note, ttlSec) {
  try {
    const res = await api("POST", "/api/leases", {
      resource, note: note || undefined, ttlSec: ttlSec || undefined,
      sessionId: mySessionId || undefined,
    });
    showToast(t("“{resource}” is yours now. Release it when you are done.", { resource }));
    return res;
  } catch (e) {
    // A 409 carries who holds it and until when - that is an answer to "why not",
    // not a failure.
    if (e.status === 409) showToast(t("Somebody else is holding “{resource}” right now. Wait, or sort it out on the channel.", { resource }), { alert: true });
    else showError(e);
    return null;
  }
}

export async function releaseLease(resource) {
  try {
    await api("POST", "/api/leases/release", { resource });
    showToast(t("Released “{resource}”.", { resource }));
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
  } catch (e) { showError(e); if (btn) { btn.disabled = false; btn.textContent = t("Join"); } }
}

/** A direct conversation from the palette: one Enter instead of the "New conversation" modal. */
export async function startDirect(handle) {
  try {
    const data = await api("POST", "/api/conversations", { kind: "dm", members: [handle] });
    await loadConversationsList();
    widok.sidebar();
    widok.otworzRozmowe(data.conversation.id);
  } catch (e) { showError(e); }
}
