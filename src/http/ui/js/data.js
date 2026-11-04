/**
 * Fetching and refreshing data. It calls drawing through the `views` registry.
 */
import { SID_KEY, api, sessionGeneration } from "./api.js";
import { acceptDigest, badgeText, dividerAfter, railBadges } from "./counters.js";
import { updateTitleBadge } from "./dom.js";
import { t } from "./i18n.js";
import { animatedMsgs, applyUnreadRows, mergeActors, mergeReactions, state, upsertMessage, views } from "./state.js";
import { showError } from "./toasts.js";

// ----------------------------------------------------------------- loading
export async function loadConversationsList() {
  const data = await api("GET", "/api/conversations");
  state.conversations = data.conversations;
  const memberships = {};
  for (const m of data.memberships) memberships[m.conversationId] = m;
  state.memberships = memberships;
  applyUnreadRows(data.unread);
}

/** U30 (r4): the conversation a route's slug names (a channel slug, or the id of a conversation
 *  without one). A slug the loaded list does not know is looked up on the server ONCE - a public
 *  channel created after this page loaded is otherwise "no access" until a reload. null when the
 *  server does not list it either (private, archived, misspelt), or when the refresh fails. */
export async function conversationBySlug(slug) {
  const find = () => state.conversations.find((x) => x.slug === slug)
    || state.conversations.find((x) => !x.slug && String(x.id) === slug) || null;
  const known = find();
  if (known) return known;
  try { await loadConversationsList(); } catch { return null; }
  return find();
}

// Entering a conversation must show the NEWEST messages at once, so the first batch is small
// (roughly what fits on a screen); older ones load themselves, 20 at a time, as you scroll
// up. Fetching 200 messages on open was paying in time-to-first-view for history nobody
// reads.
const INITIAL_BATCH_SIZE = 30;

const OLDER_BATCH_SIZE = 20;

/** The reactions of just these messages: a skipped message keeps the reactions it already has. */
export function reactionsOf(msgs, reactions) {
  return Object.fromEntries(msgs.filter((m) => reactions && m.id in reactions).map((m) => [m.id, reactions[m.id]]));
}

// T-MG-43 (codex T-MG-18 r4 F5, F6; review-r1 F1; review-r2 F2): every REST read of a conversation's
// messages is a FLIGHT (beginRead .. endRead) with a stamp from one monotonic counter taken when it
// is sent; a live SSE write takes one when it arrives. Two rules:
// 1. Stamps order writes that did NOT overlap: a read sent after another one LANDED is cut on the
//    server after that one, so a higher stamp is newer data. A page writes only over state with a
//    lower stamp (pageMayReplace for bodies, mergePageReactions for reactions); a write by a writer
//    without stamps (view code) is kept when it happened while the page was in flight.
// 2. Two flights of one conversation that were in the air at the same time have NO known cut order
//    (r2 F2: a request can reach the server after a later-sent one). The stamp rule applies as a first
//    guess, and each of them owes a re-read of the id range it carried, as does a page that met an
//    unstamped write; once no flight of that conversation is in the air, the owed ranges are read
//    again one at a time (reconcile). A re-read starts after every owed flight landed, so it is cut
//    after all of them and its stamp is above theirs: rule 1 makes it the answer.
let seq = 0;
export function currentSeq() { return seq; }
export function nextSeq() { return ++seq; }
/** message object -> { seq, live } of the write that put it in state. Every writer replaces the
 *  object, so an unstamped writer (view code) leaves an object without an entry. */
const rowStamps = new WeakMap();
export function stampRow(m, s, live = false) { rowStamps.set(m, { seq: s, live }); }
/** messageId -> the stamp of the request whose reactions are held for it, and the reaction object it
 *  left in state (a different object there now = an unstamped writer changed it since). */
const reactionStamps = new Map();
const reactionRefs = new Map();

