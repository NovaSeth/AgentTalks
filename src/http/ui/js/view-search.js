/**
 * The search results view (S11): the main column lists every message hit for a query, grouped by
 * conversation, newest first, with the searched words highlighted. Enter or a click on a hit
 * jumps to the message (S3: scroll + flash, inside its thread when needed).
 *
 * The grammar and the API mapping live in search.js and are shared with the Cmd+K palette;
 * this file only fetches, groups and draws. `Cmd+F` inside a conversation opens the palette
 * with `in:#slug ` already typed.
 */
import { api, sessionGeneration } from "./api.js";
import { avatarHtml, emptyStateHtml, escapeHtml, fmtDateTime, skeletonHtml, toggleDrawerClass } from "./dom.js";
import { iconSearch } from "./icons.js";
import { t } from "./i18n.js";
import { stripMd } from "./markdown.js";
import { buildRoute, syncRoute } from "./router.js";
import { highlightHtml, matchesFrom, openSearchPalette, parseQuery, queryTerms, resolveIn, searchParams, snippetAround } from "./search.js";
import { actorHandle, dmLabel, dmOthers, mergeActors, state, views } from "./state.js";
import { openConversation } from "./view-chat.js";

/** The current search: the query, what it parsed to, and what the server answered. Module-local
 *  rather than on `state`: nothing outside this view reads it. `olderBefore` is the id to page
 *  from in a filter-only listing (U11), null when the conversation's start was reached. */
let current = { q: "", parsed: parseQuery(""), loading: false, messages: [], unresolvedIn: false, error: null, gen: -1, olderBefore: null };

/** Every search carries a sequence number and the session generation it started in (F1): an
 *  older answer (a newer query was typed, or the account changed under it) is dropped before
 *  it touches `current`, the actor directory or the DOM. */
let searchSeq = 0;

const emptySearch = () => ({ q: "", parsed: parseQuery(""), loading: false, messages: [], unresolvedIn: false, error: null, gen: sessionGeneration(), olderBefore: null });

/** A filter-only page size: the server caps a page at 500; 200 leaves room for from: to thin it. */
const FILTER_PAGE = 200;

const hasFilter = (parsed) => !!(parsed.in || parsed.from || parsed.before !== null || parsed.after !== null);

/** The client side of a filter-only query (U11): no words, so nothing for the FTS index; the
 *  conversation's messages are listed newest first with from:, before: and after: applied here.
 *  Deleted messages are left out (the search index never returns them either). Pure. */
export function applyFilters(messages, parsed) {
  return (messages || [])
    .filter((m) => m && !m.deletedAt)
    .filter((m) => matchesFrom(m, parsed.from))
    .filter((m) => parsed.before === null || (m.ts || 0) <= parsed.before)
    .filter((m) => parsed.after === null || (m.ts || 0) >= parsed.after)
    .sort((a, b) => ((b.ts || 0) - (a.ts || 0)) || ((b.id || 0) - (a.id || 0)));
}

/** The `in:` token for a conversation: `#slug` for a channel, `@handle` for a one-to-one
 *  direct conversation, null for a group (no single name to filter by). */
function inTokenFor(c) {
  if (!c) return null;
  if (c.slug) return `#${c.slug}`;
  const others = dmOthers(c);
  return others.length === 1 ? `@${others[0].handle}` : null;
}

/** Hits grouped by conversation. Groups are ordered by their newest hit, and the hits inside a
 *  group newest first: the server already returns the newest page, so the top is "most recent". */
export function groupByConversation(messages) {
  const byConv = new Map();
  for (const m of messages || []) {
    const g = byConv.get(m.conversationId) || { conversationId: m.conversationId, messages: [], newest: 0 };
    g.messages.push(m);
    g.newest = Math.max(g.newest, m.ts || 0, m.id || 0);
    byConv.set(m.conversationId, g);
  }
  const groups = [...byConv.values()];
  for (const g of groups) g.messages.sort((a, b) => (b.ts - a.ts) || (b.id - a.id));
  groups.sort((a, b) => b.newest - a.newest);
  return groups.map(({ conversationId, messages: list }) => ({ conversationId, messages: list }));
}

/** Open the results view for `q` and run the search. Called from the palette's "Search messages"
 *  row, from the results view's own box, and from the #/search?q= route (W3-S3-A). */
