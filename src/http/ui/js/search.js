/**
 * The Cmd+K palette: conversations and people first (no network), content after.
 *
 * S11 adds the search grammar shared by the palette and the results view (view-search.js):
 *   in:#slug   from:@handle   before:YYYY-MM-DD   after:YYYY-MM-DD   <free text>
 * parseQuery() reads it, searchParams() maps it to GET /api/search (messages.ts:94-106); from:
 * has no server parameter (N4) and is filtered on the client with matchesFrom().
 */
import { startDirect } from "./actions.js";
import { api } from "./api.js";
import { ensureActors } from "./data.js";
import { avatarHtml, escapeHtml, timeAgo } from "./dom.js";
import { iconDoc, iconSearch } from "./icons.js";
import { t } from "./i18n.js";
import { actorHandle, dmLabel, dmOthers, mergeActors, recentConversations, state } from "./state.js";
import { openConversation } from "./view-chat.js";
import { openSearchView } from "./view-search.js";
import { openWikiPage } from "./view-wiki.js";

// ============================================================ query grammar (S11)
const DAY = 24 * 3600;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Unix seconds at 00:00 UTC of a YYYY-MM-DD, or null when the text is not a real date. UTC on
 *  purpose: the same query means the same window on every machine, and the server compares
 *  seconds, not calendar days. */
function dayStart(s) {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ts);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return ts / 1000;
}

/** The query split into text and filters. A token that looks like a filter but does not parse
 *  (`before:yesterday`) stays in the text: the user typed it, the user sees it searched.
 *  @returns {{ text: string, in: string|null, from: string|null, before: number|null, after: number|null }} */
