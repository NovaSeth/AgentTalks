/**
 * The message composer (S4 owns it; S0 only created the file).
 *
 * One composer serves the main dock and the thread panel. view-chat.js keeps the two mount
 * points (it owns drafts, attachments and the message list) and builds both boxes from the
 * parts here: the card markup, the formatting bar, the emoji picker and ONE autocomplete
 * engine for `@people` and `#channels`.
 *
 * The autocomplete used to lose a race: the directory refresh is async, and an answer that
 * arrived after the user had already picked a name re-opened the list over the finished text
 * (M10). Every refresh now carries a sequence number and a stale answer is dropped; Shift+Enter
 * is left to the textarea, so it inserts a newline even while the list is open.
 *
 * `renderComposer` stays re-exported from view-chat.js: callers that imported it from here
 * since S0 keep working.
 */
import { commandSuggestions } from "./commands.js";
import { avatarHtml, escapeHtml } from "./dom.js";
import { rememberEmoji, searchEmoji } from "./emoji.js";
import { iconAddReaction, iconPlus, iconSend } from "./icons.js";
import { lang, t } from "./i18n.js";
import { state } from "./state.js";

export { renderComposer } from "./view-chat.js";

// ------------------------------------------------------------- pure helpers (tested)
const LINE_PREFIXES = ["- ", "> "];

/**
 * Wrap the selection [start, end) of `text` in a markdown marker, or unwrap it when it is
 * already wrapped (a toggle). Inline markers: "**", "_", "~~", "`". "```" fences the selection
 * on its own lines; "- " and "> " prefix every selected line; "[" turns the selection into a
 * link label and leaves the caret inside the empty parentheses.
 * @returns {{ text: string, start: number, end: number }}
 */
export function wrapSelection(text, start, end, marker) {
  const before = text.slice(0, start), sel = text.slice(start, end), after = text.slice(end);
  if (marker === "```") {
    const fenced = "```\n" + sel + "\n```";
    return { text: before + fenced + after, start: start + 4, end: start + 4 + sel.length };
  }
  if (marker === "[") {
    if (!sel) return { text: before + "[]()" + after, start: start + 1, end: start + 1 };
    const caret = start + sel.length + 3;
    return { text: before + "[" + sel + "]()" + after, start: caret, end: caret };
  }
  if (LINE_PREFIXES.includes(marker)) {
    const lineStart = before.lastIndexOf("\n") + 1;
    const block = text.slice(lineStart, end);
    const lines = block.split("\n");
    const allPrefixed = lines.every((l) => l.startsWith(marker));
    const changed = lines.map((l) => (allPrefixed ? l.slice(marker.length) : marker + l)).join("\n");
    return { text: text.slice(0, lineStart) + changed + after, start: lineStart, end: lineStart + changed.length };
  }
  const n = marker.length;
  if (text.slice(start - n, start) === marker && text.slice(end, end + n) === marker) {
    return { text: text.slice(0, start - n) + sel + text.slice(end + n), start: start - n, end: end - n };
  }
  if (sel.length >= 2 * n && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(n, sel.length - n);
    return { text: before + inner + after, start, end: start + inner.length };
  }
  return { text: before + marker + sel + marker + after, start: start + n, end: end + n };
}

/**
 * The `@` or `#` token that ends at the caret: `{ start, query }` or null. A token starts at
 * the beginning of the text or after whitespace / an opening bracket, never inside a word
 * (so "a#b" and an e-mail address are left alone).
 */