/** convId -> the flights in the air; convId -> the [lo, hi] id ranges owed a re-read. */
const flights = new Map();
const owed = new Map();
const reconciling = new Set();
const reconcileRounds = new Map();
const MAX_RECONCILE_ROUNDS = 3;
const RECONCILE_PAGE = 200;
// T-MG-46 (B-MG-121, B-MG-122): an owed range leaves `owed` only when a re-read of it succeeded. A
// re-read that failed, or a conversation that hit MAX_RECONCILE_ROUNDS, keeps its ranges and waits for
// a repair timer: 1, 2, 4, 8, 16, 30 s, at most REPAIR_ATTEMPTS timers in a row. While a timer is
// pending no other trigger starts a round, except a read of that conversation that LANDED after a
// failed re-read (the network is back, e.g. the reconnect's catch-up). Without a timer left, the next
// landed read of the conversation resumes. convId -> { attempts, timer, failed }.
const repairs = new Map();
const REPAIR_ATTEMPTS = 6;
const REPAIR_BASE_MS = 1000;
const REPAIR_MAX_MS = 30000;
/** convId -> the session generation its owed ranges belong to (another session owes nothing). */
const owedGen = new Map();

function scheduleRepair(convId, failed) {
  const r = repairs.get(convId) || { attempts: 0, timer: null, failed };
  repairs.set(convId, r);
  r.failed = failed;
  if (r.timer !== null || r.attempts >= REPAIR_ATTEMPTS) return;
  const delay = Math.min(REPAIR_MAX_MS, REPAIR_BASE_MS * 2 ** r.attempts);
  r.attempts++;
  r.timer = setTimeout(() => { r.timer = null; reconcile(convId); }, delay);
}

/** Forgets what a conversation owes, with its round count and repair timer (its history is gone,
 *  the session changed, or every range was re-read). */
function dropOwed(convId) {
  owed.delete(convId);
  owedGen.delete(convId);
  reconcileRounds.delete(convId);
  const r = repairs.get(convId);
  if (r?.timer) clearTimeout(r.timer);
  repairs.delete(convId);
}

function oweRanges(convId, ranges) {
  if (!ranges.length) return;
  const gen = sessionGeneration();
  if (owedGen.get(convId) !== gen) { dropOwed(convId); owedGen.set(convId, gen); }
  (owed.get(convId) || owed.set(convId, []).get(convId)).push(...ranges);
}

/** Opens a flight just before its request is sent: the stamp, and what was held at that moment. */
export function beginRead(convId) {
  const list = state.msgs[convId] || [];
  const f = {
    sent: nextSeq(),
    rows: new Map(list.map((m) => [m.id, m])),
    rx: new Map(list.map((m) => [m.id, state.reactions[m.id]])),
    dirty: false,
  };
  const air = flights.get(convId) || new Set();
  flights.set(convId, air);
  if (air.size) { f.dirty = true; for (const o of air) o.dirty = true; }
  air.add(f);
  return f;
}

/** Closes a flight after its answer was applied (`msgs` = what it carried; null when it failed). */
export function endRead(convId, f, msgs) {
  const air = flights.get(convId);
  air?.delete(f);
  if (f.dirty && msgs && msgs.length) {
    const idsOf = msgs.map((m) => m.id).filter((id) => typeof id === "number");
    if (idsOf.length) oweRanges(convId, [[Math.min(...idsOf), Math.max(...idsOf)]]);
  }
  // A re-read's own flight never starts a round: reconcile decides what follows it.
  if (air?.size || reconciling.has(convId) || !owed.get(convId)?.length) return;
  const r = repairs.get(convId);
  if (r?.timer) {
    if (!(r.failed && msgs)) return;   // waits for its timer
    clearTimeout(r.timer);
    r.timer = null;
  }
  queueMicrotask(() => { reconcile(convId); });
}

/** Whether the page of flight `f` may replace the held object `held` of message `id`. `liveMark`: a live
 *  write stamped above it is kept as well (the catch-up passes the stamp taken when it began). */
export function pageMayReplace(held, f, id, liveMark = f.sent) {
  if (held === undefined) return true;
  const st = rowStamps.get(held);
  if (st === undefined) {
    // An unstamped writer: its order is unknown. Kept when it wrote while the page was in flight,
    // and that range is re-read.
    if (held === f.rows.get(id)) return true;
    f.dirty = true;
    return false;
  }
  if (st.live && st.seq > liveMark) return false;
  return st.seq < f.sent;
}

/** The reaction merge of flight `f`'s page, independent of which bodies it was allowed to replace
 *  (B-MG-118: an SSE message carries no reactions, so its REST reactions are still needed), except
 *  for reactions from a later-sent request, or written by an unstamped writer while it was in flight. */