export function parseQuery(q) {
  const out = { text: "", in: null, from: null, before: null, after: null };
  const words = [];
  for (const tok of String(q ?? "").trim().split(/\s+/).filter(Boolean)) {
    const m = /^(in|from|before|after):(.+)$/i.exec(tok);
    if (m) {
      const key = m[1].toLowerCase(), val = m[2];
      if (key === "in") { out.in = val.replace(/^#/, "").toLowerCase(); continue; }
      if (key === "from") { out.from = val.replace(/^@/, "").toLowerCase(); continue; }
      const day = dayStart(val);
      if (day !== null) {
        // The usual chat-tool reading: before:D is strictly before that day, after:D strictly after it.
        if (key === "before") out.before = day - 1; else out.after = day + DAY;
        continue;
      }
    }
    words.push(tok);
  }
  out.text = words.join(" ");
  return out;
}

/** The conversation an `in:` token names: a channel by slug, or a direct conversation by the
 *  other side's handle (`in:@nestor`). Null when nothing I can see matches. */
export function resolveIn(name, conversations) {
  if (!name) return null;
  const want = name.replace(/^[#@]/, "").toLowerCase();
  return (conversations || []).find((c) => (c.slug || "").toLowerCase() === want)
    || (conversations || []).find((c) => (c.kind === "dm" || c.kind === "group")
      && dmOthers(c).length === 1 && dmOthers(c)[0].handle.toLowerCase() === want)
    || null;
}

/** GET /api/search parameters for a parsed query. `limit` is 40 (the server default) and 50
 *  when from: is set: that filter runs on the client, so a page must hold enough rows for the
 *  wanted author to survive it (U7). `unresolvedIn` is true when in: names nothing I can see. */
export function searchParams(parsed, conversations, opts = {}) {
  const qs = new URLSearchParams();
  qs.set("q", parsed.text);
  const conv = resolveIn(parsed.in, conversations);
  if (conv) qs.set("conversationId", String(conv.id));
  if (parsed.after !== null) qs.set("sinceTs", String(parsed.after));
  if (parsed.before !== null) qs.set("untilTs", String(parsed.before));
  qs.set("limit", String(opts.limit ?? (parsed.from ? 50 : 40)));
  return { query: qs.toString(), conversation: conv, unresolvedIn: !!parsed.in && !conv };
}

/** The client side of from: (N4 has no server parameter). No filter matches everybody. */
export function matchesFrom(m, from) {
  if (!from) return true;
  const handle = m.actorHandle || actorHandle(m.actorId);
  return String(handle).toLowerCase() === from.toLowerCase();
}

/** The words to highlight: the free text, as the FTS index reads it (prefix match per word). */
export function queryTerms(text) {
  return String(text ?? "").toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}

/** The body as HTML with every term wrapped in <mark>. Escapes first, so a `<b>` in a message
 *  stays text; a term matches by prefix at a word start, like the server's `"word"*`. */
export function highlightHtml(body, terms) {
  const text = String(body ?? "");
  const words = (terms || []).filter(Boolean).map((w) => w.toLowerCase());
  if (!words.length) return escapeHtml(text);
  const alt = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])((?:${alt})[\\p{L}\\p{N}_]*)`, "giu");
  let out = "", last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[1].length;
    out += escapeHtml(text.slice(last, start)) + "<mark>" + escapeHtml(m[2]) + "</mark>";
    last = start + m[2].length;
  }
  return out + escapeHtml(text.slice(last));
}

/** A short window of the body around the first term, so the hit is visible in one line. */
export function snippetAround(body, terms, width = 160) {
  const text = String(body ?? "").replace(/\s+/g, " ");
  if (text.length <= width) return text;
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of terms || []) { const i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return text.slice(0, width - 1) + "…";
  const start = Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

/** The screen-reader name of a palette row (M15): what Enter does, not what the row shows. */
export function rowLabel(kind, parts) {
  switch (kind) {
    case "conversation": return t("Open {name}", { name: parts.name });
    case "person": return t("Message {name}", { name: parts.name });
    case "wiki": return t("Open the wiki page {name}", { name: parts.name });
    case "message": return t("Message from {name} in {where}", { name: parts.name, where: parts.where });
    case "search": return t("Search messages for {name}", { name: parts.name });
    default: return parts.name;
  }
}

/** The #/search?q= route (W3-S3-A): a query opens the results view with it applied; an empty one
 *  opens the palette, which is where a query is typed. */
export async function openSearchRoute(q) {
  if (String(q ?? "").trim()) await openSearchView(q);
  else openSearchPalette();
}

// ============================================================= SEARCH (Cmd+K)
let searchOverlay = null;

/** @param opts.query text to start with (Cmd+F in a channel pre-fills `in:#slug `). */
export function openSearchPalette(opts = {}) {
  if (searchOverlay) return;
  searchOverlay = document.createElement("div");
  searchOverlay.className = "overlay palette-overlay";
  searchOverlay.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="${t("Jump to a conversation or search")}">
      <div class="pal-head">${iconSearch()}
        <label class="sr-only" for="pal-input">${t("Jump to a conversation, or search messages and the wiki")}</label>
        <input id="pal-input" placeholder="${t("Jump to a conversation or search...")}" autocomplete="off"></div>
      <div class="pal-results" id="pal-results"></div>
    </div>`;
  document.body.appendChild(searchOverlay);
  const returnFocus = document.activeElement;
  const input = searchOverlay.querySelector("#pal-input");
  const results = searchOverlay.querySelector("#pal-results");
  let items = [], remote = [], sel = 0, debounce = null, seq = 0;
  // The list of people can be stale, and the palette has to be able to start a
  // conversation - so we fetch it in the background without blocking the window.
  ensureActors().then(() => rebuild());

  const close = () => {
    searchOverlay.remove();
    searchOverlay = null;
    document.removeEventListener("keydown", onKey, true);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  };
  searchOverlay.addEventListener("click", (e) => { if (e.target === searchOverlay) close(); });

  // Conversations and people are ALREADY in the client's memory, so this section
  // does not wait for the network and sits on top: "jump to #bugs" happens dozens
  // of times a day, "find a message containing bugs" - a few times a week.
  const conversationName = (c) => (c.kind === "dm" || c.kind === "group") ? dmLabel(c) : `#${c.slug || c.topic || c.id}`;
  const localResults = (q) => {
    const parsed = parseQuery(q);
    const hasFilter = parsed.in || parsed.from || parsed.before !== null || parsed.after !== null;
    const norm = parsed.text.toLowerCase();
    const myConversations = state.conversations.filter((c) => state.memberships[c.id]);
    // With a filter the user is searching messages, not jumping: no conversation or people rows.
    const selected = hasFilter ? []
      : norm ? myConversations.filter((c) => conversationName(c).toLowerCase().includes(norm))
        : recentConversations(myConversations);
    const out = selected.slice(0, 6).map((c) => ({
      section: t("Conversations"),
      label: rowLabel("conversation", { name: conversationName(c) }),
      html: `<span class="pal-title">${escapeHtml(conversationName(c))}</span>
             <span class="pal-where">${c.topic ? escapeHtml(c.topic) : ""}</span>`,
      go: () => openConversation(c.id),
    }));
    if (!norm) return out;
    if (!hasFilter) {
      for (const a of state.actorsList) {
        if (out.length >= 10) break;
        if (a.handle === state.actor.handle) continue;
        const matches = a.handle.toLowerCase().includes(norm) || (a.displayName || "").toLowerCase().includes(norm);
        if (!matches) continue;
        out.push({
          section: t("People"),
          label: rowLabel("person", { name: `@${a.handle}` }),
          html: `${avatarHtml(a.handle, 22)}<span class="pal-title">@${escapeHtml(a.handle)}</span>
                 <span class="pal-where">${a.kind === "human" ? t("human") : t("agent")} · ${t("direct conversation")}</span>`,
          go: () => startDirect(a.handle),
        });
      }
    }
    return out;
  };

  // The way to the full results view: every hit, grouped by conversation, terms highlighted.
  // It comes LAST: Enter on the first row keeps opening the best hit, the way the palette always
  // worked; the full view is one arrow press further.
  const searchRow = (q) => {
    const text = q.trim();
    if (!text) return [];
    return [{
      section: t("Search"),
      label: rowLabel("search", { name: text }),
      html: `${iconSearch()}<span class="pal-title">${t("Search messages for “{q}”", { q: escapeHtml(text) })}</span>
             <span class="pal-where">${t("in:#channel from:@name before: after:")}</span>`,
      go: () => openSearchView(text),
    }];
  };

  const rebuild = () => {
    if (!searchOverlay) return;
    items = [...localResults(input.value), ...remote, ...searchRow(input.value)];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    renderResults();
  };

  const renderResults = () => {
    if (!items.length) {
      results.innerHTML = input.value.trim()
        ? `<div class="pal-hint">${t("Nothing found.")}</div>`
        : `<div class="pal-hint">${t("Type a channel or person - or a word you are looking for in the content.")}</div>`;
      return;
    }
    let html = "", lastSection = null;
    items.forEach((it, i) => {
      if (it.section !== lastSection) { html += `<div class="pal-section">${it.section}</div>`; lastSection = it.section; }
      html += `<button class="pal-row ${i === sel ? "sel" : ""}" data-pi="${i}" aria-label="${escapeHtml(it.label || "")}">${it.html}</button>`;
    });
    results.innerHTML = html;
    results.querySelectorAll("[data-pi]").forEach((b) =>
      b.addEventListener("click", () => activate(Number(b.dataset.pi))));
    const selEl = results.querySelector(".pal-row.sel");
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  };

  const activate = (i) => {
    const it = items[i];
    if (!it) return;
    close();
    it.go();
  };

  const doSearch = async (q) => {
    const my = ++seq;
    const parsed = parseQuery(q);
    if (!parsed.text) { remote = []; rebuild(); return; }
    const params = searchParams(parsed, state.conversations, { limit: parsed.from ? 50 : 12 });
    const hasFilter = parsed.in || parsed.from || parsed.before !== null || parsed.after !== null;
    try {
      const [wiki, msgs] = await Promise.all([
        // Filters speak about messages; the wiki has no channels or authors to narrow by.
        hasFilter ? Promise.resolve({ hits: [] })
          : api("GET", `/api/wiki/search?q=${encodeURIComponent(parsed.text)}&limit=5`).catch(() => ({ hits: [] })),
        params.unresolvedIn ? Promise.resolve({ messages: [], actors: {} })
          : api("GET", `/api/search?${params.query}`).catch(() => ({ messages: [], actors: {} })),
      ]);
      if (my !== seq) return;
      mergeActors(msgs.actors);
      remote = [];
      for (const h of wiki.hits) {
        remote.push({
          section: t("Wiki"),
          label: rowLabel("wiki", { name: h.title }),
          html: `${iconDoc()} <span class="pal-title">${escapeHtml(h.title)}</span>
                 <span class="pal-snip">${escapeHtml(h.snippet).replace(/\[/g, "<mark>").replace(/\]/g, "</mark>")}</span>`,
          go: () => openWikiPage(h.slug),
        });
      }
      for (const m of msgs.messages.filter((x) => matchesFrom(x, parsed.from)).slice(0, 12)) {
        const conv = state.conversations.find((c) => c.id === m.conversationId);
        const where = conv ? (conv.slug ? "#" + conv.slug : dmLabel(conv)) : "";
        const who = m.actorHandle || actorHandle(m.actorId);
        remote.push({
          section: t("Messages"),
          label: rowLabel("message", { name: `@${who}`, where }),
          html: `${avatarHtml(who, 22)}
                 <span class="pal-title">@${escapeHtml(who)} <span class="pal-where">${escapeHtml(where)} · ${timeAgo(m.ts)}</span></span>
                 <span class="pal-snip">${highlightHtml(snippetAround(m.body, queryTerms(parsed.text), 140), queryTerms(parsed.text))}</span>`,
          go: () => openConversation(m.conversationId, m.id),
        });
      }
      sel = 0;
      rebuild();
    } catch { if (my === seq) { remote = []; rebuild(); } }
  };

  input.addEventListener("input", () => {
    // The local section reacts IMMEDIATELY; the network only after 250 ms of stillness.
    rebuild();
    clearTimeout(debounce);
    debounce = setTimeout(() => doSearch(input.value), 250);
  });
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      renderResults();
    }
    if (e.key === "Enter") { e.preventDefault(); activate(sel); }
  };
  document.addEventListener("keydown", onKey, true);
  input.focus();
  if (opts.query) {
    input.value = opts.query;
    // The caret after the prefilled filter, so typing continues the query.
    input.setSelectionRange(input.value.length, input.value.length);
    doSearch(input.value);
  }
  rebuild();   // with an empty field: the most recently opened conversations
}