export function completeToken(text, caret, kind) {
  const upto = String(text).slice(0, caret);
  const re = kind === "#" ? /(^|[\s(])#([a-z0-9_-]{0,40})$/i : /(^|[\s(])@([a-z0-9._-]{0,32})$/i;
  const m = upto.match(re);
  if (!m) return null;
  return { start: upto.length - m[2].length - 1, query: m[2] };
}

/**
 * Channels for the `#` list: the ones I am in first, then the public ones I could join;
 * a prefix match ranks before a match inside the slug; alphabetical within a rank.
 * @returns {Array<{ id: number, slug: string, member: boolean }>}
 */
export function channelCandidates(query, conversations, memberships) {
  const q = String(query ?? "").toLowerCase();
  const out = [];
  for (const c of conversations || []) {
    if (!c.slug || c.kind === "direct") continue;
    const member = !!(memberships || {})[c.id];
    if (!member && c.kind !== "public") continue;
    const slug = c.slug.toLowerCase();
    const rank = !q || slug.startsWith(q) ? 0 : slug.includes(q) ? 1 : -1;
    if (rank < 0) continue;
    out.push({ id: c.id, slug: c.slug, member, rank });
  }
  out.sort((a, b) => Number(b.member) - Number(a.member) || a.rank - b.rank || a.slug.localeCompare(b.slug));
  return out.slice(0, 8).map(({ id, slug, member }) => ({ id, slug, member }));
}

/** Insert `insert` at the caret of a textarea, replacing the selection; the caret lands after it. */
export function insertAtCaret(ta, insert) {
  const start = ta.selectionStart ?? ta.value.length, end = ta.selectionEnd ?? start;
  ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
  const pos = start + insert.length;
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

// ------------------------------------------------------------- markup
const FORMATS = [
  { id: "bold", marker: "**", glyph: "<b>B</b>", label: () => t("Bold"), key: "b" },
  { id: "italic", marker: "_", glyph: "<i>I</i>", label: () => t("Italic"), key: "i" },
  { id: "strike", marker: "~~", glyph: "<s>S</s>", label: () => t("Strikethrough"), key: "" },
  { id: "code", marker: "`", glyph: "<code>&lt;&gt;</code>", label: () => t("Code"), key: "" },
  { id: "codeblock", marker: "```", glyph: "<code>&lt;/&gt;</code>", label: () => t("Code block"), key: "" },
  { id: "link", marker: "[", glyph: "<span>[&nbsp;]</span>", label: () => t("Link"), key: "k" },
  { id: "list", marker: "- ", glyph: "<span>&#8801;</span>", label: () => t("Bulleted list"), key: "" },
  { id: "quote", marker: "> ", glyph: "<span>&gt;</span>", label: () => t("Quote"), key: "" },
];

/**
 * The card both boxes share. `prefix` names the ids ("composer" or "th"): state.saveDraft and
 * actions.js read #composer-input, so the main box keeps its historical ids.
 * @param {{ prefix: string, placeholder: string, label: string, files?: boolean, footer?: string }} o
 */
export function composerCardHtml(o) {
  const p = o.prefix;
  return `
    <div class="card" id="${p}-card">
      ${o.files ? `<div class="previews" id="${p}-previews"></div>` : ""}
      <label class="sr-only" for="${p}-input">${escapeHtml(o.label)}</label>
      <textarea id="${p}-input" rows="1" placeholder="${escapeHtml(o.placeholder)}"></textarea>
      <div class="row cfoot">
        ${o.files ? `<button class="attach" id="${p}-attach" type="button" aria-haspopup="menu" aria-label="${t("Add: a file, a tracked question or a claim")}" title="${t("Add: a file, a tracked question or a claim")}">${iconPlus()}</button>
        <input type="file" id="${p}-file" multiple style="display:none" aria-label="${t("Choose files to send")}">`
        // W3-S4-C: the upload route has no thread target, so the thread box has no attach button;
        // a Primer tooltip in its place says where files go instead of leaving a silent gap.
        : `<span class="attach-note tooltipped tooltipped-n" role="img" tabindex="0" aria-label="${escapeHtml(t("Files go to the conversation: attach them in the main message box"))}">${iconPlus()}</span>`}
        <div class="fmtbar" role="toolbar" aria-label="${t("Formatting")}">
          ${FORMATS.map((f) => `<button type="button" class="fmt" data-fmt="${f.id}" aria-label="${escapeHtml(f.label())}" title="${escapeHtml(f.label())}${f.key ? ` (Ctrl+${f.key.toUpperCase()})` : ""}">${f.glyph}</button>`).join("")}
        </div>
        <span class="cspacer"></span>
        <button type="button" class="iconbtn emoji" id="${p}-emoji" aria-label="${t("Insert an emoji")}" title="${t("Emoji")}">${iconAddReaction()}</button>
        <button class="send" id="${p}-send" disabled aria-label="${o.sendLabel ? escapeHtml(o.sendLabel) : t("Send the message")}" title="${t("Send (Enter)")}">${iconSend()}</button>
      </div>
      ${o.footer || ""}
    </div>`;
}

/** The formatting bar: a click wraps the selection; Ctrl/Cmd+B, I, K do the same from the keys. */
export function bindFormatting(ta, card) {
  const apply = (fmt) => {
    const f = FORMATS.find((x) => x.id === fmt);
    if (!f) return;
    const r = wrapSelection(ta.value, ta.selectionStart ?? 0, ta.selectionEnd ?? 0, f.marker);
    ta.value = r.text;
    ta.setSelectionRange(r.start, r.end);
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  };
  (card?.querySelectorAll("[data-fmt]") ?? []).forEach((b) => {
    // pointerdown + preventDefault keeps the selection in the textarea; a click would blur it first.
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", () => apply(b.dataset.fmt));
  });
  return (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
    const f = FORMATS.find((x) => x.key && x.key === e.key.toLowerCase());
    if (!f) return false;
    e.preventDefault();
    apply(f.id);
    return true;
  };
}

// ------------------------------------------------------------- emoji picker
let closePicker = null;

/** A searchable picker anchored above `anchor`; `onPick(ch)` receives the chosen emoji. */
export function openEmojiPicker(anchor, onPick) {
  if (closePicker) { closePicker(); return; }
  const pop = document.createElement("div");
  pop.className = "emoji-picker";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("Emoji"));
  pop.innerHTML = `
    <input type="search" class="ep-search" placeholder="${t("Search emoji")}" aria-label="${t("Search emoji")}" autocomplete="off">
    <div class="ep-grid" role="listbox"></div>`;
  document.body.appendChild(pop);
  const search = pop.querySelector(".ep-search");
  const grid = pop.querySelector(".ep-grid");
  const draw = () => {
    const found = searchEmoji(search.value, lang()).slice(0, 160);
    grid.innerHTML = found.length
      ? found.map((e) => `<button type="button" role="option" data-pick="${escapeHtml(e.ch)}" title="${escapeHtml(lang() === "pl" ? e.pl : e.en)}">${e.ch}</button>`).join("")
      : `<p class="ep-empty">${t("No emoji matches - paste one, it works too.")}</p>`;
  };
  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth, vh = vv?.height ?? window.innerHeight;
    const top = rect.top - pop.offsetHeight - 8;
    pop.style.top = `${Math.max(8, top < 8 ? Math.min(rect.bottom + 8, vh - pop.offsetHeight - 8) : top)}px`;
    pop.style.left = `${Math.max(8, Math.min(rect.left, vw - pop.offsetWidth - 8))}px`;
  };
  const pick = (ch) => { rememberEmoji(ch); close(); onPick(ch); };
  const onGrid = (e) => { const b = e.target.closest("[data-pick]"); if (b) pick(b.dataset.pick); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); anchor.focus(); return; }
    if (e.key === "Enter" && e.target === search) {
      const first = grid.querySelector("[data-pick]");
      if (first) { e.preventDefault(); pick(first.dataset.pick); }
    }
  };
  const onOutside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) close(); };
  function close() {
    pop.removeEventListener("click", onGrid);
    pop.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onOutside, true);
    pop.remove();
    closePicker = null;
  }
  pop.addEventListener("click", onGrid);
  pop.addEventListener("keydown", onKey);
  search.addEventListener("input", draw);
  setTimeout(() => document.addEventListener("pointerdown", onOutside, true), 0);
  draw();
  place();
  search.focus();
  closePicker = close;
}