export function mergePageReactions(msgs, reactions, f) {
  const rx = msgs.filter((m) => {
    if ((reactionStamps.get(m.id) ?? 0) >= f.sent) return false;
    const cur = state.reactions[m.id];
    if (cur !== reactionRefs.get(m.id) && cur !== f.rx.get(m.id)) { f.dirty = true; return false; }
    return true;
  });
  mergeReactions(rx, reactionsOf(rx, reactions));
  for (const m of rx) { reactionStamps.set(m.id, f.sent); reactionRefs.set(m.id, state.reactions[m.id]); }
}

/** A catch-up or re-read page: bodies by pageMayReplace, reactions by mergePageReactions. */
export function applyPage(convId, data, f, liveMark = f.sent) {
  const now = new Map((state.msgs[convId] || []).map((m) => [m.id, m]));
  for (const m of data.messages) {
    if (!pageMayReplace(now.get(m.id), f, m.id, liveMark)) continue;
    upsertMessage(convId, m); stampRow(m, f.sent);
  }
  mergeActors(data.actors);
  mergePageReactions(data.messages, data.reactions, f);
}

/** Rule 2: the owed ranges of a conversation, read again one page at a time once nothing is in the
 *  air. A re-read that overlaps a new flight owes its range again. A range leaves `owed` only when its
 *  re-read succeeded (T-MG-46): a failed page puts back what it did not read, and after
 *  MAX_RECONCILE_ROUNDS rounds in a row the conversation yields with its ranges kept; both wait for a
 *  repair timer (scheduleRepair), so neither can loop. */
async function reconcile(convId) {
  if (reconciling.has(convId) || flights.get(convId)?.size || !owed.get(convId)?.length) return;
  if (repairs.get(convId)?.timer) return;   // a pending repair timer starts the next round
  if (!state.loaded[convId] || owedGen.get(convId) !== sessionGeneration()) { dropOwed(convId); return; }
  const round = (reconcileRounds.get(convId) ?? 0) + 1;
  if (round > MAX_RECONCILE_ROUNDS) { reconcileRounds.delete(convId); scheduleRepair(convId, false); return; }
  reconcileRounds.set(convId, round);
  const merged = [];
  for (const [lo, hi] of owed.get(convId).sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi); else merged.push([lo, hi]);
  }
  owed.delete(convId);
  const gen = sessionGeneration();
  let failed = false;
  let stale = false;
  reconciling.add(convId);
  try {
    for (let i = 0; i < merged.length; i++) {
      const hi = merged[i][1];
      let after = merged[i][0] - 1;
      while (after < hi) {
        // Ids are global and rising, so (after, hi] holds at most hi - after messages of this conversation.
        const f = beginRead(convId);
        let data = null;
        try {
          data = await api("GET", `/api/conversations/${convId}/messages?after=${after}&limit=${Math.min(RECONCILE_PAGE, hi - after)}`);
          if (gen !== sessionGeneration()) { stale = true; return; }
          applyPage(convId, data, f);
        } catch (e) {
          // Another session's answer, or a lost session: nothing is owed to it. Otherwise the part of
          // this range not read yet, and the ranges after it, stay owed.
          if (e?.sessionLost || gen !== sessionGeneration()) { stale = true; return; }
          failed = true;
          oweRanges(convId, [[after + 1, hi], ...merged.slice(i + 1)]);
          return;
        } finally { endRead(convId, f, data && data.messages); }
        const top = data.messages.reduce((n, m) => (typeof m.id === "number" && m.id > n ? m.id : n), after);
        if (top <= after) break;
        after = top;
      }
    }
    if (state.view === "chat" && state.activeId === convId) views.messages?.();
  } finally {
    reconciling.delete(convId);
    if (stale) dropOwed(convId);
    // A failed round is no overlap round: the cap counts overlaps in a row, and the timer breaks the row.
    else if (failed) { reconcileRounds.delete(convId); scheduleRepair(convId, true); }
    else if (!owed.get(convId)?.length) dropOwed(convId);
    else queueMicrotask(() => { reconcile(convId); });
  }
}