export async function openSearchView(q) {
  const query = String(q ?? "").trim();
  const parsed = parseQuery(query);
  const my = ++searchSeq;
  const gen = sessionGeneration();
  const fresh = () => my === searchSeq && gen === sessionGeneration();
  const filterOnly = !parsed.text && hasFilter(parsed);
  const inConv = filterOnly ? resolveIn(parsed.in, state.conversations) : null;
  current = { q: query, parsed, loading: !!parsed.text || !!inConv, messages: [], unresolvedIn: false, error: null, gen, olderBefore: null };
  state.view = "search";
  state.drawerOpen = false;
  state.threadOpen = null;
  syncRoute(buildRoute({ view: "search", q: query }));
  // The shell draws the rail, the sidebar and the main column; renderMain hands the column to
  // `views.search` (registered in app.js, W5-S11-A), which is renderSearchMain below.
  views.shell();
  toggleDrawerClass();
  if (filterOnly) {
    // U11: filters alone list the conversation (what a human who typed them expects); `in:` naming nothing I
    // can see is reported, and no `in:` at all keeps the hint with a suggestion.
    if (parsed.in && !inConv) { current.unresolvedIn = true; renderSearchMain(); return; }
    if (!inConv) return;
    await loadFilterPage(inConv.id, parsed, null, fresh, query);
    return;
  }
  if (!parsed.text) return;
  const params = searchParams(parsed, state.conversations);
  if (params.unresolvedIn) {
    current.unresolvedIn = true;
    current.loading = false;
    renderSearchMain();
    return;
  }
  let data = null, error = null;
  try { data = await api("GET", `/api/search?${params.query}`); }
  catch (e) { error = e; }
  if (!fresh()) return;
  if (data) {
    mergeActors(data.actors);
    current.messages = (data.messages || []).filter((m) => matchesFrom(m, parsed.from));
  }
  current.error = error;
  current.loading = false;
  if (state.view === "search" && current.q === query) renderSearchMain();
}

/** One page of a filter-only listing: the conversation's newest messages (older than `before`
 *  when paging), filtered on the client and appended to what is shown. A full page means there
 *  may be older ones: the view offers "Show older". */
async function loadFilterPage(convId, parsed, before, fresh, query) {
  let data = null, error = null;
  const qs = `limit=${FILTER_PAGE}${before ? `&before=${before}` : ""}`;
  try { data = await api("GET", `/api/conversations/${convId}/messages?${qs}`); }
  catch (e) { error = e; }
  if (!fresh()) return;
  if (data) {
    mergeActors(data.actors);
    const page = data.messages || [];
    current.messages = applyFilters([...current.messages, ...page], parsed);
    current.olderBefore = page.length >= FILTER_PAGE ? Math.min(...page.map((m) => m.id)) : null;
  }
  current.error = error;
  current.loading = false;
  if (state.view === "search" && current.q === query) renderSearchMain();
}

const conversationName = (c) => c ? (c.slug ? `#${c.slug}` : dmLabel(c)) : t("a conversation you left");

/** The main column of the search view: the box with the query, a summary line, the groups. */
export function renderSearchMain() {
  const el = document.getElementById("main");
  if (!el || state.view !== "search") return;
  // Results kept from another account's session are never drawn (F1).
  if (current.gen !== sessionGeneration()) current = emptySearch();
  const { q, parsed, loading, messages, unresolvedIn, error, olderBefore } = current;
  const groups = groupByConversation(messages);
  const terms = queryTerms(parsed.text);
  const back = state.activeId && state.conversations.find((c) => c.id === state.activeId);
  const listing = !parsed.text && !!parsed.in;
  const summary = loading ? t("Searching...")
    : unresolvedIn ? t("No conversation named {name}", { name: parsed.in })
      : !parsed.text && !listing ? t("Add a word to search for")
        : error ? t("The search did not go through")
          : t("{n} results", { n: messages.length });
  el.innerHTML = `
    <div class="main-col search-view" id="main-col">
      <div class="topbar">
        <div class="title"><div class="t">${iconSearch()} ${t("Search results")}</div>
          <div class="topic" id="search-summary" role="status">${escapeHtml(summary)}</div></div>
        ${back ? `<button class="btn ghost" id="search-back">${t("Back to {name}", { name: escapeHtml(conversationName(back)) })}</button>` : ""}
      </div>
      <form class="search-bar" id="search-form" role="search">
        <label class="sr-only" for="search-q">${t("Search messages")}</label>
        <input id="search-q" class="form-control" value="${escapeHtml(q)}" autocomplete="off"
          placeholder="${t("Words to find, with in:#channel from:@name before:YYYY-MM-DD after:YYYY-MM-DD")}">
        <button class="btn" type="submit">${t("Search")}</button>
      </form>
      <div class="search-results viewfade" id="search-results">${resultsHtml(groups, terms, { loading, parsed, unresolvedIn, error, q, listing, olderBefore, suggest: inTokenFor(back) })}</div>
    </div>`;
  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const next = document.getElementById("search-q").value.trim();
    if (next) openSearchView(next);
  });
  document.getElementById("search-back")?.addEventListener("click", () => openConversation(back.id));
  const results = document.getElementById("search-results");
  // U11: the suggestion adds in: for the conversation you came from; "Show older" pages the
  // filter-only listing from its oldest row.
  results.querySelector("[data-suggest-in]")?.addEventListener("click", (e) =>
    openSearchView(`${q} in:${e.currentTarget.dataset.suggestIn}`));
  results.querySelector("[data-older]")?.addEventListener("click", (e) => {
    e.currentTarget.disabled = true;
    const conv = resolveIn(parsed.in, state.conversations);
    const my = ++searchSeq, gen = sessionGeneration();
    if (conv) loadFilterPage(conv.id, parsed, olderBefore, () => my === searchSeq && gen === sessionGeneration(), q);
  });
  results.querySelectorAll("[data-hit]").forEach((b) => b.addEventListener("click", () => {
    openConversation(Number(b.dataset.conv), Number(b.dataset.hit));
  }));
  // Arrow keys walk the hits like a list; Enter on a focused hit is the button's own click.
  results.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const hits = [...results.querySelectorAll("[data-hit]")];
    const i = hits.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    hits[(i + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length].focus();
  });
  if (!loading) document.getElementById("search-q").focus();
}