// ------------------------------------------------------------- @ and # autocomplete
/**
 * One popover for `@people` and `#channels`. `providers.actors()` resolves to the actor list
 * (it may refresh the directory first); channels come from the state synchronously.
 * Returns { refresh, keydown, close }: call refresh() on input, keydown(e) first in the
 * textarea's keydown (true = consumed), close() before sending.
 */
export function createAutocomplete(ta, providers) {
  let pop = null, items = [], index = 0, start = -1, kind = null, seq = 0;

  function close() {
    if (pop) { pop.remove(); pop = null; }
    items = []; kind = null;
  }

  function mentionItems(actors, q) {
    const query = q.toLowerCase();
    const allItem = { handle: "all", displayName: t("everybody on the channel"), kind: "all" };
    const showAll = !query || ["all", ...(providers.allAliases || [])].some((alias) => alias.startsWith(query));
    return [
      ...(showAll ? [allItem] : []),
      ...(actors || [])
        .filter((a) => a.handle !== state.actor?.handle)
        .filter((a) => !query || a.handle.toLowerCase().includes(query) || (a.displayName || "").toLowerCase().includes(query)),
    ].slice(0, 6);
  }

  async function refresh() {
    const caret = ta.selectionStart ?? ta.value.length;
    let tok = completeToken(ta.value, caret, "@"), tokKind = "@";
    if (!tok) { tok = completeToken(ta.value, caret, "#"); tokKind = "#"; }
    // S5: "/" at the start of the box opens the command list through this same engine (one
    // popover, the same keys: arrows, Tab/Enter complete, Esc closes). commands.js owns the rows.
    let cmd = null;
    if (!tok) { cmd = commandSuggestions(ta.value, caret); if (cmd) { tok = { start: cmd.start, query: "" }; tokKind = "/"; } }
    if (!tok) { close(); return; }
    const mySeq = ++seq;
    let found;
    if (cmd) {
      found = cmd.items;
    } else if (tokKind === "@") {
      let actors = [];
      try { actors = await providers.actors(); } catch { /* offline: the list simply stays closed */ }
      // The sequence guard (M10): a slower answer to an older keystroke must not re-open the
      // list over a name the user has already picked or a token that is no longer there.
      if (mySeq !== seq) return;
      const again = completeToken(ta.value, ta.selectionStart ?? ta.value.length, "@");
      if (!again || again.start !== tok.start) return;
      found = mentionItems(actors, again.query).map((a) => ({ ...a, insert: "@" + a.handle }));
    } else {
      found = channelCandidates(tok.query, state.conversations, state.memberships)
        .map((c) => ({ ...c, kind: "channel", insert: "#" + c.slug }));
    }
    if (!found.length) { close(); return; }
    items = found; index = 0; start = tok.start; kind = tokKind;
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "mention-pop";
      pop.setAttribute("role", "listbox");
      document.body.appendChild(pop);
    }
    pop.innerHTML = items.map((a, i) => a.html ? a.html : kind === "#"
      ? `<button type="button" role="option" data-mi="${i}" class="${i === index ? "sel" : ""}">
          <span class="mention-all-ic">#</span>
          <span class="mh">#${escapeHtml(a.slug)}</span>
          <span class="kindtag">${a.member ? t("your channel") : t("you can join")}</span>
        </button>`
      : `<button type="button" role="option" data-mi="${i}" class="${i === index ? "sel" : ""}">
          ${a.kind === "all" ? `<span class="mention-all-ic">@</span>` : avatarHtml(a.handle, 22)}
          <span class="mh">@${escapeHtml(a.handle)}</span>
          <span class="kindtag ${a.kind === "all" ? "" : a.kind}">${a.kind === "all" ? t("the whole channel") : a.kind === "human" ? t("human") : t("agent")}</span>
        </button>`).join("");
    place();
    // pointerdown, not click: on touch the emulated mouse arrives after the field lost focus.
    pop.querySelectorAll("[data-mi]").forEach((b) =>
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); pick(Number(b.dataset.mi)); }));
  }

  /** Clamped to the VISIBLE viewport: on a phone the keyboard covers the bottom of the window. */
  function place() {
    const rect = ta.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewport = { top: vv?.offsetTop ?? 0, left: vv?.offsetLeft ?? 0,
      width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
    const margin = 8;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(rect.left + margin, viewport.left + viewport.width - w - margin);
    left = Math.max(viewport.left + margin, left);
    let top = rect.top - h - 6;
    if (top < viewport.top + margin) {
      top = rect.bottom + 6 + h <= viewport.top + viewport.height ? rect.bottom + 6 : viewport.top + margin;
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }

  function pick(i) {
    const a = items[i];
    if (!a) return;
    const after = ta.value.slice(ta.selectionStart ?? ta.value.length);
    ta.value = ta.value.slice(0, start) + a.insert + " " + after;
    const pos = start + a.insert.length + 1;
    ta.setSelectionRange(pos, pos);
    close();
    seq++;   // an answer still in flight for the old token is stale now
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  }

  function keydown(e) {
    if (!pop) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      index = (index + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      pop.querySelectorAll("[data-mi]").forEach((b, i) => b.classList.toggle("sel", i === index));
      return true;
    }
    // Shift+Enter belongs to the textarea: a newline, even with the list open (M10).
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); pick(index); return true; }
    if (e.key === "Escape") { close(); return true; }
    return false;
  }

  return { refresh, keydown, close, isOpen: () => !!pop };
}