export async function loadMessages(convId, { keepTouched = false } = {}) {
  const firstLoad = !state.loaded[convId];
  // keepTouched (resume refresh, codex r3 F4; T-MG-43 r1): the answer replaces a held message only
  // when pageMayReplace allows it: never over a write from a later-sent request or a later live
  // event (an older revision must not come back), always over one from an earlier-sent request.
  const f = beginRead(convId);
  let data = null;
  try {
    data = await api("GET", `/api/conversations/${convId}/messages?limit=${INITIAL_BATCH_SIZE}`);
    applyNewest(convId, data, f, { keepTouched, firstLoad });
  } finally { endRead(convId, f, data && data.messages); }
  // Thread replies do not stand in the main list, so a batch of 30 messages can produce a
  // screen with three. We fetch more until there is something to scroll - without that, lazy
  // loading would never start, because there simply is no scrollbar.
  let extraBatches = 0;
  while (
    state.hasMore[convId] && extraBatches < 4 &&
    (state.msgs[convId] || []).filter((m) => !m.threadId).length < 15
  ) {
    extraBatches++;
    await loadOlderMessages(convId);
  }
}

function applyNewest(convId, data, f, { keepTouched, firstLoad }) {
  // We MERGE rather than replace the array: assigning `state.msgs[id] = ...` erased everything
  // the user had loaded by scrolling up.
  // History enters without animation - the "slide in" is played only by a message that arrived
  // live (SSE), not by every opening of a channel.
  const may = (m) => !keepTouched
    || pageMayReplace(state.msgs[convId]?.find((h) => h.id === m.id), f, m.id);
  const fresh = data.messages.filter(may);
  for (const m of fresh) { upsertMessage(convId, m); stampRow(m, f.sent); animatedMsgs.add(m.id); }
  // The "history FETCHED" marker (not "there are some messages"): a single message from SSE
  // must not pretend to be a loaded conversation.
  state.loaded[convId] = true;
  // A full batch = there is probably older history to load. When refreshing an already loaded
  // conversation, a new batch says nothing about what lies ABOVE our list.
  if (firstLoad) state.hasMore[convId] = data.messages.length >= INITIAL_BATCH_SIZE;
  mergeActors(data.actors);
  // B-MG-118: a kept message keeps its body, not the reactions it had before (none for an SSE
  // arrival); only reactions from a later-sent request (or an unstamped write in flight) stay.
  mergePageReactions(data.messages, data.reactions, f);
}

/** Loading older history above what we already have - keeping the scroll position (the content
/**  must not run away from your eyes when older messages slide in above it). */
let loadingOlder = false;

export async function loadOlderMessages(convId) {
  const list = state.msgs[convId] || [];
  const oldest = list[0];
  if (!oldest || loadingOlder || !state.hasMore[convId]) return;
  loadingOlder = true;
  try {
    const f = beginRead(convId);
    let data = null;
    try {
      data = await api("GET", `/api/conversations/${convId}/messages?before=${oldest.id}&limit=${OLDER_BATCH_SIZE}`);
      applyPage(convId, data, f);
      for (const m of data.messages) animatedMsgs.add(m.id);
    } finally { endRead(convId, f, data && data.messages); }
    state.hasMore[convId] = data.messages.length >= OLDER_BATCH_SIZE;
    const el = document.getElementById("messages");
    const beforeH = el ? el.scrollHeight : 0, beforeTop = el ? el.scrollTop : 0;
    views.messages();
    // An anchor: after adding older messages above, what you are looking at has to stay under the
    // same finger - otherwise lazy loading "yanks" the view.
    if (el) el.scrollTop = beforeTop + (el.scrollHeight - beforeH);
  } catch (e) { showError(e); }
  finally { loadingOlder = false; }
}

// The handle of the periodic leases/digest refresh. In a module variable, because without it
// every re-login in the same tab left another interval running in parallel (and a third after
// a third login). Leases live for minutes, so 30 s is enough for a "board".
let digestTimer = null;

export function startDigestTimer() {
  clearInterval(digestTimer);
  digestTimer = setInterval(refreshDigestAndLeases, 30000);
}

export function stopDigestTimer() { clearInterval(digestTimer); digestTimer = null; }

/** The "What you missed" digest and the lease board - data for the sidebar.
/**  summary=1: the sidebar needs ONE number from the digest, while the full response is the
/**  complete set of mentions and open questions with their content (tens of KB every 30 s).
/**  When the server does not know the parameter it simply returns everything - nothing breaks. */
/** @param force skips the tab-visibility condition. A periodic refresh in the background is
/**  pointless, but a refresh AFTER A USER ACTION (they claimed a resource, released one) has to
/**  go through always - otherwise the list contradicts the message that has just said "done". */
// Every digest poll carries a sequence number: the 30 s timer and a forced refresh after an
// action can be in flight at once, and the older answer must not land on top of the newer one.
let digestSeq = 0;

