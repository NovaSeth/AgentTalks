/**
 * MCP: glowny interfejs agentow.
 *
 * Jedyne miejsce w projekcie z zaleznoscia npm (@modelcontextprotocol/sdk) - rdzen,
 * REST, CLI i UI pozostaja na samej bibliotece standardowej. Uzywamy niskopoziomowego
 * `Server` z JSON Schema zamiast wysokopoziomowego `McpServer`, zeby nie wciagac
 * zod jako drugiej zaleznosci.
 *
 * Uwierzytelnienie: WYLACZNIE bearer token aktora - ten sam, co w REST. Klient MCP
 * (np. `claude mcp add --transport http agenttalks <url>/mcp --header "Authorization:
 * Bearer atk_..."`) jest wiec konkretnym aktorem i kazde narzedzie dziala w jego
 * imieniu. Zadnego pola "who" w argumentach - tozsamosc nie jest argumentem.
 *
 * Transport: Streamable HTTP, bezstanowo - kazde zadanie dostaje swezy par
 * server+transport, jak w prototypie. Stan (sesje, kursory) zyje w bazie, nie
 * w obiekcie serwera.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../core/ctx.ts";
import type { Config } from "../config.ts";
import type { Actor } from "../core/actors.ts";
import { getActorByHandle } from "../core/actors.ts";
import {
  assertCanRead,
  ensureDirect,
  getBySlug,
  getConversation,
  members,
  type Conversation,
} from "../core/conversations.ts";
import { AppError, badRequest, notFound } from "../core/errors.ts";
import { inboxAfter, lastMessageId, listMessages, listThread, postMessage, type Message }
  from "../core/messages.ts";
import { actorLiveness, presence, registerSession, setDoing, signal, type SessionKind }
  from "../core/presence.ts";
import { answer, ask, openQuestions } from "../core/questions.ts";
import { react } from "../core/reactions.ts";
import { search } from "../core/search.ts";
import { markRead, unreadFor } from "../core/unread.ts";
import { digestFor } from "../core/digest.ts";
import { mentionsOf } from "../core/mentions.ts";
import { acquire, listLeases, release } from "../core/leases.ts";
import type { Req, Res } from "../http/router.ts";

const WAIT_MAX_SEC = 300;
const PROGRESS_INTERVAL_MS = 20_000;

// ---- opisy narzedzi -------------------------------------------------------

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const S = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> =>
  ({ type: "object", properties, required });

const CONV_DESC =
  "Adres konwersacji: '#kanal' (np. '#general'), '@handle' (rozmowa 1:1), " +
  "'@a,@b' (grupa) albo liczbowe id konwersacji.";

export const TOOLS: ToolDef[] = [
  {
    name: "talk_whoami",
    description: "Kim jestem wedlug serwera (handle i rodzaj).",
    inputSchema: S({}),
  },
  {
    name: "talk_status",
    description:
      "Pelny obraz kanalu w jednym wywolaniu: kto jest, nieprzeczytane, otwarte pytania, " +
      "ostatnie wiadomosci. Zacznij od tego.",
    inputSchema: S({}),
  },
  {
    name: "talk_send",
    description: "Wyslij wiadomosc. Przy rozmowie prywatnej odpowiedz mowi, czy adresaci zyja.",
    inputSchema: S(
      {
        to: { type: "string", description: CONV_DESC },
        body: { type: "string", description: "Tresc wiadomosci." },
        threadId: { type: "number", description: "Opcjonalnie: id wiadomosci, na ktora odpowiadasz (watek)." },
        sessionId: { type: "string", description: "Opcjonalnie: id Twojej sesji." },
      },
      ["to", "body"],
    ),
  },
  {
    name: "talk_read",
    description:
      "Nowe wiadomosci dla Ciebie (ze wszystkich Twoich konwersacji). Podaj afterId z poprzedniego " +
      "wywolania jako kursor. waitSec > 0 czeka na pierwsza nowa wiadomosc (long-poll, max 300 s).",
    inputSchema: S({
      afterId: { type: "number", description: "Kursor: najwyzsze widziane id wiadomosci. Domyslnie 0." },
      waitSec: { type: "number", description: "Ile sekund czekac, gdy nic nie ma (0 = wroc od razu)." },
    }),
  },
  {
    name: "talk_log",
    description: "Historia jednej konwersacji (ostatnie N). Oznacza ja jako przeczytana.",
    inputSchema: S(
      {
        conversation: { type: "string", description: CONV_DESC },
        limit: { type: "number", description: "Ile wiadomosci (domyslnie 20)." },
        beforeId: { type: "number", description: "Stronicowanie wstecz: wiadomosci starsze niz to id." },
      },
      ["conversation"],
    ),
  },
  {
    name: "talk_who",
    description: "Kto jest w kanale: sesje, stan (pisze/pracuje/aktywna/cisza), co robia.",
    inputSchema: S({}),
  },
  {
    name: "talk_ask",
    description:
      "Otwarte pytanie do KANALU, nie do konkretnej sesji - podejmie je ktokolwiek, kto wroci.",
    inputSchema: S(
      { conversation: { type: "string", description: CONV_DESC },
        body: { type: "string", description: "Tresc pytania." } },
      ["conversation", "body"],
    ),
  },
  {
    name: "talk_answer",
    description: "Odpowiedz na otwarte pytanie i zamknij je.",
    inputSchema: S(
      { questionId: { type: "number" }, body: { type: "string" } },
      ["questionId", "body"],
    ),
  },
  {
    name: "talk_open",
    description: "Otwarte pytania bez odpowiedzi (z konwersacji, ktore widzisz).",
    inputSchema: S({ conversation: { type: "string", description: CONV_DESC + " Opcjonalne." } }),
  },
  {
    name: "talk_react",
    description: "Przypnij emoji do wiadomosci (drugie takie samo zdejmuje).",
    inputSchema: S(
      { messageId: { type: "number" }, emoji: { type: "string" } },
      ["messageId", "emoji"],
    ),
  },
  {
    name: "talk_search",
    description: "Szukaj w historii (FTS, przedrostki). Tylko konwersacje, ktore masz prawo czytac.",
    inputSchema: S(
      {
        q: { type: "string", description: "Fraza." },
        conversation: { type: "string", description: CONV_DESC + " Opcjonalne." },
        sinceTs: { type: "number", description: "Od (sekundy uniksowe)." },
        untilTs: { type: "number", description: "Do (sekundy uniksowe)." },
        limit: { type: "number" },
      },
      ["q"],
    ),
  },
  {
    name: "talk_thread",
    description: "Caly watek wiadomosci (korzen + odpowiedzi).",
    inputSchema: S({ messageId: { type: "number" } }, ["messageId"]),
  },
  {
    name: "talk_digest",
    description: "Co sie dzialo pod Twoja nieobecnosc: kto, gdzie, wzmianki, otwarte pytania.",
    inputSchema: S({}),
  },
  {
    name: "talk_mentions",
    description: "Wiadomosci wspominajace @Ciebie.",
    inputSchema: S({ afterId: { type: "number" } }),
  },
  {
    name: "talk_seen",
    description: "Oznacz konwersacje jako przeczytana (do podanej wiadomosci albo do konca).",
    inputSchema: S(
      { conversation: { type: "string", description: CONV_DESC },
        messageId: { type: "number" } },
      ["conversation"],
    ),
  },
  {
    name: "talk_register",
    description:
      "Zarejestruj/odswiez swoja sesje w obecnosci. kind='ephemeral' dla wcielen jednorazowych. " +
      "doing = nad czym pracujesz (widoczne dla innych).",
    inputSchema: S(
      {
        sessionId: { type: "string" },
        label: { type: "string", description: "Czytelna etykieta sesji, np. 'vps' albo 'deploy-motowolt'." },
        kind: { type: "string", enum: ["durable", "ephemeral"] },
        doing: { type: "string" },
      },
      ["sessionId"],
    ),
  },
  {
    name: "talk_claim",
    description:
      "Zajmij zasob na wylacznosc z TTL (dzierzawa). Odpowiedz synchroniczna: GRANTED albo kto " +
      "trzyma i na jak dlugo. Blokada jest SPRAWDZANA przez serwer, nie ogloszona proza.",
    inputSchema: S(
      {
        resource: { type: "string", description: "Nazwa zasobu, np. 'wiki/topics/vps.md' albo 'deploy'." },
        ttlSec: { type: "number", description: "Czas dzierzawy w sekundach (domyslnie 120, max 86400)." },
        note: { type: "string", description: "Po co bierzesz (widoczne dla pytajacych)." },
        sessionId: { type: "string" },
      },
      ["resource"],
    ),
  },
  {
    name: "talk_release",
    description: "Zwolnij zasob wziety przez talk_claim.",
    inputSchema: S({ resource: { type: "string" } }, ["resource"]),
  },
  {
    name: "talk_leases",
    description: "Aktywne dzierzawy zasobow: co jest zajete, przez kogo, na jak dlugo.",
    inputSchema: S({}),
  },
];

// ---- adresowanie konwersacji ---------------------------------------------

function resolveConversation(ctx: Ctx, actor: Actor, ref: string): Conversation {
  const raw = String(ref ?? "").trim();
  if (!raw) throw badRequest("brak_adresu", "podaj adres konwersacji");
  // Kazda galaz konczy sie kontrola dostepu. To NIE jest nadgorliwosc: narzedzia
  // MCP ida z resolveConversation prosto do prymitywow rdzenia (listMessages,
  // markRead), wiec to tutaj jest granica, na ktorej numer cudzej prywatnej
  // rozmowy ma przestac dzialac.
  if (/^\d+$/.test(raw)) {
    return assertCanRead(ctx, Number(raw), actor.id);
  }
  if (raw.startsWith("#")) {
    const conv = getBySlug(ctx, raw);
    // Kanal nieistniejacy i prywatny-bez-dostepu MUSZA dac ten sam blad: inaczej
    // roznica tresci ("nie ma kanalu" vs "brak dostepu") jest wyrocznia istnienia
    // kanalu prywatnego po nazwie. assertCanRead z niemozliwym id daje spojny blad.
    return assertCanRead(ctx, conv ? conv.id : -1, actor.id);
  }
  // '@a' albo '@a,@b' -> rozmowa bezposrednia (dm/grupa), zakladana w locie.
  const handles = raw.split(/[\s,]+/).filter(Boolean);
  const ids = handles.map((h) => {
    const a = getActorByHandle(ctx, h);
    if (!a) throw notFound("aktor", `nie ma aktora ${h}`);
    return a.id;
  });
  return ensureDirect(ctx, [actor.id, ...ids]);
}

// ---- rendering ------------------------------------------------------------
// Wyjscie MCP to tekst dla agenta: zwarty, z identyfikatorami (id wiadomosci,
// id pytan), bo agent bedzie ich uzywal w kolejnych wywolaniach.

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function convName(ctx: Ctx, id: number): string {
  const conv = getConversation(ctx, id);
  if (!conv) return `konwersacja ${id}`;
  if (conv.slug) return `#${conv.slug}`;
  const who = members(ctx, id)
    .map((m) => (ctx.db.prepare("SELECT handle FROM actors WHERE id = ?").get(m.actorId) as
      { handle: string } | undefined)?.handle ?? "?")
    .join(", ");
  return `[${conv.kind}:${id} ${who}]`;
}

function fmtMsg(ctx: Ctx, m: Message): string {
  const a = ctx.db.prepare("SELECT handle, kind FROM actors WHERE id = ?").get(m.actorId) as
    { handle: string; kind: string } | undefined;
  // Rodzaj autora widoczny INLINE: agent egzekwujacy "zgoda na produkcje tylko od
  // czlowieka" musi tanio wiedziec, kto pisze - feedback 332c7e42 (afera o zgode
  // na deploy wziela sie z tego, ze nie dalo sie tanio powiedziec "czy to czlowiek").
  const author = a ? (a.kind === "human" ? `${a.handle}:czlowiek` : a.handle) : "?";
  const tags: string[] = [];
  if (m.kind === "ask") tags.push("PYTANIE");
  if (m.kind === "answer") tags.push("odpowiedz");
  if (m.kind === "file") tags.push("plik");
  if (m.threadId) tags.push(`watek:${m.threadId}`);
  if (m.deletedAt) tags.push("skasowana");
  const tag = tags.length ? ` (${tags.join(", ")})` : "";
  return `[${m.id}] ${fmtTs(m.ts)} ${convName(ctx, m.conversationId)} <${author}>${tag}: ${m.body}`;
}

function renderStatus(ctx: Ctx, actor: Actor): string {
  const out: string[] = [`Jestes @${actor.handle}.`];
  const rows = presence(ctx);
  out.push("", "=== KTO JEST ===");
  if (rows.length === 0) out.push("  (nikogo)");
  for (const p of rows) {
    const state = p.typing ? "PISZE" : p.busy ? "pracuje" : p.online ? "aktywna" : "cisza";
    out.push(
      `  [${state}] @${p.handle} (${p.label})` +
        (p.doing ? ` - robi: ${p.doing}` : ""),
    );
  }
  const unread = unreadFor(ctx, actor.id).filter((r) => r.unread > 0);
  out.push("", "=== NIEPRZECZYTANE ===");
  if (unread.length === 0) out.push("  (nic)");
  for (const r of unread) {
    out.push(`  ${r.unread} (plakietki: ${r.badge}) w ${convName(ctx, r.conversationId)}`);
  }
  const open = openQuestions(ctx, { actorId: actor.id });
  out.push("", "=== OTWARTE PYTANIA ===");
  if (open.length === 0) out.push("  (nic)");
  for (const q of open) out.push(`  [q${q.id}] ${fmtMsg(ctx, q.message)}`);
  const last = inboxAfter(ctx, actor.id, Math.max(0, lastMessageId(ctx) - 200)).slice(-8);
  out.push("", "=== OSTATNIE WIADOMOSCI DO CIEBIE ===");
  if (last.length === 0) out.push("  (nic nowego)");
  for (const m of last) out.push(`  ${fmtMsg(ctx, m)}`);
  out.push("", `Kursor do talk_read: afterId=${lastMessageId(ctx)}`);
  return out.join("\n");
}

// ---- wykonanie narzedzi ---------------------------------------------------

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });

async function callTool(
  ctx: Ctx,
  config: Config,
  actor: Actor,
  name: string,
  args: Record<string, unknown>,
  extra: {
    progressToken?: string | number;
    sendNotification?: (n: unknown) => Promise<void>;
  },
): Promise<ToolResult> {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined;
  const strv = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  switch (name) {
    case "talk_status":
      return text(renderStatus(ctx, actor));

    case "talk_whoami":
      return text(`@${actor.handle} (${actor.kind})`);

    case "talk_send": {
      const conv = resolveConversation(ctx, actor, strv(args.to) ?? "");
      const message = postMessage(ctx, {
        conversationId: conv.id,
        actorId: actor.id,
        body: strv(args.body) ?? "",
        threadId: num(args.threadId) ?? null,
        sessionId: strv(args.sessionId) ?? null,
        maxBytes: config.maxMessageBytes,
      });
      let deliveryNote = "";
      if (conv.kind === "dm" || conv.kind === "group") {
        deliveryNote = "\n" + members(ctx, conv.id)
          .filter((m) => m.actorId !== actor.id)
          .map((m) => {
            const handle = (ctx.db.prepare("SELECT handle FROM actors WHERE id = ?")
              .get(m.actorId) as { handle: string }).handle;
            const live = actorLiveness(ctx, m.actorId);
            const state = live.online
              ? "zywa"
              : live.lastSeenAt
                ? `cisza ${Math.round((ctx.now() - live.lastSeenAt) / 60)} min`
                : "NIEOBECNA (zadnej zywej sesji)";
            return `  @${handle}: ${state}`;
          })
          .join("\n");
      }
      return text(`wyslane [${message.id}] do ${convName(ctx, conv.id)}${deliveryNote}`);
    }

    case "talk_read": {
      const after = num(args.afterId) ?? 0;
      const waitSec = Math.min(Math.max(num(args.waitSec) ?? 0, 0), WAIT_MAX_SEC);
      let messages = inboxAfter(ctx, actor.id, after);
      if (messages.length === 0 && waitSec > 0) {
        messages = await waitForInbox(ctx, actor.id, after, waitSec, extra);
      }
      if (messages.length === 0) {
        return text(`Brak nowych wiadomosci. Kursor: afterId=${after}`);
      }
      const lines = messages.map((m) => fmtMsg(ctx, m));
      const cursor = messages[messages.length - 1].id;
      return text(`${messages.length} nowych:\n${lines.join("\n")}\n\nKursor: afterId=${cursor}`);
    }

    case "talk_log": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      const messages = listMessages(ctx, {
        conversationId: conv.id,
        limit: num(args.limit) ?? 20,
        before: num(args.beforeId),
      });
      markRead(ctx, actor.id, conv.id);
      if (messages.length === 0) return text(`Pusto w ${convName(ctx, conv.id)}.`);
      return text(messages.map((m) => fmtMsg(ctx, m)).join("\n"));
    }

    case "talk_who": {
      const rows = presence(ctx);
      if (rows.length === 0) return text("Nikogo nie ma.");
      return text(rows.map((p) => {
        const state = p.typing ? "PISZE" : p.busy ? "pracuje" : p.online ? "aktywna" : "cisza";
        const age = Math.round((ctx.now() - p.lastSeenAt) / 60);
        const who = ctx.db.prepare("SELECT kind FROM actors WHERE id = ?").get(p.actorId) as
          { kind: string } | undefined;
        const kindTag = who?.kind === "human" ? " [czlowiek]" : "";
        return `[${state}] @${p.handle}${kindTag} (${p.label}) ostatnio ${age} min temu` +
          (p.doing ? ` - robi: ${p.doing}` : "");
      }).join("\n"));
    }

    case "talk_ask": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      const q = ask(ctx, { conversationId: conv.id, actorId: actor.id,
                           body: strv(args.body) ?? "" });
      return text(
        `otwarte pytanie [q${q.question}] na ${convName(ctx, conv.id)} - ` +
          `odpowie ktokolwiek: talk_answer(questionId=${q.question})`,
      );
    }

    case "talk_answer": {
      const r = answer(ctx, { questionId: num(args.questionId) ?? 0, actorId: actor.id,
                              body: strv(args.body) ?? "" });
      return text(`odpowiedziane, wiadomosc [${r.message.id}]`);
    }

    case "talk_open": {
      const ref = strv(args.conversation);
      const conv = ref ? resolveConversation(ctx, actor, ref) : null;
      const items = openQuestions(ctx, { actorId: actor.id, conversationId: conv?.id });
      if (items.length === 0) return text("Brak otwartych pytan.");
      return text(items.map((q) => `[q${q.id}] ${fmtMsg(ctx, q.message)}`).join("\n"));
    }

    case "talk_react": {
      const r = react(ctx, { messageId: num(args.messageId) ?? 0, actorId: actor.id,
                             emoji: strv(args.emoji) ?? "" });
      return text(r.on ? "reakcja dodana" : "reakcja zdjeta");
    }

    case "talk_search": {
      const ref = strv(args.conversation);
      const conv = ref ? resolveConversation(ctx, actor, ref) : null;
      const hits = search(ctx, {
        actorId: actor.id,
        text: strv(args.q) ?? "",
        conversationId: conv?.id,
        sinceTs: num(args.sinceTs),
        untilTs: num(args.untilTs),
        limit: num(args.limit),
      });
      if (hits.length === 0) return text("Brak trafien.");
      return text(hits.map((m) => fmtMsg(ctx, m)).join("\n"));
    }

    case "talk_thread": {
      const root = num(args.messageId) ?? 0;
      const first = ctx.db.prepare("SELECT conversation_id, thread_id FROM messages WHERE id = ?")
        .get(root) as { conversation_id: number; thread_id: number | null } | undefined;
      // Nieistniejaca wiadomosc i wiadomosc z kanalu bez dostepu daja ten sam blad
      // ("brak dostepu" z assertCanRead) - id sa globalne, wiec rozne odpowiedzi
      // zdradzalyby istnienie tresci w cudzych kanalach.
      resolveConversation(ctx, actor, String(first ? first.conversation_id : -1));
      const messages = listThread(ctx, first!.thread_id ?? root);
      return text(messages.map((m) => fmtMsg(ctx, m)).join("\n"));
    }

    case "talk_digest": {
      const d = digestFor(ctx, actor.id);
      if (!d) return text("Nic nowego od Twojej ostatniej aktywnosci.");
      const out = [
        `Pod Twoja nieobecnosc: ${d.count} wiadomosci`,
        "  kto:    " + d.byWho.map(([k, v]) => `${k} x${v}`).join(", "),
        "  gdzie:  " + d.byConversation.map(([k, v]) => `${k} x${v}`).join(", "),
      ];
      if (d.mentions.length) {
        out.push(`  DOTYCZY CIEBIE (${d.mentions.length}):`);
        for (const m of d.mentions.slice(-3)) out.push("    " + fmtMsg(ctx, m));
      }
      if (d.open.length) {
        out.push(`  OTWARTE PYTANIA (${d.open.length}):`);
        for (const q of d.open) out.push(`    [q${q.id}] ${fmtMsg(ctx, q.message)}`);
      }
      return text(out.join("\n"));
    }

    case "talk_mentions": {
      const ms = mentionsOf(ctx, actor.id, { afterId: num(args.afterId) });
      if (ms.length === 0) return text("Brak wzmianek.");
      return text(ms.map((m) => fmtMsg(ctx, m)).join("\n"));
    }

    case "talk_seen": {
      const conv = resolveConversation(ctx, actor, strv(args.conversation) ?? "");
      markRead(ctx, actor.id, conv.id, num(args.messageId));
      return text(`oznaczone jako przeczytane: ${convName(ctx, conv.id)}`);
    }

    case "talk_register": {
      const sessionId = strv(args.sessionId);
      if (!sessionId) throw badRequest("brak_sessionid", "podaj sessionId");
      const owner = ctx.db.prepare("SELECT actor_id FROM sessions WHERE id = ?")
        .get(sessionId) as { actor_id: number } | undefined;
      if (owner && owner.actor_id !== actor.id) {
        throw badRequest("nie_twoja_sesja", "ta sesja nalezy do innego aktora");
      }
      const kind = strv(args.kind);
      registerSession(ctx, {
        sessionId,
        actorId: actor.id,
        label: strv(args.label),
        kind: (kind === "ephemeral" ? "ephemeral" : "durable") as SessionKind,
      });
      signal(ctx, sessionId, "busy");
      if (args.doing !== undefined) setDoing(ctx, sessionId, strv(args.doing) ?? null);
      return text(`sesja ${sessionId} zarejestrowana jako @${actor.handle}`);
    }

    case "talk_claim": {
      const r = acquire(ctx, {
        resource: strv(args.resource) ?? "",
        actorId: actor.id,
        ttlSec: num(args.ttlSec),
        note: strv(args.note) ?? null,
        sessionId: strv(args.sessionId) ?? null,
      });
      if (r.granted) {
        return text(`GRANTED ${r.lease.resource} do ${fmtTs(r.lease.expiresAt)} ` +
          `(${r.lease.expiresAt - ctx.now()} s)`);
      }
      return {
        content: [{
          type: "text",
          text: `HELD-BY @${r.heldBy.handle} jeszcze ${r.heldBy.expiresAt - ctx.now()} s` +
            (r.heldBy.note ? ` (${r.heldBy.note})` : ""),
        }],
        isError: true,
      };
    }

    case "talk_release": {
      const r = release(ctx, { resource: strv(args.resource) ?? "", actorId: actor.id });
      if (r.released) return text("UNLOCKED");
      return {
        content: [{ type: "text", text: `DENIED - trzyma @${r.heldBy!.handle}` }],
        isError: true,
      };
    }

    case "talk_leases": {
      const leases = listLeases(ctx);
      if (leases.length === 0) return text("Nic nie jest zajete.");
      return text(leases.map((l) =>
        `${l.resource}  @${l.handle}  jeszcze ${l.expiresAt - ctx.now()} s` +
          (l.note ? `  (${l.note})` : ""),
      ).join("\n"));
    }

    default:
      throw badRequest("nieznane_narzedzie", `nie ma narzedzia ${name}`);
  }
}

/** Long-poll wewnatrz wywolania MCP, z heartbeatem progress co 20 s - mechanizm
 *  przeniesiony z prototypu (tam uratowal kilkunastominutowe zadania przed
 *  timeoutem ciszy). Zastrzezenie z feedbacku #nextIteration wdrozone: gdy klient
 *  NIE podal progressToken, zostawiamy slad w logu zamiast dzialac po cichu. */
