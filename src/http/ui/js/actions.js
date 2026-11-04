/**
 * Message actions: sending (optimistic, with retry), reactions, editing,
 * deleting. Drawing goes through the `views` registry.
 */
import { api } from "./api.js";
import { loadConversationsList, markReadDebounced, mySessionId, refreshQuestions } from "./data.js";
import { iconCheck } from "./icons.js";
import { t } from "./i18n.js";
import { clearDraft, findMsgById, saveDraft, state, upsertMessage, views } from "./state.js";
import { showError, showToast } from "./toasts.js";

// Optimistic send. The bubble appears IMMEDIATELY (greyed out), because the
// moment the text field is cleared it is the only copy of what the user wrote.
// A failed send leaves it in a "Not sent" state with a retry button - the core
// deduplicates by clientMsgId, so a retry will not double the message.
let tmpSeq = 0;

function pendingList(convId) { return state.pending[convId] || (state.pending[convId] = []); }

export async function sendMessage(text, opts = {}) {
  const convId = opts.conversationId ?? state.activeId;
  const composer = !opts.threadId && !opts.clientMsgId && state.activeId === convId
    ? document.getElementById("composer-input") : null;
  const composerText = composer?.value;
  const draft = state.drafts[convId];
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
  if (state.activeId === convId && !rec.threadId) { views.message(rec); views.scrollToBottom(true); }
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
      // The user may already be writing the next message, or may have switched conversations.
      // Keep the live element and only clear a draft that still contains the sent text.
      if (composer && state.activeId === convId && document.getElementById("composer-input") === composer) {
        if (composer.value === composerText && composerText.trim() === text) {
          composer.value = "";
          composer.dispatchEvent(new Event("input"));
        }
        if (!composer.value.trim() && state.replyTo === rec.threadId) {
          state.replyTo = null;
          document.querySelector("#composer .replying")?.remove();
        }
        saveDraft();
      } else if (!opts.clientMsgId && state.drafts[convId] === draft && draft?.text.trim() === text) {
        clearDraft(convId);
      }
      if (state.activeId === convId) {
        if (rec.threadId) {
          views.message(findMsgById(rec.threadId));   // the "N replies" bar under the root
          views.openThread(rec.threadId);              // and the thread itself, so the sent message is visible
        } else {
          views.message(data.message);
          views.scrollToBottom(true);
        }
      }
    }
    return data.message;
  } catch (e) {
    rec.pending = false; rec.failed = true; rec.error = e.message;
    if (state.activeId === convId && !rec.threadId) views.message(rec);
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
    const reactionMap = state.reactions[messageId] || (state.reactions[messageId] = {});
    const who = (reactionMap[emoji] || []).filter((h) => h !== state.actor.handle);
    if (res && res.on) who.push(state.actor.handle);
    if (who.length) reactionMap[emoji] = who; else delete reactionMap[emoji];
    if (!Object.keys(reactionMap).length) delete state.reactions[messageId];
    if (state.view === "chat") views.message(findMsgById(messageId));
    if (state.threadOpen) views.thread();
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
  if (state.view === "chat") views.message(msg);
  if (state.threadOpen) views.thread();
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
export async function togglePin(messageId, pin) {
  try {
    if (pin) {
      const data = await api("POST", `/api/messages/${messageId}/pin`, {});
      state.convPins = [...state.convPins.filter((p) => p.messageId !== messageId), data.pin];
      showToast(t("Pinned. You will find it in the conversation details."));
    } else {
      await api("DELETE", `/api/messages/${messageId}/pin`);
      state.convPins = state.convPins.filter((p) => p.messageId !== messageId);
      showToast(t("Unpinned."));
    }
    views.message(findMsgById(messageId));
    if (state.detailsOpen) views.details();
  } catch (e) { showError(e); }
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

export async function saveEditedMsg(messageId, text, beforeUpdate) {
  const data = await api("PATCH", `/api/messages/${messageId}`, { body: text });
  beforeUpdate?.();
  applyMessageUpdate(data.message);
}

export async function answerQuestion(questionId, text) {
  const data = await api("POST", `/api/questions/${questionId}/answer`, { body: text, sessionId: mySessionId || undefined });
  upsertMessage(state.activeId, data.message);
  await refreshQuestions(state.activeId);
  views.messages();
}

export async function joinChannel(id, btn) {
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span>`; }
    await api("POST", `/api/conversations/${id}/join`, {});
    if (btn) btn.innerHTML = iconCheck();
    // Joining IS reading: the history was there before you came, so the row must not light up
    // as unread the moment you join (S7).
    markReadDebounced(id);
    await loadConversationsList();
    setTimeout(() => { views.sidebar(); views.main(); }, 350);
  } catch (e) { showError(e); if (btn) { btn.disabled = false; btn.textContent = t("Join"); } }
}

/** A direct conversation from the palette: one Enter instead of the "New conversation" modal. */
export async function startDirect(handle) {
  try {
    const data = await api("POST", "/api/conversations", { kind: "dm", members: [handle] });
    await loadConversationsList();
    views.sidebar();
    views.openConversation(data.conversation.id);
  } catch (e) { showError(e); }
}