export async function refreshDigestAndLeases(force) {
  if (!force && document.visibilityState !== "visible") return;  // a background tab does not need the lease board
  const seq = ++digestSeq;
  const gen = sessionGeneration();
  try {
    const [d, l] = await Promise.all([
      api("GET", "/api/digest?summary=1").catch(() => ({ digest: undefined })),
      api("GET", "/api/leases").catch(() => ({ leases: [] })),
    ]);
    // The fallbacks above must not blank the next account's board either (F1).
    if (gen !== sessionGeneration()) return;
    const incoming = d.digest ? { ...d.digest, seq } : d.digest;
    state.digest = acceptDigest(state.digest, incoming);
    state.leases = l.leases || [];
    views.sidebar();
  } catch { /* optional additions, not core functionality */ }
}

/** The reactions of ONE message. There is no dedicated endpoint, but `before=<id+1>&limit=1`
/**  returns exactly that one message together with its reaction map - instead of 200 full
/**  messages (hundreds of KB) after every emoji click by every member. */
export async function loadReactionsForMessage(convId, messageId) {
  if (!convId || !messageId) return;
  try {
    // T-MG-43: a flight like every REST read; it writes only by the rules above, and a failed
    // refresh writes no stamp, so it keeps no page's reactions out.
    const f = beginRead(convId);
    let data = null;
    try {
      data = await api("GET", `/api/conversations/${convId}/messages?before=${messageId + 1}&limit=1`);
      if (state.loaded[convId]) applyPage(convId, data, f);
      else { mergeActors(data.actors); mergePageReactions(data.messages, data.reactions, f); }
    } finally { endRead(convId, f, data && data.messages); }
  } catch { /* best effort */ }
}

// The actor directory: ONE rule instead of three different ones (mentionAutocomplete fetched
// it when the list was empty; a new conversation did the same; the details panel had its own
// way). A simple TTL plus a shared request, so that a run of messages from unknown authors
// does not fire a run of identical requests.
const ACTORS_TTL_MS = 60000;

let actorsRequest = null;

let actorsRequestGen = -1;

export async function ensureActors(opts = {}) {
  const fresh = Date.now() - state.actorsAt < (opts.maxAgeMs ?? ACTORS_TTL_MS);
  if (!opts.force && fresh && state.actorsList.length) return state.actorsList;
  // The shared request is shared within ONE session only: the next account must not wait on
  // (and get nothing from) the previous account's request (F1).
  if (actorsRequest && actorsRequestGen === sessionGeneration()) return actorsRequest;
  actorsRequestGen = sessionGeneration();
  const request = api("GET", "/api/actors")
    .then((d) => {
      state.actorsList = d.actors || [];
      for (const a of state.actorsList) {
        // `avatar` MUST travel into the cache: avatarUrl() reads ONLY the cache, so dropping
        // the field here rendered every uploaded avatar as initials across the whole UI -
        // sidebar, messages, typing bubbles - while the API kept serving the image correctly.
        state.actorsCache[a.id] = {
          handle: a.handle, displayName: a.displayName, kind: a.kind,
          avatar: a.avatar ?? null, lastActiveAt: a.lastActiveAt,
        };
      }
      state.actorsAt = Date.now();
      return state.actorsList;
    })
    .catch(() => state.actorsList)
    .finally(() => { if (actorsRequest === request) actorsRequest = null; });
  actorsRequest = request;
  return request;
}

export async function refreshPresence() {
  try {
    const data = await api("GET", "/api/presence");
    state.presence = data.presence;
    // Pointwise: presence changes ONLY the dots in the sidebar. Web sessions beat a heartbeat
    // every 30 s, so a full rebuild of the list on every breath would yank the list out from
    // under the user's cursor.
    views.presence();
  } catch { /* presence is not critical */ }
}

export async function refreshQuestions(convId) {
  try {
    const data = await api("GET", "/api/questions/open");
    const open = {};
    for (const q of data.questions) open[q.message.id] = q.id;
    // Without this comparison, every entry into a conversation and every reply redrew the whole
    // message list, usually in order to change nothing.
    const changed = Object.keys(open).join(",") !== Object.keys(state.openQuestions).join(",");
    state.openQuestions = open;
    if (!changed) return;
    views.sidebar();
    if (state.view === "chat" && (!convId || convId === state.activeId)) views.messages();
  } catch { /* best effort */ }
}