function waitForInbox(
  ctx: Ctx,
  actorId: number,
  afterId: number,
  waitSec: number,
  extra: { progressToken?: string | number; sendNotification?: (n: unknown) => Promise<void> },
): Promise<Message[]> {
  if (extra.progressToken === undefined) {
    console.warn(
      `[mcp] talk_read czeka ${waitSec}s bez progressToken - klient moze zerwac na limicie ciszy`,
    );
  }
  return new Promise((resolve) => {
    let ticks = 0;
    const heartbeat = extra.progressToken !== undefined && extra.sendNotification
      ? setInterval(() => {
          void extra.sendNotification!({
            method: "notifications/progress",
            params: {
              progressToken: extra.progressToken,
              progress: ++ticks,
              message: `czekam na wiadomosci (${ticks * 20}s) - to nie timeout`,
            },
          }).catch(() => {});
        }, PROGRESS_INTERVAL_MS)
      : undefined;
    heartbeat?.unref?.();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      clearTimeout(timer);
      resolve(inboxAfter(ctx, actorId, afterId));
    };
    const unsubscribe = ctx.bus.subscribe(actorId, (event) => {
      // Budzimy sie tylko na CUDZE wiadomosci: inboxAfter i tak pomija wlasne,
      // wiec obudzenie sie na wlasnej konczylo long-poll pusta lista, choc dla
      // aktora nadal moglo nic nie byc - i klient odpytywal od nowa bez potrzeby.
      if (event.type === "message" && event.message.actorId !== actorId) finish();
    });
    const timer = setTimeout(finish, waitSec * 1000);
    if (typeof timer.unref === "function") timer.unref();
  });
}

// ---- montaz ---------------------------------------------------------------

function buildServer(ctx: Ctx, config: Config, actor: Actor): Server {
  const server = new Server(
    { name: "agenttalks", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    try {
      return await callTool(ctx, config, actor, name, (args ?? {}) as Record<string, unknown>, {
        progressToken: request.params._meta?.progressToken,
        sendNotification: extra?.sendNotification as ((n: unknown) => Promise<void>) | undefined,
      });
    } catch (err) {
      // Blad domenowy wraca jako wynik narzedzia (isError), nie jako blad protokolu:
      // agent ma go przeczytac i poprawic wywolanie, a nie zobaczyc zerwana sesje.
      const msg = err instanceof AppError || err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `blad: ${msg}` }], isError: true };
    }
  });
  return server;
}

/** Obsluga POST /mcp. Uwierzytelnienie zrobil wolajacy (bearer); tu dostajemy
 *  juz konkretnego aktora. */
export async function handleMcp(ctx: Ctx, config: Config, actor: Actor, req: Req, res: Res):
  Promise<void> {
  const server = buildServer(ctx, config, actor);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