function resultsHtml(groups, terms, { loading, parsed, unresolvedIn, error, q, listing, olderBefore, suggest }) {
  if (loading) return skeletonHtml();
  if (unresolvedIn) {
    return emptyStateHtml(iconSearch(2.4), t("No conversation named {name}", { name: parsed.in }),
      t("in: takes the name of a channel or a person you can see, for example in:#general or in:@nestor."));
  }
  if (!parsed.text && !listing) {
    // No words and no place: the hint stays, with the one click that turns the filters into a
    // listing of the conversation you came from (U11).
    return emptyStateHtml(iconSearch(2.4), t("Add a word to search for"),
      t("Or add in:#channel to list the latest messages there."))
      + (suggest && hasFilter(parsed) ? `<p class="search-suggest"><button class="btn slim" data-suggest-in="${escapeHtml(suggest)}">${escapeHtml(t("List the latest in {name}", { name: suggest }))}</button></p>` : "");
  }
  if (listing && !error && !groups.length) {
    return emptyStateHtml(iconSearch(2.4), t("Nothing in {name} matches these filters", { name: `#${parsed.in}` }),
      t("Try another author or wider dates."));
  }
  if (error) {
    return emptyStateHtml(iconSearch(2.4), t("The search did not go through"),
      t("Check the connection and try again."));
  }
  if (!groups.length) {
    return emptyStateHtml(iconSearch(2.4), t("Nothing found for “{q}”", { q }),
      t("Try fewer words, another spelling, or wider dates."));
  }
  return groups.map((g) => {
    const conv = state.conversations.find((c) => c.id === g.conversationId);
    const where = conversationName(conv);
    return `
      <section class="search-group" aria-labelledby="sg-${g.conversationId}">
        <h2 class="search-group-h" id="sg-${g.conversationId}">${escapeHtml(where)}
          <span class="Counter">${g.messages.length}</span></h2>
        ${g.messages.map((m) => {
          const who = m.actorHandle || actorHandle(m.actorId);
          return `
        <button class="search-hit" data-hit="${m.id}" data-conv="${m.conversationId}"
          aria-label="${escapeHtml(t("Message from @{who} in {where}, {when}: open it", { who, where, when: fmtDateTime(m.ts) }))}">
          ${avatarHtml(who, 28)}
          <span class="sh-body">
            <span class="sh-head"><b>@${escapeHtml(who)}</b><span class="sh-when">${fmtDateTime(m.ts)}</span>
              ${m.threadId ? `<span class="sh-thread">${t("in a thread")}</span>` : ""}</span>
            <span class="sh-text">${highlightHtml(snippetAround(stripMd(m.body), terms), terms)}</span>
          </span>
        </button>`;
        }).join("")}
      </section>`;
  }).join("") + (listing && olderBefore ? `<p class="search-older"><button class="btn slim" data-older="${olderBefore}">${escapeHtml(t("Show older"))}</button></p>` : "");
}

// ------------------------------------------------------------- Mod+F in a conversation
/** Inside a conversation the browser's find is the wrong tool: the list holds only the loaded
 *  page. Mod+F opens the palette with `in:` pre-filled for this conversation instead. The key is
 *  matched by the shortcut table (W5-S11-C: `findInConversation` in shortcuts.js, so the help
 *  sheet lists it) and run from app.js; `false` means "not in a conversation" and the key keeps
 *  its browser meaning (wiki, Activity, admin, a group conversation without one name). */
export function findInConversation() {
  if (!state.actor || state.view !== "chat" || !state.activeId) return false;
  const c = state.conversations.find((x) => x.id === state.activeId);
  if (!c) return false;
  const others = dmOthers(c);
  const where = c.slug ? `#${c.slug}` : others.length === 1 ? `@${others[0].handle}` : null;
  if (!where) return false;
  openSearchPalette({ query: `in:${where} ` });
  return true;
}