/** The active conversation's pins. Previously ONLY the details panel fetched them, so the
/**  message menu had no way of knowing whether to offer "Pin" or "Unpin". The response is tiny
/**  (a list of identifiers) and arrives once per entry into a conversation. */
export async function loadPins(convId) {
  try {
    const data = await api("GET", `/api/conversations/${convId}/pins`);
    if (state.activeId !== convId) return;
    state.convPins = data.pins || [];
    views.messages();
    // W5-S10-C: the header's pins pill lives in the topbar meta, which only the presence glue
    // repaints; without this the pill appeared on the second open, never on the first.
    views.presence();
  } catch { /* pins are optional */ }
}

export async function loadWikiList() {
  try {
    const data = await api("GET", "/api/wiki");
    state.wiki.pages = data.pages;
    views.sidebar();
  } catch { /* best effort */ }
}

let markReadTimers = {};

/** Teardown: a debounced "read" of the previous account must not fire under the next one. */
export function cancelMarkRead() {
  for (const id of Object.keys(markReadTimers)) clearTimeout(markReadTimers[id]);
  markReadTimers = {};
}

/** @param messageId up to which message we are reading. Without it the server moves the marker
/**  to the NEWEST message in the system - so a jump to an entry from an hour ago would also
/**  clear everything that arrived after it. */
export function markReadDebounced(convId, messageId) {
  clearTimeout(markReadTimers[convId]);
  markReadTimers[convId] = setTimeout(async () => {
    try {
      await api("POST", `/api/conversations/${convId}/read`, messageId ? { messageId } : {});
      // A frozen mark of 0 ("never read here") still produced a divider from the unread count;
      // that count is about to become 0, so the mark takes over the divider's position first.
      if (state.readMark[convId] === 0 && state.actor) {
        const frozen = dividerAfter(state.msgs[convId], 0, state.unread[convId], state.actor.id, state.lastUnread[convId]);
        if (frozen !== null) state.readMark[convId] = frozen;
      }
      // We clear it ONLY after the server confirms: a counter that lied once stops being read at all.
      state.unread[convId] = 0;
      state.unreadBadge[convId] = 0;
      views.conversationRow(convId);
      updateTitleBadge();
    } catch { /* best effort */ }
  }, 500);
}

// -------------------------------------------------- the human's session (presence)
// We register the browser session so that OTHERS see our presence and our "typing...".
// Ephemeral + a heartbeat: closing the tab simply lets the session expire.
export let mySessionId = sessionStorage.getItem(SID_KEY) || null;

let heartbeatTimer = null;

export function stopPresenceHeartbeat() { clearInterval(heartbeatTimer); heartbeatTimer = null; }

export async function registerPresenceSession() {
  if (!mySessionId) {
    mySessionId = "web-" + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(SID_KEY, mySessionId);
  }
  try {
    await api("POST", "/api/sessions", { sessionId: mySessionId, label: "web", kind: "ephemeral" });
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      api("POST", "/api/sessions", { sessionId: mySessionId, label: "web", kind: "ephemeral" }).catch(() => {});
    }, 30000);
  } catch { /* presence is optional */ }
}

let lastTypingSignal = 0;

/** The "typing" signal with a place: loc = "c:<convId>" / "w:<slug>". Without loc it takes the
/**  active conversation. Throttled to 3 s - the server TTL is 7 s. */
export function signalTyping(loc) {
  const now = Date.now();
  if (!mySessionId || now - lastTypingSignal < 3000) return;
  lastTypingSignal = now;
  const where = loc || (state.activeId ? `c:${state.activeId}` : null);
  api("POST", `/api/sessions/${mySessionId}/signal`, {
    kind: "typing", ...(where ? { in: where } : {}),
  }).catch(() => {});
}

export async function refreshNotifications() {
  try {
    const data = await api("GET", "/api/notifications?limit=60");
    state.notifications = data.notifications;
    state.notifUnread = data.unread;
    updateTitleBadge();
    const { activity } = railBadges(state);
    const rail = document.getElementById("rail-notif");
    if (rail) rail.setAttribute("aria-label", `${t("Activity")}${activity ? `, ${t("{n} new", { n: activity })}` : ""}`);
    const badge = document.getElementById("rail-badge");
    if (badge) {
      badge.textContent = badgeText(activity);
      badge.classList.toggle("off", !activity);
    }
    if (state.view === "notifications") views.notifications();
  } catch { /* notifications are optional, not core functionality */ }
}
