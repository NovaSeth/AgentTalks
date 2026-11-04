/**
 * The search results view (S11): the main column lists every message hit for a query, grouped by
 * conversation, newest first, with the searched words highlighted. Enter or a click on a hit
 * jumps to the message (S3: scroll + flash, inside its thread when needed).
 *
 * The grammar and the API mapping live in search.js and are shared with the Cmd+K palette;
 * this file only fetches, groups and draws. `Cmd+F` inside a conversation opens the palette
 * with `in:#slug ` already typed.
 */
import { api } from "./api.js";
import { avatarHtml, emptyStateHtml, escapeHtml, fmtDateTime, skeletonHtml, toggleDrawerClass } from "./dom.js";
import { iconSearch } from "./icons.js";
import { t } from "./i18n.js";
import { buildRoute, syncRoute } from "./router.js";
import { highlightHtml, matchesFrom, openSearchPalette, parseQuery, queryTerms, searchParams, snippetAround } from "./search.js";
import { actorHandle, dmLabel, dmOthers, mergeActors, state, views } from "./state.js";
import { openConversation } from "./view-chat.js";

/** The current search: the query, what it parsed to, and what the server answered. Module-local
 *  rather than on `state`: nothing outside this view reads it. */
let current = { q: "", parsed: parseQuery(""), loading: false, messages: [], unresolvedIn: false, error: null };

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
  current = { q: query, parsed, loading: !!parsed.text, messages: [], unresolvedIn: false, error: null };
  state.view = "search";
  state.drawerOpen = false;
  state.threadOpen = null;
  syncRoute(buildRoute({ view: "search", q: query }));
  // The shell draws the rail, the sidebar and the main column; renderMain hands the column to
  // `views.search` (registered in app.js, W5-S11-A), which is renderSearchMain below.
  views.shell();
  toggleDrawerClass();
  if (!parsed.text) return;
  const params = searchParams(parsed, state.conversations);
  if (params.unresolvedIn) {
    current.unresolvedIn = true;
    current.loading = false;
    renderSearchMain();
    return;
  }
  try {
    const data = await api("GET", `/api/search?${params.query}`);
    mergeActors(data.actors);
    current.messages = (data.messages || []).filter((m) => matchesFrom(m, parsed.from));
  } catch (e) {
    current.error = e;
  }
  current.loading = false;
  if (state.view === "search" && current.q === query) renderSearchMain();
}

const conversationName = (c) => c ? (c.slug ? `#${c.slug}` : dmLabel(c)) : t("a conversation you left");

/** The main column of the search view: the box with the query, a summary line, the groups. */
export function renderSearchMain() {
  const el = document.getElementById("main");
  if (!el || state.view !== "search") return;
  const { q, parsed, loading, messages, unresolvedIn, error } = current;
  const groups = groupByConversation(messages);
  const terms = queryTerms(parsed.text);
  const back = state.activeId && state.conversations.find((c) => c.id === state.activeId);
  const summary = loading ? t("Searching...")
    : !parsed.text ? t("Add a word to search for")
      : unresolvedIn ? t("No conversation named {name}", { name: parsed.in })
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
      <div class="search-results viewfade" id="search-results">${resultsHtml(groups, terms, { loading, parsed, unresolvedIn, error, q })}</div>
    </div>`;
  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const next = document.getElementById("search-q").value.trim();
    if (next) openSearchView(next);
  });
  document.getElementById("search-back")?.addEventListener("click", () => openConversation(back.id));
  const results = document.getElementById("search-results");
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

function resultsHtml(groups, terms, { loading, parsed, unresolvedIn, error, q }) {
  if (loading) return skeletonHtml();
  if (!parsed.text) {
    return emptyStateHtml(iconSearch(2.4), t("Add a word to search for"),
      t("Filters narrow a search down; the words to look for are still needed."));
  }
  if (unresolvedIn) {
    return emptyStateHtml(iconSearch(2.4), t("No conversation named {name}", { name: parsed.in }),
      t("in: takes the name of a channel or a person you can see, for example in:#general or in:@nestor."));
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
            <span class="sh-text">${highlightHtml(snippetAround(m.body, terms), terms)}</span>
          </span>
        </button>`;
        }).join("")}
      </section>`;
  }).join("");
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
