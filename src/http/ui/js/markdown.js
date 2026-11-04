/**
 * Markdown for messages and wiki pages. Escape FIRST, syntax after.
 */
import { escapeHtml } from "./dom.js";
import { iconCopy } from "./icons.js";
import { t } from "./i18n.js";
import { state } from "./state.js";

// -------------------------------------------------------- markdown (shared)
// Security: escape FIRST, syntax after. No user content lands in the DOM without
// escaping. Mode "message" = a modest subset (code, bold, italic, links, quotes, new
// lines); mode "page" = a fuller one (headings, lists, hr).
function mdInline(s, myHandle) {
  // Generated links and code are opaque to later substitutions, especially mentions.
  const fragments = [];
  const protect = (html) => { fragments.push(html); return `\x00I${fragments.length - 1}\x00`; };
  let out = s
    .replace(/`([^`\n]+)`/g, (m, code) => protect(`<code>${code}</code>`))
    // The wiki marker [[slug]] / [[slug|label]] - a click opens the page; a non-existent one
    // renders as "missing" and a click creates it in the editor.
    .replace(/\[\[([a-z0-9_-]{1,80})(?:\|([^\]\n]{1,120}))?\]\]/gi, (m, slug, label) => {
      const sl = slug.toLowerCase();
      const exists = state.wiki.pages.some((p) => p.slug === sl);
      // The ONLY exception to the "escape first, syntax after" rule: the slug and the label come
      // from text that is already escaped, but the page title arrives fresh from the /api/wiki
      // JSON and nobody cleaned it on the way. Without this escaping, a title containing
      // "<img onerror=...>" would execute for everybody who sees the [[link]].
      const shown = label ?? escapeHtml(state.wiki.pages.find((p) => p.slug === sl)?.title ?? slug).replace(/\x00/g, "");
      return protect(`<a href="#" class="wikilink ${exists ? "" : "missing"}" data-wikilink="${sl}" title="${escapeHtml(exists ? t("Wiki page") : t("This page does not exist yet - click to create it"))}">${shown}</a>`);
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (m, label, url) => protect(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`))
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      (m, pre, url) => pre + protect(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  out = out.replace(/(^|[\s(>])@([a-z0-9._-]{2,32})\b/gi, (m, pre, h) => {
    // @all (and its aliases) = a mention of the whole channel; highlighted, but not clickable
    // through to a profile (there is no "all" actor).
    if (["all", "channel", "here", "wszyscy", "kanal"].includes(h.toLowerCase())) {
      return `${pre}<span class="mention mention-all">@${h}</span>`;
    }
    const mine = myHandle && h.toLowerCase() === myHandle.toLowerCase();
    return `${pre}<span class="${mine ? "me-mention" : "mention"}" data-actor="${escapeHtml(h)}">@${h}</span>`;
  });
  // #slug of a conversation I can see is a link to it (S4, U3). A heading "# title" has a space
  // after the hash, "#1" is not a slug of mine and "a#b" sits inside a word: all stay text.
  out = out.replace(/(^|[\s(>])#([a-z0-9][a-z0-9_-]{0,79})\b/gi, (m, pre, slug) => {
    const known = state.conversations.some((c) => c.slug && c.slug.toLowerCase() === slug.toLowerCase());
    if (!known) return m;
    const sl = escapeHtml(slug.toLowerCase());
    return `${pre}<a href="#/c/${sl}" class="chanlink" data-channel="${sl}">#${slug}</a>`;
  });
  const restore = (text) => text.replace(/\x00I(\d+)\x00/g, (m, index) => restore(fragments[+index]));
  return restore(out);
}

export function mdToHtml(src, mode, myHandle) {
  // NUL is reserved for internal placeholders, never accepted from user input.
  const esc = escapeHtml(String(src ?? "").replace(/\x00/g, ""));
  const blocks = [];
  const text = esc.replace(/```(?:[a-z0-9_-]*)\n?([\s\S]*?)```/gi, (m, code) => {
    blocks.push(code.replace(/^\n+|\n+$/g, ""));
    return `\x00B${blocks.length - 1}\x00`;
  });
  const lines = text.split("\n");
  let html = "", list = null, para = [];
  const inline = (s) => mdInline(s, myHandle);
  const flushPara = () => {
    if (!para.length) return;
    const joined = mode === "message" ? para.map(inline).join("<br>") : inline(para.join(" "));
    html += `<p>${joined}</p>`; para = [];
  };
  const flushList = () => {
    if (!list) return;
    html += `<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`;
    list = null;
  };
  const isTableRow = (s) => /^\s*\|.*\|\s*$/.test(s);
  const isTableSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
  const splitCells = (s) => s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const bm = line.trim().match(/^\x00B(\d+)\x00$/);
    if (bm) {
      flushPara(); flushList();
      html += `<div class="mdpre"><button class="copybtn" data-copy title="${escapeHtml(t("Copy"))}">${iconCopy()}</button><pre><code>${blocks[+bm[1]]}</code></pre></div>`;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara(); flushList();
      const head = splitCells(line);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && isTableRow(lines[j]); j++) rows.push(splitCells(lines[j]));
      html += `<div class="mdtable"><table><thead><tr>${
        head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${
        rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "")}</td>`).join("")}</tr>`).join("")
      }</tbody></table></div>`;
      i = j - 1;
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (mode === "page") {
      const h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) { flushPara(); flushList(); const lv = h[1].length + 1; html += `<h${lv}>${inline(h[2])}</h${lv}>`; continue; }
      if (/^---+$/.test(line.trim())) { flushPara(); flushList(); html += "<hr>"; continue; }
      const ol = line.match(/^\d+[.)]\s+(.*)/);
      if (ol) { flushPara(); if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(ol[1]); continue; }
    }
    const ul = line.match(/^[-*]\s+(.*)/);
    if (ul) { flushPara(); if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(ul[1]); continue; }
    const q = line.match(/^&gt;\s?(.*)/);
    if (q) { flushPara(); flushList(); html += `<blockquote>${inline(q[1])}</blockquote>`; continue; }
    para.push(line);
  }
  flushPara(); flushList();
  return html;
}

export function renderBody(text, myHandle) {
  return mdToHtml(text, "message", myHandle);
}
